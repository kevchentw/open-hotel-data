# Split iPrefer and Choice Points Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display iPrefer points and Choice points as distinct, independent point programs across map, list, detail views, filters, and sorting.

**Architecture:** All changes are in `src/main.js`. The map toggle expands from 2 to 3 buttons. List view primary line becomes mode-aware. Filters and sorting split from shared CPP into per-program values. No new files, no new CSS classes.

**Tech Stack:** Vanilla JS, Leaflet maps, DOM manipulation

**Spec:** `docs/superpowers/specs/2026-04-15-split-iprefer-choice-points-design.md`

---

### Task 1: Add Choice Points Color Constants and Helper

**Files:**
- Modify: `src/main.js:7-29` (color constants area)
- Modify: `src/main.js:1520-1526` (bucket color helpers)

- [ ] **Step 1: Add `CHOICE_POINTS_BUCKET_SIZE` and `CHOICE_POINTS_COLOR_STOPS` constants**

After the existing `POINTS_COLOR_STOPS` block (line ~29), add:

```javascript
const CHOICE_POINTS_BUCKET_SIZE = 5000;
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

- [ ] **Step 2: Add `getChoicePointsBucketColor()` helper**

After `getPointsBucketColor()` (line ~1526), add:

```javascript
function getChoicePointsBucketColor(pointsValue) {
  return getBucketColor(pointsValue, CHOICE_POINTS_BUCKET_SIZE, CHOICE_POINTS_COLOR_STOPS);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: add Choice points color bucket constants and helper"
```

---

### Task 2: Expand Map Toggle to 3 Buttons

**Files:**
- Modify: `src/main.js:2017-2020` (map toggle HTML)
- Modify: `src/main.js:1800-1801` (render function — sync active class)

- [ ] **Step 1: Add third button to map toggle HTML**

Change the `#iprefer-map-toggle` div (line ~2017-2020) from:

```html
<div id="iprefer-map-toggle" class="map-mode-toggle" hidden>
  <button class="map-mode-toggle__btn is-active" data-mode="cash" type="button">Cash</button>
  <button class="map-mode-toggle__btn" data-mode="points" type="button">Points</button>
</div>
```

to:

```html
<div id="iprefer-map-toggle" class="map-mode-toggle" hidden>
  <button class="map-mode-toggle__btn is-active" data-mode="cash" type="button">Cash</button>
  <button class="map-mode-toggle__btn" data-mode="points" type="button">iPrefer Pts</button>
  <button class="map-mode-toggle__btn" data-mode="choice" type="button">Choice Pts</button>
</div>
```

- [ ] **Step 2: Sync iPrefer toggle active class in `render()`**

After `dom.ipreferMapToggle.hidden = !isIprefer;` (line ~1801), add active class syncing (matching the pattern used for Hilton toggle on lines 1805-1807):

```javascript
dom.ipreferMapToggle.querySelectorAll("[data-mode]").forEach((b) => {
  b.classList.toggle("is-active", b.dataset.mode === state.ipreferMapMode);
});
```

- [ ] **Step 3: Verify the existing click handler works**

The existing click handler at lines 2229-2240 uses `event.target.closest("[data-mode]")` and sets `state.ipreferMapMode = btn.dataset.mode` — this already works for any `data-mode` value including `"choice"`. No changes needed.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: expand iPrefer map toggle to Cash / iPrefer Pts / Choice Pts"
```

---

### Task 3: Update Map Pin Rendering for Choice Mode

**Files:**
- Modify: `src/main.js:1423-1473` (`markerHtml()`)
- Modify: `src/main.js:1475-1491` (`mapPinClass()`)
- Modify: `src/main.js:1528-1546` (`mapPinStyle()`)
- Modify: `src/main.js:1570-1599` (`getLowestPriceHotel()`)

- [ ] **Step 1: Update `markerHtml()` — add Choice branch**

In `markerHtml()`, the iPrefer section currently has two branches: points mode and cash mode. Add a third branch for choice mode. The iPrefer block (lines ~1425-1443) should become:

```javascript
if (state.bucket === "iprefer") {
  if (state.ipreferMapMode === "choice") {
    const label = hotel.choicePointsValue !== null
      ? `${Math.round(hotel.choicePointsValue / 1000)}k`
      : "N/A";
    return `<div class="${mapPinClass(hotel)}" style="${mapPinStyle(hotel)}">${escapeHtml(label)}</div>`;
  }
  if (state.ipreferMapMode === "points") {
    // existing points branch (lines 1425-1428) — unchanged
  }
  // existing cash branch (lines 1436-1443) — unchanged
}
```

Insert the `choice` branch **before** the existing `points` check. Keep the existing points and cash branches exactly as they are.

- [ ] **Step 2: Update `mapPinClass()` — add Choice branch**

In `mapPinClass()`, the iPrefer section (lines ~1477-1480) currently checks `hotel.ipreferPointsMin !== null` OR `hotel.ipreferCashMin !== null`. Add a choice-mode check:

```javascript
if (state.bucket === "iprefer") {
  if (state.ipreferMapMode === "choice") {
    return hotel.choicePointsValue !== null ? "map-pin--priced" : "map-pin--pending";
  }
  return (state.ipreferMapMode === "points"
    ? hotel.ipreferPointsMin !== null
    : hotel.ipreferCashMin !== null)
    ? "map-pin--priced"
    : "map-pin--pending";
}
```

- [ ] **Step 3: Update `mapPinStyle()` — add Choice branch**

In `mapPinStyle()`, the iPrefer section (lines ~1530-1535) currently has two branches. Add choice:

```javascript
if (state.bucket === "iprefer") {
  if (state.ipreferMapMode === "choice") {
    return `--pin-color: ${getChoicePointsBucketColor(hotel.choicePointsValue)};`;
  }
  if (state.ipreferMapMode === "points") {
    return `--pin-color: ${getPointsBucketColor(hotel.ipreferPointsMin)};`;
  }
  return `--pin-color: ${getPriceBucketColor(hotel.ipreferCashMin)};`;
}
```

- [ ] **Step 4: Update `getLowestPriceHotel()` — add Choice branch**

In `getLowestPriceHotel()`, the iPrefer section (lines ~1572-1574) returns based on map mode. Add choice:

```javascript
if (state.bucket === "iprefer") {
  return state.ipreferMapMode === "choice"
    ? hotel.choicePointsValue
    : state.ipreferMapMode === "points"
      ? hotel.ipreferPointsMin
      : hotel.ipreferCashMin;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: render Choice points on map pins in choice mode"
```

---

### Task 4: Update List View for Mode-Aware Primary Line

**Files:**
- Modify: `src/main.js:1097-1102` (`createHotelRow()` — `rowPriceHtml`)

- [ ] **Step 1: Make primary/secondary lines mode-aware**

Replace the iPrefer `rowPriceHtml` block (lines 1097-1102):

```javascript
const rowPriceHtml = state.bucket === "iprefer"
  ? `<div class="row-price-iprefer">
      <span class="row-price">${escapeHtml(hotel.ipreferPriceLabel)}</span>
      ${hotel.choicePointsValue !== null ? `<span class="row-price-cash">${escapeHtml(formatNumber(hotel.choicePointsValue))} choice pts</span>` : ""}
      ${hotel.ipreferCashMin !== null ? `<span class="row-price-cash">${escapeHtml(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency))}</span>` : ""}
    </div>`
```

with:

```javascript
const rowPriceHtml = state.bucket === "iprefer"
  ? (() => {
      const ipreferLine = `${escapeHtml(hotel.ipreferPriceLabel)} iPrefer pts`;
      const choiceLine = hotel.choicePointsValue !== null ? `${escapeHtml(formatNumber(hotel.choicePointsValue))} Choice pts` : null;
      const cashLine = hotel.ipreferCashMin !== null ? escapeHtml(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency)) : null;
      let primary, secondaries;
      if (state.ipreferMapMode === "choice" && choiceLine) {
        primary = choiceLine;
        secondaries = [ipreferLine, cashLine];
      } else if (state.ipreferMapMode === "cash" && cashLine) {
        primary = cashLine;
        secondaries = [ipreferLine, choiceLine];
      } else {
        primary = ipreferLine;
        secondaries = [choiceLine, cashLine];
      }
      return `<div class="row-price-iprefer">
        <span class="row-price">${primary}</span>
        ${secondaries.filter(Boolean).map((s) => `<span class="row-price-cash">${s}</span>`).join("")}
      </div>`;
    })()
