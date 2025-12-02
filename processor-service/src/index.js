const { Kafka } = require('kafkajs');
const { Pool } = require('pg');
require('dotenv').config();

const kafka = new Kafka({
  clientId: 'insighthub-processor',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const consumer = kafka.consumer({ groupId: 'log-processors' });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'insighthub',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD
});

async function processLog(log) {
  // TODO: Call ML engine for anomaly detection
  const anomalyScore = 0;
  const isAnomaly = false;
  
  // Insert into database
  await pool.query(
    `INSERT INTO logs (service, level, message, latency_ms, anomaly_score, is_anomaly, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [log.service, log.level, log.message, log.latency_ms || 0, anomalyScore, isAnomaly, log.timestamp]
  );
}

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'logs', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const log = JSON.parse(message.value.toString());
        await processLog(log);
        console.log('Processed log:', log.service, log.level);
      } catch (error) {
        console.error('Error processing log:', error);
      }
    },
  });

  console.log('Processor service started');
}

run().catch(console.error);
