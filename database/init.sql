-- Create logs table
CREATE TABLE IF NOT EXISTS logs (
    log_id BIGSERIAL,
    service TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    latency_ms INTEGER,
    anomaly_score FLOAT DEFAULT 0,
    is_anomaly BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (log_id, created_at)
);

-- Create hypertable for time-series optimization
SELECT create_hypertable('logs', 'created_at', if_not_exists => TRUE);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_is_anomaly ON logs(is_anomaly) WHERE is_anomaly = TRUE;

-- Create aggregates table
CREATE TABLE IF NOT EXISTS log_aggregates (
    id BIGSERIAL,
    service TEXT NOT NULL,
    minute_bucket TIMESTAMPTZ NOT NULL,
    total_logs INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    avg_latency FLOAT DEFAULT 0,
    anomaly_count INTEGER DEFAULT 0,
    PRIMARY KEY (id, minute_bucket)
);

SELECT create_hypertable('log_aggregates', 'minute_bucket', if_not_exists => TRUE);
