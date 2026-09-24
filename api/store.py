"""PostGIS production storage; SQLite fixture adapter for an explicit offline demo."""
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
from api.parse import normalize

ROOT = Path(__file__).resolve().parents[1]


class Store:
    def __init__(self, settings):
        self.settings = settings
        self.demo = settings.data_mode == 'demo'
        if self.demo:
            Path(settings.demo_db).parent.mkdir(parents=True, exist_ok=True)
            with self.connect() as conn:
                conn.executescript('''CREATE TABLE IF NOT EXISTS pin_corrections (
                    id TEXT PRIMARY KEY, address_norm TEXT, lat REAL, lon REAL,
                    candidate_id TEXT, status TEXT DEFAULT 'pending', token_id TEXT UNIQUE,
                    created_at REAL);
                    CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, hits INTEGER, expires_at REAL);''')

    @contextmanager
    def connect(self):
        if self.demo:
            conn = sqlite3.connect(self.settings.demo_db, timeout=10)
        else:
            conn = psycopg.connect(self.settings.database_url, row_factory=dict_row, connect_timeout=5)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def aliases(self):
        if self.demo:
            return json.loads((ROOT / 'data/area_aliases.json').read_text())
        with self.connect() as conn:
            rows = conn.execute('SELECT a.name, aa.alias FROM area_aliases aa JOIN areas a ON a.id=aa.area_id').fetchall()
        aliases = {}
        for row in rows:
            aliases.setdefault(row['name'], []).append(row['alias'])
        return aliases

    def candidates(self, landmark):
        if not landmark:
            return []
        if self.demo:
            return [{**p, 'source': 'synthetic_fixture', 'dataset_version': 'demo-v1'}
                    for p in json.loads((ROOT / 'data/sample_places.json').read_text())]
        with self.connect() as conn:
            # Global name retrieval: area is NEVER a WHERE predicate.
            rows = conn.execute('''SELECT id::text, name, area, category, source, dataset_version,
                ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon
                FROM places ORDER BY name_norm <-> %s, id LIMIT 100''', (landmark,)).fetchall()
        return rows

    def health(self):
        with self.connect() as conn:
            conn.execute('SELECT 1').fetchone()
            if not self.demo:
                count = conn.execute('SELECT count(*) AS n FROM places').fetchone()['n']
                conn.execute('SELECT count(*) FROM pin_corrections').fetchone()
                return count
        return len(self.candidates('demo'))

    def consume_limit(self, key, maximum, seconds):
        now = time.time()
        with self.connect() as conn:
            if self.demo:
                conn.execute('BEGIN IMMEDIATE')
                conn.execute('DELETE FROM rate_limits WHERE expires_at < ?', (now,))
                row = conn.execute('''INSERT INTO rate_limits VALUES (?,1,?)
                    ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits''', (key, now+seconds)).fetchone()
                hits = row[0]
            else:
                conn.execute('DELETE FROM rate_limits WHERE expires_at < %s', (now,))
                hits = conn.execute('''INSERT INTO rate_limits VALUES (%s,1,%s)
                    ON CONFLICT(key) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits''',
                    (key, now+seconds)).fetchone()['hits']
        return hits <= maximum

    def save_pin(self, id, parsed, lat, lon, candidate_id, token_id):
        with self.connect() as conn:
            if self.demo:
                row = conn.execute('''INSERT INTO pin_corrections
                    (id,address_norm,lat,lon,candidate_id,token_id,created_at) VALUES (?,?,?,?,?,?,?)
                    ON CONFLICT(token_id) DO NOTHING RETURNING id''',
                    (id, parsed, lat, lon, candidate_id, token_id, time.time())).fetchone()
            else:
                row = conn.execute('''INSERT INTO pin_corrections
                    (id,address_norm,geom,candidate_id,token_id)
                    VALUES (%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,%s,%s)
                    ON CONFLICT(token_id) DO NOTHING RETURNING id''',
                    (id, parsed, lon, lat, candidate_id, token_id)).fetchone()
        return bool(row)
