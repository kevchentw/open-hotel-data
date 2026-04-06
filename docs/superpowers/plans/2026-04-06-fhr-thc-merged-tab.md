# FHR/THC Merged Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate FHR and THC bucket tabs with a single FHR/THC tab that defaults to showing FHR properties, with inline pill buttons to switch between FHR, THC, or FHR+THC views.

**Architecture:** All changes are in `src/main.js` — a single-file vanilla JS app. A new `fhrThcSubFilter` state field drives filtering when the `fhr_thc` bucket is active. A pill toggle (styled like the existing iPrefer map toggle) lets users switch sub-filters without leaving the tab.

**Tech Stack:** Vanilla JS (ES modules), Leaflet for maps, Vite for bundling, CSS in `src/styles.css`.

---

## File Map

- **Modify:** `src/main.js` — all logic changes
- **Modify:** `src/styles.css` — pill toggle styles (if not already covered by `.map-mode-toggle`)

---

### Task 1: Merge `fhr`/`thc` into `fhr_thc` in PLAN_CONFIG and update `buildBucketKey`

**Files:**
- Modify: `src/main.js:34-65` (PLAN_CONFIG)
- Modify: `src/main.js:295-317` (buildBucketKey)

- [ ] **Step 1: Update PLAN_CONFIG**

In `src/main.js`, replace the separate `fhr` and `thc` entries with a single `fhr_thc` entry. The full object after the change:

```js
const PLAN_CONFIG = {
  aspire: {
    key: "aspire",
    label: "Aspire",
    plans: ["hilton_aspire_resort_credit"],
    description: "Hilton Aspire resorts that are not also in Amex FHR or THC.",
  },
  fhr_thc: {
    key: "fhr_thc",
    label: "FHR/THC",
    plans: ["amex_fhr", "amex_thc"],
    description: "Amex Fine Hotels + Resorts and The Hotel Collection properties.",
  },
  iprefer: {
    key: "iprefer",
    label: "iPrefer",
    plans: ["iprefer_points"],
    description: "I Prefer hotels that support points redemption.",
  },
  edit: {
    key: "edit",
    label: "Edit",
    plans: ["chase_edit"],
    description: "Chase Edit hotels from the 2026 stack source (Award Helper). Indicates whether each hotel has chase_2026_credit.",
  },
};
```

- [ ] **Step 2: Update `buildBucketKey`**

Replace the `amex_thc` and `amex_fhr` checks with a single `fhr_thc` return. The full function after the change:

```js
function buildBucketKey(plans = []) {
  if (plans.includes("amex_thc") || plans.includes("amex_fhr")) {
    return "fhr_thc";
  }

  if (plans.includes("iprefer_points")) {
    return "iprefer";
  }

  if (plans.includes("hilton_aspire_resort_credit")) {
    return "aspire";
  }

  if (plans.includes("chase_edit")) {
    return "edit";
  }

  return null;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "refactor: merge fhr/thc into fhr_thc bucket in PLAN_CONFIG and buildBucketKey"
```

---

### Task 2: Add `fhrThcSubFilter` to state and update filtering logic

**Files:**
- Modify: `src/main.js:75-100` (state)
- Modify: `src/main.js:675-678` (hotelMatchesBucket)
- Modify: `src/main.js:862-876` (getBucketCounts)

- [ ] **Step 1: Add `fhrThcSubFilter` to `state`**

In the `state` object (around line 75), add this field after `aspireCreditWithStayFilter`:

```js
fhrThcSubFilter: "fhr",
```

The `state` object should now include:
```js
const state = {
  // ... existing fields ...
  aspireCreditWithStayFilter: false,
  fhrThcSubFilter: "fhr",
  lastTrackedBucket: null,
};
```

- [ ] **Step 2: Update `hotelMatchesBucket`**

Replace the current `hotelMatchesBucket` function with one that handles the `fhr_thc` sub-filter:

