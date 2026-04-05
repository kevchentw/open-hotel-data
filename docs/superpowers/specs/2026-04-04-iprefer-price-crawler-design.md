# iPrefer Price Crawler Design

**Date:** 2026-04-04  
**Stage:** 5-price  
**File:** `data-pipeline/5-price/fetch-iprefer.mjs`

---

## Overview

Fetch iPrefer points and cash rates for canonical hotels that have an `iprefer_synxis_id`, and store them alongside existing xotelo price artifacts.

## Inputs

| File | Purpose |
|------|---------|
| `data-pipeline/4-unique/hotel.json` | Canonical hotel registry; filter to hotels with `iprefer_synxis_id` |
| `data-pipeline/1-list/iprefer-points-hotel.json` | Provides `nid` per hotel, matched via `synxis_id` → `iprefer_synxis_id` |
| `data-pipeline/5-price/prices/*.json` | Existing artifacts; used to determine skip/fetch |

## API Endpoints

Both endpoints return all available dates in one call (~500+ dates).

| Call | URL | Extracts |
|------|-----|---------|
| Points | `https://ptgapis.com/rate-calendar/v2?nid={nid}&adults=2&children=0&rateCode=IPPOINTS` | Min `points` across available dates |
| Cash | `https://ptgapis.com/rate-calendar/v2?nid={nid}&adults=2&children=0` | Lowest `rate + tax` across available dates in next 12 months |

A date is "available" when `is_available: true` and `has_inventory: true` and `allows_check_in: true`.

## Output Schema

Adds a new top-level `iprefer` field to each `prices/{tripadvisor_id}.json` artifact:

```json
{
  "metadata": { "...existing fields..." },
  "iprefer": {
    "currency": "USD",
    "fetched_at": "2026-04-04T12:00:00.000Z",
    "months": {
      "2026-04": {
        "cash_min": "168.00",
        "cash_max": "522.00",
        "cash_available_nights": 18,
        "points_min": "50000",
        "points_max": "50000",
        "points_available_nights": 20
      },
      "2026-05": { "..." }
    }
  },
  "prices": { "...existing xotelo prices..." },
  "sample_attempts": { "...existing..." }
}
```

- `months` — keyed by `YYYY-MM`; only months with at least one available night included
- `cash_min` / `cash_max` — lowest/highest `rate + tax` across available cash nights in the month; omitted if no cash data
- `cash_available_nights` — count of nights available for cash booking; omitted if no cash data
- `points_min` / `points_max` — lowest/highest `points` value across available points nights; omitted if no points data
- `points_available_nights` — count of nights available for points booking; omitted if no points data
- A night is "available" when `is_available: true`, `has_inventory: true`, `allows_check_in: true`
- `currency` — always `"USD"` (API returns USD)
- If no data is found for either call, `iprefer` is omitted from the artifact

## Skip Logic

- **Skip** a hotel if its existing artifact already has an `iprefer` field, unless `STAGE5_IPREFER_FORCE_REFRESH=true`
- **Do not skip** hotels that have existing xotelo `prices` — iprefer data is fetched independently

## nid Resolution

Build a `synxisId → nid` map from `iprefer-points-hotel.json`, then for each canonical hotel with a non-empty `iprefer_synxis_id`, look up its `nid`. Hotels with no matching `nid` are skipped with a warning.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STAGE5_IPREFER_FORCE_REFRESH` | `false` | Re-fetch even if `iprefer` field already present |
| `STAGE5_IPREFER_CONCURRENCY` | `5` | Parallel hotel fetches |
| `STAGE5_HOTEL_IDS` | *(all)* | Comma-separated tripadvisor IDs to restrict fetch (shared with xotelo stage) |

## Concurrency

Uses the same `mapWithConcurrency` helper already in `fetch.mjs`. Each hotel makes 2 sequential API calls (points then cash); hotels run in parallel up to concurrency limit.

## Error Handling

- HTTP error on either call → log warning, store `fetch_error` status in `iprefer.status`, continue
- Empty results (count 0) → omit the corresponding field (`points` or `cash`), log warning
- Missing `nid` → skip hotel, log warning

## CLI Entry Point

```bash
node data-pipeline/5-price/fetch-iprefer.mjs
```

Mirrors the pattern of `fetch.mjs` — runs `writeIpreferArtifacts()` when invoked directly.
