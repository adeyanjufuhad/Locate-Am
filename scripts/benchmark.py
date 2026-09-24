"""Evaluate only returned references; abstentions count as misses in threshold shares."""
import argparse
import json
from pathlib import Path
from statistics import median
import httpx
from api.match import distance_m


def evaluate(dataset, geocode):
    if dataset.get('kind') not in ('synthetic', 'consented_real'):
        raise ValueError('Dataset kind must be synthetic or consented_real')
    if dataset['kind'] == 'consented_real' and dataset.get('consent_confirmed') is not True:
        raise ValueError('Real datasets require consent_confirmed=true; keep them outside Git')
    rows = dataset['rows']
    if not rows:
        raise ValueError('Dataset is empty')
    errors, pins, with_candidates = [], 0, 0
    for row in rows:
        if not (6.3 <= float(row['lat']) <= 6.8 and 2.7 <= float(row['lon']) <= 4):
            raise ValueError('Ground truth must be inside the Lagos MVP bounds')
        result = geocode(row['address'])
        pins += int(result['needs_pin'])
        with_candidates += int(bool(result['candidates']))
        if result['reference'] is not None:
            ref = result['reference']
            errors.append(distance_m(row['lat'], row['lon'], ref['lat'], ref['lon']))
    n = len(rows)
    return {'kind': dataset['kind'], 'addresses': n, 'returned_references': len(errors),
            'within_m_all_addresses': {str(m): sum(e <= m for e in errors)/n for m in (100, 200, 500)},
            'median_error_m_returned_references': median(errors) if errors else None,
            'result_share': len(errors)/n, 'candidate_share': with_candidates/n,
            'requires_pin_share': pins/n,
            'real_world_accuracy': 'unmeasured' if dataset['kind'] == 'synthetic' else 'measured_on_supplied_consented_set',
            'denominator_note': 'Threshold and share denominators include all addresses; median includes returned references only.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', default='data/benchmark_synthetic.json')
    parser.add_argument('--api', default='http://127.0.0.1:8000')
    parser.add_argument('--output', default='reports/local/benchmark.json')
    args = parser.parse_args()
    with httpx.Client(base_url=args.api, timeout=30) as client:
        def geocode(address):
            response = client.post('/geocode', json={'address': address})
            response.raise_for_status()  # Operational failures invalidate a run, not an accuracy miss.
            return response.json()
        result = evaluate(json.loads(Path(args.dataset).read_text()), geocode)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
