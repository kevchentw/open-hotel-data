# TripAdvisor Data Quality Tool — Design Spec

**Date:** 2026-04-05  
**Status:** Approved

## Summary

Two new scripts added to the stage 3 tripadvisor pipeline:

1. **`quality-check.mjs`** — scores each matched hotel by comparing the hotel name against the TripAdvisor URL slug, writing quality fields in place on unreviewed entries
2. **`quality-review.mjs`** — generates a review queue of flagged entries for manual inspection, and applies manual verdicts back into the stage 3 files

## Data Shape

Each match entry in a stage 3 JSON file (`amex-fhr-hotel.json`, `amex-thc-hotel.json`, `aspire-hotel.json`, `chase-edit-hotel.json`) gains up to five optional fields:

```json
{
  "tripadvisor_id": "g154911-d184171",
  "tripadvisor_url": "https://www.tripadvisor.com/Hotel_Review-g154911-d184171-Reviews-Fairmont_Banff_Springs-Banff_Banff_National_Park_Alberta.html",
  "search_query": "Fairmont Banff Springs",
  "match_confidence": "high",
  "matched_at": "...",

  "quality_score": 1.0,
  "quality_flag": "ok",
  "quality_reason": "4/4 name tokens found in slug",

  "quality_review": "approved",
  "quality_corrected_url": ""
}
```

**`quality_flag`** (set by checker): `ok` | `suspect` | `likely_wrong`  
**`quality_review`** (set by you via review tool): `approved` | `wrong`  
**`quality_corrected_url`** (set by you when `wrong`): the correct TripAdvisor URL

### Immutability rules

- The checker **never touches** entries that already have `quality_review` set.
- The apply step **only touches** entries present in the queue file.
- Once `quality_review` is set, the entry is permanently exempt from re-scoring.

## Scoring Logic

### Slug extraction

From a TripAdvisor URL path like:
```
/Hotel_Review-g154911-d184171-Reviews-Fairmont_Banff_Springs-Banff_National_Park_Alberta.html
```

Strip the prefix pattern `/Hotel_Review-gNNN-dNNN-Reviews-` and the `.html` suffix, then replace `_` with spaces:
```
Fairmont Banff Springs Banff National Park Alberta
```

### Token comparison

Tokenize both the hotel name (from stage 1) and the extracted slug text:
- Lowercase
- Strip punctuation and special characters
- Split on whitespace
- Remove common stop words: `the`, `a`, `an`, `and`, `of`, `at`, `in`, `by`

Count how many hotel name tokens appear anywhere in the slug token set.

**Score** = matched tokens / total name tokens (after stop-word removal)

### Thresholds

| Score | Flag | Meaning |
|---|---|---|
| ≥ 0.8 | `ok` | Strong match, likely correct |
| 0.5–0.79 | `suspect` | Partial match, worth reviewing |
| < 0.5 | `likely_wrong` | Few or no name tokens found |

### Special cases

- Entry has empty `tripadvisor_url`: flag `likely_wrong`, reason `"no tripadvisor url"`
- Entry has `match_confidence: "none"`: skip entirely (already known unmatched, no quality score written)

## Scripts

### `data-pipeline/3-tripadvisor/quality-check.mjs`

**Purpose:** Score all unreviewed matches across all sources.

**Behavior:**
1. Reads all 4 stage 3 JSON files
2. For each source, reads the corresponding stage 1 JSON to get hotel names keyed by `source_hotel_id`
3. For each match entry: skip if `quality_review` is already set; skip if `match_confidence === "none"`; otherwise compute and write `quality_score`, `quality_flag`, `quality_reason`
4. Writes updated stage 3 files in place (same format, same key order)
5. Prints summary per source and overall totals

**npm script:** `pipeline:stage3:quality-check`

### `data-pipeline/3-tripadvisor/quality-review.mjs`

**Purpose:** Generate review queue and apply manual verdicts.

**Generate mode** (`pipeline:stage3:quality-review`):
1. Reads all 4 stage 3 files
2. Collects entries where `quality_flag` is `suspect` or `likely_wrong` AND `quality_review` is not set
3. Writes `data-pipeline/3-tripadvisor/quality-review-queue.json`
4. Prints count of entries written to queue

**Queue file format:**
```json
[
  {
    "source": "amex_fhr",
    "source_hotel_id": "Alberta-CA/Jasper/The-Fairmont-Jasper-Park-Lodge",
    "hotel_name": "The Fairmont Jasper Park Lodge",
    "tripadvisor_url": "https://...",
    "quality_score": 0.5,
    "quality_flag": "suspect",
    "quality_reason": "2/4 name tokens found in slug",
    "verdict": "",
    "corrected_url": ""
  }
]
```

You fill in `verdict: "approved"` or `verdict: "wrong"`, and `corrected_url` when wrong.

**Apply mode** (`pipeline:stage3:quality-apply`):
1. Reads `quality-review-queue.json`
2. For each entry with a non-empty `verdict`:
   - Writes `quality_review: verdict` onto the match in the correct stage 3 file
   - If `verdict === "wrong"` and `corrected_url` is provided: also writes `quality_corrected_url` and updates `tripadvisor_url` and `tripadvisor_id` from the corrected URL
3. Removes applied entries from the queue file (entries with empty verdict remain)
4. Prints summary of applied changes

## File Layout

```
data-pipeline/3-tripadvisor/
  quality-check.mjs              # new
  quality-review.mjs             # new
  quality-review-queue.json      # generated, gitignored or committed as-needed
  amex-fhr-hotel.json            # existing, gains quality fields in place
  amex-thc-hotel.json            # existing, gains quality fields in place
  aspire-hotel.json              # existing, gains quality fields in place
  chase-edit-hotel.json          # existing, gains quality fields in place
```

## npm Scripts

```json
"pipeline:stage3:quality-check": "node data-pipeline/3-tripadvisor/quality-check.mjs",
"pipeline:stage3:quality-review": "node data-pipeline/3-tripadvisor/quality-review.mjs",
"pipeline:stage3:quality-apply":  "node data-pipeline/3-tripadvisor/quality-review.mjs --apply"
```

## Typical Workflow

```
# After running stage 3 matchers:
npm run pipeline:stage3:quality-check

# Generate queue of flagged entries:
npm run pipeline:stage3:quality-review

# Edit quality-review-queue.json, fill in verdict / corrected_url

# Apply your verdicts back:
npm run pipeline:stage3:quality-apply
```

## Source File Mapping

| Source slug | Stage 3 file | Stage 1 file |
|---|---|---|
| `amex_fhr` | `amex-fhr-hotel.json` | `../1-list/amex-fhr-hotel.json` |
| `amex_thc` | `amex-thc-hotel.json` | `../1-list/amex-thc-hotel.json` |
| `hilton_aspire_resort_credit` | `aspire-hotel.json` | `../1-list/aspire-hotel.json` |
| `chase_edit` | `chase-edit-hotel.json` | `../1-list/chase-edit-hotel.json` |
