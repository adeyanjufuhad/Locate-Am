CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE areas (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    geom GEOGRAPHY(Point,4326)
);
CREATE TABLE area_aliases (
    alias TEXT PRIMARY KEY,
    area_id BIGINT NOT NULL REFERENCES areas(id)
);
CREATE TABLE places (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    name_norm TEXT NOT NULL,
    category TEXT,
    area TEXT,
    geom GEOGRAPHY(Point,4326) NOT NULL,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    UNIQUE(source, source_id),
    CHECK (ST_Y(geom::geometry) BETWEEN 6.3 AND 6.8),
    CHECK (ST_X(geom::geometry) BETWEEN 2.7 AND 4.0)
);
CREATE INDEX places_name_trgm ON places USING gist(name_norm gist_trgm_ops);
CREATE INDEX places_geom ON places USING gist(geom);
CREATE TABLE place_sources (
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    place_id BIGINT NOT NULL REFERENCES places(id),
    PRIMARY KEY(source, source_id)
);
CREATE TABLE pin_corrections (
    id UUID PRIMARY KEY,
    address_norm TEXT NOT NULL CHECK(length(address_norm) BETWEEN 3 AND 300),
    geom GEOGRAPHY(Point,4326) NOT NULL,
    candidate_id BIGINT REFERENCES places(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    token_id TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    CHECK (ST_Y(geom::geometry) BETWEEN 6.3 AND 6.8),
    CHECK (ST_X(geom::geometry) BETWEEN 2.7 AND 4.0)
);
-- Deliberately absent from the matcher; approval does not silently activate a pin.
CREATE INDEX pin_corrections_review ON pin_corrections(status, created_at);
CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL
);
REVOKE ALL ON pin_corrections, rate_limits FROM PUBLIC;
