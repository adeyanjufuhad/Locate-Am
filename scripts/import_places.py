"""Repeatable OSM Overpass JSON or optional Overture GeoJSON imports.

Overture input must be a Lagos-trimmed FeatureCollection with Point geometries.
Source snapshots stay outside Git. Exact names within 35 m are merged; distinct
branches remain separate. All source identities survive in place_sources.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import psycopg
from api.config import get_settings
from api.parse import normalize


def records(payload, source):
    items = payload.get('elements', []) if source == 'osm' else payload.get('features', [])
    for item in items:
        if source == 'osm':
            tags = item.get('tags', {})
            point = item if item.get('type') == 'node' else item.get('center', {})
            identity = f"{item['type']}/{item['id']}" if item.get('type') in ('node','way','relation') and isinstance(item.get('id'), int) else ''
            yield {'source_id': identity, 'name': tags.get('name'),
                   'lat': point.get('lat'), 'lon': point.get('lon'),
                   'area': tags.get('addr:suburb') or tags.get('addr:district'),
                   'category': next((tags[k] for k in ['amenity', 'shop', 'tourism', 'place', 'highway'] if k in tags), 'other')}
        else:
            props = item.get('properties', {})
            geom = item.get('geometry') or {}
            coords = geom.get('coordinates', []) if geom.get('type') == 'Point' else []
            yield {'source_id': str(props.get('id') or item.get('id') or ''),
                   'name': (props.get('names') or {}).get('primary') or props.get('name'),
                   'lat': coords[1] if len(coords) >= 2 else None,
                   'lon': coords[0] if len(coords) >= 2 else None,
                   'area': props.get('area'), 'category': (props.get('categories') or {}).get('primary', 'other')}


def usable(row):
    try:
        return (isinstance(row['name'], str) and bool(normalize(row['name'])) and bool(row['source_id'])
                and math.isfinite(float(row['lat'])) and math.isfinite(float(row['lon']))
                and 6.3 <= float(row['lat']) <= 6.8 and 2.7 <= float(row['lon']) <= 4.0)
    except (TypeError, ValueError):
        return False


def import_file(path, source, version, url=None, dry_run=False):
    raw = Path(path).read_bytes()
    payload = json.loads(raw)
    rows = list(records(payload, source))
    valid = [r for r in rows if usable(r)]
    report = {'source': source, 'dataset_version': version,
              'sha256': hashlib.sha256(raw).hexdigest(), 'input_records': len(rows),
              'usable_records': len(valid), 'rejected_records': len(rows)-len(valid),
              'inserted_places': 0, 'updated_sources': 0, 'merged_sources': 0,
              'dry_run': dry_run, 'bounds': [6.3, 2.7, 6.8, 4.0]}
    if dry_run:
        return report
    with psycopg.connect(url) as conn:
        # Serialize import jobs so dedupe is deterministic even on concurrent runs.
        conn.execute('SELECT pg_advisory_xact_lock(723020)')
        for row in valid:
            name = normalize(row['name'])
            existing = conn.execute('SELECT place_id FROM place_sources WHERE source=%s AND source_id=%s', (source, row['source_id'])).fetchone()
            if existing:
                id = existing[0]
                # Only canonical source updates its geometry/name; preserve merged provenance.
                conn.execute('''UPDATE places SET name=%s,name_norm=%s,area=%s,category=%s,
                    geom=ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,dataset_version=%s
                    WHERE id=%s AND source=%s AND source_id=%s''',
                    (row['name'], name, normalize(row['area'] or '') or None, row['category'],
                     row['lon'], row['lat'], version, id, source, row['source_id']))
                report['updated_sources'] += 1
            else:
                duplicate = conn.execute('''SELECT id FROM places WHERE name_norm=%s AND
                    ST_DWithin(geom,ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,35)
                    ORDER BY id LIMIT 1''', (name, row['lon'], row['lat'])).fetchone()
                if duplicate:
                    id = duplicate[0]
                    report['merged_sources'] += 1
                else:
                    id = conn.execute('''INSERT INTO places(name,name_norm,category,area,geom,source,source_id,dataset_version)
                        VALUES (%s,%s,%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,%s,%s,%s) RETURNING id''',
                        (row['name'], name, row['category'], normalize(row['area'] or '') or None,
                         row['lon'], row['lat'], source, row['source_id'], version)).fetchone()[0]
                    report['inserted_places'] += 1
            conn.execute('''INSERT INTO place_sources VALUES (%s,%s,%s,%s)
                ON CONFLICT(source,source_id) DO UPDATE SET dataset_version=excluded.dataset_version''',
                (source, row['source_id'], version, id))
        report['total_places_in_database'] = conn.execute('SELECT count(*) FROM places').fetchone()[0]
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--source', choices=['osm', 'overture'], default='osm')
    parser.add_argument('--version', required=True, help='Snapshot timestamp or Overture release ID')
    parser.add_argument('--report', default='reports/local/import.json')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    report = import_file(args.input, args.source, args.version, get_settings().database_url, args.dry_run)
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
