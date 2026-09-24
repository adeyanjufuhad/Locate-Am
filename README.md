# LocateAm — Nigerian Address Geocoder

**A Lagos-first MVP for landmark-style addresses, ranked map references, and a human-confirmed destination pin.**

LocateAm accepts directions such as “3rd gate after the market, Ikeja”, extracts a possible landmark and area, searches a local place database, and explains when it cannot locate the destination reliably. It never invents coordinates. A landmark coordinate is an **approximate reference, not a verified delivery entrance**.

Built from `Nigerian_Address_Geocoder_Blueprint.docx`. This implementation replaces the blueprint's hard area filter, automatic correction reuse, and optional LLM fallback with soft area ranking, quarantined pin submissions, and rules only. No public deployment or paid service is required.

## Implementation checklist

- [x] PostGIS/pg_trgm schema, repeatable migrations, aliases and source provenance
- [x] OSM downloader, repeatable importer, deduplication and import reports
- [x] Optional Overture GeoJSON import
- [x] Nigerian shorthand, rule parser, fuzzy matching and conservative ranking
- [x] FastAPI endpoints, validation and basic abuse protection
- [x] Responsive React/Leaflet interface, candidates and movable confirmation pin
- [x] Fictional sample data, benchmark runner and consent boundary
- [x] Parser, matcher, coordinates, API and desktop/mobile browser tests
- [x] Local complete-flow verification and production frontend build
- [x] Setup documentation and system architecture
- [ ] Load real Lagos places into your PostGIS database
- [ ] Evaluate consented real addresses and calibrate thresholds if justified

## Current status

The default is a working **offline fixture demo**: six fictional landmarks and a SQLite confirmation queue. It needs no database credentials or geocoding keys. Fixture coordinates are invented, not verified destinations. Internet is needed for basemap tiles; if tiles fail, candidates and coordinate inputs still work.

The Postgres adapter uses PostGIS and pg_trgm, with an integration test and a GitHub Actions PostGIS service. This build machine has no PostgreSQL/PostGIS server, so that test is skipped locally. A passing fixture demo does not prove production database performance.

**Real-world accuracy is unmeasured.** The six-row synthetic benchmark tests evaluation plumbing only. No private home addresses, exact home pins, source snapshots, credentials, or user submissions are committed.

The full-Lagos Overpass download initially returned HTTP 406, then HTTP 504. A smaller Ikeja snapshot succeeded: **708 input features, 704 usable, 4 rejected**. See `reports/osm-ikeja-validation.json` for the snapshot checksum and counts. This is a **dry-run validation**, not a real database import claim. The snapshot stays in ignored `data/downloads/`.

## Quick start: fixture demo

Requirements: Python 3.12+ and Node.js 22.14+ (or Node 24). Run from the repository root. Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-lock.txt
Copy-Item .env.example .env
.\.venv\Scripts\python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --no-proxy-headers
```

In another terminal:

```powershell
cd web
npm.cmd ci
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. API docs: **http://127.0.0.1:8000/docs**. Health: **http://127.0.0.1:8000/health**.

On macOS/Linux, use `python3 -m venv .venv`, `.venv/bin/python` instead of `.\.venv\Scripts\python`, `cp` instead of `Copy-Item`, and `npm` instead of `npm.cmd`. `requirements-lock.txt` pins the tested Python environment; `requirements.txt` records direct dependency ranges. `web/package-lock.json` pins frontend dependencies.

Try these **fictional** examples:

| Address | Expected behavior |
| --- | --- |
| `Demo Palm Market, Ikeja` | Strong approximate landmark reference |
| `Opp. Demo Palm Market, Ikeja` | Parsed relation; destination pin required |
| `Demo Unity Filling Station` | Two distant branches; no chosen reference |
| `Demo Palm Markte, Ikeja` | Fuzzy candidate despite misspelling |
| `Demo Palm Market, Yaba` | Landmark remains eligible despite wrong area hint |
| `Ikeja` | Area only; no invented coordinate; pin required |