```

Note: `hotel.ipreferPriceLabel` already formats the iPrefer points value (e.g., "50,000"). The label " iPrefer pts" suffix makes it distinct from Choice pts. When iPrefer points are null, `ipreferPriceLabel` shows "N/A" which is fine as a secondary line.

- [ ] **Step 2: Commit**

```bash
git add src/main.js
git commit -m "feat: make list view primary price line mode-aware for iPrefer/Choice/Cash"
```

---

### Task 5: Add CPP Summary to Detail View

**Files:**
- Modify: `src/main.js:546-602` (`renderIpreferPricePattern()`)

- [ ] **Step 1: Add CPP summary line above the table**

In `renderIpreferPricePattern()`, the function returns an HTML string with the monthly table. Add a CPP summary line before the table. Find the `return` statement (line ~586) and prepend a CPP summary:

```javascript
const cppParts = [];
if (hotel.ipreferCpp !== null) {
  cppParts.push(`iPrefer CPP: ${hotel.ipreferCpp.toFixed(2)}¢/pt`);
}
if (hotel.choiceCpp !== null) {
  cppParts.push(`Choice CPP: ${hotel.choiceCpp.toFixed(2)}¢/pt`);
}
const cppSummary = cppParts.length > 0
  ? `<div class="detail-row">${escapeHtml(cppParts.join("  |  "))}</div>`
  : "";
