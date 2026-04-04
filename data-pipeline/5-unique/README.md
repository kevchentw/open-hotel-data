# Stage 5: Unique Canonical Registry

## Purpose

Merge stage-1 hotel records across plans using TripAdvisor identity from stage 2 and build the
canonical hotel registry for the rest of the pipeline.

This is the first stage where cross-plan merging is allowed.

## Inputs

- Stage-1 per-plan JSON from `data-pipeline/1-list/`
- Stage-2 TripAdvisor match JSON from `data-pipeline/2-tripadvisor/`

## Outputs

Write one canonical registry JSON in this directory.

Example output path:

- `data-pipeline/3-unique/hotel.json`

Target JSON shape:

```json
{
  "metadata": {
    "stage": "3-unique",
    "generated_at": "2026-04-03T00:00:00.000Z",
    "canonical_count": 1,
    "link_count": 2,
    "unmatched_count": 1
  },
  "hotels": {
    "g294013-d2154485": {
      "tripadvisor_id": "g294013-d2154485",
      "tripadvisor_url": "https://www.tripadvisor.com/Hotel_Review-g294013-d2154485-Reviews-.html",
      "name": "Conrad Abu Dhabi Etihad Towers",
      "city": "Abu Dhabi",
      "state_region": "",
      "country": "United Arab Emirates",
      "brand": "Conrad",
      "chain": "Hilton",
      "plans": [
        "amex_fhr",
        "hilton_aspire_resort_credit"
      ]
    }
  },
  "links": {
    "amex_fhr::source-id-1": {
      "source": "amex_fhr",
      "source_hotel_id": "source-id-1",
      "tripadvisor_id": "g294013-d2154485"
    }
  },
  "unmatched": {
    "amex_fhr::source-id-2": {
      "source": "amex_fhr",
      "source_hotel_id": "source-id-2",
      "reason": "missing_tripadvisor_match",
      "name": "Example Hotel"
    }
  }
}
```

## Required Outputs

The stage output must contain:

- `hotels`: canonical hotel objects keyed by `tripadvisor_id`
- `links`: per-source mappings from `source + source_hotel_id` to `tripadvisor_id`
- `unmatched`: unresolved records that do not have a reliable TripAdvisor match

## Merge Rules

- Exact TripAdvisor ID match means the records refer to the same canonical hotel.
- Do not merge records across plans unless they share the same trusted `tripadvisor_id`.
- Preserve source traceability through the `links` object.
- Canonical fields may choose the best available non-empty source value, but the merge strategy must be deterministic.

## Identity Rules

- `tripadvisor_id` is the canonical hotel key in v1.
- Hotels without a TripAdvisor match must remain in `unmatched`.
- Do not generate a synthetic canonical hotel ID for unmatched records in v1.

## Failure and Retry Expectations

- If one source file is malformed, fail loudly rather than silently producing a partial canonical registry.
- A rerun should rebuild the canonical registry deterministically from stages 1 and 2.
- Unmatched hotels should remain visible for manual review and later enrichment.

## Script Notes

- This stage should not call external services.
- It should be a pure merge step built from existing stage artifacts.
- Put reusable merge/normalization helpers under shared utilities if the logic grows.
