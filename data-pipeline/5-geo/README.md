# Stage 5: Geo

## Purpose

Attach geo enrichment to canonical hotels using provided input files or approved geo providers.
This stage exists to normalize and backfill geo data after canonical identity is already known.

## Inputs

- Canonical hotel registry from `data-pipeline/3-unique/hotel.json`
- Provided geo input files from collaborators or external enrichment sources

## Outputs

Write geo enrichment keyed by `tripadvisor_id`.

Recommended output path:

- `data-pipeline/5-geo/hotel-geo.json`

Target JSON shape:

```json
{
  "metadata": {
    "stage": "5-geo",
    "generated_at": "2026-04-03T00:00:00.000Z",
    "record_count": 1
  },
  "geo": {
    "g294013-d2154485": {
      "tripadvisor_id": "g294013-d2154485",
      "latitude": "24.467222",
      "longitude": "54.323056",
      "formatted_address": "West Corniche, Abu Dhabi, United Arab Emirates",
      "geo_provider": "manual_import",
      "geo_confidence": "high",
      "geo_status": "resolved",
      "updated_at": "2026-04-03T00:00:00.000Z"
    }
  }
}
```

## Required Fields

- `latitude`
- `longitude`
- `formatted_address`
- `geo_provider`
- `geo_confidence`
- `geo_status`
- `updated_at`

optional
- country
- city

Use `tripadvisor_id` as the key for each geo record.

## Behavior Rules

- Backfill only when geo data is missing unless force-refresh is enabled.
- Use canonical hotels from stage 3 as the population for geo enrichment.
- Do not write plan-specific geo files in v1; geo belongs to canonical hotels.
- If a provided input file has conflicting coordinates, prefer the explicitly approved source and record the provider used.

## Failure and Retry Expectations

- If a geo input row cannot be matched to a canonical hotel, skip it and surface it for manual review.
- Missing geo should not block the hotel from existing in the canonical registry.
- A rerun should preserve existing geo values unless refresh is explicitly requested.

## Script Notes

- This stage can be a simple transformer if geo data is already collected elsewhere.
- Normalize collaborator-provided inputs into the stage-5 JSON contract.
- Stage-5 scripts should read stage-3 data and approved geo inputs, then write only stage-5 artifacts.