```

Then prepend `cppSummary` to the returned HTML string, before the `<table>` tag.

- [ ] **Step 2: Commit**

```bash
git add src/main.js
git commit -m "feat: show iPrefer and Choice CPP summary in detail view"
```

---

### Task 6: Split Filter into Two Independent Buttons

**Files:**
- Modify: `src/main.js:104` (state — add `choiceHasPoints`)
- Modify: `src/main.js:813-815` (`hotelMatchesActiveFilters()`)
- Modify: `src/main.js:1944-1947` (filter button DOM)
- Modify: `src/main.js:2056-2057` (DOM references)
- Modify: `src/main.js:2197-2203` (event listener)
- Modify: `src/main.js:1810` (render active class)
- Modify: `src/main.js:1735-1736` (`syncStateFromUrl()`)
- Modify: `src/main.js:2087-2088` (bucket switch defaults)

- [ ] **Step 1: Add `choiceHasPoints` to state**

After `ipreferHasPoints: false,` (line ~107), add:

```javascript
choiceHasPoints: false,
```

- [ ] **Step 2: Add Choice filter logic in `hotelMatchesActiveFilters()`**

After the `ipreferHasPoints` check (lines 813-815), add:

```javascript
if (!excluded.has("choiceHasPoints") && state.choiceHasPoints && hotel.choicePointsValue === null) {
  return false;
}
```

- [ ] **Step 3: Update filter button DOM**

Replace the filter button HTML (lines 1944-1947):

```html
<label id="iprefer-has-points-group" class="toolbar-group" hidden>
  <span>iPrefer filter</span>
  <button id="iprefer-has-points-btn" class="filter-toggle-btn" type="button">Has points ability</button>
</label>
```

with:

```html
<label id="iprefer-has-points-group" class="toolbar-group" hidden>
  <span>iPrefer filter</span>
  <button id="iprefer-has-points-btn" class="filter-toggle-btn" type="button">Has iPrefer Pts</button>
  <button id="choice-has-points-btn" class="filter-toggle-btn" type="button">Has Choice Pts</button>