Choose a candidate, **drag the green pin or edit its coordinates**, check storage consent, and select **Submit pin for review**. The API returns HTTP 202 and `status: pending`. It does not change future results. Editing the address requires another search before confirmation.

## System architecture

```mermaid
flowchart TD
    User[Landmark-style address] --> UI[React + Leaflet]
    UI -->|POST /geocode| API[FastAPI]
    API --> N[Normalize shorthand and punctuation]
    N --> P[Rule parser + area aliases]
    P --> Retrieve[Global fuzzy place retrieval]
    Retrieve --> Rank[Name score + soft area bonus]
    Rank --> Gate[Strength and ambiguity checks]
    Gate -->|Strong landmark| Ref[Approximate reference + candidates]
    Gate -->|Weak / ambiguous / empty| Abstain[No chosen reference + ask for pin]
    Ref --> UI
    Abstain --> UI
    UI -->|POST /confirm + consent + token| Validate[Bounds, signature, replay and rate checks]
    Validate --> Queue[Pending correction queue]
    Queue -.->|Manual review only| Reviewer[Trusted operator]
    DB[(Postgres: PostGIS + pg_trgm)] --> Retrieve
    DB --> P
    Validate --> DB
    OSM[OSM snapshot] --> Import[Offline validation + dedupe + import]
    Overture[Optional Overture GeoJSON] --> Import
    Import --> DB
    Import --> Report[Counts + version + SHA256 report]
```

There is one live API and one database. React is a static frontend. Imports and benchmarks are offline commands. There is no LLM, external geocoder, Redis, job queue, account system, billing, or routing engine.

### Components

| Component | Files | Responsibility |
| --- | --- | --- |
| Configuration | `api/config.py` | Environment and threshold validation |
| Parser | `api/parse.py` | Shorthand, relation, area hints, landmark phrase |
| Storage/retrieval | `api/store.py` | PostGIS or fixture adapter; review and rate-limit storage |
| Ranking | `api/match.py` | Similarity, area bonus, ambiguity and abstention |
| HTTP boundary | `api/main.py` | Validation, CORS, limits and signed confirmation tokens |
| Database | `db/migrations/`, `scripts/migrate.py` | Transactional schema versioning and aliases |
| Data pipeline | `scripts/fetch_osm.py`, `scripts/import_places.py` | Downloads, provenance, dedupe and reports |
| Interface | `web/src/` | Search, parsed result, candidates, map and pin submission |
| Evaluation | `scripts/benchmark.py` | Distance error, coverage, median, pin share |
| Verification | `tests/`, `web/tests/`, `.github/workflows/` | API, database and browser checks |

### Address processing and ranking

1. Validate 3–300 characters with meaningful alphabetic content. Cap actual request bodies at 8 KiB, including chunked requests.
2. Apply Unicode NFKC, lowercase, punctuation and whitespace cleanup. Expand `opp` → `opposite`, `nr` → `near`, `jnc`/`jct` → `junction`, `b/stop` → `bus stop`, `rd` → `road`, `st` → `street`, `ave` → `avenue`.
3. Match aliases with word boundaries, preferring longer overlapping aliases. `VI`/`V.I.` maps to Victoria Island. Multiple distinct area hints remain explicit and force caution.
4. Take the phrase after the last recognized relation as the possible landmark; otherwise use the remaining address. Remove area hints, Lagos/Nigeria tokens and a simple leading house number. Relations are metadata; they **never shift coordinates**.
5. Postgres retrieves the globally closest 100 names using pg_trgm distance and a GiST index. There is **no area WHERE filter**. Demo mode scans its six fixtures. Both use the same reranker.
6. `name_score = max(character_ratio, token_sort_ratio) / 100` using RapidFuzz. Drop scores below `CANDIDATE_FLOOR`. Rank by `0.9 × name_score + 0.1 × area_agrees`, capped at 1. Conflicting area hints earn no bonus but cannot remove a place.
7. A reference needs both `ACCEPT_SCORE` and `MIN_NAME_SCORE`. A competitor within `AMBIGUITY_MARGIN` and more than 100 m away causes abstention. Multiple parsed areas also cause abstention. Return at most five candidates in deterministic order.
8. A relative direction such as opposite/behind/after **always requires a destination pin**, even with an exact landmark. Weak/ambiguous matches return `reference: null`. Candidate coordinates remain available for inspection with an approximate-reference label.