```js
function hotelMatchesBucket(hotel, bucket = state.bucket) {
  if (bucket === "fhr_thc") {
    const sub = state.fhrThcSubFilter;
    if (sub === "fhr") return hotel.plans.includes("amex_fhr");
    if (sub === "thc") return hotel.plans.includes("amex_thc");
    // "fhr+thc" — either plan
    return hotel.plans.includes("amex_fhr") || hotel.plans.includes("amex_thc");
  }
  const plans = PLAN_CONFIG[bucket]?.plans || [];
  return plans.some((plan) => hotel.plans.includes(plan));
}
```

- [ ] **Step 3: Update `getBucketCounts`**

Replace `fhr: 0` and `thc: 0` with `fhr_thc: 0`:

```js
function getBucketCounts() {
  const counts = {
    fhr_thc: 0,
    aspire: 0,
    iprefer: 0,
    edit: 0,
  };

  Object.keys(counts).forEach((bucket) => {
    counts[bucket] = getBucketHotels(bucket).length;
  });

  return counts;
}
```

Note: `getBucketHotels("fhr_thc")` will use the active `fhrThcSubFilter`, so the tab badge reflects the current sub-filter count.

- [ ] **Step 4: Verify in browser**

Open the dev server (`npm run dev`). The app should load on the default "aspire" tab without errors. The FHR and THC tabs will disappear (the HTML still references them — that's fine for now, handled in Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: add fhrThcSubFilter state and update hotelMatchesBucket for fhr_thc bucket"
```

---

### Task 3: Update `buildShell` HTML — replace FHR/THC tabs with one tab and add pill toggle

**Files:**
- Modify: `src/main.js:1645-1653` (bucket-tabs in buildShell)
- Modify: `src/main.js:1691-1724` (toolbar section in buildShell)
- Modify: `src/main.js:1755-1780` (dom object in buildShell)

- [ ] **Step 1: Replace bucket tab buttons**

In `buildShell`, find the `.bucket-tabs` div (around line 1646) and replace:

```html
<div class="bucket-tabs">
  <button class="bucket-tab" data-bucket="aspire" type="button"></button>
  <button class="bucket-tab" data-bucket="fhr" type="button"></button>
  <button class="bucket-tab" data-bucket="thc" type="button"></button>
  <button class="bucket-tab" data-bucket="iprefer" type="button"></button>
  <button class="bucket-tab" data-bucket="edit" type="button"></button>
</div>
```

with:

```html
<div class="bucket-tabs">
  <button class="bucket-tab" data-bucket="aspire" type="button"></button>
  <button class="bucket-tab" data-bucket="fhr_thc" type="button"></button>
  <button class="bucket-tab" data-bucket="iprefer" type="button"></button>
  <button class="bucket-tab" data-bucket="edit" type="button"></button>
</div>
```

- [ ] **Step 2: Add FHR/THC pill toggle to toolbar**

In `buildShell`, find the existing toolbar section that holds the `iprefer-has-points-group` label (around line 1691). Add the FHR/THC toggle label **immediately before** it:

```html
<label id="fhr-thc-toggle-group" class="toolbar-group" hidden>
  <span>Amex filter</span>
  <div id="fhr-thc-toggle" class="map-mode-toggle">
    <button class="map-mode-toggle__btn is-active" data-subfilter="fhr" type="button">FHR</button>
    <button class="map-mode-toggle__btn" data-subfilter="thc" type="button">THC</button>
    <button class="map-mode-toggle__btn" data-subfilter="fhr+thc" type="button">FHR + THC</button>
  </div>
</label>
```

- [ ] **Step 3: Add new DOM references**

In the `dom = { ... }` block inside `buildShell` (around line 1755), add after `aspireCreditWithStayBtn`:

```js
fhrThcToggleGroup: document.querySelector("#fhr-thc-toggle-group"),
fhrThcToggle: document.querySelector("#fhr-thc-toggle"),
```

- [ ] **Step 4: Verify in browser**

After `npm run dev`, the tabs should show: Aspire · FHR/THC · iPrefer · Edit. The FHR/THC tab should be clickable. The pill toggle is hidden by default (handled in Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: update buildShell with merged FHR/THC tab and pill toggle HTML"
```

---

### Task 4: Update `render()` to show/hide the pill toggle and sync active pill state

**Files:**
- Modify: `src/main.js:1558-1577` (render function)

- [ ] **Step 1: Update `render()`**

Find the `render()` function (around line 1558). After the existing `isAspire` block (line 1572), add the FHR/THC toggle visibility and active pill sync:

```js
const isFhrThc = state.bucket === "fhr_thc";
dom.fhrThcToggleGroup.hidden = !isFhrThc;
dom.fhrThcToggle.querySelectorAll("[data-subfilter]").forEach((btn) => {
  btn.classList.toggle("is-active", btn.dataset.subfilter === state.fhrThcSubFilter);
});
```

The full `render()` function after the change:

```js
function render() {
  updateBucketTabs();
  updateFilterOptions();
  applyFilters();
  trackBucketView();
  const isIprefer = state.bucket === "iprefer";
  dom.ipreferMapToggle.hidden = !isIprefer;
  dom.ipreferHasPointsGroup.hidden = !isIprefer;
  dom.ipreferHasPointsBtn.classList.toggle("is-active", state.ipreferHasPoints);
  const isEdit = state.bucket === "edit";
  dom.editSelectHotelsGroup.hidden = !isEdit;
  dom.editSelectHotelsBtn.classList.toggle("is-active", state.editSelectHotels);
  const isAspire = state.bucket === "aspire";
  dom.aspireCreditWithStayGroup.hidden = !isAspire;
  dom.aspireCreditWithStayBtn.classList.toggle("is-active", state.aspireCreditWithStayFilter);
  const isFhrThc = state.bucket === "fhr_thc";
  dom.fhrThcToggleGroup.hidden = !isFhrThc;
  dom.fhrThcToggle.querySelectorAll("[data-subfilter]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.subfilter === state.fhrThcSubFilter);
  });
  renderMap();
  ensureSelectedHotel();
  updateMeta();
  renderListPanel();
}
```

- [ ] **Step 2: Verify in browser**

Click the FHR/THC tab. The pill toggle should appear in the toolbar with "FHR" active. Other tabs should hide the toggle.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: show/hide FHR/THC pill toggle in render() and sync active pill"
```

---

### Task 5: Bind pill toggle click events and reset sub-filter on tab switch

**Files:**
- Modify: `src/main.js:1786-1938` (bindEvents function)

- [ ] **Step 1: Add pill toggle click handler**

In `bindEvents()`, after the `dom.ipreferMapToggle` event listener (around line 1919), add:

```js
dom.fhrThcToggle.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-subfilter]");
  if (!btn || btn.dataset.subfilter === state.fhrThcSubFilter) return;

  state.fhrThcSubFilter = btn.dataset.subfilter;
  state.listLimit = LIST_PAGE_SIZE;
  state.shouldResetMapView = true;
  state.listPanelMode = "list";
  render();
});
```

- [ ] **Step 2: Reset `fhrThcSubFilter` on bucket tab switch**

In `bindEvents()`, find the `[data-bucket]` click handler (around line 1787). After `state.aspireCreditWithStayFilter = false;`, add:

```js
state.fhrThcSubFilter = "fhr";
```

The full bucket click handler after the change:

```js
document.querySelectorAll("[data-bucket]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextBucket = button.dataset.bucket;
    if (nextBucket === state.bucket) {
      return;
    }

    state.bucket = nextBucket;
    state.listLimit = LIST_PAGE_SIZE;
    state.brand = "all";
    state.chain = "all";
    state.country = "all";
    state.overlapPlan = "all";
    state.amenities = [];
    state.ipreferHasPoints = false;
    state.editSelectHotels = false;
    state.aspireCreditWithStayFilter = false;
    state.fhrThcSubFilter = "fhr";
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    state.selectedHotelId = null;
    syncUrlFromState();
    render();
  });
});
```

- [ ] **Step 3: Verify pill toggle behavior in browser**

1. Click FHR/THC tab → pill "FHR" is active, FHR hotels are shown.
2. Click "THC" pill → hotel list and map update to THC hotels, tab count updates.
3. Click "FHR + THC" pill → shows all FHR and THC hotels combined.
4. Switch to another tab and back → tab resets to "FHR" pill.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: bind FHR/THC pill toggle events and reset sub-filter on tab switch"
```

