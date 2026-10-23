import { describe, it, expect, vi } from 'vitest';
import { createEventPublisher, createLegacyPublisher, withTimeout } from '../src/services/kafka.js';

// Like the real client, a producer refuses a second connect() ("Connect has already been called").
function fakeProducer(sendImpl) {
  let connectCalls = 0;
  return {
    connect: vi.fn(async () => {
      connectCalls += 1;
      if (connectCalls > 1) throw new Error('Connect has already been called elsewhere.');
    }),
    disconnect: vi.fn(async () => {}),
    send: vi.fn(sendImpl),
  };
}

function fakeKafka(sendImpl = async () => []) {
  const producers = [];
  const kafka = {
    producer: vi.fn(() => {
      const p = fakeProducer(sendImpl);
      producers.push(p);
      return p;
    }),
  };
  return { kafka, producers };
}

describe('event publisher', () => {
  it('sends key = String(projectId) and the contract value shape', async () => {
    const { kafka, producers } = fakeKafka();
    const event = { event_id: 'e1', message: 'boom' };
    await createEventPublisher(kafka, 'error-events').publish(7, [event], '2026-01-01T00:00:00.000Z');

    const record = producers[0].send.mock.calls[0][0];
    expect(record.topic).toBe('error-events');
    expect(record).not.toHaveProperty('acks'); // acks is producer config in this client
    expect(record.messages).toHaveLength(1);
    expect(record.messages[0].key).toBe('7');
    expect(JSON.parse(record.messages[0].value)).toEqual({
      schema: 1, project_id: 7, received_at: '2026-01-01T00:00:00.000Z', event,
    });
  });

  it('configures an idempotent, acks=all, single in-flight, bounded producer', async () => {
    const { kafka } = fakeKafka();
    await createEventPublisher(kafka, 'error-events').connect();
    const cfg = kafka.producer.mock.calls[0][0];
    expect(cfg.kafkaJS).toMatchObject({ idempotent: true, acks: -1, maxInFlightRequests: 1 });
    expect(cfg.kafkaJS.retry.retries).toBe(3);
    expect(cfg.partitioner).toBe('murmur2_random');
    expect(cfg['message.timeout.ms']).toBe(5000);
  });

  it('rejects when the send fails and recovers on the next publish with a new producer', async () => {
    let fail = true;
    const { kafka, producers } = fakeKafka(async () => {
      if (fail) throw new Error('broker down');
      return [];
    });
    const pub = createEventPublisher(kafka, 'error-events');
    await expect(pub.publish(1, [{}], 't')).rejects.toThrow('broker down');
    expect(pub.isConnected()).toBe(false);
    fail = false;
    await pub.publish(1, [{}], 't');
    expect(producers).toHaveLength(2);
    expect(producers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(producers[1].connect).toHaveBeenCalledTimes(1);
    expect(pub.isConnected()).toBe(true);
  });

  it('recovers after a failed connect (the client cannot connect the same producer twice)', async () => {
    const { kafka, producers } = fakeKafka();
    kafka.producer.mockImplementationOnce(() => {
      const p = fakeProducer(async () => []);
      p.connect.mockRejectedValueOnce(new Error('all broker connections are down'));
      producers.push(p);
      return p;
    });
    const pub = createEventPublisher(kafka, 'error-events');
    await expect(pub.publish(1, [{}], 't')).rejects.toThrow('all broker connections are down');
    await pub.publish(1, [{}], 't');
    expect(producers).toHaveLength(2);
    expect(producers[1].send).toHaveBeenCalledTimes(1);
  });

  it('does not hang when the broker never answers', async () => {
    vi.useFakeTimers();
    try {
      const { kafka } = fakeKafka(() => new Promise(() => {}));
      const p = createEventPublisher(kafka, 'error-events').publish(1, [{}], 't');
      const assertion = expect(p).rejects.toThrow('kafka send timed out');
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('legacy publisher', () => {
  it('sends the log without a key', async () => {
    const { kafka, producers } = fakeKafka();
    await createLegacyPublisher(kafka, 'logs').publishLog({ message: 'x' });
    expect(producers[0].send.mock.calls[0][0]).toEqual({ topic: 'logs', messages: [{ value: '{"message":"x"}' }] });
  });
});

describe('withTimeout', () => {
  it('rejects slow promises', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, 'thing')).rejects.toThrow('thing timed out');
  });
});
