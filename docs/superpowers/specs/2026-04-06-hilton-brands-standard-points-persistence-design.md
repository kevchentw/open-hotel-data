# Hilton Brands Standard Points Persistence Design

**Date:** 2026-04-06
**Status:** Approved

## Goal

Persist the historical lowest Standard Room Reward points price per hotel across crawl runs, so that if a hotel switches to Premium-only pricing, the previously observed Standard price is not lost. Also provide a CSV for manually entering Standard points for hotels the crawler never captured as Standard.

## New Files

| Path | Who writes it | Purpose |
|---|---|---|
| `data-pipeline/1-list/hilton-brands-points-history.json` | Crawler (auto) | Running minimum Standard points per hotel, keyed by `source_hotel_id` |
| `data-pipeline/1-list/hilton-brands-points-manual.csv` | Crawler (auto-seed) + human (fill values) | Manual Standard points lookup table; auto-populated with blank rows for hotels needing attention |

## CSV Schema

```
source_hotel_id,hotel_name,standard_points,notes
auhetci,Conrad Abu Dhabi Etihad Towers,,
lonwahi,Waldorf Astoria London,60000,verified from app Apr 2026
```

- `source_hotel_id` — required, matches `source_hotel_id` in stage-1 record
- `hotel_name` — required, written by crawler for human readability
- `standard_points` — integer or blank; blank = needs manual lookup
- `notes` — optional free text

Rows are sorted by `source_hotel_id`. Crawler only appends new rows; it never modifies or removes existing rows (preserves manual edits).

## History File Schema

```json
{
  "metadata": {
    "updated_at": "2026-04-06T19:34:49.266Z"
  },
  "hotels": {
    "auhetci": {
      "standard_lowest_points_price": "50000",
      "captured_at": "2026-04-06T19:34:49.266Z"
    }
  }
}
```

Keyed by `source_hotel_id`. Only contains hotels where a Standard price has been seen. `standard_lowest_points_price` only ever decreases (newer crawl can lower it, never raise it).

## New Output Field

Each hotel record in `hilton-brands-hotel.json` gains one field:

```json
"standard_lowest_points_price": "50000"
```

Empty string `""` when no Standard price is available from any source.

## Crawler Logic Per Hotel

| Current crawl result | In history? | In manual CSV? | `standard_lowest_points_price` | Side-effects |
|---|---|---|---|---|
| Standard found | no | — | current value | Write to history |
| Standard found | yes (higher) | — | current value | Update history (lower) |
| Standard found | yes (lower) | — | history value | No history update needed |
| Premium only | yes | — | history value | No change |
| Premium only | no | yes, filled | manual value | No change |
| Premium only | no | yes, blank | `""` | No change |
| Premium only | no | no | `""` | Append blank row to CSV |

**Rule:** `standard_lowest_points_price` = minimum of (current Standard if available, history value if any, manual value if filled). Empty string if none.

## Crawler Update Steps (added to `writeStageOneOutputs`)

1. Load history file (empty object if file doesn't exist)
2. Load manual CSV (empty map if file doesn't exist)
3. For each hotel record built from extract:
   a. Determine `standard_lowest_points_price` using the table above
   b. If current crawl has Standard pricing: update history entry if lower than existing
4. For hotels where only Premium seen, no history, and not in manual CSV: collect them
5. Append new blank rows to manual CSV for collected hotels (sort by `source_hotel_id`)
6. Write updated history file
7. Write `hilton-brands-hotel.json` with `standard_lowest_points_price` on every record

## What the Crawler Never Does

- Never removes rows from the manual CSV
- Never modifies existing CSV rows (preserves manual edits and notes)
- Never raises a value in the history file (only lowers or keeps)

## Files to Commit

Both `hilton-brands-points-history.json` and `hilton-brands-points-manual.csv` follow the same convention as other stage-1 artifacts — they are committed to git. This makes the history auditable and the manual CSV diff-reviewable.
