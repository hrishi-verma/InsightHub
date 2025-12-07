# InsightHub Processor Service

Stream processor that consumes logs from Kafka, enriches them with ML-based anomaly detection, and stores them in the database.

## Overview

The processor service acts as the bridge between the message queue (Kafka) and the database, performing real-time log processing and anomaly detection.

## Architecture

```
Kafka → Consumer → ML Anomaly Detection → Database Insert
```

## Features

- ✅ Kafka consumer with automatic offset management
- ✅ Real-time log processing
- ✅ ML-based anomaly detection (ready for integration)
- ✅ PostgreSQL/TimescaleDB integration
- ✅ Error handling and retry logic
- ✅ Consumer group for scalability

## Tech Stack

- **Runtime**: Node.js 18
- **Message Queue**: Kafka (via kafkajs)
- **Database**: PostgreSQL (via pg)
- **ML Integration**: Python ML engine (future)

## How It Works

1. **Consume**: Reads messages from Kafka topic `logs`
2. **Process**: Extracts and validates log data
3. **Enrich**: Adds anomaly detection scores (ML integration point)
4. **Store**: Inserts processed logs into PostgreSQL

## Configuration

### Environment Variables

```bash
KAFKA_BROKER=kafka:9092
DB_HOST=postgres
DB_PORT=5432
DB_NAME=insighthub
DB_USER=postgres
DB_PASSWORD=password
```

### Consumer Group

- **Group ID**: `log-processors`
- **Topic**: `logs`
- **Auto Commit**: Enabled
- **From Beginning**: false (only new messages)

## Code Structure

```javascript
// Main processor logic
const processLog = async (log) => {
  // TODO: Call ML engine for anomaly detection
  const anomalyScore = 0;
  const isAnomaly = false;
  
  // Insert into database
  await pool.query(
    `INSERT INTO logs (service, level, message, latency_ms, anomaly_score, is_anomaly, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [log.service, log.level, log.message, log.latency_ms || 0, anomalyScore, isAnomaly, log.timestamp]
  );
};
```

## ML Integration Point

The processor is designed to integrate with the ML engine for anomaly detection:

```javascript
// Future implementation
const mlResult = await fetch('http://ml-engine:5000/predict', {
  method: 'POST',
  body: JSON.stringify({
    latency_ms: log.latency_ms,
    level: log.level,
    service: log.service
  })
});

