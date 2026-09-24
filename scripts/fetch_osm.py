"""Download a reproducible named-place snapshot. Does not submit user addresses."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import json
import httpx


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', required=True, help='UTC timestamp, e.g. 2026-09-01T00:00:00Z')
    parser.add_argument('--output', default='data/downloads/lagos-osm.json')
    parser.add_argument('--endpoint', default='https://overpass-api.de/api/interpreter')
    parser.add_argument('--bbox', nargs=4, type=float, default=[6.3,2.7,6.8,4.0],
                        metavar=('SOUTH','WEST','NORTH','EAST'))
    args = parser.parse_args()
    timestamp = datetime.fromisoformat(args.snapshot.replace('Z', '+00:00'))
    if timestamp.tzinfo is None or timestamp > datetime.now(timezone.utc):
        parser.error('Snapshot must be timezone-aware and in the past')
    stamp = timestamp.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    south, west, north, east = args.bbox
    if not (6.3 <= south < north <= 6.8 and 2.7 <= west < east <= 4):
        parser.error('Bounding box must be inside the Lagos MVP bounds')
    query = f'''[out:json][timeout:180][date:"{stamp}"];
    nwr["name"]({south},{west},{north},{east});out center;'''
    response = httpx.get(args.endpoint, params={'data': query}, timeout=240,
                         headers={'User-Agent': 'LocateAmGeocoder/0.1 (local public-data import)'})
    response.raise_for_status()
    payload = response.json()
    if 'remark' in payload:
        raise RuntimeError('Overpass returned an incomplete response: ' + payload['remark'])
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding='utf-8')
    print(f'Saved {len(payload["elements"])} features to {path}; import with --version {stamp}')
