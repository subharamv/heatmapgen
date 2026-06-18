CREATE TABLE IF NOT EXISTS zones (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    polygon     JSONB NOT NULL,
    max_capacity INTEGER NOT NULL DEFAULT 10,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS people_counts (
    id          BIGSERIAL PRIMARY KEY,
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    total_count INTEGER NOT NULL,
    zone_counts JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS alerts (
    id          BIGSERIAL PRIMARY KEY,
    zone_id     TEXT NOT NULL,
    zone_name   TEXT NOT NULL,
    count       INTEGER NOT NULL,
    limit_val   INTEGER NOT NULL,
    triggered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS heatmap_snapshots (
    id          BIGSERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    data        JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_people_counts_time ON people_counts (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_time ON alerts (triggered_at DESC);
