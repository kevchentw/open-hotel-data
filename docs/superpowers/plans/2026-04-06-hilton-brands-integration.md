# Hilton Brands Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `hilton_brands` stage-1 source through stages 4 and 6 of the data pipeline, then add a Hilton tab to the UI showing cash price (USD), points price, and CPP (cents per point).

**Architecture:** Extract `CURRENCY_TO_USD` + `convertToUsd` into a shared module consumed by both `5-price/fetch.mjs` and `6-output/export.mjs`. Stage 4 carries three raw Hilton pricing fields through the canonical registry. Stage 6 converts cash to USD and computes CPP. The UI adds a `hilton` bucket with a cash/points toggle and CPP display.

**Tech Stack:** Node.js ESM (`node:test` for tests), Vite frontend (vanilla JS, no framework).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `data-pipeline/shared/currency.mjs` | Shared `CURRENCY_TO_USD` table + `convertToUsd()` |
| Create | `data-pipeline/shared/currency.test.mjs` | Tests for `convertToUsd()` |
| Modify | `data-pipeline/5-price/fetch.mjs` | Import from shared instead of local definitions |
| Modify | `data-pipeline/4-unique/build.mjs` | Add `hilton_brands` source + 3 pricing fields |
| Modify | `data-pipeline/6-output/export.mjs` | Import `convertToUsd`, compute USD cash + CPP |
| Modify | `src/main.js` | Add Hilton bucket, toggle, CPP display |

---

### Task 1: Create shared currency module

**Files:**
- Create: `data-pipeline/shared/currency.mjs`
- Create: `data-pipeline/shared/currency.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `data-pipeline/shared/currency.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { convertToUsd } from "./currency.mjs";

test("convertToUsd returns '0.00' for zero input", () => {
  assert.strictEqual(convertToUsd("0", "USD"), "0.00");
});

test("convertToUsd converts USD to USD unchanged", () => {
  assert.strictEqual(convertToUsd("100", "USD"), "100.00");
});

test("convertToUsd converts AED to USD using fixed peg", () => {
  // 100 AED × 0.27229 = 27.229 → "27.23"
  assert.strictEqual(convertToUsd("100", "AED"), "27.23");
});

test("convertToUsd accepts numeric string with decimals", () => {
  // 125.25 AED × 0.27229 ≈ 34.10 → "34.10"
  const result = convertToUsd("125.25", "AED");
  assert.match(result, /^\d+\.\d{2}$/u);
});

test("convertToUsd returns empty string for non-numeric input", () => {
  assert.strictEqual(convertToUsd("not-a-number", "USD"), "");
});

test("convertToUsd is case-insensitive for currency code", () => {
  assert.strictEqual(convertToUsd("100", "usd"), "100.00");
  assert.strictEqual(convertToUsd("100", "Usd"), "100.00");
});

