# More Filters Popover Design

**Date:** 2026-04-07

## Problem

The toolbar has too many filters to fit in one row. On tabs with a tab-specific filter (Aspire, iPrefer, Edit, Hilton), there are 9 items total, causing Amenities to wrap onto a second row.

## Solution

Move Brand, Reviews, and Amenities behind a `+ More` button that opens a floating popover panel. This reduces the always-visible toolbar to 6 items (Search, Chain, Country, Also eligible for, Sort, tab-specific filter), which fits comfortably in one row.

## Toolbar Layout Changes

Remove Brand, Reviews, and Amenities from the toolbar grid. Update `grid-template-columns` in `.toolbar` from 8 columns to 7 columns:

- Search (wide)
- Chain
- Country
- Also eligible for
- Sort
- Tab-specific filter (Aspire/iPrefer/Edit/Hilton — hidden when not applicable)
- More button (always last)

Existing responsive breakpoints (`≤1120px` → 2 columns, `≤600px` → 1 column) remain unchanged. The More button becomes another item in those collapsed layouts.

## More Button

- Styled with `.filter-toggle-btn` (matches existing toggle buttons)
- Label: `+ More` when no hidden filters are active
- Label: `More · N` with `.is-active` green highlight when N hidden filters are active (N = count of: brand ≠ "all", amenities.length > 0, forum review active)
- Positioned as the last item in the toolbar row

## Popover Panel

- Uses existing `.filter-dropdown__panel` styles, anchored below-right of the More button
- Toggled by clicking the More button (`hidden` attribute on/off)
- Closes on outside click or Escape key (same pattern as existing Amenities dropdown)
- Contains 3 filters stacked vertically:

```
┌─────────────────────────────────┐
│ Brand      [All brands      ▾]  │
│ Reviews    [Has forum review ]  │
│ Amenities  [Any amenities   ▾]  │
└─────────────────────────────────┘
```

Each filter uses its existing control:
- Brand → `<select id="brand-select">`
- Reviews → `.filter-toggle-btn` (`#forum-review-filter-btn`)
- Amenities → existing `filter-dropdown` component (`#amenities-dropdown`)

The Amenities nested dropdown opens within the panel (no change to its own logic).

## JavaScript Changes

No state changes. Existing `state.brand`, `state.amenities`, and forum review flag are unchanged. Controls move into the panel; their event listeners stay the same.

New JS needed:
1. `#more-filters-btn` click handler — toggles panel `hidden`
2. Outside-click listener — closes panel when clicking outside (same pattern as Amenities)
3. Badge update function — called whenever brand, amenities, or forum review state changes; recomputes `More · N` label and `.is-active` class

No changes to filtering logic, sort logic, or any other part of the app.
