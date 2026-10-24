-- Retention, compression and an audit trail for issue status changes. Safe to run twice.

-- Compress chunks older than 14 days (events up to 7 days old are still accepted, so wait longer
-- than that), and drop events after 90 days.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.hypertables
         WHERE hypertable_name = 'error_events' AND compression_enabled
    ) THEN
        ALTER TABLE error_events SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'project_id, issue_id',
            timescaledb.compress_orderby = 'occurred_at DESC'
        );
    END IF;
END $$;

SELECT add_compression_policy('error_events', INTERVAL '14 days', if_not_exists => true);
SELECT add_retention_policy('error_events', INTERVAL '90 days', if_not_exists => true);

-- Who last changed an issue's status, and when. The user link is cleared if the user is deleted.
ALTER TABLE issues ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS status_changed_by integer REFERENCES users(id) ON DELETE SET NULL;