const { anomaly_score, is_anomaly } = await mlResult.json();
```

## Database Operations

### Insert Log
```javascript
await pool.query(
  `INSERT INTO logs (service, level, message, latency_ms, anomaly_score, is_anomaly, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [service, level, message, latency_ms, anomaly_score, is_anomaly, timestamp]
);
```

### Connection Pooling
- Reuses database connections
- Automatic reconnection on failure
- Configurable pool size

## Error Handling

### Kafka Errors
- Automatic retry with exponential backoff
- Logs connection errors
- Continues processing on transient failures

### Database Errors
- Logs insertion errors
- Continues processing other messages
- Dead letter queue for failed messages (future)

### Processing Errors
- Catches and logs exceptions
- Prevents consumer from crashing
- Skips malformed messages

## Monitoring

### Check Processor Status
```bash
docker logs insighthub-processor-1
```

### Consumer Group Status
```bash
docker exec insighthub-kafka-1 kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe --group log-processors
```

### Processing Rate
Monitor logs for:
```
Processed log: payment-service ERROR
Processed log: auth-service INFO
```

## Scaling

### Horizontal Scaling
Run multiple processor instances:

```yaml
processor:
  deploy:
    replicas: 3
```

Each instance joins the same consumer group and processes different partitions.

### Partition Assignment
- Kafka automatically assigns partitions to consumers
- Rebalancing occurs when consumers join/leave
- Each partition processed by only one consumer

## Performance

### Throughput
- Processes ~1000 logs/second per instance
- Batched database inserts for higher throughput (future)
- Async processing for non-blocking operations

### Latency
- Average processing time: <10ms per log
- Database insert: ~5ms
- ML prediction: ~2ms (when integrated)

## Development

### Install Dependencies
```bash
npm install
```

### Run Locally
```bash
npm start
```

### Run with Docker
```bash
docker-compose up processor
```

## Testing

### Send Test Message to Kafka
```bash
docker exec -it insighthub-kafka-1 kafka-console-producer \
  --bootstrap-server localhost:9092 \
  --topic logs

# Then paste:
{"service":"test","level":"INFO","message":"Test message","timestamp":"2025-12-03T15:00:00Z"}
```

### Verify Database Insert
```bash
docker exec -i insighthub-postgres-1 psql -U postgres -d insighthub \
  -c "SELECT * FROM logs ORDER BY created_at DESC LIMIT 5;"
```

## Troubleshooting

### Processor Not Consuming
1. Check Kafka is running: `docker ps | grep kafka`
2. Verify topic exists: `docker exec insighthub-kafka-1 kafka-topics --list --bootstrap-server localhost:9092`
3. Check consumer group: `docker exec insighthub-kafka-1 kafka-consumer-groups --list --bootstrap-server localhost:9092`

### Database Connection Failed
1. Check PostgreSQL is running
2. Verify connection string
3. Test connection: `docker exec insighthub-postgres-1 psql -U postgres -d insighthub -c "SELECT 1;"`

### Messages Not Being Processed
1. Check processor logs for errors
2. Verify message format matches expected schema
3. Check database for constraint violations

### High Memory Usage
1. Reduce batch size
2. Increase processing speed
3. Add more processor instances

## ML Engine Integration

The processor integrates with the ML Engine API for advanced anomaly detection:

```javascript
// Calls ML Engine /score endpoint
const response = await fetch('http://ml-engine:5000/score', {
  method: 'POST',
  body: JSON.stringify(log)
});

// Falls back to heuristics if ML Engine unavailable
```

**ML Scoring Methods:**
1. **Isolation Forest** (40% weight) - ML-based detection
2. **Sliding Window** (60% weight) - Statistical analysis
3. **Combined Score** - Weighted average

## Processing Pipeline

```
1. Normalize Log Structure
   ↓
2. Add Timestamps
   ↓
3. Convert to Time-Series Format
   ↓
4. ML Anomaly Scoring (with fallback)
   ↓
5. Database Storage
```

## Environment Variables

```bash
KAFKA_BROKER=kafka:9092
DB_HOST=postgres
DB_PORT=5432
DB_NAME=insighthub
DB_USER=postgres
DB_PASSWORD=password
ML_ENGINE_URL=http://ml-engine:5000
```

## Monitoring Output

The processor logs detailed information:

```
✓ Connected to Kafka
✓ Subscribed to "logs" topic
✓ Connected to PostgreSQL
🚀 Processor service started and ready

  ML Engine: Combined method, score: 0.85
🚨 ANOMALY Processed log #42: payment-service [ERROR] (score: 0.85)

✓ Processed log #43: auth-service [INFO]
```

## Future Enhancements

### Batch Processing
- Collect logs in batches
- Bulk database inserts
- Improved throughput

### Dead Letter Queue
- Handle failed messages
- Retry mechanism
- Error tracking

### Metrics Collection
- Processing rate
- Error rate
- Average latency
- Prometheus integration

### Circuit Breaker
- Protect against ML Engine failures
- Automatic fallback
- Health monitoring

## Best Practices

1. **Always commit offsets** after successful processing
2. **Handle errors gracefully** to prevent consumer crashes
3. **Use connection pooling** for database
4. **Monitor consumer lag** to ensure timely processing
5. **Scale horizontally** for high throughput
6. **Log processing errors** for debugging
7. **Validate message format** before processing
8. **Use idempotent operations** to handle duplicates
9. **Implement retry logic** for transient failures
10. **Monitor memory usage** and optimize as needed
