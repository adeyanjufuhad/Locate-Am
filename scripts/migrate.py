"""Run ordered, transactional SQL migrations and seed the area gazetteer."""
import json
from api.config import get_settings
from api.store import ROOT
from api.parse import normalize
import psycopg


def migrate(url):
    with psycopg.connect(url) as conn:
        conn.execute('SELECT pg_advisory_xact_lock(723019)')
        conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())')
        for path in sorted((ROOT/'db/migrations').glob('*.sql')):
            if not conn.execute('SELECT 1 FROM schema_migrations WHERE name=%s', (path.name,)).fetchone():
                conn.execute(path.read_text())
                conn.execute('INSERT INTO schema_migrations(name) VALUES (%s)', (path.name,))
        for area, aliases in json.loads((ROOT/'data/area_aliases.json').read_text()).items():
            id = conn.execute('INSERT INTO areas(name) VALUES (%s) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id', (area,)).fetchone()[0]
            for alias in aliases:
                conn.execute('INSERT INTO area_aliases VALUES (%s,%s) ON CONFLICT(alias) DO UPDATE SET area_id=excluded.area_id', (normalize(alias), id))
    print('Migrations and area aliases applied.')


if __name__ == '__main__':
    migrate(get_settings().database_url)