These are **uncalibrated ranking scores, not probabilities**. Defaults are engineering choices, not measured accuracy guarantees. Retrieval capped at 100 names can miss a branch among many duplicates. Multiple landmarks, compound directions, local nicknames, incomplete aliases and missing POIs remain known limitations. Add models only when measured failures justify them.

### Database model

```mermaid
erDiagram
    areas ||--o{ area_aliases : has
    places ||--o{ place_sources : preserves
    places ||--o{ pin_corrections : optionally_references
    areas {
        bigint id PK
        text name UK
        geography geom
    }
    area_aliases {
        text alias PK
        bigint area_id FK
    }
    places {
        bigint id PK
        text name
        text name_norm
        text category
        text area
        geography geom
        text source
        text source_id
        text dataset_version
    }
    place_sources {
        text source PK
        text source_id PK
        text dataset_version
        bigint place_id FK
    }
    pin_corrections {
        uuid id PK
        text address_norm
        geography geom
        bigint candidate_id FK
        text status
        text token_id UK
        timestamptz created_at
        timestamptz reviewed_at
    }
```

`schema_migrations` records applied SQL files. `rate_limits` holds expiring HMAC-derived client/action keys and counters. Area centroids are nullable: the initial gazetteer supplies textual hints, not authoritative boundaries. The pilot rectangle is latitude **6.3–6.8**, longitude **2.7–4.0**, not all of Lagos State.

Coordinate conventions: JSON `{lat, lon}`; Leaflet `[lat, lon]`; GeoJSON `[lon, lat]`; PostGIS `ST_MakePoint(lon, lat)`, SRID 4326. Storage uses `geography(Point,4326)` and metre-based dedupe distances. API and DB constraints reject out-of-bounds and swapped Lagos coordinates.

## Postgres/PostGIS setup

Supply a local or existing private Postgres URL with PostGIS and pg_trgm available. Extension creation may require a privileged migration role. Never put the database password in frontend configuration. An existing Supabase Postgres URL also works; no hosted account is necessary.

If Docker is already installed, this optional command starts one local database:

```powershell
docker run --name locateam-db -e POSTGRES_USER=locateam -e POSTGRES_PASSWORD=locateam -e POSTGRES_DB=locateam -p 127.0.0.1:5432:5432 -v locateam-pg:/var/lib/postgresql/data -d postgis/postgis:16-3.4
```

Set `.env`:

```dotenv
DATA_MODE=postgres
DATABASE_URL=postgresql://locateam:locateam@localhost:5432/locateam
SIGNING_SECRET=replace-with-at-least-32-random-characters
```

Generate a secret, copy it into `.env`, then migrate:

```powershell
.\.venv\Scripts\python -c "import secrets; print(secrets.token_hex(32))"
.\.venv\Scripts\python -m scripts.migrate
```

Migrations are transactional, advisory-locked and repeatable. Add increasing SQL filenames for changes. There is no automatic destructive reset/downgrade. Back up corrections before schema changes. For hosted use, separate migration/import credentials from a least-privilege API role.

### OSM download and import

The downloader requests named nodes, ways and relations at an explicit historical timestamp. Ways/relations use bounding-box centres, which need not be entrances or even lie inside concave features. All coordinates stay approximate.

