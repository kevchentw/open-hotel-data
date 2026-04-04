# Stage 4: Price

## Purpose

Attach price information to canonical hotels after identity has been resolved in stage 3.
Prices belong to canonical hotels keyed by `tripadvisor_id`, not to raw plan-only records.

## Inputs

- Canonical hotel registry from `data-pipeline/3-unique/hotel.json`
- Price providers or backfill sources approved for this project

## Outputs

Write one price-history JSON file per canonical hotel under a `prices/` subdirectory.

Recommended output path:

- `data-pipeline/4-price/prices/g294013-d2154485.json`
- `data-pipeline/4-price/prices/g293736-d25054745.json`

Target JSON shape:

```json
{
  "metadata": {
    "stage": "4-price",
    "generated_at": "2026-04-03T00:00:00.000Z",
    "tripadvisor_id": "g294013-d2154485"
  },
  "prices": {
    "2026-04-05": {
      "currency": "USD",
      "fetched_at": "2026-04-03T00:00:00.000Z",
      "source": "xotelo",
      "cost": "640"
    },
    "2026-05-05": {
      "currency": "USD",
      "fetched_at": "2026-04-03T00:00:00.000Z",
      "source": "xotelo",
      "cost": "910"
    }
  }
}
```

## Required Fields

- `metadata.tripadvisor_id`
- one or more stay-date keys inside `prices`
- `currency`
- `fetched_at`
- `source`
- `cost`

Each file represents one canonical hotel. Each key inside `prices` is the target stay date for that quoted rate.
Optional future fields may include room type, cancellation terms, taxes, or provider metadata.

## Behavior Rules

- Only canonical hotels from stage 3 are eligible for price enrichment.
- Default behavior is backfill-only for missing stay dates or hotels that do not yet have a price file.
- Force-refresh may intentionally update existing prices and timestamps.
- If a provider cannot price a hotel, keep the record out of canonical output until a later successful fetch rather than attaching it to an unmatched source row.

## Failure and Retry Expectations

- Partial failures should not erase previously fetched prices unless force-refresh is enabled and replacement data is successfully written.
- Failed fetches should be visible in logs or metadata so reruns can target them.
- A retry should be safe for any subset of canonical hotels.

## Script Notes

- Keep provider-specific fetch logic separate from serialization.
- Stage-4 scripts should read stage-3 output and write only stage-4 price artifacts.
- If multiple providers are used later, normalize them into this per-hotel history contract before stage 6.