</label>
```

- [ ] **Step 4: Add DOM reference for new button**

After `ipreferHasPointsBtn:` (line ~2057), add:

```javascript
choiceHasPointsBtn: document.querySelector("#choice-has-points-btn"),
```

- [ ] **Step 5: Add event listener for new button**

After the `ipreferHasPointsBtn` event listener (lines 2197-2203), add:

```javascript
dom.choiceHasPointsBtn.addEventListener("click", () => {
  state.choiceHasPoints = !state.choiceHasPoints;
  state.listLimit = LIST_PAGE_SIZE;
  state.shouldResetMapView = true;
  state.listPanelMode = "list";
  render();
});
```

- [ ] **Step 6: Toggle active class in `render()`**

After `dom.ipreferHasPointsBtn.classList.toggle("is-active", state.ipreferHasPoints);` (line ~1810), add:

```javascript
dom.choiceHasPointsBtn.classList.toggle("is-active", state.choiceHasPoints);
```

- [ ] **Step 7: Update bucket switch defaults**

At the bucket switch code (line ~2088), after `state.ipreferHasPoints = nextBucket === "iprefer";`, add:

```javascript
state.choiceHasPoints = false;
```

- [ ] **Step 8: `syncStateFromUrl()` — `choiceHasPoints` defaults to `false`**

No code change needed. `choiceHasPoints` is initialized as `false` in state and `syncStateFromUrl()` doesn't set it, so it stays `false` when entering iPrefer bucket via hash. This matches the spec: "`choiceHasPoints` defaults to `false`".

- [ ] **Step 9: Commit**

```bash
git add src/main.js
git commit -m "feat: split Has Points filter into independent iPrefer and Choice toggles"
```

---

### Task 7: Replace CPP Sort with Per-Program Sort Values

**Files:**
- Modify: `src/main.js:1936-1941` (sort dropdown HTML)
- Modify: `src/main.js:707-747` (`compareHotels()`)
- Modify: `src/main.js:1023` (`updateFilterOptions()` — sort value sync)
- Modify: `src/main.js:1735` (`syncStateFromUrl()` — default sort)
- Modify: `src/main.js:2087` (bucket switch — default sort)

- [ ] **Step 1: Make sort dropdown dynamically populated**

The sort dropdown is currently static HTML. It needs to show different options per bucket. Replace the static `<select>` (lines 1936-1941):

```html
<label class="toolbar-group">
  <span>Sort</span>
  <select id="sort-select">
    <option value="price-asc">Lowest price</option>
    <option value="price-desc">Highest price</option>
    <option value="cpp-desc">Best CPP</option>
    <option value="name">Name</option>
  </select>
</label>
```

with an empty select that will be populated dynamically:

```html
<label class="toolbar-group">
  <span>Sort</span>
  <select id="sort-select"></select>
</label>
```

- [ ] **Step 2: Add sort options population in `updateFilterOptions()`**

In `updateFilterOptions()`, before `dom.sort.value = state.sort;` (line ~1023), add logic to populate the sort dropdown based on bucket:

```javascript
const baseSortOptions = [
  { value: "price-asc", label: "Lowest price" },
  { value: "price-desc", label: "Highest price" },
];
const cppSortOptions = state.bucket === "iprefer"
  ? [
      { value: "cpp-iprefer-desc", label: "Best iPrefer CPP" },
      { value: "cpp-choice-desc", label: "Best Choice CPP" },
    ]
  : state.bucket === "hilton"
    ? [{ value: "cpp-hilton-desc", label: "Best Hilton CPP" }]
    : [];
const sortOptions = [...baseSortOptions, ...cppSortOptions, { value: "name", label: "Name" }];
dom.sort.innerHTML = sortOptions.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join("");
```

- [ ] **Step 3: Update `compareHotels()` — replace `cpp-desc` with per-program sorts**

Replace the `cpp-desc` block in `compareHotels()` (lines 712-721):

```javascript
if (state.sort === "cpp-desc") {
  const leftCpp = state.bucket === "iprefer" ? left.ipreferCpp : left.hiltonCpp;
  const rightCpp = state.bucket === "iprefer" ? right.ipreferCpp : right.hiltonCpp;
  ...
}
```

with three separate sort handlers:

```javascript
if (state.sort === "cpp-iprefer-desc" || state.sort === "cpp-choice-desc" || state.sort === "cpp-hilton-desc") {
  const field = state.sort === "cpp-iprefer-desc" ? "ipreferCpp"
    : state.sort === "cpp-choice-desc" ? "choiceCpp"
    : "hiltonCpp";
  const leftCpp = left[field];
  const rightCpp = right[field];
  if (leftCpp !== null && rightCpp !== null && leftCpp !== rightCpp) {
    return rightCpp - leftCpp;
  }
  if (leftCpp !== null && rightCpp === null) return -1;
  if (leftCpp === null && rightCpp !== null) return 1;
  return left.name.localeCompare(right.name);
}
```

- [ ] **Step 4: Update price sort for Choice mode**

In `compareHotels()`, the price sort for iPrefer (lines ~723-732) currently branches on `state.ipreferMapMode === "points"`. Add choice mode:

```javascript
const leftPrice = state.bucket === "iprefer"
  ? (state.ipreferMapMode === "choice" ? left.choicePointsValue
    : state.ipreferMapMode === "points" ? left.ipreferPointsMin
    : left.ipreferCashMin)
  : // ... rest unchanged
