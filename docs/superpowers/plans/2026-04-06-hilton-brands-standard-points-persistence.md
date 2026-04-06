# Hilton Brands Standard Points Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the most recently seen Standard Room Reward points price per hotel across crawl runs, auto-seed a manual CSV for hotels that only ever show Premium pricing, and expose `standard_lowest_points_price` on every stage-1 hotel record.

**Architecture:** A new focused module `hilton-brands-points-persistence.mjs` owns all pure persistence helpers (CSV + history JSON parsing/serialization, resolution logic). `hilton-brands.mjs` calls those helpers inside `writeStageOneOutputs` — load history + CSV before the hotel loop, resolve `standard_lowest_points_price` per hotel, update history and append CSV rows after the loop. `buildHotelRecord` gains a 4th parameter so the field appears in a consistent position on every record.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, `node:fs/promises`, `papaparse` (already in `dependencies`)

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `data-pipeline/1-list/scripts/hilton-brands-points-persistence.mjs` | Create | Pure helpers: parse/serialize history JSON and manual CSV, resolve standard points, decide auto-add |
| `data-pipeline/1-list/scripts/hilton-brands-points-persistence.test.mjs` | Create | Unit tests for all pure helpers |
| `data-pipeline/1-list/scripts/hilton-brands.mjs` | Modify | Add `standardLowestPointsPrice` param to `buildHotelRecord`; wire persistence into `writeStageOneOutputs` |
| `data-pipeline/1-list/scripts/hilton-brands.test.mjs` | Modify | Update `buildHotelRecord` tests to assert `standard_lowest_points_price` field |
| `data-pipeline/1-list/hilton-brands-points-history.json` | Generated | Per-hotel Standard points history; committed to git |
| `data-pipeline/1-list/hilton-brands-points-manual.csv` | Generated + hand-edited | Manual Standard points lookup table; committed to git |

---

## Task 1: Create persistence helpers module with tests

**Files:**
- Create: `data-pipeline/1-list/scripts/hilton-brands-points-persistence.mjs`
- Create: `data-pipeline/1-list/scripts/hilton-brands-points-persistence.test.mjs`

- [ ] **Step 1: Create the persistence module**

Create `data-pipeline/1-list/scripts/hilton-brands-points-persistence.mjs`:

```js
import Papa from "papaparse";

const CSV_COLUMNS = ["source_hotel_id", "hotel_name", "standard_points", "notes"];

// ── History JSON ───────────────────────────────────────────────────────────

export function parsePointsHistory(jsonString) {
  if (!jsonString || !jsonString.trim()) return { metadata: {}, hotels: {} };
  try {
    const parsed = JSON.parse(jsonString);
    return { metadata: parsed.metadata ?? {}, hotels: parsed.hotels ?? {} };
  } catch {
    return { metadata: {}, hotels: {} };
  }
}

export function updatePointsHistory(history, sourceHotelId, standardPointsPrice, capturedAt) {
  return {
    metadata: history.metadata,
    hotels: {
      ...history.hotels,
      [sourceHotelId]: {
        standard_lowest_points_price: standardPointsPrice,
        captured_at: capturedAt
      }
    }
  };
}

export function serializePointsHistory(history, updatedAt) {
  return `${JSON.stringify({ metadata: { updated_at: updatedAt }, hotels: history.hotels }, null, 2)}\n`;
}

// ── Manual CSV ─────────────────────────────────────────────────────────────

export function parseManualCsv(csvString) {
  const map = new Map();
  if (!csvString || !csvString.trim()) return map;
  const result = Papa.parse(csvString.trim(), { header: true, skipEmptyLines: true });
  for (const row of result.data) {
    if (row.source_hotel_id) {
      map.set(row.source_hotel_id, {
        hotel_name: row.hotel_name ?? "",
        standard_points: row.standard_points ?? "",
        notes: row.notes ?? ""
      });
    }
  }
  return map;
}

export function serializeManualCsv(manualMap) {
  const rows = [...manualMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source_hotel_id, { hotel_name, standard_points, notes }]) => ({
      source_hotel_id,
      hotel_name,
      standard_points,
      notes
    }));
  return `${Papa.unparse(rows, { columns: CSV_COLUMNS })}\n`;
}

export function buildManualCsvRow(sourceHotelId, hotelName) {
  return { source_hotel_id: sourceHotelId, hotel_name: hotelName, standard_points: "", notes: "" };
}

// ── Resolution ─────────────────────────────────────────────────────────────

export function resolveStandardPointsPrice(currentStandard, historyEntry, manualValue) {
  if (currentStandard) return currentStandard;
  if (historyEntry?.standard_lowest_points_price) return historyEntry.standard_lowest_points_price;
  if (manualValue) return manualValue;
  return "";
}

export function shouldAddToManualCsv(currentStandard, historyEntry, manualEntry) {
  return !currentStandard && !historyEntry && !manualEntry;
}
```

