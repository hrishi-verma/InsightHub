const axios = require('axios');

class InsightHubClient {
  constructor(config) {
    this.apiUrl = config.apiUrl || 'http://localhost:8000';
    this.token = config.token;
    this.serviceName = config.serviceName;
    this.batchSize = config.batchSize || 10;
    this.batch = [];
  }

  log(level, message, metadata = {}) {
    const logEntry = {
      service: this.serviceName,
      level,
      message,
      ...metadata,
      timestamp: new Date().toISOString()
    };

    this.batch.push(logEntry);

    if (this.batch.length >= this.batchSize) {
      this.flush();
    }
  }

  info(message, metadata) {
    this.log('INFO', message, metadata);
  }

  warn(message, metadata) {
    this.log('WARN', message, metadata);
  }

  error(message, metadata) {
    this.log('ERROR', message, metadata);
  }

  async flush() {
    if (this.batch.length === 0) return;

    const logs = [...this.batch];
    this.batch = [];

    try {
      for (const log of logs) {
        await axios.post(`${this.apiUrl}/api/logs`, log, {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (error) {
      console.error('Failed to send logs:', error.message);
    }
  }
}

module.exports = InsightHubClient;
