const express = require('express');
const router = express.Router();
const { validateLog } = require('../middleware/validation');
const { authenticate } = require('../middleware/auth');
const kafka = require('../services/kafka');

router.post('/', authenticate, validateLog, async (req, res) => {
  try {
    const log = {
      ...req.body,
      timestamp: new Date().toISOString()
    };
    
    await kafka.publishLog(log);
    res.json({ status: 'queued' });
  } catch (error) {
    console.error('Error publishing log:', error);
    res.status(500).json({ error: 'Failed to queue log' });
  }
});

router.get('/', authenticate, async (req, res) => {
  // TODO: Query logs from database
  res.json({ logs: [] });
});

module.exports = router;
