-- Include event_id in the compression ordering: (event_id, occurred_at) is the unique key the processor
-- deduplicates on, and TimescaleDB warns when it isn't part of segmentby/orderby. Safe to run twice.
-- Compression settings can only change while no chunk is compressed yet, so it's skipped after that.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.chunks
         WHERE hypertable_name = 'error_events' AND is_compressed
    ) THEN
        ALTER TABLE error_events SET (timescaledb.compress_orderby = 'occurred_at DESC, event_id');
    END IF;
END $$;