test("convertToUsd throws for unknown currency", () => {
  assert.throws(
    () => convertToUsd("100", "XYZ"),
    /Missing USD transform rule for currency "XYZ"/u
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test data-pipeline/shared/currency.test.mjs
```

Expected: fail with "Cannot find module" (file doesn't exist yet).

- [ ] **Step 3: Create `data-pipeline/shared/currency.mjs`**

```js
export const CURRENCY_TO_USD = Object.freeze({
  USD: 1,
  AED: 0.27229,   // pegged ~3.6725/USD — stable, unchanged
  AUD: 0.69090,   // 1.4474 AUD/USD (x-rates Apr 3)
  CAD: 0.71820,   // 1.3924 CAD/USD (x-rates Apr 3)
  CNY: 0.14535,   // 6.8800 CNY/USD (x-rates Apr 3)
  EUR: 1.15355,   // 0.8669 EUR/USD (x-rates Apr 3)
  FJD: 0.44949,   // ~2.225 FJD/USD (Wise/exchange-rates.org Mar–Apr 2026)
  IDR: 0.00005880, // ~17,006 IDR/USD (x-rates Apr 3)
  INR: 0.01077,   // 92.89 INR/USD (x-rates Apr 3)
  JOD: 1.41044,   // pegged ~0.7090 JOD/USD — stable (exchange-rates.org Apr 4)
  JPY: 0.00626,   // ~159.6 JPY/USD (TradingEconomics Apr 3)
  KRW: 0.000662,  // ~1,509.7 KRW/USD (x-rates Apr 3)
  MAD: 0.10638,   // ~9.40 MAD/USD (XE Apr 4)
  MXN: 0.05598,   // 17.863 MXN/USD (x-rates Apr 3)
  MYR: 0.24785,   // 4.0347 MYR/USD (x-rates Apr 3)
  NZD: 0.57121,   // 1.7507 NZD/USD (x-rates Apr 3)
  OMR: 2.59820,   // pegged ~0.3849 OMR/USD (x-rates Apr 3)
  PHP: 0.01657,   // 60.349 PHP/USD (x-rates Apr 3)
  PLN: 0.26965,   // 3.7086 PLN/USD (x-rates Apr 3)
  QAR: 0.27473,   // pegged ~3.64 QAR/USD — stable
  THB: 0.03062,   // 32.663 THB/USD (x-rates Apr 3)
  VND: 0.00003796, // ~26,340 VND/USD (TradingEconomics/XE Apr 3–4)
  XPF: 0.00967,   // ~103.4 XPF/USD (Wise Mar–Apr 2026)
});

export function convertToUsd(amount, currency) {
  const numericAmount = Number.parseFloat(String(amount));
  if (!Number.isFinite(numericAmount)) {
    return "";
  }

  const normalizedCurrency = (typeof currency === "string" ? currency.trim() : "").toUpperCase() || "USD";
  const multiplier = CURRENCY_TO_USD[normalizedCurrency];
  if (!Number.isFinite(multiplier)) {
    throw new Error(`Missing USD transform rule for currency "${normalizedCurrency}"`);
  }

  return numericAmount === 0 ? "0.00" : (numericAmount * multiplier).toFixed(2);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test data-pipeline/shared/currency.test.mjs
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add data-pipeline/shared/currency.mjs data-pipeline/shared/currency.test.mjs
git commit -m "feat: add shared currency conversion module"
```

---

### Task 2: Update fetch.mjs to use shared currency

**Files:**
- Modify: `data-pipeline/5-price/fetch.mjs`

The goal: remove the local `CURRENCY_TO_USD` constant (lines 24–48) and the local `convertToUsd` function (lines 849–862), replacing them with imports from the shared module. Behavior must not change.

- [ ] **Step 1: Add import at top of fetch.mjs**

At the top of `data-pipeline/5-price/fetch.mjs`, after the existing `import { fileURLToPath }` line, add:

```js
import { CURRENCY_TO_USD, convertToUsd } from "../shared/currency.mjs";
```

- [ ] **Step 2: Remove local CURRENCY_TO_USD constant**

Delete the entire `const CURRENCY_TO_USD = Object.freeze({ ... });` block (lines 24–48 in the original file — the object starting with `USD: 1` through the closing `});`).

- [ ] **Step 3: Remove local convertToUsd function**

Delete the entire `function convertToUsd(amount, currency) { ... }` function body (the function starting at the `function convertToUsd` line through its closing `}`). The `numericAmountToString` helper used only by the old `convertToUsd` can also be deleted if it has no other callers — check first with:

```bash
grep -n "numericAmountToString" data-pipeline/5-price/fetch.mjs
```

If the only remaining reference is in `normalizeDecimal`, keep `numericAmountToString`. If the only references were in the deleted `convertToUsd`, delete it too.

- [ ] **Step 4: Run existing fetch.mjs tests**

```bash
node --test data-pipeline/5-price/fetch.test.mjs
```

Expected: all tests PASS (same as before the refactor).

- [ ] **Step 5: Commit**

```bash
git add data-pipeline/5-price/fetch.mjs
git commit -m "refactor: import currency conversion from shared module in fetch.mjs"
```

---

### Task 3: Add hilton_brands to stage 4 (unique)

**Files:**
- Modify: `data-pipeline/4-unique/build.mjs`

- [ ] **Step 1: Add hilton_brands to SOURCE_CONFIGS**

In `build.mjs`, find the `SOURCE_CONFIGS` array. After the `chase_edit` entry (the last one), add:

```js
  {
    source: "hilton_brands",
    stageOneUrl: new URL("../1-list/hilton-brands-hotel.json", import.meta.url),
    stageTwoUrl: new URL("../2-enrichment/hilton-brands-hotel.json", import.meta.url),
    stageThreeUrl: new URL("../3-tripadvisor/hilton-brands-hotel.json", import.meta.url)
  }
```

- [ ] **Step 2: Extend hilton_url to also pick from hilton_brands**

Find this line in `buildCanonicalHotel`:

```js
    hilton_url: pickSourcePageUrl(contributors, ["hilton_aspire_resort_credit"]),
```

Change it to:

```js
    hilton_url: pickSourcePageUrl(contributors, ["hilton_aspire_resort_credit", "hilton_brands"]),
```

- [ ] **Step 3: Add three pricing fields to buildCanonicalHotel**

In `buildCanonicalHotel`, inside the `sortObjectKeys({...})` call, add these three fields after the `hilton_url` line:

```js
    hilton_cash_currency: pickField(contributors, (contributor) =>
      contributor.source === "hilton_brands" ? contributor.stageOneHotel?.lowest_cash_price_currency : ""
    ),
    hilton_cash_price: pickField(contributors, (contributor) =>
      contributor.source === "hilton_brands" ? contributor.stageOneHotel?.lowest_cash_price : ""
    ),
    hilton_points_price: pickField(contributors, (contributor) =>
      contributor.source === "hilton_brands" ? contributor.stageOneHotel?.lowest_points_price : ""
    ),
```

- [ ] **Step 4: Fix hilton_url in buildUnmatchedRecord**

Find this block in `buildUnmatchedRecord`:

```js
    hilton_url: record.source === "hilton_aspire_resort_credit"
      ? firstNonEmpty([record.stageTwoHotel.detail_url, record.stageOneHotel.url])
      : "",
```

Replace it with:

```js
    hilton_url: (record.source === "hilton_aspire_resort_credit" || record.source === "hilton_brands")
      ? firstNonEmpty([record.stageTwoHotel.detail_url, record.stageOneHotel.url])
      : "",
```

- [ ] **Step 5: Add three pricing fields to buildUnmatchedRecord**

In `buildUnmatchedRecord`, inside the `sortObjectKeys({...})` call, add these three fields after the `hilton_url` line:

```js
    hilton_cash_currency: record.source === "hilton_brands"
      ? normalizeString(record.stageOneHotel.lowest_cash_price_currency)
      : "",
    hilton_cash_price: record.source === "hilton_brands"
      ? normalizeString(record.stageOneHotel.lowest_cash_price)
      : "",
    hilton_points_price: record.source === "hilton_brands"
      ? normalizeString(record.stageOneHotel.lowest_points_price)
      : "",
```

- [ ] **Step 6: Run stage 4 and verify output**

```bash
node data-pipeline/4-unique/build.mjs
```

Expected output (approximate):
```
Wrote N canonical hotels to .../4-unique/hotel.json (M links, K unmatched)
```

The count should be higher than before (hilton_brands hotels added). Spot-check the output:

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('data-pipeline/4-unique/hotel.json','utf8'));
const hiltonLinks = Object.values(d.links).filter(l => l.source === 'hilton_brands');
const hiltonUnmatched = Object.values(d.unmatched).filter(u => u.source === 'hilton_brands');
console.log('hilton_brands links:', hiltonLinks.length);
console.log('hilton_brands unmatched:', hiltonUnmatched.length);
const sampleUnmatched = hiltonUnmatched[0];
console.log('sample unmatched hilton_points_price:', sampleUnmatched?.hilton_points_price);
console.log('sample unmatched hilton_cash_currency:', sampleUnmatched?.hilton_cash_currency);
"
```

Expected: `hilton_brands links: 0` (no tripadvisor matches yet), `hilton_brands unmatched: 641`, and a non-empty `hilton_points_price` on the sample.

- [ ] **Step 7: Commit**

```bash
git add data-pipeline/4-unique/build.mjs data-pipeline/4-unique/hotel.json
git commit -m "feat: add hilton_brands source to stage-4 canonical registry"
```

---

### Task 4: Add hilton pricing fields to stage 6 (output)

**Files:**
- Modify: `data-pipeline/6-output/export.mjs`

- [ ] **Step 1: Add import for convertToUsd**

At the top of `data-pipeline/6-output/export.mjs`, after the existing `import { inferChainFromBrand }` line, add:

```js
import { convertToUsd } from "../shared/currency.mjs";
```

- [ ] **Step 2: Add hilton raw fields to pickHotelFields**

In the `pickHotelFields` function, after the `chase_2026_credit` line, add:

```js
    hilton_cash_currency: normalizeString(hotel.hilton_cash_currency),
    hilton_cash_price: normalizeString(hotel.hilton_cash_price),
    hilton_points_price: normalizeString(hotel.hilton_points_price),
```

- [ ] **Step 3: Add USD conversion + CPP to buildCanonicalHotels**

In `buildCanonicalHotels`, find where `canonicalHotel` is assembled (the `const canonicalHotel = { ...pickHotelFields(hotel), ... }` block). After that block but before `return [tripadvisorId, sortObjectKeys(canonicalHotel)]`, add:

```js
        const rawCash = canonicalHotel.hilton_cash_price;
        const rawCurrency = canonicalHotel.hilton_cash_currency;
        const rawPoints = canonicalHotel.hilton_points_price;
        if (rawCash && rawCurrency && rawPoints) {
          try {
            const cashUsd = convertToUsd(rawCash, rawCurrency);
            const pointsNum = Number.parseFloat(rawPoints);
            const cashUsdNum = Number.parseFloat(cashUsd);
            if (cashUsd && Number.isFinite(pointsNum) && pointsNum > 0 && Number.isFinite(cashUsdNum)) {
              canonicalHotel.hilton_cash_price_usd = cashUsd;
              canonicalHotel.hilton_cpp = ((cashUsdNum / pointsNum) * 100).toFixed(4);
            }
          } catch (e) {
            console.warn(`[hilton] skipping CPP computation: ${e.message}`);
          }
        }
```

- [ ] **Step 4: Add hilton raw fields to buildFallbackHotels**

In the `buildFallbackHotels` function, inside the `sortObjectKeys({...})` call for each entry, add these fields after the `chase_2026_credit` line:

```js
          hilton_cash_currency: normalizeString(hotel.hilton_cash_currency),
          hilton_cash_price: normalizeString(hotel.hilton_cash_price),
          hilton_points_price: normalizeString(hotel.hilton_points_price),
```

- [ ] **Step 5: Add USD conversion + CPP to buildFallbackHotels**

In `buildFallbackHotels`, after the `sortObjectKeys({...})` call that builds `entry`, but before `return [fallbackId, sortObjectKeys(entry)]`, add:

```js
        const rawCash = entry.hilton_cash_price;
        const rawCurrency = entry.hilton_cash_currency;
        const rawPoints = entry.hilton_points_price;
        if (rawCash && rawCurrency && rawPoints) {
          try {
            const cashUsd = convertToUsd(rawCash, rawCurrency);
            const pointsNum = Number.parseFloat(rawPoints);
            const cashUsdNum = Number.parseFloat(cashUsd);
            if (cashUsd && Number.isFinite(pointsNum) && pointsNum > 0 && Number.isFinite(cashUsdNum)) {
              entry.hilton_cash_price_usd = cashUsd;
              entry.hilton_cpp = ((cashUsdNum / pointsNum) * 100).toFixed(4);
            }
          } catch (e) {
            console.warn(`[hilton] skipping CPP computation: ${e.message}`);
          }
        }
```

- [ ] **Step 6: Run stage 6 and verify output**

```bash
node data-pipeline/6-output/export.mjs
```

Spot-check the output:

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('public/data/hotels.json','utf8'));
const hilton = d.hotels.filter(h => h.plans?.includes('hilton_brands'));
console.log('hilton_brands hotels in app output:', hilton.length);
const sample = hilton[0];
console.log('sample hilton_points_price:', sample?.hilton_points_price);
console.log('sample hilton_cash_price_usd:', sample?.hilton_cash_price_usd);
console.log('sample hilton_cpp:', sample?.hilton_cpp);
console.log('sample hilton_cash_currency:', sample?.hilton_cash_currency);
"
```

Expected: `hilton_brands hotels in app output: 641`, and non-empty `hilton_points_price`, `hilton_cash_price_usd`, `hilton_cpp` on the sample (for hotels whose currency is in the table).

- [ ] **Step 7: Commit**

```bash
git add data-pipeline/6-output/export.mjs data-pipeline/6-output/hotels.json public/data/hotels.json
git commit -m "feat: add hilton USD cash price and CPP to stage-6 output"
```

---

### Task 5: Update UI — bucket config, state, shell, events

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Add hilton to PLAN_CONFIG**

Find the `PLAN_CONFIG` object. After the `edit` entry, add:

```js
  hilton: {
    key: "hilton",
    label: "Hilton",
    plans: ["hilton_brands"],
    description: "Hilton luxury brands (Conrad, Waldorf Astoria, LXR, SLH) scraped from hilton.com with live points and cash pricing.",
  },
