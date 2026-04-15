# Split iPrefer and Choice Points Display

## Summary

Display iPrefer points and Choice points as distinct, independent point programs across all views (detail, list, map) and filters. Currently they are partially merged in the iPrefer bucket UI. This change separates them so users can independently view, filter, and sort by each program.

## Changes

### 1. Map Toggle (3-button)

Expand `state.ipreferMapMode` from `"cash" | "points"` to `"cash" | "points" | "choice"`.

The iPrefer map toggle becomes:

```
[ Cash | iPrefer Pts | Choice Pts ]
```

**Pin display in Choice mode:**
- Label: `choicePointsValue` formatted as compact thousands (e.g., `"25k"`, `"50k"`). `"N/A"` when null.
- Pin class: `map-pin--priced` when `choicePointsValue !== null`, else `map-pin--pending`.

**Choice-specific color buckets:**
- `CHOICE_POINTS_BUCKET_SIZE = 5000`
- Color stops tuned for the 20k–90k distribution:

```js
const CHOICE_POINTS_COLOR_STOPS = [
  { bucketStart: 20000, color: "#2a9d8f" },
  { bucketStart: 30000, color: "#65b96f" },
  { bucketStart: 40000, color: "#e9c46a" },
  { bucketStart: 50000, color: "#f4a261" },
  { bucketStart: 60000, color: "#e76f51" },
  { bucketStart: 70000, color: "#c8553d" },
  { bucketStart: 80000, color: "#7d4e57" },
  { bucketStart: 90000, color: "#355070" },
];
```

New helper: `getChoicePointsBucketColor(value)` calls `getBucketColor(value, CHOICE_POINTS_BUCKET_SIZE, CHOICE_POINTS_COLOR_STOPS)`.

`markerHtml()`, `mapPinClass()`, `mapPinStyle()`, and `getLowestPriceHotel()` gain a third branch for `state.ipreferMapMode === "choice"`.

### 2. List View (distinct lines)

Each iPrefer hotel row displays up to three labeled lines:

```
50,000 iPrefer pts      (row-price — primary)
25,000 Choice pts       (row-price-cash — secondary, only if choicePointsValue !== null)
$350                    (row-price-cash — secondary, only if ipreferCashMin !== null)
```

The primary `row-price` line reflects the current map mode:
- `"cash"` mode: cash is primary
- `"points"` mode: iPrefer pts is primary
- `"choice"` mode: Choice pts is primary

Secondary lines show the other two values.

### 3. Detail View (combined table + CPP summary)

The monthly table structure is unchanged — it already renders columns for Cash, iPrefer Pts, and Choice Pts.

Add a CPP summary line above the table:

```
iPrefer CPP: 0.85¢/pt  |  Choice CPP: 1.20¢/pt
```

- Show iPrefer CPP when `ipreferCpp !== null`
- Show Choice CPP when `choiceCpp !== null`
- Uses existing styling patterns (`detail-row` or inline within the eyebrow area)

### 4. Filters (two independent toggles)

Replace the single "Has points ability" button with two buttons:

```
[ Has iPrefer Pts ]  [ Has Choice Pts ]
```

**State:**
- `state.ipreferHasPoints` — existing, unchanged (default `false`)
- `state.choiceHasPoints` — new (default `false`)

**Filter logic in `hotelMatchesActiveFilters()`:**
- `ipreferHasPoints` active: exclude hotels where `hotel.ipreferPointsMin === null`
- `choiceHasPoints` active: exclude hotels where `hotel.choicePointsValue === null`
- Both apply independently (AND logic)

**DOM:**
- `#iprefer-has-points-group` label wraps both buttons
- `#iprefer-has-points-btn` — "Has iPrefer Pts"
- `#choice-has-points-btn` — "Has Choice Pts" (new)
- Both hidden when not in iPrefer bucket

**URL hash defaults:** When entering iPrefer bucket via hash, `ipreferHasPoints` defaults to `true` (existing behavior). `choiceHasPoints` defaults to `false`.

### 5. Sorting (per-program CPP)

Replace `"cpp-desc"` with program-specific sort values:

| Value | Label | Field | Bucket |
|---|---|---|---|
| `cpp-iprefer-desc` | Best iPrefer CPP | `hotel.ipreferCpp` | iPrefer |
| `cpp-choice-desc` | Best Choice CPP | `hotel.choiceCpp` | iPrefer |
| `cpp-hilton-desc` | Best Hilton CPP | `hotel.hiltonCpp` | Hilton |

**Sort dropdown is bucket-aware:**
- iPrefer bucket: Lowest Price, Highest Price, Best iPrefer CPP, Best Choice CPP, Name
- Hilton bucket: Lowest Price, Highest Price, Best Hilton CPP, Name
- Other buckets: Lowest Price, Highest Price, Name

**Default sort when entering iPrefer bucket:** `"cpp-iprefer-desc"` (replaces current `"cpp-desc"`).
**Default sort when entering Hilton bucket:** `"cpp-hilton-desc"` (replaces current `"cpp-desc"`).

**`compareHotels()` update:** Each CPP sort value maps directly to a field — no more branching on `state.bucket` to determine which CPP field to use.

## Files Modified

- `src/main.js` — all changes are in this single file

## Out of Scope

- Data pipeline changes (iPrefer/Choice data already flows correctly)
- New CSS classes (reuse existing `row-price`, `row-price-cash`, `filter-toggle-btn`, `map-mode-toggle__btn`)
- Changes to other buckets (Hilton, Aspire, FHR/THC, Edit, Bilt)