```powershell
.\.venv\Scripts\python -m scripts.fetch_osm --snapshot 2026-09-01T00:00:00Z
.\.venv\Scripts\python -m scripts.import_places --input data/downloads/lagos-osm.json --source osm --version 2026-09-01T00:00:00Z --dry-run
.\.venv\Scripts\python -m scripts.import_places --input data/downloads/lagos-osm.json --source osm --version 2026-09-01T00:00:00Z --report reports/local/osm-import.json
```

If a full query times out, download smaller tiles at the same timestamp to distinct files and import each. The successful development extract used:

```powershell
.\.venv\Scripts\python -m scripts.fetch_osm --snapshot 2026-09-01T00:00:00Z --bbox 6.58 3.32 6.62 3.37 --output data/downloads/ikeja-osm.json
.\.venv\Scripts\python -m scripts.import_places --input data/downloads/ikeja-osm.json --source osm --version 2026-09-01T00:00:00Z --report reports/local/ikeja-import.json
```

Use a past timestamp supported by the endpoint's historical database. `--endpoint` selects an alternative Overpass interpreter URL. Download once and reuse the file. HTTP failures and Overpass partial-result remarks abort. Offline snapshots can be supplied directly to the importer.

The importer validates names, finite coordinates and bounds; preserves source identities; merges equal normalized names within 35 m; keeps distant branches; and updates repeat source imports. An advisory lock serializes imports. Canonical places retain their first source, while `place_sources` preserves merged source/version identities. A merged secondary source does not overwrite canonical coordinates.

Reports contain input/usable/rejected counts, inserted places, updated/merged sources, final DB count, bounds, dataset version and SHA256. Repeating a snapshot inserts no extra places. Versions are operator-supplied; checksums identify actual bytes. Imports are incremental and do not remove features absent from newer snapshots. Dedupe can miss alternate names or merge adjacent same-name features; audit data before relying on it.

### Optional Overture

Supply a Lagos-trimmed **GeoJSON FeatureCollection** of Points with `id`, `names.primary`, optional `categories.primary`, and longitude-first coordinates. Use official Overture tooling to export a selected release. Global Parquet download/conversion is outside this MVP.

```powershell
.\.venv\Scripts\python -m scripts.import_places --input data/downloads/overture-lagos.geojson --source overture --version YOUR_RELEASE_ID --dry-run
.\.venv\Scripts\python -m scripts.import_places --input data/downloads/overture-lagos.geojson --source overture --version YOUR_RELEASE_ID --report reports/local/overture-import.json
```

Import only public place data. Retain OSM/ODbL attribution and the chosen Overture release's licenses and attribution. See `data/README.md`.

## API contract

### `POST /geocode`

```json
{"address":"Opp. Demo Palm Market, Ikeja"}
```

| Response field | Meaning |
| --- | --- |
| `parsed` | Normalized text, landmark, relation, area, all hints and area ambiguity |
| `candidates` | Up to five places with lat/lon, source/version, scores and coordinate kind |
| `reference` | Strong approximate landmark, or null when uncertain |
| `needs_pin` | True for relative addresses, uncertainty and no match |
| `reason` | `no_candidates`, `weak_match`, `ambiguous_match`, `relative_address_requires_pin`, `landmark_reference_only` |
| `score_kind` | Always `uncalibrated_ranking_score` |
| `delivery_entrance_verified` | Always false |
| `data_mode` | `demo` or `postgres` |
| `confirmation_token` | Signed, address-bound, 30-minute token |
| `notice` | Approximate-reference warning |

No top-level precise destination coordinate is emitted. Search returns normalized text to its caller but does not persist it. Consumers must preserve uncertainty labels.

### `POST /confirm`

```json
{
  "address":"Opp. Demo Palm Market, Ikeja",
  "lat":6.602,
  "lon":3.352,
  "candidate_id":"demo-1",
  "confirmation_token":"COPY_FROM_GEOCODE",
  "consent":true
}
```

`candidate_id` may be null for unmatched destinations; otherwise it must belong to this search. Valid submissions return HTTP **202**:

```json
{"ok":true,"id":"generated-uuid","status":"pending","affects_search":false}
```

