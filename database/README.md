# InsightHub Database

PostgreSQL database with TimescaleDB extension for time-series log data.

## Overview

The database stores all ingested logs with time-series optimization for efficient querying and aggregation.

## Tech Stack

- **Database**: PostgreSQL 15
- **Extension**: TimescaleDB (time-series optimization)
- **Container**: timescale/timescaledb:latest-pg15

## Schema

### Logs Table

Primary table for storing all log entries.

```sql
CREATE TABLE logs (
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
```

**Hypertable**: Partitioned by `created_at` for time-series optimization

**Indexes:**
- `idx_logs_service` on `service`
- `idx_logs_level` on `level`
- `idx_logs_created_at` on `created_at DESC`
- `idx_logs_is_anomaly` on `is_anomaly` (partial index)

### Log Aggregates Table

Pre-computed aggregations for faster analytics.

```sql
CREATE TABLE log_aggregates (
    id BIGSERIAL,
    service TEXT NOT NULL,
    minute_bucket TIMESTAMPTZ NOT NULL,
    total_logs INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    avg_latency FLOAT DEFAULT 0,
    anomaly_count INTEGER DEFAULT 0,
    PRIMARY KEY (id, minute_bucket)
);
```

**Hypertable**: Partitioned by `minute_bucket`

## TimescaleDB Features

### Hypertables
Automatically partition data by time for:
- Faster queries on recent data
- Efficient data retention policies
- Optimized compression

### Continuous Aggregates (Future)
Pre-compute aggregations:
```sql
CREATE MATERIALIZED VIEW logs_hourly
WITH (timescaledb.continuous) AS
SELECT 
  time_bucket('1 hour', created_at) AS hour,
  service,
  COUNT(*) as total_logs,
  COUNT(*) FILTER (WHERE level = 'ERROR') as errors
FROM logs
GROUP BY hour, service;
```

### Data Retention (Future)
Automatically drop old data:
```sql
SELECT add_retention_policy('logs', INTERVAL '90 days');
```

## Initialization

The database is initialized with `init.sql` on first startup:

```bash
docker exec -i insighthub-postgres-1 psql -U postgres -d insighthub < database/init.sql
```

## Connection Details

**Docker Compose:**
```yaml
Host: postgres
Port: 5432
Database: insighthub
User: postgres
Password: password
```

**Local Connection:**
```bash
psql -h localhost -p 5432 -U postgres -d insighthub
```

## Common Queries

### Get Recent Logs
```sql
SELECT * FROM logs 
ORDER BY created_at DESC 
LIMIT 100;
```

### Count Logs by Level
```sql
SELECT level, COUNT(*) 
FROM logs 
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY level;
```

### Average Latency by Service
```sql
SELECT service, AVG(latency_ms) as avg_latency
FROM logs
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND latency_ms IS NOT NULL
GROUP BY service
ORDER BY avg_latency DESC;
```

### Error Rate Over Time
```sql
SELECT 
  time_bucket('1 hour', created_at) as hour,
  COUNT(*) FILTER (WHERE level = 'ERROR') as errors
FROM logs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour;
```

### Find Anomalies
```sql
SELECT * FROM logs
WHERE is_anomaly = true
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY anomaly_score DESC;
```

## Maintenance

### Check Table Size
```sql
SELECT 
  pg_size_pretty(pg_total_relation_size('logs')) as total_size,
  pg_size_pretty(pg_relation_size('logs')) as table_size,
  pg_size_pretty(pg_indexes_size('logs')) as indexes_size;
```

### Vacuum and Analyze
```sql
VACUUM ANALYZE logs;
```

### Check Hypertable Info
```sql
SELECT * FROM timescaledb_information.hypertables;
```

### View Chunks
```sql
SELECT * FROM timescaledb_information.chunks
WHERE hypertable_name = 'logs';
```

## Backup

### Dump Database
```bash
docker exec insighthub-postgres-1 pg_dump -U postgres insighthub > backup.sql
```

### Restore Database
```bash
docker exec -i insighthub-postgres-1 psql -U postgres insighthub < backup.sql
```

## Performance Tuning

### Shared Buffers
Configured by timescaledb_tune on startup:
```
shared_buffers = 1959MB
effective_cache_size = 5877MB
```

### Work Memory
```
work_mem = 2006kB
maintenance_work_mem = 1003106kB
```

### Parallel Workers
```
max_parallel_workers_per_gather = 5
max_parallel_workers = 10
```

## Monitoring

### Active Connections
```sql
SELECT count(*) FROM pg_stat_activity;
```

### Slow Queries
```sql
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Table Statistics
```sql
SELECT * FROM pg_stat_user_tables WHERE relname = 'logs';
```

## Troubleshooting

### Connection Refused
- Check if PostgreSQL is running: `docker ps | grep postgres`
- Verify port mapping: `docker port insighthub-postgres-1`
- Check logs: `docker logs insighthub-postgres-1`

### Slow Queries
- Run EXPLAIN ANALYZE on slow queries
- Check if indexes are being used
- Consider adding more indexes
- Increase work_mem for complex queries

### Disk Space
- Check available space: `df -h`
- Drop old partitions if using retention policy
- Compress old chunks with TimescaleDB compression

### Table Bloat
- Run VACUUM FULL (requires downtime)
- Enable autovacuum
- Monitor dead tuples

## Data Retention

### Manual Cleanup
```sql
DELETE FROM logs 
WHERE created_at < NOW() - INTERVAL '90 days';
```

### Automated Retention Policy
```sql
SELECT add_retention_policy('logs', INTERVAL '90 days');
```

## Security

### Change Default Password
```sql
ALTER USER postgres WITH PASSWORD 'new_secure_password';
```

### Create Read-Only User
```sql
CREATE USER readonly WITH PASSWORD 'readonly_password';
GRANT CONNECT ON DATABASE insighthub TO readonly;
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
```

### Enable SSL (Production)
Configure in postgresql.conf:
```
ssl = on
ssl_cert_file = '/path/to/server.crt'
ssl_key_file = '/path/to/server.key'
```

## Migration

### Add New Column
```sql
ALTER TABLE logs ADD COLUMN user_id INTEGER;
```

### Create Index
```sql
CREATE INDEX idx_logs_user_id ON logs(user_id);
```

### Update Schema
```sql
-- Run migration scripts in order
\i migrations/001_add_user_id.sql
\i migrations/002_add_tags.sql
```

## Best Practices

1. **Always use indexes** on frequently queried columns
2. **Partition by time** for time-series data
3. **Use EXPLAIN** to analyze query performance
4. **Regular VACUUM** to prevent bloat
5. **Monitor disk space** and set retention policies
6. **Backup regularly** before major changes
7. **Use connection pooling** in applications
8. **Limit result sets** with LIMIT clause
9. **Use prepared statements** to prevent SQL injection
10. **Monitor slow queries** and optimize them