---

### Task 6: Fix URL hash handling for `fhr_thc` bucket

**Files:**
- Modify: `src/main.js:1496-1516` (syncUrlFromState, syncStateFromUrl)

- [ ] **Step 1: Verify `syncUrlFromState`**

The current `syncUrlFromState` (around line 1500) uses `state.bucket` directly:

```js
const hash = `#${state.bucket}${hotelPart}`;
```

This already works for `fhr_thc` — no change needed. The URL will be `#fhr_thc`.

- [ ] **Step 2: Verify `syncStateFromUrl`**

The current `syncStateFromUrl` (around line 1506) checks `PLAN_CONFIG[bucket]` to validate the bucket. Since `fhr_thc` is now in `PLAN_CONFIG`, navigating to `#fhr_thc` will correctly restore the bucket. No change needed.

- [ ] **Step 3: Handle legacy `#fhr` and `#thc` URLs**

Old bookmarks may use `#fhr` or `#thc`. Update `syncStateFromUrl` to redirect them to `fhr_thc`:

```js
function syncStateFromUrl() {
  const hash = window.location.hash.slice(1); // remove leading #
  if (!hash) return;
  const [bucket, hotelId] = hash.split("/");

  // Redirect legacy fhr/thc hashes to the merged tab
  const resolvedBucket = (bucket === "fhr" || bucket === "thc") ? "fhr_thc" : bucket;

  if (PLAN_CONFIG[resolvedBucket]) {
    state.bucket = resolvedBucket;
    // Set sub-filter for legacy URLs
    if (bucket === "thc") {
      state.fhrThcSubFilter = "thc";
    }
  }
  if (hotelId) {
    state.selectedHotelId = hotelId;
    state.listPanelMode = "detail";
  }
}
```