A token cannot create a second correction. Search again after expiry or address changes. In demo mode an unconfigured signing secret is generated at startup, invalidating earlier tokens on restart. Postgres requires a persistent secret of at least 32 characters.

### `GET /health`

Returns status, mode, usable place count and `real_world_accuracy: unmeasured`; checks DB connectivity and relevant tables. Zero places is a valid empty database, not evidence of coverage. Storage failure returns 503.

Errors: **400** invalid token/candidate/consent; **409** duplicate confirmation; **413** oversized request; **422** field/coordinate validation; **429** rate limit; **503** data service failure. The UI exposes loading, empty, ambiguous and error states.

## Review, privacy and basic abuse protection

- Searches do not persist addresses. Confirmation stores normalized address and exact pin, potentially sensitive, only after explicit consent. Submit only locations you may share.
- All submissions enter `pending`. No public review endpoint or automatic correction reuse exists. Even manually setting `approved` does not activate a correction. Future reuse needs an audited promotion design.
- HMAC-signed tokens bind address hash and candidate IDs to a search, expire after 30 minutes, and cannot be replayed. They are not identity verification; attackers can request new tokens.
- Durable fixed-window limits default to 60 geocodes/minute and 10 confirmation attempts/hour per direct client IP. Keys are HMACs, not stored raw IPs. Expired buckets are removed on requests. This is basic protection, not distributed bot defense.
- Run with `--no-proxy-headers` to prevent arbitrary forwarding headers from evading limits. Future hosting behind a proxy requires explicit trusted-proxy configuration; otherwise proxy users share one bucket.
- CORS only allows configured local origins; it is not authentication. Body/field bounds, finite coordinates, SQL parameters, database constraints and non-reflective service errors provide additional protection.
- Application code does not log address/pin bodies. No address goes to an LLM or external geocoder. Browser OSM tile requests reveal map viewport to the tile provider; optional Google Fonts also require network access.
- Demo submissions stay in ignored `data/private/demo.db`; Postgres corrections stay in your DB. Restrict access, choose retention/deletion procedures, and never publish row-level home data. Automated retention and authenticated review are not yet implemented.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_MODE` | `demo` | Fixture adapter or `postgres` |
| `DATABASE_URL` | Local development URL | Server-only connection |
| `DEMO_DB` | `data/private/demo.db` | Demo review queue and limiter |
| `ACCEPT_SCORE` | `0.86` | Minimum ranking score for a reference |
| `MIN_NAME_SCORE` | `0.78` | Independent name-strength gate |
| `CANDIDATE_FLOOR` | `0.55` | Minimum displayed name score |
| `AMBIGUITY_MARGIN` | `0.12` | Close-score competitors >100 m apart force abstention |
| `REQUESTS_PER_MINUTE` | `60` | Geocode limit per client |
| `CONFIRMATIONS_PER_HOUR` | `10` | Confirmation attempt limit |
| `SIGNING_SECRET` | Ephemeral in demo | Required persistent random key in Postgres |
| `CORS_ORIGINS` | Localhost origins | JSON array of allowed frontend origins |
| `VITE_API_URL` | `/api` | Vite proxies locally; optional API base override |

Restart the API after environment changes. Thresholds must lie between 0 and 1. There is no confidence calibration.

## Benchmark

With the API running:

```powershell
.\.venv\Scripts\python -m scripts.benchmark --dataset data/benchmark_synthetic.json --api http://127.0.0.1:8000 --output reports/local/benchmark.json
```

Metrics include the share of **all addresses** with a returned reference within 100/200/500 m; median error among returned references only (null if none); reference/result share; candidate share; and pin-required share. Distances use Haversine metres. Abstentions are misses in threshold shares, not removed from the denominator. A strong landmark reference may still require a pin, so result and pin shares are not complements. API failures abort evaluation rather than becoming geographic misses.

Large runs may hit the limiter: increase `REQUESTS_PER_MINUTE` for an isolated local evaluation server and restart. For real evaluation, supply an ignored file under `data/private/` with `kind: consented_real`, `consent_confirmed: true`, and rows containing `address`, `lat`, `lon`. Obtain consent separately and run against real imported Postgres places. Do not transmit private evaluation data to third parties.

| Method | Dataset | 100/200/500 m | Median error | Result share | Requires pin |
| --- | --- | --- | --- | --- | --- |
| Rules + fixture adapter | Six synthetic fixtures | Generated report; software test only | Generated report | Generated report | Generated report |
| Rules + PostGIS | Consented real addresses | **Unmeasured** | **Unmeasured** | **Unmeasured** | **Unmeasured** |
| Naive baseline | Consented real addresses | **Unmeasured** | **Unmeasured** | **Unmeasured** | n/a |

No real-world accuracy percentage is claimed. Naive/Nominatim comparisons are future evaluation work, not implemented integrations. No LLM labeling, paid API or fine-tuning is used.

## Tests and verification

```powershell
.\.venv\Scripts\python -m pytest -q
cd web
npm.cmd run build
npm.cmd exec playwright install chromium
npm.cmd run test:e2e
```

Browser tests expect both servers running in demo mode. They exercise desktop 1440×1000 and mobile 390×844: search, candidates, coordinate adjustment, consent, submission, ambiguous/empty states, loading and API errors. Repeated runs against one DB may eventually hit confirmation limits; use an isolated `DEMO_DB` and higher limits for a dedicated test server.

Python tests cover shorthand, aliases, area boundaries, relations, misspellings, incorrect-area survival, distant duplicate names, coordinate order, abstention, pending/replayed pins, validation, limiter spoof resistance, imports and metric denominators.

PostGIS integration requires a **disposable, empty database**, never production:

```powershell
$env:TEST_DATABASE_URL="postgresql://locateam:locateam@localhost:5432/locateam_test"
.\.venv\Scripts\python -m pytest tests/test_postgres.py -q
Remove-Item Env:TEST_DATABASE_URL
```

The integration test migrates twice, imports duplicate fixtures, repeats import, searches with the wrong area, confirms a pin and checks PostGIS coordinates/status. It leaves fixture rows in that disposable DB. GitHub Actions supplies a fresh PostGIS service and runs Python tests, frontend build, browser tests and synthetic benchmark on pushes/PRs. No private address data enters CI.

Local verification: backend tests passed with the PostGIS test skipped for lack of a server; production frontend build passed; desktop/mobile browser flows passed; synthetic benchmark ran; search → inspect → adjust → submit was also verified manually in the in-app browser. These checks do not establish real address accuracy.

## Repository layout

```text
api/                   FastAPI, parsing, matching, configuration and storage
db/migrations/         Ordered PostGIS/pg_trgm SQL migrations
scripts/               Migration, download, import and benchmark commands
data/                  Public aliases and fictional fixtures
data/downloads/        Ignored downloaded snapshots
data/private/          Ignored submissions and consented evaluation data
reports/               Non-private source validation reports
reports/local/         Ignored local benchmark/import reports
tests/                 Python and PostGIS tests
web/                   React, Leaflet, Vite and browser tests
.github/workflows/     Verification pipeline
```

## What you must supply for real use

1. Postgres/PostGIS connection and extension permissions; migrate and import.
2. A stable random signing secret in private `.env`.
3. Public Lagos OSM snapshots (download requires internet), optionally Overture exports.
4. A separate consented real address/pin dataset for credible measurements.

No LLM key, map API key, purchase or public deployment is required. Before any public launch, measure performance and implement authenticated review, retention/deletion, trusted proxy settings and operational monitoring.

## Technical references

- [PostgreSQL pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html): fuzzy distance operators and indexing.
- [PostGIS ST_DWithin](https://postgis.net/docs/ST_DWithin.html): geography dedupe distances in metres.
- [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL): dated snapshots and centres.
- [OpenStreetMap attribution and licensing](https://www.openstreetmap.org/copyright).
