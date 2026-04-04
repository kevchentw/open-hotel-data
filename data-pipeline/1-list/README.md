# Stage 1: List Collection

## Purpose

Collect raw hotel records from each source/plan and store them without cross-plan deduplication.
This stage preserves source truth and creates the base artifact used by all later enrichment steps.

## Inputs

- Source collectors under `data-pipeline/1-list/scripts`
- Live list pages or source-specific input files, depending on the collector

## Outputs

Write one JSON file per plan/source in this directory. The output must be keyed by `source_hotel_id`.

Example output paths:

- `data-pipeline/1-list/amex-fhr-hotel.json`
- `data-pipeline/1-list/amex-thc-hotel.json`
- `data-pipeline/1-list/aspire-hotel.json`

Target JSON shape:

```json
{
  "metadata": {
    "stage": "1-list",
    "source": "amex_fhr",
    "generated_at": "2026-04-03T00:00:00.000Z",
    "record_count": 1
  },
  "hotels": {
    "Hawaii-US/Princeville/1-Hotel-Hanalei-Bay": {
      "source": "amex_fhr",
      "source_hotel_id": "Hawaii-US/Princeville/1-Hotel-Hanalei-Bay",
      "name": "1 Hotel Hanalei Bay",
      "address_raw": "5520 Ka Haku Rd, Princeville, HI 96722, USA",
      "city": "Princeville",
      "state_region": "Hawaii",
      "country": "United States",
      "url": "https://www.americanexpress.com/en-us/travel/discover/property/Hawaii-US/Princeville/1-Hotel-Hanalei-Bay",
      "plan": "Fine Hotels + Resorts",
      "brand": "1 Hotels",
      "chain": "",
      "latitude": "22.2206439",
      "longitude": "-159.4972603",
      "collected_at": "2026-04-03T00:00:00.000Z"
    }
  }
}
```

## Required Fields

Each hotel record must include:

- `source`
- `source_hotel_id`
- `name`
- `address_raw`
- `city`
- `state_region`
- `country`
- `url`
- `plan`
- `brand`
- `chain`
- `latitude`
- `longitude`
- `collected_at`

Collectors may include more fields, but these are the minimum contract for downstream stages.

## Behavior Rules

- Do not dedupe hotels across plans or sources in this stage.
- Preserve source values as collected, even if formatting differs between sources.
- If a field is unavailable, store an empty string rather than dropping the record.
- A rerun may overwrite the stage-1 file because this stage is the fresh source-truth snapshot.

## Failure and Retry Expectations

- If collection fails for one source, do not corrupt previously written artifacts for other sources.
- If a hotel row is partially complete, keep the row and leave missing fields blank when possible.
- Hard failures should be recorded in script logs with enough context to rerun the collector.
- A retry should be safe and should regenerate the stage file from source input.

## Script Notes

- Keep stage-specific crawler dependencies inside `data-pipeline/1-list/scripts/`.
- Keep one entry script per source family under `data-pipeline/1-list/scripts/`.
- Stage-1 scripts should only read source input and write stage-1 JSON.