- [ ] **Step 2: Write the tests**

Create `data-pipeline/1-list/scripts/hilton-brands-points-persistence.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  parsePointsHistory,
  updatePointsHistory,
  serializePointsHistory,
  parseManualCsv,
  serializeManualCsv,
  buildManualCsvRow,
  resolveStandardPointsPrice,
  shouldAddToManualCsv,
} from "./hilton-brands-points-persistence.mjs";

// ── parsePointsHistory ─────────────────────────────────────────────────────

test("parsePointsHistory returns empty structure for empty string", () => {
  const result = parsePointsHistory("");
  assert.deepEqual(result, { metadata: {}, hotels: {} });
});

test("parsePointsHistory returns empty structure for invalid JSON", () => {
  const result = parsePointsHistory("not json");
  assert.deepEqual(result, { metadata: {}, hotels: {} });
});

test("parsePointsHistory parses valid history JSON", () => {
  const json = JSON.stringify({
    metadata: { updated_at: "2026-04-06T00:00:00.000Z" },
    hotels: {
      auhetci: { standard_lowest_points_price: "50000", captured_at: "2026-04-06T00:00:00.000Z" }
    }
  });
  const result = parsePointsHistory(json);
  assert.equal(result.hotels.auhetci.standard_lowest_points_price, "50000");
});

// ── updatePointsHistory ────────────────────────────────────────────────────

test("updatePointsHistory adds new hotel to empty history", () => {
  const history = { metadata: {}, hotels: {} };
  const updated = updatePointsHistory(history, "auhetci", "50000", "2026-04-06T00:00:00.000Z");
  assert.equal(updated.hotels.auhetci.standard_lowest_points_price, "50000");
  assert.equal(updated.hotels.auhetci.captured_at, "2026-04-06T00:00:00.000Z");
});

test("updatePointsHistory overwrites existing entry with higher price", () => {
  const history = {
    metadata: {},
    hotels: { auhetci: { standard_lowest_points_price: "50000", captured_at: "2026-01-01T00:00:00.000Z" } }
  };
  const updated = updatePointsHistory(history, "auhetci", "60000", "2026-04-06T00:00:00.000Z");
  assert.equal(updated.hotels.auhetci.standard_lowest_points_price, "60000");
});

test("updatePointsHistory overwrites existing entry with lower price", () => {
  const history = {
    metadata: {},
    hotels: { auhetci: { standard_lowest_points_price: "60000", captured_at: "2026-01-01T00:00:00.000Z" } }
  };
  const updated = updatePointsHistory(history, "auhetci", "40000", "2026-04-06T00:00:00.000Z");
  assert.equal(updated.hotels.auhetci.standard_lowest_points_price, "40000");
});

test("updatePointsHistory preserves other hotels", () => {
  const history = {
    metadata: {},
    hotels: { lonwahi: { standard_lowest_points_price: "80000", captured_at: "2026-01-01T00:00:00.000Z" } }
  };
  const updated = updatePointsHistory(history, "auhetci", "50000", "2026-04-06T00:00:00.000Z");
  assert.equal(updated.hotels.lonwahi.standard_lowest_points_price, "80000");
  assert.equal(updated.hotels.auhetci.standard_lowest_points_price, "50000");
});

// ── serializePointsHistory ─────────────────────────────────────────────────

test("serializePointsHistory produces valid JSON with updated_at in metadata", () => {
  const history = {
    metadata: {},
    hotels: { auhetci: { standard_lowest_points_price: "50000", captured_at: "2026-04-06T00:00:00.000Z" } }
  };
  const json = serializePointsHistory(history, "2026-04-06T12:00:00.000Z");
  const parsed = JSON.parse(json);
  assert.equal(parsed.metadata.updated_at, "2026-04-06T12:00:00.000Z");
  assert.equal(parsed.hotels.auhetci.standard_lowest_points_price, "50000");
});

// ── parseManualCsv ─────────────────────────────────────────────────────────

test("parseManualCsv returns empty Map for empty string", () => {
  assert.equal(parseManualCsv("").size, 0);
});

test("parseManualCsv parses row with filled standard_points", () => {
  const csv = "source_hotel_id,hotel_name,standard_points,notes\nauhetci,Conrad Abu Dhabi,60000,verified";
  const map = parseManualCsv(csv);
  assert.equal(map.get("auhetci").standard_points, "60000");
  assert.equal(map.get("auhetci").hotel_name, "Conrad Abu Dhabi");
  assert.equal(map.get("auhetci").notes, "verified");
});

test("parseManualCsv parses row with blank standard_points", () => {
  const csv = "source_hotel_id,hotel_name,standard_points,notes\nlonwahi,Waldorf London,,";
  const map = parseManualCsv(csv);
  assert.equal(map.get("lonwahi").standard_points, "");
});

test("parseManualCsv handles hotel name with comma via quoting", () => {
  const csv = `source_hotel_id,hotel_name,standard_points,notes\nauhetci,"Conrad, Abu Dhabi",50000,`;
  const map = parseManualCsv(csv);
  assert.equal(map.get("auhetci").hotel_name, "Conrad, Abu Dhabi");
});

// ── serializeManualCsv ─────────────────────────────────────────────────────

test("serializeManualCsv produces header row", () => {
  const map = new Map();
  const csv = serializeManualCsv(map);
  assert.ok(csv.startsWith("source_hotel_id,hotel_name,standard_points,notes"));
});

test("serializeManualCsv sorts rows by source_hotel_id", () => {
  const map = new Map([
    ["zzz", { hotel_name: "Z Hotel", standard_points: "", notes: "" }],
    ["aaa", { hotel_name: "A Hotel", standard_points: "50000", notes: "" }],
  ]);
  const csv = serializeManualCsv(map);
  const lines = csv.trim().split("\n");
  assert.ok(lines[1].startsWith("aaa,"));
  assert.ok(lines[2].startsWith("zzz,"));
});

test("serializeManualCsv round-trips with parseManualCsv", () => {
  const original = new Map([
    ["auhetci", { hotel_name: "Conrad Abu Dhabi", standard_points: "60000", notes: "verified" }],
    ["lonwahi", { hotel_name: "Waldorf London", standard_points: "", notes: "" }],
  ]);
  const csv = serializeManualCsv(original);
  const roundTripped = parseManualCsv(csv);
  assert.equal(roundTripped.get("auhetci").standard_points, "60000");
  assert.equal(roundTripped.get("lonwahi").standard_points, "");
});

// ── buildManualCsvRow ──────────────────────────────────────────────────────

test("buildManualCsvRow creates blank row with source_hotel_id and hotel_name", () => {
  const row = buildManualCsvRow("lonwahi", "Waldorf Astoria London");
  assert.deepEqual(row, {
    source_hotel_id: "lonwahi",
    hotel_name: "Waldorf Astoria London",
    standard_points: "",
    notes: ""
  });
});

// ── resolveStandardPointsPrice ─────────────────────────────────────────────

test("resolveStandardPointsPrice returns currentStandard when present", () => {
  assert.equal(
    resolveStandardPointsPrice("40000", { standard_lowest_points_price: "50000" }, "60000"),
    "40000"
  );
});

test("resolveStandardPointsPrice falls back to history when no currentStandard", () => {
  assert.equal(
    resolveStandardPointsPrice("", { standard_lowest_points_price: "50000" }, "60000"),
    "50000"
  );
});

test("resolveStandardPointsPrice falls back to manual when no currentStandard and no history", () => {
  assert.equal(
    resolveStandardPointsPrice("", null, "60000"),
    "60000"
  );
});

test("resolveStandardPointsPrice returns empty string when nothing available", () => {
  assert.equal(resolveStandardPointsPrice("", null, ""), "");
});

// ── shouldAddToManualCsv ───────────────────────────────────────────────────

test("shouldAddToManualCsv returns true when Premium only, no history, not in CSV", () => {
  assert.equal(shouldAddToManualCsv("", null, null), true);
});

test("shouldAddToManualCsv returns false when Standard found this crawl", () => {
  assert.equal(shouldAddToManualCsv("40000", null, null), false);
});

test("shouldAddToManualCsv returns false when history exists", () => {
  assert.equal(shouldAddToManualCsv("", { standard_lowest_points_price: "50000" }, null), false);
});

test("shouldAddToManualCsv returns false when manual entry exists (blank or filled)", () => {
  assert.equal(shouldAddToManualCsv("", null, { standard_points: "" }), false);
  assert.equal(shouldAddToManualCsv("", null, { standard_points: "60000" }), false);
});
```

