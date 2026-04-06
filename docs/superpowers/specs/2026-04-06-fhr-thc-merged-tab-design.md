# FHR/THC Merged Tab Design

**Date:** 2026-04-06

## Overview

Merge the separate FHR and THC bucket tabs into a single **FHR/THC** tab. The tab defaults to showing FHR properties, with inline pill buttons allowing the user to switch between FHR, THC, or FHR+THC views.

## Tab Changes

- Remove `data-bucket="fhr"` and `data-bucket="thc"` buttons from `buildShell`.
- Add a single `data-bucket="fhr_thc"` button labeled **FHR/THC**.
- Tab badge count reflects the number of hotels matching the active sub-filter.

## State

Add to `state`:
```js
fhrThcSubFilter: "fhr",  // "fhr" | "thc" | "fhr+thc"
```

Default is `"fhr"`. Reset to `"fhr"` whenever the bucket switches away from `fhr_thc`, so returning to the tab always starts on FHR.

## PLAN_CONFIG

Add a new entry:
```js
fhr_thc: {
  key: "fhr_thc",
  label: "FHR/THC",
  plans: ["amex_fhr", "amex_thc"],
  description: "Amex Fine Hotels + Resorts and The Hotel Collection properties.",
},
```

Remove the separate `fhr` and `thc` entries.

## Filtering Logic

`hotelMatchesBucket` is updated for the `fhr_thc` bucket:

| Sub-filter   | Matches hotels with plan… |
|--------------|---------------------------|
| `fhr`        | `amex_fhr`                |
| `thc`        | `amex_thc`                |
| `fhr+thc`    | `amex_fhr` OR `amex_thc`  |

All other buckets are unaffected.

## Hotel Bucket Assignment (`buildBucketKey`)

Today `amex_thc` → `"thc"` and `amex_fhr` → `"fhr"`. Both now map to `"fhr_thc"`:

```js
if (plans.includes("amex_thc") || plans.includes("amex_fhr")) return "fhr_thc";
```

## Sub-filter Pill Toggle UI

A pill row (`id="fhr-thc-toggle"`) is shown in the toolbar only when `state.bucket === "fhr_thc"`, hidden on all other tabs. Mirrors the existing iPrefer map toggle pattern.

Pills:
```
[ FHR ]  [ THC ]  [ FHR + THC ]
```

Each pill has `data-subfilter="fhr"`, `data-subfilter="thc"`, `data-subfilter="fhr+thc"`. The active pill gets class `is-active`.

Clicking a pill sets `state.fhrThcSubFilter`, resets list pagination, and triggers a full re-render (filters + map + list + tab counts).

## `getBucketCounts`

Remove `fhr: 0` and `thc: 0` from the counts object, add `fhr_thc: 0`.

## Analytics

`trackBucketView` and `getHotelAnalyticsParams` continue to use `state.bucket`, so the merged tab reports as `"fhr_thc"`. No additional sub-filter tracking required.
