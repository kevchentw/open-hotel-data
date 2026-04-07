# Cross-Plan TripAdvisor Lookup — Design Spec

**Date:** 2026-04-07

## Problem

Each stage 3 TripAdvisor script only checks its own output file when deciding which hotels still need matching. If a hotel appears in multiple plans (e.g. the same property is in both `amex_fhr` and `bilt_hafh`), the second plan will waste a browser session re-matching a hotel that is already resolved.

## Goal

Before opening a browser, automatically resolve any pending hotel whose TripAdvisor identity is already known from another plan's stage 3 output — using stage 4 `hotel.json` as the authoritative cross-plan source.

## Source of Truth

**`data-pipeline/4-unique/hotel.json`**

Stage 4 is the de-duplicated, enriched aggregate of all plans. Each entry is keyed by `tripadvisor_id` and contains:
- `source_keys` — array of `"plan::source_hotel_id"` strings for every plan that maps to this hotel
- `latitude`, `longitude` — enriched GPS coordinates
- `name`, `city`, `country` — normalised hotel identity

This file is used read-only. If it is missing, cross-plan lookup is skipped gracefully.

## New Module

**`data-pipeline/3-tripadvisor/cross-plan-lookup.mjs`**

Exports two functions:

### `buildCrossPlanIndex()`

Reads stage 4 `hotel.json` and returns an index object with four sub-maps:

| Map | Key | Value |
|-----|-----|-------|
| `sourceKeyMap` | `"plan::source_hotel_id"` | `{ tripadvisor_id, tripadvisor_url }` |
| `coordsMap` | `"lat,lng"` rounded to 3dp | array of `{ tripadvisor_id, tripadvisor_url, name }` |
| `nameCityMap` | `"normalizedName\|city\|country"` | `{ tripadvisor_id, tripadvisor_url }` |
| `nameOnlyMap` | `"normalizedName"` | `{ tripadvisor_id, tripadvisor_url }` |

Returns `null` if stage 4 file is missing or unreadable (logged as a warning).

### `lookupCrossPlan(hotel, index)`

Tries each strategy in order and returns the first hit, or `null` if none match.

**Strategy 1 — source_key (exact)**
Look up `"source::source_hotel_id"` in `sourceKeyMap`. Requires `hotel.source` and `hotel.source_hotel_id`.

**Strategy 2 — coordinates + name (combined gate)**
Round hotel lat/lng to 3 decimal places. Check the 3×3 grid of buckets centred on that cell (9 buckets total) to avoid edge misses. For each candidate in those buckets, compute name token overlap. Require **≥50% token overlap** to accept. Coordinates proximity alone is never sufficient.

**Strategy 3 — name + city + country**
Normalise name, city, and country; look up in `nameCityMap`. Requires all three fields to be non-empty.

**Strategy 4 — name only**
Normalise name; look up in `nameOnlyMap`. Lowest confidence, last resort.

**Text normalisation** (shared): NFKD decomposition, strip non-alphanumeric, lowercase, collapse whitespace.

## Integration into Stage 3 Scripts

All five scripts are updated identically:

1. Import `buildCrossPlanIndex` and `lookupCrossPlan` from `./cross-plan-lookup.mjs`
2. In the main build function, call `buildCrossPlanIndex()` once before `getPendingHotels`
3. Pass the index into `getPendingHotels`
4. Inside `getPendingHotels`, for each hotel not in `existingMatches`, call `lookupCrossPlan`. If it returns a hit, pre-fill `existingMatches[hotel.source_hotel_id]` with:

```json
{
  "tripadvisor_id": "<id>",
  "tripadvisor_url": "<url>",
  "search_query": "",
  "match_confidence": "cross_plan",
  "matched_at": "<now>"
}
```

Hotels pre-filled this way are excluded from the pending list and never sent to the browser.

**Scripts updated:**
- `aspire-hotel.mjs`
- `amex-fhr-hotel.mjs`
- `amex-thc-hotel.mjs`
- `chase-edit-hotel.mjs`
- `bilt-hafh-hotel.mjs`

## Output Format

Cross-plan matched hotels appear in the stage 3 JSON with `match_confidence: "cross_plan"`. This distinguishes them from browser-sourced matches (`"high"`, `"medium"`, `"none"`) and makes the source auditable.

## Error Handling

- Stage 4 file missing → log warning, return `null` index, all hotels go to browser as normal
- Stage 4 file malformed → same as missing
- Hotel missing lat/lng → strategy 2 skipped, falls through to strategy 3/4
- Hotel missing city/country → strategy 3 skipped, falls through to strategy 4

## Files Changed

| File | Change |
|------|--------|
| `data-pipeline/3-tripadvisor/cross-plan-lookup.mjs` | New file |
| `data-pipeline/3-tripadvisor/aspire-hotel.mjs` | Import + integrate |
| `data-pipeline/3-tripadvisor/amex-fhr-hotel.mjs` | Import + integrate |
| `data-pipeline/3-tripadvisor/amex-thc-hotel.mjs` | Import + integrate |
| `data-pipeline/3-tripadvisor/chase-edit-hotel.mjs` | Import + integrate |
| `data-pipeline/3-tripadvisor/bilt-hafh-hotel.mjs` | Import + integrate |
