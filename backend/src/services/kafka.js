const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'insighthub-ingestion',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const producer = kafka.producer();
let isConnected = false;

const connect = async () => {
  if (!isConnected) {
    await producer.connect();
    isConnected = true;
    console.log('Kafka producer connected');
  }
};

const publishLog = async (log) => {
  await connect();
  
  await producer.send({
    topic: process.env.KAFKA_TOPIC || 'logs',
    messages: [
      { value: JSON.stringify(log) }
    ]
  });
};

module.exports = { publishLog };