- [ ] **Step 3: Run tests — all must pass**

```bash
node --test data-pipeline/1-list/scripts/hilton-brands-points-persistence.test.mjs
```

Expected:
```
# tests 22
# pass 22
# fail 0
```

- [ ] **Step 4: Commit**

```bash
git add data-pipeline/1-list/scripts/hilton-brands-points-persistence.mjs data-pipeline/1-list/scripts/hilton-brands-points-persistence.test.mjs
git commit -m "feat: add Standard points persistence helpers (history JSON + manual CSV)"
```

---

## Task 2: Update buildHotelRecord to include standard_lowest_points_price

**Files:**
- Modify: `data-pipeline/1-list/scripts/hilton-brands.mjs`
- Modify: `data-pipeline/1-list/scripts/hilton-brands.test.mjs`

- [ ] **Step 1: Add the parameter to buildHotelRecord**

In `data-pipeline/1-list/scripts/hilton-brands.mjs`, replace the `buildHotelRecord` function signature and return value:

```js
export function buildHotelRecord(extractHotel, brand, collectedAt, standardLowestPointsPrice = "") {
  const address = extractHotel?.address ?? {};
  const coordinate = extractHotel?.localization?.coordinate ?? {};
  const lowestCash = extractHotel?.leadRate?.lowest ?? {};
  const hhonorsLead = extractHotel?.leadRate?.hhonors?.lead ?? {};
  const pointsTypeRaw = hhonorsLead?.ratePlan?.ratePlanName ?? "";

  const ctyhocn = (extractHotel?.ctyhocn ?? "").toLowerCase();
  const homeUrl = extractHotel?.facilityOverview?.homeUrlTemplate ?? "";

  return {
    source: SOURCE,
    source_hotel_id: ctyhocn,
    name: extractHotel?.name ?? "",
    address_raw: address.addressLine1 ?? "",
    city: address.city ?? "",
    state_region: address.stateName ?? "",
    country: address.countryName ?? "",
    url: normalizeHiltonHotelUrl(homeUrl) || `https://www.hilton.com/en/hotels/${ctyhocn}/`,
    plan: "",
    brand,
    chain: "Hilton",
    latitude: stringifyNumber(coordinate.latitude),
    longitude: stringifyNumber(coordinate.longitude),
    lowest_cash_price: stringifyNumber(lowestCash.rateAmount),
    lowest_cash_price_currency: extractHotel?.localization?.currencyCode ?? "",
    lowest_cash_price_display: lowestCash.rateAmountFmt ?? "",
    lowest_points_price: stringifyNumber(hhonorsLead.dailyRmPointsRate),
    points_reward_type: mapPointsRewardType(pointsTypeRaw),
    standard_lowest_points_price: standardLowestPointsPrice,
    collected_at: collectedAt
  };
}
```

- [ ] **Step 2: Update the tests to assert the new field**

In `data-pipeline/1-list/scripts/hilton-brands.test.mjs`, add `standard_lowest_points_price` assertions to the existing `buildHotelRecord` tests. Update the last two `buildHotelRecord` tests:

```js
test("buildHotelRecord maps points price and reward type", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.lowest_points_price, "40000");
  assert.equal(record.points_reward_type, "Standard Room Reward");
  assert.equal(record.standard_lowest_points_price, "");
});

