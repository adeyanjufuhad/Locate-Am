"""Deterministic parser. Relations describe text, never coordinate offsets."""
import re
import unicodedata

ABBREVIATIONS = {
    r'\bb\s*/\s*stop\b': 'bus stop', r'\bbstop\b': 'bus stop',
    r'\bopp\b': 'opposite', r'\bnr\b': 'near', r'\bjnc\b': 'junction',
    r'\bjct\b': 'junction', r'\brd\b': 'road', r'\bst\b': 'street',
    r'\bave\b': 'avenue', r'\bexp\b': 'expressway', r'\bext\b': 'extension',
}
RELATIONS = r'\b(opposite|near|beside|behind|after|before|along|around|at)\b'


def normalize(text: str) -> str:
    text = unicodedata.normalize('NFKC', text).lower()
    for pattern, replacement in ABBREVIATIONS.items():
        text = re.sub(pattern, replacement, text)
    text = re.sub(r'[^\w\s]', ' ', text, flags=re.UNICODE)
    return ' '.join(text.split())


def parse_address(address: str, aliases: dict[str, list[str]]) -> dict:
    normalized = normalize(address)
    matches = []
    for area, names in aliases.items():
        for alias in names:
            alias = normalize(alias)
            for match in re.finditer(r'\b' + re.escape(alias) + r'\b', normalized):
                matches.append((match.start(), match.end(), area, alias))
    # Longest alias wins overlapping spans; multiple distinct areas remain uncertain.
    selected = []
    for match in sorted(matches, key=lambda m: -(m[1] - m[0])):
        if not any(match[0] < x[1] and match[1] > x[0] for x in selected):
            selected.append(match)
    areas = list(dict.fromkeys(m[2] for m in sorted(selected)))
    area = areas[-1] if areas else None
    relation_matches = list(re.finditer(RELATIONS, normalized))
    relation = relation_matches[-1].group(1) if relation_matches else None
    landmark = normalized[relation_matches[-1].end():] if relation_matches else normalized
    for _, _, _, alias in selected:
        landmark = re.sub(r'\b' + re.escape(alias) + r'\b', ' ', landmark)
    landmark = re.sub(r'\b(lagos|nigeria)\b', ' ', landmark)
    landmark = re.sub(r'^\s*(?:\d+[a-z]?\s+)', '', landmark)
    landmark = re.sub(r'^\s*(?:the\s+)', '', landmark)
    landmark = ' '.join(landmark.split())
    return {'normalized': normalized, 'landmark': landmark or None,
            'relation': relation, 'area': area, 'area_hints': areas,
            'area_ambiguous': len(areas) > 1}
