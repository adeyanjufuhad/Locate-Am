import math
from rapidfuzz.fuzz import ratio, token_sort_ratio
from api.parse import normalize


def distance_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2-p1, math.radians(lon2-lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 6371008.8 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


def name_score(a, b):
    return max(ratio(a, b), token_sort_ratio(a, b)) / 100


def rank(parsed, places, settings):
    landmark = parsed['landmark']
    ranked = []
    if landmark:
        for place in places:
            score = name_score(landmark, normalize(place['name']))
            if score < settings.candidate_floor:
                continue
            agrees = bool(parsed['area'] and normalize(place.get('area') or '') == parsed['area'])
            ranked.append({**place, 'name_score': round(score, 4),
                           'ranking_score': round(min(1, 0.9*score + (0.1 if agrees else 0)), 4),
                           'area_agrees': agrees, 'coordinate_kind': 'approximate_landmark_reference'})
    ranked.sort(key=lambda c: (-c['ranking_score'], c['id']))
    candidates = ranked[:5]
    reason = 'no_candidates'
    accepted = False
    if candidates:
        top = candidates[0]
        ambiguous = any(top['ranking_score'] - p['ranking_score'] < settings.ambiguity_margin
                        and distance_m(top['lat'], top['lon'], p['lat'], p['lon']) > 100
                        for p in ranked[1:])
        accepted = (not ambiguous and not parsed['area_ambiguous']
                    and top['ranking_score'] >= settings.accept_score
                    and top['name_score'] >= settings.min_name_score)
        reason = 'ambiguous_match' if ambiguous or parsed['area_ambiguous'] else (
            'landmark_reference_only' if accepted else 'weak_match')
    # Directional descriptions cannot establish an entrance, even with an exact POI match.
    needs_pin = not accepted or bool(parsed['relation'])
    if accepted and parsed['relation']:
        reason = 'relative_address_requires_pin'
    return {'candidates': candidates, 'reference': candidates[0] if accepted else None,
            'needs_pin': needs_pin, 'reason': reason, 'score_kind': 'uncalibrated_ranking_score',
            'delivery_entrance_verified': False}
