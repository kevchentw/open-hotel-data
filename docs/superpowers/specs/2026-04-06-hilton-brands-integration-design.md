# Hilton Brands Integration Design

**Date:** 2026-04-06
**Status:** Approved

## Overview

Integrate the `hilton_brands` stage-1 source (641 hotels: Conrad, Waldorf Astoria, LXR, SLH) through the unique and output pipeline stages, and surface a new "Hilton" tab on the website showing points price, cash price (USD), and CPP (cost per point).

## Background

Stage-1 data already exists at `data-pipeline/1-list/hilton-brands-hotel.json`. Each hotel record includes:
- `lowest_points_price` — Hilton Honors points per night
- `lowest_cash_price` + `lowest_cash_price_currency` — local-currency cash rate from hilton.com
- `url` — deep link to hilton.com hotel page
- `brand`, `chain`, `latitude`, `longitude`, `city`, `country`, etc.

No stage-2 enrichment or stage-3 TripAdvisor matcher exists yet. The pipeline handles missing optional stages gracefully — hotels without a TripAdvisor match go to the `unmatched` bucket in stage 4 and are surfaced as fallback records in stage 6.

## Changes

### 1. Shared utility: `data-pipeline/shared/currency.mjs`

Extract `CURRENCY_TO_USD` (frozen object of currency → USD multiplier) and `convertToUsd(amount, currency)` from `data-pipeline/5-price/fetch.mjs` into a new shared module.

- `fetch.mjs` imports from `../shared/currency.mjs` (no behavior change)
- Stage-6 `export.mjs` imports the same module for hilton price conversion

`convertToUsd` behavior: parse amount as float, look up multiplier, throw on unknown currency, return formatted decimal string or `""` on bad input.

### 2. Stage 4 — `data-pipeline/4-unique/build.mjs`

**Add `hilton_brands` to `SOURCE_CONFIGS`:**

```js
{
  source: "hilton_brands",
  stageOneUrl: new URL("../1-list/hilton-brands-hotel.json", import.meta.url),
  stageTwoUrl: new URL("../2-enrichment/hilton-brands-hotel.json", import.meta.url),   // optional
  stageThreeUrl: new URL("../3-tripadvisor/hilton-brands-hotel.json", import.meta.url) // optional
}
```

Both stage-2 and stage-3 files are optional (`readJsonOptional`) — missing files are handled gracefully today.

**New fields in `buildCanonicalHotel`** (picked from `hilton_brands` contributors only):
- `hilton_points_price` — `stageOneHotel.lowest_points_price`
- `hilton_cash_price` — `stageOneHotel.lowest_cash_price`
- `hilton_cash_currency` — `stageOneHotel.lowest_cash_price_currency`

**Extend `pickSourcePageUrl` for `hilton_url`** to include `hilton_brands` alongside the existing `hilton_aspire_resort_credit`.

**Mirror the same three fields in `buildUnmatchedRecord`** for fallback hotels from `hilton_brands`.

### 3. Stage 6 — `data-pipeline/6-output/export.mjs`

Import `convertToUsd` from `../shared/currency.mjs`.

For each hotel (canonical and fallback) that has `hilton_cash_price` and `hilton_cash_currency`:
- Compute `hilton_cash_price_usd` = `convertToUsd(hilton_cash_price, hilton_cash_currency)` — string, 2 decimal places
- Compute `hilton_cpp` = `(parseFloat(hilton_cash_price_usd) / parseFloat(hilton_points_price)) * 100` — cents per point, rounded to 4 decimal places, stored as string
- If either input is missing/zero/invalid, omit both fields
- Wrap `convertToUsd` call in a try/catch — log a warning and skip the fields if the currency is unknown (prevents an unknown future currency from crashing the build)

Fields added to app output per hotel:
```
hilton_points_price      "50000"
hilton_cash_price_usd    "34.00"
hilton_cpp               "0.0680"
hilton_cash_currency     "AED"
```

Update `pickHotelFields` and the fallback builder to carry these four fields through.

### 4. UI — `src/main.js`

**`PLAN_CONFIG`** — add new bucket:
```js
hilton: {
  key: "hilton",
  label: "Hilton",
  plans: ["hilton_brands"],
  description: "Hilton luxury brands (Conrad, Waldorf Astoria, LXR, SLH) scraped from hilton.com with live points and cash pricing."
}
```

**`PLAN_LABELS`** — add `hilton_brands: "Hilton"`

**`buildBucketKey`** — add case: `hilton_brands` → `"hilton"` (insert before `aspire` check)

**`getBucketCounts`** — add `hilton: 0`

**New state fields:**
- `hiltonMapMode: "points"` — toggle between `"cash"` and `"points"` (mirrors `ipreferMapMode`)

**`normalizeHotel`** — extract and expose:
- `hiltonPointsPrice` — `toFiniteNumber(rawHotel.hilton_points_price)`
- `hiltonCashPriceUsd` — `toFiniteNumber(rawHotel.hilton_cash_price_usd)`
- `hiltonCpp` — `toFiniteNumber(rawHotel.hilton_cpp)`
- `hiltonCashCurrency` — `rawHotel.hilton_cash_currency || ""`

**Price value for sort/map color** (Hilton tab):
- `"points"` mode: use `hiltonPointsPrice`
- `"cash"` mode: use `hiltonCashPriceUsd`

**Hotel card** (Hilton tab): primary label shows points or cash depending on `hiltonMapMode`; secondary label shows CPP as `{cpp}¢/pt`

**Hotel detail panel** (Hilton tab): show points price, cash price in USD (with original currency noted), CPP, and a cash/points toggle

## Out of Scope

- Stage-3 TripAdvisor matcher for `hilton_brands` (future work — hotels will be fallback records until then)
- Stage-2 enrichment for `hilton_brands`
- Live exchange rate fetching