test("buildHotelRecord stores empty strings for missing price fields", () => {
  const record = buildHotelRecord({ ctyhocn: "TESTCI", name: "Test" }, "Conrad Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.lowest_cash_price, "");
  assert.equal(record.lowest_points_price, "");
  assert.equal(record.points_reward_type, "");
  assert.equal(record.standard_lowest_points_price, "");
});

test("buildHotelRecord uses provided standardLowestPointsPrice", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z", "35000");
  assert.equal(record.standard_lowest_points_price, "35000");
});
```

- [ ] **Step 3: Run all tests — all must pass**

```bash
node --test data-pipeline/1-list/scripts/hilton-brands.test.mjs
```

Expected:
```
# tests 16
# pass 16
# fail 0
```

- [ ] **Step 4: Commit**

```bash
git add data-pipeline/1-list/scripts/hilton-brands.mjs data-pipeline/1-list/scripts/hilton-brands.test.mjs
git commit -m "feat: add standard_lowest_points_price field to buildHotelRecord"
```

---

## Task 3: Wire persistence into writeStageOneOutputs

**Files:**
- Modify: `data-pipeline/1-list/scripts/hilton-brands.mjs`

- [ ] **Step 1: Add imports and file URL constants**

At the top of `data-pipeline/1-list/scripts/hilton-brands.mjs`, replace the import line and add new constants:

```js
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  buildManualCsvRow,
  parseManualCsv,
  parsePointsHistory,
  resolveStandardPointsPrice,
  serializeManualCsv,
  serializePointsHistory,
  shouldAddToManualCsv,
  updatePointsHistory,
} from "./hilton-brands-points-persistence.mjs";
```

After the existing `OUTPUT_DIRECTORY_URL` constant, add:

```js
const HISTORY_FILE_URL = new URL("../hilton-brands-points-history.json", import.meta.url);
const MANUAL_CSV_FILE_URL = new URL("../hilton-brands-points-manual.csv", import.meta.url);
```

- [ ] **Step 2: Replace writeStageOneOutputs with the persistence-aware version**

Replace the entire `writeStageOneOutputs` function in `data-pipeline/1-list/scripts/hilton-brands.mjs`:

```js
export async function writeStageOneOutputs() {
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });
  const collectedAt = new Date().toISOString();
  const hotels = {};
  const sourceUrls = [];

  // Load persistence files
  const historyRaw = await readFileOptional(HISTORY_FILE_URL);
  const manualCsvRaw = await readFileOptional(MANUAL_CSV_FILE_URL);
  let history = parsePointsHistory(historyRaw);
  const manualMap = parseManualCsv(manualCsvRaw);

  const manualRowsToAdd = new Map();

  // Fetch each brand page to get its brandCode and the shared extract URL
  let extractUrl = "";
  const brandConfigs = [];

  for (const { slug, brand } of BRAND_SLUGS) {
    const pageUrl = `https://www.hilton.com/en/locations/${slug}/`;
    sourceUrls.push(pageUrl);
    console.log(`[hilton-brands] fetching ${pageUrl}`);

    const html = await fetchText(pageUrl);
    const nextData = extractNextData(html, slug);
    const brandCode = extractBrandCode(nextData);

    if (!brandCode) {
      throw new Error(`[hilton-brands] brandCode not found in __NEXT_DATA__ for slug: ${slug}`);
    }

    if (!extractUrl) {
      extractUrl = extractHotelSummaryExtractUrl(nextData);
      if (!extractUrl) {
        throw new Error(`[hilton-brands] hotelSummaryExtractUrl not found for slug: ${slug}`);
      }
    }

    brandConfigs.push({ brand, brandCode });
    console.log(`[hilton-brands] ${slug}: brandCode=${brandCode}`);
  }

  // Fetch the global extract once
  console.log(`[hilton-brands] fetching hotel extract`);
  const extract = await fetchJson(extractUrl);
  const extractHotels = Object.values(extract).filter(
    (h) => h && typeof h === "object"
  );

  // Filter and build records per brand
  for (const { brand, brandCode } of brandConfigs) {
    const brandHotels = extractHotels.filter((h) => h.brandCode === brandCode);
    console.log(`[hilton-brands] ${brand} (${brandCode}): ${brandHotels.length} hotels`);

    for (const extractHotel of brandHotels) {
      const ctyhocn = (extractHotel?.ctyhocn ?? "").toLowerCase();
      if (!ctyhocn) continue;

      // Determine if this crawl captured Standard pricing
      const hhonorsLead = extractHotel?.leadRate?.hhonors?.lead ?? {};
      const pointsType = mapPointsRewardType(hhonorsLead?.ratePlan?.ratePlanName ?? "");
      const currentStandard = pointsType === "Standard Room Reward"
        ? stringifyNumber(hhonorsLead.dailyRmPointsRate)
        : "";

      const historyEntry = history.hotels[ctyhocn] ?? null;
      const manualEntry = manualMap.get(ctyhocn) ?? null;
      const manualValue = manualEntry?.standard_points ?? "";

      const standardLowestPointsPrice = resolveStandardPointsPrice(
        currentStandard,
        historyEntry,
        manualValue
      );

      // Always overwrite history when Standard pricing found this run
      if (currentStandard) {
        history = updatePointsHistory(history, ctyhocn, currentStandard, collectedAt);
      }

      // Queue auto-add to manual CSV if Premium only, no history, not already in CSV
      if (shouldAddToManualCsv(currentStandard, historyEntry, manualEntry)) {
        manualRowsToAdd.set(
          ctyhocn,
          buildManualCsvRow(ctyhocn, extractHotel?.name ?? "")
        );
      }

      hotels[ctyhocn] = buildHotelRecord(extractHotel, brand, collectedAt, standardLowestPointsPrice);
    }
  }

  // Save updated history
  await writeFile(HISTORY_FILE_URL, serializePointsHistory(history, collectedAt), "utf8");

  // Append new rows to manual CSV (preserving existing entries)
  if (manualRowsToAdd.size > 0) {
    for (const [id, row] of manualRowsToAdd) {
      manualMap.set(id, { hotel_name: row.hotel_name, standard_points: "", notes: "" });
    }
    await writeFile(MANUAL_CSV_FILE_URL, serializeManualCsv(manualMap), "utf8");
    console.log(`[hilton-brands] auto-added ${manualRowsToAdd.size} hotels to manual CSV`);
  }

  const sortedHotels = Object.fromEntries(
    Object.entries(hotels).sort(([, a], [, b]) =>
      a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)
    )
  );

  const payload = {
    metadata: {
      stage: "1-list",
      source: SOURCE,
      generated_at: collectedAt,
      record_count: Object.keys(sortedHotels).length,
      source_urls: sourceUrls
    },
    hotels: sortedHotels
  };

  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[hilton-brands] wrote ${payload.metadata.record_count} hotels to ${OUTPUT_FILE_URL.pathname}`);
}
```

