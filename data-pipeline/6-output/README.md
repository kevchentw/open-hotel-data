# Stage 6: Output

## Purpose

Assemble the final pipeline outputs from canonical identity, links, price, and geo/address data already captured upstream.
This stage is the export layer for both pipeline consumers and the current app-facing JSON files.

## Inputs

- Canonical registry from `data-pipeline/4-unique/`
- Price enrichment from `data-pipeline/5-price/`
- Geo and address fields carried forward from list and enrichment stages

## Outputs

Stage 6 is responsible for two output families:

- canonical JSON outputs for pipeline consumers
- app-facing JSON outputs for the current frontend

Recommended output set:

- `data-pipeline/6-output/hotels.json`
- `public/data/hotels.json`

Target JSON shape for pipeline output:

```json
{
  "metadata": {
    "stage": "6-output",
    "generated_at": "2026-04-03T00:00:00.000Z",
    "canonical_count": 1,
    "fallback_count": 1
  },
  "hotels": {
    "g294013-d2154485": {
      "tripadvisor_id": "g294013-d2154485",
      "name": "Conrad Abu Dhabi Etihad Towers",
      "tripadvisor_url": "https://www.tripadvisor.com/Hotel_Review-g294013-d2154485-Reviews-.html",
      "plans": [
        "amex_fhr",
        "hilton_aspire_resort_credit"
      ],
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
      },
      "summary_price": {
        "currency": "USD",
        "source": "hilton",
        "cost": "640"
      },
      "currency": "USD",
      "latitude": "24.467222",
      "longitude": "54.323056",
      "formatted_address": "West Corniche, Abu Dhabi, United Arab Emirates"
    }
  },
  "fallback_hotels": {
    "amex_thc::Example-Source-Id": {
      "id": "amex_thc::Example-Source-Id",
      "record_type": "fallback",
      "source": "amex_thc",
      "source_hotel_id": "Example-Source-Id",
      "name": "Example Hotel",
      "fallback_reason": "missing_tripadvisor_stage"
    }
  }
}
```

## Export Rules

- Final canonical JSON should be keyed by `tripadvisor_id`.
- Plan-specific JSON should be derived from canonical hotels plus the stage-4
  `links`.
- `summary_price` and export-level `currency` are optional and should only be
  emitted when stage 5 produced normalized price data.
- App-facing JSON may derive a legacy frontend ID if needed, but that ID is an export detail rather than the pipeline source-of-truth identifier.
- Do not emit unmatched hotels into canonical output as if they were resolved hotels.
- Unmatched hotels should still be exported in a separate fallback bucket so the
  app can display them before identity matching is complete.

## App Output Expectations

Stage 6 should be able to generate data compatible with the current frontend shape, including:

- `public/data/hotels.json`

At export time, the adapter may map canonical TripAdvisor-based records into the existing app schema, including any derived legacy IDs required by the frontend.
Fallback app records should use a stable source-derived ID such as
`source::source_hotel_id` and remain clearly marked as fallback records.

## Failure and Retry Expectations

- Stage 6 should fail loudly if the stage-4 canonical data is missing or
  malformed.
- Missing price or geo fields should not prevent hotel export if the canonical record is otherwise valid.
- A rerun should be deterministic from canonical, price, and upstream geo/address inputs.

## Script Notes

- Reuse existing serialization helpers where helpful, but treat them as output adapters.
- Stage-6 scripts should read only upstream stage artifacts and write final JSON outputs.
