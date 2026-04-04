# Stage 3: TripAdvisor Match

## Purpose

Match each stage-1 hotel record to a TripAdvisor hotel page and store the enrichment separately.
TripAdvisor identity becomes the canonical hotel key used by stage 4 and later
stages.

## Inputs

- Stage-1 per-plan JSON files from `data-pipeline/1-list/`
- Search tooling such as Brave/web search
- Optional existing stage-2 JSON files for backfill-aware reruns

## Outputs

Write one JSON file per plan/source in this directory. The output must be keyed by `source_hotel_id`.

Example output paths:

- `data-pipeline/3-tripadvisor/amex-fhr-hotel.json`
- `data-pipeline/3-tripadvisor/aspire-hotel.json`

Target JSON shape:

```json
{
  "metadata": {
    "stage": "3-tripadvisor",
    "source": "amex_fhr",
    "generated_at": "2026-04-03T00:00:00.000Z",
    "record_count": 1
  },
  "matches": {
    "Hawaii-US/Princeville/1-Hotel-Hanalei-Bay": {
      "tripadvisor_id": "g60625-d123456",
      "tripadvisor_url": "https://www.tripadvisor.com/Hotel_Review-g60625-d123456-Reviews-Example.html",
      "search_query": "1 Hotel Hanalei Bay Princeville Hawaii TripAdvisor",
      "match_confidence": "high",
      "matched_at": "2026-04-03T00:00:00.000Z"
    }
  }
}
```

## Required Fields

Each match record must include:

- `tripadvisor_id`
- `tripadvisor_url`
- `search_query`
- `match_confidence`
- `matched_at`

Recommended `match_confidence` values:

- `high`
- `medium`
- `low`
- `none`

## Matching Rules

- Build the query from normalized hotel name, city/region, and the term `TripAdvisor`.
- Prefer exact TripAdvisor hotel pages over directory, forum, or attraction pages.
- Extract `tripadvisor_id` from the matched URL. Example: `g294013-d2154485`.
- Store the query used so the match can be audited later.

## Backfill Behavior

- Default behavior is backfill-only.
- If a hotel already has `tripadvisor_id`, do not search again unless force-refresh is enabled.
- If a prior record exists with `match_confidence=none`, a later rerun may retry if force-refresh is enabled or if search logic improves.

## Failure and Retry Expectations

- If no reliable TripAdvisor page is found, keep the hotel in the output with:
  - `tripadvisor_id` as an empty string
  - `tripadvisor_url` as an empty string
  - `match_confidence` as `none`
- Do not drop hotels from the output because matching failed.
- Retries should preserve existing successful matches unless force-refresh is enabled.

## Script Notes

- Keep search and URL parsing helpers in shared utilities when the logic becomes reusable.
- TripAdvisor scripts should read stage-1 files plus optional stage-2 enrichment
  when helpful and write only stage-3 artifacts.
- Logging should make it easy to review low-confidence and unmatched results
  before stage 4 canonicalization.
