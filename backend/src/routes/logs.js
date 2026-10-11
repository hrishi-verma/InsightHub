const express = require('express');
const { validateLog } = require('../middleware/validation');
const { createServiceTokenAuth } = require('../middleware/serviceToken');

// Legacy log pipeline, kept as it was apart from config: pool, Kafka and token are injected.
function createLogsRouter({ pool, legacyPublisher, serviceToken }) {
  const router = express.Router();
  const authenticate = createServiceTokenAuth(serviceToken);
  const kafka = legacyPublisher;

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
    try {
      const { service, level } = req.query;
      // Bounded so one request can't pull the whole table.
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
      
      let query = 'SELECT * FROM logs WHERE 1=1';
      const params = [];
      let paramCount = 1;
      
      if (service) {
        query += ` AND service = $${paramCount}`;
        params.push(service);
        paramCount++;
      }
      
      if (level) {
        query += ` AND level = $${paramCount}`;
        params.push(level);
        paramCount++;
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${paramCount}`;
      params.push(limit);
      
      const result = await pool.query(query, params);
      res.json({ logs: result.rows });
    } catch (error) {
      console.error('Error querying logs:', error);
      res.status(500).json({ error: 'Failed to query logs' });
    }
  });

  router.get('/stats', authenticate, async (req, res) => {
    try {
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total_logs,
          COUNT(*) FILTER (WHERE level = 'ERROR') as errors,
          COUNT(*) FILTER (WHERE is_anomaly = true) as anomalies
        FROM logs
        WHERE created_at > NOW() - INTERVAL '1 hour'
      `);
      
      res.json(stats.rows[0]);
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  router.get('/errors-over-time', authenticate, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          date_trunc('hour', created_at) as time,
          COUNT(*) FILTER (WHERE level = 'ERROR') as errors
        FROM logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY time
        ORDER BY time
      `);
      
      res.json({ data: result.rows });
    } catch (error) {
      console.error('Error fetching error trends:', error);
      res.status(500).json({ error: 'Failed to fetch error trends' });
    }
  });

  router.get('/latency-by-service', authenticate, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          service,
          AVG(latency_ms) as latency
        FROM logs
        WHERE created_at > NOW() - INTERVAL '1 hour'
          AND latency_ms IS NOT NULL
        GROUP BY service
        ORDER BY latency DESC
      `);
      
      res.json({ data: result.rows });
    } catch (error) {
      console.error('Error fetching latency data:', error);
      res.status(500).json({ error: 'Failed to fetch latency data' });
    }
  });

  return router;
}

module.exports = { createLogsRouter };
