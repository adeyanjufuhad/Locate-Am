# Data boundaries

`sample_places.json` contains six **fictional** named landmarks with invented coordinates inside the Lagos pilot rectangle. These are fixtures, not an OSM extract, not verified real businesses, and not routing destinations. Every demo API candidate is labeled `synthetic_fixture`, version `demo-v1`.

`benchmark_synthetic.json` contains invented address strings and invented reference/destination coordinates. Its numbers test software plumbing only. The benchmark includes ambiguity and abstention; it must not support real accuracy claims.

`area_aliases.json` is a small manually authored, incomplete neighborhood gazetteer. It supplies hints, not authoritative administrative boundaries. Aliases such as “Berger” can be ambiguous in real usage. Matching never filters a landmark out by area.

Downloaded OSM/Overture snapshots belong in ignored `data/downloads/`. Personal addresses, consented real benchmark files, and the demo confirmation database belong in ignored `data/private/` or outside the repository. Git ignores are not a substitute for reviewing staged files before publication.

Real benchmark format (do not commit filled-in personal data):

```json
{"kind":"consented_real","consent_confirmed":true,"rows":[]}
```

Each row needs `address`, `lat` and `lon`. Obtain specific consent for collection and evaluation. Keep any consent records separately under restricted access. The script refuses an empty dataset or real data lacking the consent flag. Aggregate reports contain no address strings or pins, but publish aggregates only when consent and the group size allow it.

OSM data is © OpenStreetMap contributors, licensed under ODbL: https://www.openstreetmap.org/copyright . Retain attribution and comply with database redistribution obligations. Overture licensing varies by release and upstream sources; retain the release's licenses and attribution when importing it. Neither dataset is bundled here. No public Nominatim or paid geocoding service is used.