- [ ] **Step 4: Verify legacy URL handling in browser**

Navigate to `#fhr` → app loads FHR/THC tab with FHR sub-filter active.
Navigate to `#thc` → app loads FHR/THC tab with THC sub-filter active.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: handle legacy #fhr and #thc URL hashes by redirecting to #fhr_thc"
```

---

### Task 7: Final smoke test and cleanup

- [ ] **Step 1: Full browser smoke test**

Run `npm run dev` and verify:

1. Page loads on Aspire tab (default).
2. FHR/THC tab shows correct hotel count.
3. Clicking FHR/THC tab shows pill toggle with FHR active.
4. Clicking THC pill updates list and map; tab count updates to THC count.
5. Clicking FHR + THC pill shows combined count of FHR and THC hotels.
6. Switching to Aspire tab hides pill toggle; returning to FHR/THC resets to FHR.
7. Brand/chain/country/overlap filters work on FHR/THC tab.
8. Direct navigation to `#fhr_thc` loads FHR/THC tab.
9. Direct navigation to `#fhr` loads FHR/THC tab with FHR sub-filter.
10. Direct navigation to `#thc` loads FHR/THC tab with THC sub-filter.

- [ ] **Step 2: Check `src/styles.css` for any `.map-mode-toggle` styles**

The pill toggle reuses the `.map-mode-toggle` and `.map-mode-toggle__btn` CSS classes from the iPrefer map toggle. Open `src/styles.css` and confirm these classes exist. If they do, no CSS changes are needed. If the pills look unstyled, add matching styles under the existing `.map-mode-toggle` block.

- [ ] **Step 3: Build and verify no errors**

```bash
npm run build
```

Expected: Build completes with no errors. Check `dist/` output.

- [ ] **Step 4: Final commit**

```bash
git add src/main.js src/styles.css
git commit -m "feat: complete FHR/THC merged tab with sub-filter pills"
```