const rightPrice = state.bucket === "iprefer"
  ? (state.ipreferMapMode === "choice" ? right.choicePointsValue
    : state.ipreferMapMode === "points" ? right.ipreferPointsMin
    : right.ipreferCashMin)
  : // ... rest unchanged
```

- [ ] **Step 5: Update default sort values**

In `syncStateFromUrl()` (line ~1735), change:
```javascript
state.sort = "cpp-desc";
```
to:
```javascript
state.sort = "cpp-iprefer-desc";
```

In bucket switch (line ~2087), change:
```javascript
state.sort = (nextBucket === "hilton" || nextBucket === "iprefer") ? "cpp-desc" : "price-asc";
```
to:
```javascript
state.sort = nextBucket === "iprefer" ? "cpp-iprefer-desc"
  : nextBucket === "hilton" ? "cpp-hilton-desc"
  : "price-asc";
```

- [ ] **Step 6: Ensure sort value is valid when switching buckets**

In `updateFilterOptions()`, after populating sort options and before `dom.sort.value = state.sort;`, add a fallback if current sort value isn't valid for the new bucket:

```javascript
if (!sortOptions.some((o) => o.value === state.sort)) {
  state.sort = sortOptions[0].value;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "feat: replace shared CPP sort with per-program iPrefer/Choice/Hilton CPP sorts"
```

---

### Task 8: Update Map Popup for Choice Mode

**Files:**
- Modify: `src/main.js:1644-1645` (map popup `popupPriceHtml`)

- [ ] **Step 1: Update popup to reflect current map mode**

The popup currently always shows iPrefer points as primary. Update the iPrefer popup (line ~1644-1645) to be mode-aware, similar to the list view:

```javascript
const popupPriceHtml = state.bucket === "iprefer"
  ? (() => {
      const parts = [];
      if (state.ipreferMapMode === "choice") {
        parts.push(hotel.choicePointsValue !== null ? `${formatNumber(hotel.choicePointsValue)} choice pts` : "N/A");
        parts.push(hotel.ipreferPriceLabel);
      } else if (state.ipreferMapMode === "cash") {
        if (hotel.ipreferCashMin !== null) parts.push(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency));
        else parts.push("N/A");
        parts.push(hotel.ipreferPriceLabel);
      } else {
        parts.push(hotel.ipreferPriceLabel);
        if (hotel.choicePointsValue !== null) parts.push(`${formatNumber(hotel.choicePointsValue)} choice`);
      }
      if (state.ipreferMapMode !== "cash" && hotel.ipreferCashMin !== null) {
        parts.push(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency));
      }
      return `<span>${parts.map(escapeHtml).join(" · ")}</span>`;
    })()
```

Keep the Hilton and default branches unchanged.

- [ ] **Step 2: Commit**

```bash
git add src/main.js
git commit -m "feat: update map popup to reflect current iPrefer/Choice/Cash mode"
```

---

### Task 9: Manual Smoke Test

- [ ] **Step 1: Start dev server and verify all changes**

```bash
npx serve .
```

Open the app in a browser and verify:

1. **Map toggle:** Three buttons visible (Cash / iPrefer Pts / Choice Pts) when on iPrefer tab
2. **Map pins in Choice mode:** Show "25k", "50k" etc. labels with correct color bucketing; "N/A" for nulls
3. **List view:** Primary line changes when toggling between modes; secondary lines show the other two values
4. **Detail view:** CPP summary line visible above monthly table (e.g., "iPrefer CPP: 0.85¢/pt | Choice CPP: 1.20¢/pt")
5. **Filters:** Two separate buttons "Has iPrefer Pts" and "Has Choice Pts"; both apply independently
6. **Sorting:** Dropdown shows "Best iPrefer CPP" and "Best Choice CPP" when in iPrefer tab; shows "Best Hilton CPP" in Hilton tab; no CPP options in other tabs
7. **URL hash:** `#iprefer` sets sort to `cpp-iprefer-desc` and enables `ipreferHasPoints`
8. **Bucket switching:** Sort dropdown updates correctly when switching between tabs