- [ ] **Step 3: Add the readFileOptional helper**

Add this private function near the bottom of `hilton-brands.mjs`, before `extractNextData`:

```js
async function readFileOptional(fileUrl) {
  try {
    return await readFile(fileUrl, "utf8");
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run both test suites — all must still pass**

```bash
node --test data-pipeline/1-list/scripts/hilton-brands.test.mjs && node --test data-pipeline/1-list/scripts/hilton-brands-points-persistence.test.mjs
```

Expected: 16 pass + 22 pass, 0 fail in both.

- [ ] **Step 5: Commit**

```bash
git add data-pipeline/1-list/scripts/hilton-brands.mjs
git commit -m "feat: wire Standard points persistence into Hilton brands crawler"
```

---

## Task 4: Run end-to-end and commit artifacts

- [ ] **Step 1: Run the crawler**

```bash
node scripts/crawl-hilton-brands.mjs
```

Expected output includes lines like:
```
[hilton-brands] fetching hotel extract
[hilton-brands] Small Luxury Hotels of the World (LX): 522 hotels
[hilton-brands] Waldorf Astoria Hotels & Resorts (WA): 44 hotels
[hilton-brands] LXR Hotels & Resorts (OL): 20 hotels
[hilton-brands] Conrad Hotels & Resorts (CH): 55 hotels
[hilton-brands] auto-added NNN hotels to manual CSV
[hilton-brands] wrote 641 hotels to .../hilton-brands-hotel.json
```

- [ ] **Step 2: Spot-check the output**

```bash
node --input-type=module <<'EOF'
import { readFile } from "node:fs/promises";
const data = JSON.parse(await readFile("data-pipeline/1-list/hilton-brands-hotel.json", "utf8"));
const hotels = Object.values(data.hotels);
const withStandard = hotels.filter(h => h.standard_lowest_points_price !== "");
const withoutStandard = hotels.filter(h => h.standard_lowest_points_price === "");
console.log("total:", data.metadata.record_count);
console.log("with standard_lowest_points_price:", withStandard.length);
console.log("without:", withoutStandard.length);
console.log("sample hotel:", JSON.stringify(hotels[0], null, 2));
EOF
```

Verify: `standard_lowest_points_price` field present on every hotel; majority have a non-empty value.

- [ ] **Step 3: Spot-check the history file**

```bash
node --input-type=module <<'EOF'
import { readFile } from "node:fs/promises";
const h = JSON.parse(await readFile("data-pipeline/1-list/hilton-brands-points-history.json", "utf8"));
const entries = Object.entries(h.hotels);
console.log("history entries:", entries.length);
console.log("sample entry:", entries[0]);
EOF
```

Verify: history contains entries only for hotels where Standard pricing was found.

- [ ] **Step 4: Spot-check the manual CSV**

```bash
head -5 data-pipeline/1-list/hilton-brands-points-manual.csv
wc -l data-pipeline/1-list/hilton-brands-points-manual.csv
```

Verify: header row is `source_hotel_id,hotel_name,standard_points,notes`; rows have blank `standard_points`; row count matches hotels with no Standard pricing.

- [ ] **Step 5: Commit all artifacts**

```bash
git add data-pipeline/1-list/hilton-brands-hotel.json data-pipeline/1-list/hilton-brands-points-history.json data-pipeline/1-list/hilton-brands-points-manual.csv
git commit -m "data: add Standard points history and manual CSV artifacts"
```