```

- [ ] **Step 2: Add hilton_brands to PLAN_LABELS**

Find the `PLAN_LABELS` object. Add:

```js
  hilton_brands: "Hilton",
```

- [ ] **Step 3: Update buildBucketKey**

Find `buildBucketKey`. Add a `hilton_brands` case before the existing `hilton_aspire_resort_credit` check:

```js
  if (plans.includes("hilton_brands")) {
    return "hilton";
  }
```

So the function body becomes:

```js
function buildBucketKey(plans = []) {
  if (plans.includes("amex_thc") || plans.includes("amex_fhr")) {
    return "fhr_thc";
  }

  if (plans.includes("iprefer_points")) {
    return "iprefer";
  }

  if (plans.includes("hilton_brands")) {
    return "hilton";
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

- [ ] **Step 4: Add hilton to getBucketCounts**

Find `getBucketCounts`. Change the `counts` object to include `hilton`:

```js
  const counts = {
    fhr_thc: 0,
    aspire: 0,
    iprefer: 0,
    edit: 0,
    hilton: 0,
  };
```

- [ ] **Step 5: Add hiltonMapMode to state**

Find the `const state = { ... }` object. After `ipreferMapMode: "cash"`, add:

```js
  hiltonMapMode: "points",
```

- [ ] **Step 6: Add Hilton bucket tab and map toggle to buildShell HTML**

In `buildShell`, find the bucket-tabs div:

```html
<div class="bucket-tabs">
  <button class="bucket-tab" data-bucket="aspire" type="button"></button>
  <button class="bucket-tab" data-bucket="fhr_thc" type="button"></button>
  <button class="bucket-tab" data-bucket="iprefer" type="button"></button>
  <button class="bucket-tab" data-bucket="edit" type="button"></button>
</div>
```

Add the Hilton tab button at the end:

```html
<div class="bucket-tabs">
  <button class="bucket-tab" data-bucket="aspire" type="button"></button>
  <button class="bucket-tab" data-bucket="fhr_thc" type="button"></button>
  <button class="bucket-tab" data-bucket="iprefer" type="button"></button>
  <button class="bucket-tab" data-bucket="edit" type="button"></button>
  <button class="bucket-tab" data-bucket="hilton" type="button"></button>
</div>
```

Then find the existing iprefer map toggle div in the map panel:

```html
<div id="iprefer-map-toggle" class="map-mode-toggle" hidden>
  <button class="map-mode-toggle__btn is-active" data-mode="cash" type="button">Cash</button>
  <button class="map-mode-toggle__btn" data-mode="points" type="button">Points</button>
</div>
```

Add a Hilton toggle immediately after it:

```html
<div id="hilton-map-toggle" class="map-mode-toggle" hidden>
  <button class="map-mode-toggle__btn" data-mode="cash" type="button">Cash</button>
  <button class="map-mode-toggle__btn is-active" data-mode="points" type="button">Points</button>
</div>
```

- [ ] **Step 7: Add hiltonMapToggle to dom refs**

In `buildShell`, in the `dom = { ... }` assignment after `ipreferMapToggle`, add:

```js
    hiltonMapToggle: document.querySelector("#hilton-map-toggle"),
```

- [ ] **Step 8: Show/hide Hilton toggle in render()**

In the `render()` function, find:

```js
  const isIprefer = state.bucket === "iprefer";
  dom.ipreferMapToggle.hidden = !isIprefer;
```

After this block, add:

```js
  const isHilton = state.bucket === "hilton";
  dom.hiltonMapToggle.hidden = !isHilton;
  dom.hiltonMapToggle.querySelectorAll("[data-mode]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.mode === state.hiltonMapMode);
  });
```

- [ ] **Step 9: Bind Hilton toggle events in bindEvents()**

In `bindEvents()`, after the `dom.ipreferMapToggle.addEventListener` block, add:

```js
  dom.hiltonMapToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-mode]");
    if (!btn || btn.dataset.mode === state.hiltonMapMode) return;

    state.hiltonMapMode = btn.dataset.mode;
    dom.hiltonMapToggle.querySelectorAll("[data-mode]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.mode === state.hiltonMapMode);
    });
    applyFilters();
    renderMap();
    renderListPanel();
  });
```

- [ ] **Step 10: Commit**

```bash
git add src/main.js
git commit -m "feat: add Hilton bucket config, state, shell and event bindings to UI"
```

---

### Task 6: Update UI — hotel rendering (card, map, detail)

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Extend normalizeHotel to extract Hilton pricing fields**

In `normalizeHotel`, after the `sampledPriceSummary` line in the hotel object literal, add these four fields:

```js
    hiltonPointsPrice: toFiniteNumber(rawHotel.hilton_points_price),
    hiltonCashPriceUsd: toFiniteNumber(rawHotel.hilton_cash_price_usd),
    hiltonCpp: toFiniteNumber(rawHotel.hilton_cpp),
    hiltonCashCurrency: rawHotel.hilton_cash_currency || "",
```

- [ ] **Step 2: Update compareHotels to sort by Hilton pricing**

Find `compareHotels`. The current price selection logic is:

```js
  const leftPrice = state.bucket === "iprefer"
    ? (state.ipreferMapMode === "points" ? left.ipreferPointsMin : left.ipreferCashMin)
    : left.priceValue;
  const rightPrice = state.bucket === "iprefer"
    ? (state.ipreferMapMode === "points" ? right.ipreferPointsMin : right.ipreferCashMin)
    : right.priceValue;
```

Replace with:

```js
  const leftPrice = state.bucket === "iprefer"
    ? (state.ipreferMapMode === "points" ? left.ipreferPointsMin : left.ipreferCashMin)
    : state.bucket === "hilton"
      ? (state.hiltonMapMode === "points" ? left.hiltonPointsPrice : left.hiltonCashPriceUsd)
      : left.priceValue;
  const rightPrice = state.bucket === "iprefer"
    ? (state.ipreferMapMode === "points" ? right.ipreferPointsMin : right.ipreferCashMin)
    : state.bucket === "hilton"
      ? (state.hiltonMapMode === "points" ? right.hiltonPointsPrice : right.hiltonCashPriceUsd)
      : right.priceValue;
```

- [ ] **Step 3: Update markerHtml for Hilton**

Find `markerHtml`. The current logic is:

```js
  if (state.bucket === "iprefer") {
    if (state.ipreferMapMode === "points") { ... }
    ... // cash
  }
  return `...default...`;
```

Add a Hilton branch before the final `return`:

```js
  if (state.bucket === "hilton") {
    if (state.hiltonMapMode === "points") {
      const label = hotel.hiltonPointsPrice !== null
        ? `${formatNumber(hotel.hiltonPointsPrice / 1000)}k`
        : "N/A";
      return `
        <div class="map-pin ${mapPinClass(hotel)}" style="${mapPinStyle(hotel)}">
          <span>${escapeHtml(label)}</span>
        </div>
      `;
    }

    const label = hotel.hiltonCashPriceUsd !== null
      ? formatCompactCurrency(hotel.hiltonCashPriceUsd, "USD")
      : "—";
    return `
      <div class="map-pin ${mapPinClass(hotel)}" style="${mapPinStyle(hotel)}">
        <span>${escapeHtml(label)}</span>
      </div>
    `;
  }
```

- [ ] **Step 4: Update mapPinClass for Hilton**

Find `mapPinClass`. The current logic is:

```js
  if (state.bucket === "iprefer") {
    const hasValue = state.ipreferMapMode === "points"
      ? hotel.ipreferPointsMin !== null
      : hotel.ipreferCashMin !== null;
    return hasValue ? "map-pin--priced" : "map-pin--pending";
  }

  return hotel.priceValue === null ? "map-pin--pending" : "map-pin--priced";
```

Add a Hilton branch after the iprefer block:

```js
  if (state.bucket === "hilton") {
    const hasValue = state.hiltonMapMode === "points"
      ? hotel.hiltonPointsPrice !== null
      : hotel.hiltonCashPriceUsd !== null;
    return hasValue ? "map-pin--priced" : "map-pin--pending";
  }
```

- [ ] **Step 5: Update mapPinStyle for Hilton**

Find `mapPinStyle`. The current logic is:

```js
  if (state.bucket === "iprefer") {
    if (state.ipreferMapMode === "points") {
      return `--pin-color: ${getPointsBucketColor(hotel.ipreferPointsMin)};`;
    }
    return `--pin-color: ${getPriceBucketColor(hotel.ipreferCashMin)};`;
  }

  return `--pin-color: ${getPriceBucketColor(hotel.priceValue)};`;
```

Add a Hilton branch after the iprefer block:

```js
  if (state.bucket === "hilton") {
    if (state.hiltonMapMode === "points") {
      return `--pin-color: ${getPointsBucketColor(hotel.hiltonPointsPrice)};`;
    }
    return `--pin-color: ${getPriceBucketColor(hotel.hiltonCashPriceUsd)};`;
  }
```

- [ ] **Step 6: Update getLowestPriceHotel for Hilton**

Find `getLowestPriceHotel`. The current `getValue` function is:

```js
  const getValue = (hotel) => {
    if (state.bucket === "iprefer") {
      return state.ipreferMapMode === "points" ? hotel.ipreferPointsMin : hotel.ipreferCashMin;
    }
    return hotel.priceValue;
  };
```

Replace with:

```js
  const getValue = (hotel) => {
    if (state.bucket === "iprefer") {
      return state.ipreferMapMode === "points" ? hotel.ipreferPointsMin : hotel.ipreferCashMin;
    }
    if (state.bucket === "hilton") {
      return state.hiltonMapMode === "points" ? hotel.hiltonPointsPrice : hotel.hiltonCashPriceUsd;
    }
    return hotel.priceValue;
  };
```

- [ ] **Step 7: Update createHotelRow price HTML for Hilton**

Find `createHotelRow`. The current `rowPriceHtml` assignment is:

```js
  const rowPriceHtml = state.bucket === "iprefer"
    ? `<div class="row-price-iprefer">
        <span class="row-price">${escapeHtml(hotel.ipreferPriceLabel)}</span>
        ${hotel.ipreferCashMin !== null ? `<span class="row-price-cash">${escapeHtml(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency))}</span>` : ""}
      </div>`
    : `<span class="row-price">${escapeHtml(hotel.priceLabel)}</span>`;
```

Replace with:

```js
  const rowPriceHtml = state.bucket === "iprefer"
    ? `<div class="row-price-iprefer">
        <span class="row-price">${escapeHtml(hotel.ipreferPriceLabel)}</span>
        ${hotel.ipreferCashMin !== null ? `<span class="row-price-cash">${escapeHtml(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency))}</span>` : ""}
      </div>`
    : state.bucket === "hilton"
      ? `<div class="row-price-iprefer">
          <span class="row-price">${escapeHtml(
            state.hiltonMapMode === "points"
              ? (hotel.hiltonPointsPrice !== null ? `${formatNumber(hotel.hiltonPointsPrice)} pts` : "N/A")
              : (hotel.hiltonCashPriceUsd !== null ? formatCompactCurrency(hotel.hiltonCashPriceUsd, "USD") : "N/A")
          )}</span>
          ${hotel.hiltonCpp !== null ? `<span class="row-price-cash">${escapeHtml(hotel.hiltonCpp.toFixed(4))}¢/pt</span>` : ""}
        </div>`
      : `<span class="row-price">${escapeHtml(hotel.priceLabel)}</span>`;
```

- [ ] **Step 8: Update popup price HTML for Hilton in renderMap**

Find the `popupPriceHtml` assignment in `renderMap`:

```js
    const popupPriceHtml = state.bucket === "iprefer"
      ? `<span>${escapeHtml(hotel.ipreferPriceLabel)}${hotel.ipreferCashMin !== null ? ` · ${escapeHtml(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency))}` : ""}</span>`
      : `<span>${escapeHtml(hotel.priceLabel)}</span>`;
```

Replace with:

```js
    const popupPriceHtml = state.bucket === "iprefer"
      ? `<span>${escapeHtml(hotel.ipreferPriceLabel)}${hotel.ipreferCashMin !== null ? ` · ${escapeHtml(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency))}` : ""}</span>`
      : state.bucket === "hilton"
        ? `<span>${escapeHtml(
            state.hiltonMapMode === "points"
              ? (hotel.hiltonPointsPrice !== null ? `${formatNumber(hotel.hiltonPointsPrice)} pts` : "N/A")
              : (hotel.hiltonCashPriceUsd !== null ? formatCompactCurrency(hotel.hiltonCashPriceUsd, "USD") : "N/A")
          )}${hotel.hiltonCpp !== null ? ` · ${escapeHtml(hotel.hiltonCpp.toFixed(4))}¢/pt` : ""}</span>`
        : `<span>${escapeHtml(hotel.priceLabel)}</span>`;
```

- [ ] **Step 9: Update price-pill in detail card topline for Hilton**

Find this in `renderDetailView`:

```js
<span class="price-pill">${escapeHtml(state.bucket === "iprefer" ? hotel.ipreferPriceLabel : hotel.priceLabel)}</span>
```

Replace with:

```js
<span class="price-pill">${escapeHtml(
  state.bucket === "iprefer"
    ? hotel.ipreferPriceLabel
    : state.bucket === "hilton"
      ? (state.hiltonMapMode === "points"
          ? (hotel.hiltonPointsPrice !== null ? `${formatNumber(hotel.hiltonPointsPrice)} pts` : "N/A")
          : (hotel.hiltonCashPriceUsd !== null ? formatCompactCurrency(hotel.hiltonCashPriceUsd, "USD") : "N/A"))
      : hotel.priceLabel
)}</span>
```

- [ ] **Step 10: Add Hilton pricing section to renderDetailView**

In `renderDetailView`, find where `ipreferPricePattern` is used:

```js
  const ipreferPricePattern = state.bucket === "iprefer" ? renderIpreferPricePattern(hotel) : "";
```

Add a `hiltonPricingSection` variable after it:

```js
  const hiltonPricingSection = state.bucket === "hilton" && (hotel.hiltonPointsPrice !== null || hotel.hiltonCashPriceUsd !== null)
    ? `
      <section class="sampled-price-pattern" aria-label="Hilton pricing">
        <span class="sampled-price-pattern__eyebrow">Hilton pricing</span>
        <div class="detail-grid">
          ${hotel.hiltonPointsPrice !== null ? `
          <div class="detail-row">
            <span>Points/night</span>
            <strong>${escapeHtml(formatNumber(hotel.hiltonPointsPrice))} pts</strong>
          </div>` : ""}
          ${hotel.hiltonCashPriceUsd !== null ? `
          <div class="detail-row">
            <span>Cash/night (USD)</span>
            <strong>${escapeHtml(formatCompactCurrency(hotel.hiltonCashPriceUsd, "USD"))}${hotel.hiltonCashCurrency && hotel.hiltonCashCurrency !== "USD" ? ` <span style="opacity:0.6">(${escapeHtml(hotel.hiltonCashCurrency)})</span>` : ""}</strong>
          </div>` : ""}
          ${hotel.hiltonCpp !== null ? `
          <div class="detail-row">
            <span>CPP</span>
            <strong>${escapeHtml(hotel.hiltonCpp.toFixed(4))}¢/pt</strong>
          </div>` : ""}
        </div>
      </section>`
    : "";
```

Then in the template string for `dom.list.innerHTML`, find where `${ipreferPricePattern}` is used and add `${hiltonPricingSection}` after it:

```js
      ${ipreferPricePattern}
      ${hiltonPricingSection}
      ${sampledPricePattern}
```

- [ ] **Step 11: Build and verify in browser**

```bash
npm run build
npm run preview
```

Open the preview URL. You should see a "Hilton" tab. Click it — it should show ~641 hotels on the map. Click a hotel — the detail panel should show the Hilton pricing section with points, cash (USD), and CPP. Toggle between Cash and Points using the map toggle — the map pin labels and card prices should update.

- [ ] **Step 12: Commit**

```bash
git add src/main.js
git commit -m "feat: add Hilton tab UI with points/cash toggle and CPP display"
```
