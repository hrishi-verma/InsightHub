const express = require('express');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logsRouter = require('./routes/logs');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000
});

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use('/api', limiter);
app.use('/api/logs', logsRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Ingestion service running on port ${PORT}`);
});
