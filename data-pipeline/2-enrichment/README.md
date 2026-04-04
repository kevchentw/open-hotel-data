# Stage 2: Source Enrichment

## Purpose

Enrich stage-1 source rows with more detail from source-native pages before any
cross-source identity matching happens.

This stage exists to keep "collect what the source itself says" separate from
"decide which records refer to the same real hotel."

## Inputs

- stage-1 per-plan JSON from `data-pipeline/1-list/`
- source-native detail pages, landing pages, or approved source files
- optional existing stage-2 enrichment JSON for backfill-aware reruns

## Outputs

Write one JSON file per source or plan in this directory. The output must be
keyed by `source_hotel_id`.

Example target paths:

- `data-pipeline/2-enrichment/hilton-aspire-hotel.json`
- `data-pipeline/2-enrichment/amex-hotel.json`

Target JSON shape:

```json
{
  "metadata": {
    "stage": "2-enrichment",
    "source": "hilton_aspire_resort_credit",
    "generated_at": "2026-04-03T00:00:00.000Z",
    "record_count": 1
  },
  "hotels": {
    "conrad-maldives-rangali-island": {
      "source_hotel_id": "conrad-maldives-rangali-island",
      "detail_url": "https://www.hilton.com/en/hotels/example/",
      "detail_address": "Rangali Island, South Ari Atoll, Maldives",
      "detail_city": "South Ari Atoll",
      "detail_state_region": "",
      "detail_country": "Maldives",
      "detail_latitude": "3.6167",
      "detail_longitude": "72.7167",
      "lowest_public_price": "1342.00",
      "price_currency": "USD",
      "source_rating": "4.6",
      "source_review_count": "1287",
      "amenities": [
        "pool",
        "spa",
        "parking"
      ],
      "tags": [
        "resort",
        "newly_built"
      ],
      "notes": "",
      "enriched_at": "2026-04-03T00:00:00.000Z"
    }
  }
}
```

## Good Candidates For This Stage

Examples already identified:

1. Hilton resort detail and landing pages
2. Amex hotel detail pages

Useful data to capture here when available:

- address cleanup beyond the stage-1 list page
- city, state, country, and GPS from the detail page
- public lowest price shown on the source page
- source-native rating and review count
- amenity coverage such as parking or pool
- special labels such as newly built
- source-specific partner messaging or badges that do not belong in canonical identity

## Required Fields

Minimum required fields for an enrichment record:

- `source_hotel_id`
- `detail_url`
- `enriched_at`

Recommended fields when available:

- `detail_address`
- `detail_city`
- `detail_state_region`
- `detail_country`
- `detail_latitude`
- `detail_longitude`
- `lowest_public_price`
- `price_currency`
- `source_rating`
- `source_review_count`
- `amenities`
- `tags`
- `notes`

If a field is unavailable, prefer an empty string or empty array instead of
dropping the hotel from the stage output.

## Behavior Rules

- do not dedupe or merge across plans in this stage
- preserve source-native values even if formatting is inconsistent
- this stage may improve fields that were rough in stage 1, but it should not overwrite stage-1 source truth files
- keep enrichment scoped to what the source itself exposes
- TripAdvisor IDs and cross-source matching decisions do not belong here

## Backfill Behavior

- default behavior should be backfill-only
- if a hotel already has good enrichment, do not refetch unless force-refresh is enabled
- reruns may fill in newly supported fields without discarding older successful enrichment

## Failure and Retry Expectations

- if enrichment fails for one hotel, keep the hotel in the output with partial data where possible
- if one source fails, do not corrupt previous enrichment for other sources
- log enough context to retry specific hotels or pages later
- retries should be safe and should preserve existing successful enrichment unless force-refresh is enabled

## Script Notes

- keep source-specific enrichment scripts in this directory
- enrichers should read stage-1 outputs and write only stage-2 artifacts
- reusable page parsing or normalization helpers can move into shared utilities once they are used by more than one source
