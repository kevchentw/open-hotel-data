# iPrefer Price Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch iPrefer monthly points and cash rate stats for canonical hotels and store them in the existing per-hotel price artifacts under a new `iprefer` field.

**Architecture:** A new standalone `fetch-iprefer.mjs` in `5-price/` reads `4-unique/hotel.json` (for hotels with `iprefer_synxis_id`) and `1-list/iprefer-points-hotel.json` (for `nid` lookup). For each hotel it makes two API calls to `ptgapis.com/rate-calendar/v2` (one for points, one for cash), aggregates results into monthly min/max/count stats, and merges a new top-level `iprefer` object into the existing `prices/{tripadvisor_id}.json` artifact.

**Tech Stack:** Node.js ESM, `node:fs/promises`, `node:test` + `node:assert/strict` for tests. No new dependencies.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `data-pipeline/5-price/fetch-iprefer.mjs` | Crawler: nid resolution, API fetch, monthly aggregation, artifact write |
| Create | `data-pipeline/5-price/fetch-iprefer.test.mjs` | Unit tests for all exported pure functions |
| Modify | `package.json` | Add `pipeline:stage5:iprefer` npm script |

---

### Task 1: Monthly aggregation — points

**Files:**
- Create: `data-pipeline/5-price/fetch-iprefer.mjs`
- Create: `data-pipeline/5-price/fetch-iprefer.test.mjs`

- [ ] **Step 1: Create the test file with a failing test for `aggregatePointsMonths`**

```js
// data-pipeline/5-price/fetch-iprefer.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePointsMonths } from "./fetch-iprefer.mjs";

test("aggregatePointsMonths groups available nights by month", () => {
  const results = {
    "2026-04-10": { is_available: true, has_inventory: true, allows_check_in: true, points: 50000 },
    "2026-04-11": { is_available: true, has_inventory: true, allows_check_in: true, points: 60000 },
    "2026-04-12": { is_available: false, has_inventory: true, allows_check_in: true, points: 40000 },
    "2026-05-01": { is_available: true, has_inventory: true, allows_check_in: true, points: 50000 }
  };
  assert.deepEqual(aggregatePointsMonths(results), {
    "2026-04": { points_min: "50000", points_max: "60000", points_available_nights: 2 },
    "2026-05": { points_min: "50000", points_max: "50000", points_available_nights: 1 }
  });
});

test("aggregatePointsMonths skips nights with zero or missing points", () => {
  const results = {
    "2026-04-10": { is_available: true, has_inventory: true, allows_check_in: true, points: 0 },
    "2026-04-11": { is_available: true, has_inventory: true, allows_check_in: true, points: 50000 }
  };
  assert.deepEqual(aggregatePointsMonths(results), {
    "2026-04": { points_min: "50000", points_max: "50000", points_available_nights: 1 }
  });
});

test("aggregatePointsMonths returns empty object for empty results", () => {
  assert.deepEqual(aggregatePointsMonths({}), {});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test data-pipeline/5-price/fetch-iprefer.test.mjs
```

Expected: error about missing module `./fetch-iprefer.mjs`

- [ ] **Step 3: Create `fetch-iprefer.mjs` with `aggregatePointsMonths`**

```js
// data-pipeline/5-price/fetch-iprefer.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const RATE_CALENDAR_BASE = "https://ptgapis.com/rate-calendar/v2";
const IPREFER_POINTS_INPUT_URL = new URL("../1-list/iprefer-points-hotel.json", import.meta.url);
const CANONICAL_INPUT_URL = new URL("../4-unique/hotel.json", import.meta.url);
const PRICE_DIRECTORY_URL = new URL("./prices/", import.meta.url);
const FORCE_REFRESH = parseBoolean(process.env.STAGE5_IPREFER_FORCE_REFRESH);
const DEFAULT_CONCURRENCY = 5;
const CONCURRENCY = parsePositiveInteger(process.env.STAGE5_IPREFER_CONCURRENCY, DEFAULT_CONCURRENCY);
const FILTER_HOTEL_IDS = getFilterHotelIds();

export function aggregatePointsMonths(results) {
  if (!isRecord(results)) {
    return {};
  }

  const byMonth = {};

  for (const [date, entry] of Object.entries(results)) {
    if (!isAvailableNight(entry)) {
      continue;
    }

    const points = Number.parseInt(String(entry.points ?? ""), 10);
    if (!Number.isFinite(points) || points <= 0) {
      continue;
    }

    const month = date.slice(0, 7);
    if (!byMonth[month]) {
      byMonth[month] = { min: points, max: points, count: 0 };
    } else {
      byMonth[month].min = Math.min(byMonth[month].min, points);
      byMonth[month].max = Math.max(byMonth[month].max, points);
    }

    byMonth[month].count += 1;
  }

  return sortObjectKeys(
    Object.fromEntries(
      Object.entries(byMonth).map(([month, { min, max, count }]) => [
        month,
        { points_min: String(min), points_max: String(max), points_available_nights: count }
      ])
    )
  );
}

// --- helpers (more functions added in later tasks) ---

function isAvailableNight(entry) {
  return Boolean(entry?.is_available) && Boolean(entry?.has_inventory) && Boolean(entry?.allows_check_in);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortObjectKeys(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

function parseBoolean(value) {
  return /^true$/iu.test(typeof value === "string" ? value.trim() : "");
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getFilterHotelIds() {
  const raw = typeof process.env.STAGE5_HOTEL_IDS === "string" ? process.env.STAGE5_HOTEL_IDS.trim() : "";
  return new Set(raw.split(",").map((v) => v.trim()).filter(Boolean));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test data-pipeline/5-price/fetch-iprefer.test.mjs
```

Expected: 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add data-pipeline/5-price/fetch-iprefer.mjs data-pipeline/5-price/fetch-iprefer.test.mjs
git commit -m "feat: add aggregatePointsMonths for iprefer crawler"
```

---

### Task 2: Monthly aggregation — cash

**Files:**
- Modify: `data-pipeline/5-price/fetch-iprefer.mjs`
- Modify: `data-pipeline/5-price/fetch-iprefer.test.mjs`

- [ ] **Step 1: Add failing tests for `aggregateCashMonths`**

Append to `fetch-iprefer.test.mjs`:

```js
import { aggregatePointsMonths, aggregateCashMonths } from "./fetch-iprefer.mjs";
```

Replace the import line at the top with the above, then append:

```js
test("aggregateCashMonths groups available nights by month using rate+tax", () => {
  const results = {
    "2026-04-10": { is_available: true, has_inventory: true, allows_check_in: true, rate: 168, tax: 33 },
    "2026-04-11": { is_available: true, has_inventory: true, allows_check_in: true, rate: 300, tax: 60 },
    "2026-04-12": { is_available: false, has_inventory: true, allows_check_in: true, rate: 100, tax: 20 },
    "2026-05-01": { is_available: true, has_inventory: true, allows_check_in: true, rate: 200, tax: 40 }
  };
  assert.deepEqual(aggregateCashMonths(results), {
    "2026-04": { cash_min: "201.00", cash_max: "360.00", cash_available_nights: 2 },
    "2026-05": { cash_min: "240.00", cash_max: "240.00", cash_available_nights: 1 }
  });
});

test("aggregateCashMonths skips nights where rate is zero or negative", () => {
  const results = {
    "2026-04-10": { is_available: true, has_inventory: true, allows_check_in: true, rate: 0, tax: 0 },
    "2026-04-11": { is_available: true, has_inventory: true, allows_check_in: true, rate: 200, tax: 40 }
  };
  assert.deepEqual(aggregateCashMonths(results), {
    "2026-04": { cash_min: "240.00", cash_max: "240.00", cash_available_nights: 1 }
  });
});

test("aggregateCashMonths returns empty object for empty results", () => {
  assert.deepEqual(aggregateCashMonths({}), {});
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
node --test data-pipeline/5-price/fetch-iprefer.test.mjs
```

Expected: 3 pass, 3 fail (aggregateCashMonths not yet exported)

- [ ] **Step 3: Add `aggregateCashMonths` to `fetch-iprefer.mjs`**

After the `aggregatePointsMonths` export, add:

```js
export function aggregateCashMonths(results) {
  if (!isRecord(results)) {
    return {};
  }

  const byMonth = {};

  for (const [date, entry] of Object.entries(results)) {
    if (!isAvailableNight(entry)) {
      continue;
    }

    const rate = Number.parseFloat(String(entry.rate ?? ""));
    const tax = Number.parseFloat(String(entry.tax ?? ""));
    if (!Number.isFinite(rate) || rate <= 0) {
      continue;
    }

    const total = rate + (Number.isFinite(tax) ? tax : 0);
    const month = date.slice(0, 7);

    if (!byMonth[month]) {
      byMonth[month] = { min: total, max: total, count: 0 };
    } else {
      byMonth[month].min = Math.min(byMonth[month].min, total);
      byMonth[month].max = Math.max(byMonth[month].max, total);
    }

    byMonth[month].count += 1;
  }

  return sortObjectKeys(
    Object.fromEntries(
      Object.entries(byMonth).map(([month, { min, max, count }]) => [
        month,
        {
          cash_min: min.toFixed(2),
          cash_max: max.toFixed(2),
          cash_available_nights: count
        }
      ])
    )
  );
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
node --test data-pipeline/5-price/fetch-iprefer.test.mjs
```

Expected: 6 passing tests

- [ ] **Step 5: Commit**

```bash
git add data-pipeline/5-price/fetch-iprefer.mjs data-pipeline/5-price/fetch-iprefer.test.mjs
git commit -m "feat: add aggregateCashMonths for iprefer crawler"
```

---

### Task 3: Merge monthly stats + skip logic

**Files:**
- Modify: `data-pipeline/5-price/fetch-iprefer.mjs`
- Modify: `data-pipeline/5-price/fetch-iprefer.test.mjs`

- [ ] **Step 1: Add failing tests for `buildMonthlyStats` and `shouldFetchIprefer`**

Update import at top of `fetch-iprefer.test.mjs`:

```js
import { aggregatePointsMonths, aggregateCashMonths, buildMonthlyStats, shouldFetchIprefer } from "./fetch-iprefer.mjs";
```

Append:

```js
test("buildMonthlyStats merges points and cash months, omits months with no data", () => {
  const pointsMonths = {
    "2026-04": { points_min: "50000", points_max: "60000", points_available_nights: 10 }
  };
  const cashMonths = {
    "2026-04": { cash_min: "168.00", cash_max: "522.00", cash_available_nights: 18 },
    "2026-05": { cash_min: "200.00", cash_max: "300.00", cash_available_nights: 12 }
  };
  assert.deepEqual(buildMonthlyStats(pointsMonths, cashMonths), {
    "2026-04": {
      cash_min: "168.00",
      cash_max: "522.00",
      cash_available_nights: 18,
      points_min: "50000",
      points_max: "60000",
      points_available_nights: 10
    },
    "2026-05": {
      cash_min: "200.00",
      cash_max: "300.00",
      cash_available_nights: 12
    }
  });
});

test("buildMonthlyStats returns empty object when both inputs are empty", () => {
  assert.deepEqual(buildMonthlyStats({}, {}), {});
});

test("shouldFetchIprefer returns true when artifact has no iprefer field", () => {
  assert.equal(shouldFetchIprefer({ prices: {} }, false), true);
});

test("shouldFetchIprefer returns false when iprefer already present and no force refresh", () => {
  assert.equal(shouldFetchIprefer({ iprefer: { months: {} } }, false), false);
});

test("shouldFetchIprefer returns true when force refresh is set even if iprefer exists", () => {
  assert.equal(shouldFetchIprefer({ iprefer: { months: {} } }, true), true);
});
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
node --test data-pipeline/5-price/fetch-iprefer.test.mjs
```

Expected: 6 pass, 5 fail

- [ ] **Step 3: Add `buildMonthlyStats` and `shouldFetchIprefer` to `fetch-iprefer.mjs`**

After `aggregateCashMonths`, add:

```js
export function buildMonthlyStats(pointsMonths, cashMonths) {
  const allMonths = new Set([...Object.keys(pointsMonths), ...Object.keys(cashMonths)]);
  if (!allMonths.size) {
    return {};
  }

  const merged = {};
  for (const month of [...allMonths].sort()) {
    const entry = {};
    const cash = cashMonths[month];
    const points = pointsMonths[month];

    if (cash) {
      entry.cash_min = cash.cash_min;
      entry.cash_max = cash.cash_max;
      entry.cash_available_nights = cash.cash_available_nights;
    }

    if (points) {
      entry.points_min = points.points_min;
      entry.points_max = points.points_max;
      entry.points_available_nights = points.points_available_nights;
    }

    merged[month] = sortObjectKeys(entry);
  }

  return merged;
}

export function shouldFetchIprefer(artifact, forceRefresh) {
  if (forceRefresh) {
    return true;
  }

  return !isRecord(artifact?.iprefer);
}
```

- [ ] **Step 4: Run all tests**

```bash
node --test data-pipeline/5-price/fetch-iprefer.test.mjs
```

Expected: 11 passing tests

- [ ] **Step 5: Commit**

```bash
git add data-pipeline/5-price/fetch-iprefer.mjs data-pipeline/5-price/fetch-iprefer.test.mjs
git commit -m "feat: add buildMonthlyStats and shouldFetchIprefer"
```

---

### Task 4: nid lookup

**Files:**
- Modify: `data-pipeline/5-price/fetch-iprefer.mjs`
- Modify: `data-pipeline/5-price/fetch-iprefer.test.mjs`

- [ ] **Step 1: Add failing test for `buildNidLookup`**

Update import at top of `fetch-iprefer.test.mjs`:

```js
import { aggregatePointsMonths, aggregateCashMonths, buildMonthlyStats, shouldFetchIprefer, buildNidLookup } from "./fetch-iprefer.mjs";
```

Append:

```js
test("buildNidLookup maps synxis_id to nid, skips entries missing either field", () => {
  const ipreferHotels = {
    "SINAM": { nid: "414821", synxis_id: "49391" },
    "ZPCVV": { nid: "306010", synxis_id: "NONE" },
    "NOSY1": { nid: "", synxis_id: "12345" },
    "NOSY2": { nid: "999", synxis_id: "" }
  };
  assert.deepEqual(
    buildNidLookup(ipreferHotels),
    new Map([
      ["49391", "414821"],
      ["NONE", "306010"]
    ])
  );
});

test("buildNidLookup returns empty map for empty input", () => {
  assert.deepEqual(buildNidLookup({}), new Map());
});
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
node --test data-pipeline/5-price/fetch-iprefer.test.mjs
```

Expected: 11 pass, 2 fail

- [ ] **Step 3: Add `buildNidLookup` to `fetch-iprefer.mjs`**

After `shouldFetchIprefer`, add:

```js
export function buildNidLookup(ipreferHotels) {
  const map = new Map();

  for (const hotel of Object.values(ipreferHotels)) {
    const nid = typeof hotel?.nid === "string" ? hotel.nid.trim() : "";
    const synxisId = typeof hotel?.synxis_id === "string" ? hotel.synxis_id.trim() : "";
    if (nid && synxisId) {
      map.set(synxisId, nid);
    }
  }

  return map;
}
```

- [ ] **Step 4: Run all tests**

```bash
node --test data-pipeline/5-price/fetch-iprefer.test.mjs
```

Expected: 13 passing tests

- [ ] **Step 5: Commit**

```bash
git add data-pipeline/5-price/fetch-iprefer.mjs data-pipeline/5-price/fetch-iprefer.test.mjs
git commit -m "feat: add buildNidLookup for iprefer nid resolution"
```

---

### Task 5: HTTP fetch + orchestration

**Files:**
- Modify: `data-pipeline/5-price/fetch-iprefer.mjs`

- [ ] **Step 1: Add `fetchRateCalendar` (internal) and `fetchIpreferRates` (internal) to `fetch-iprefer.mjs`**

After `buildNidLookup`, add:

```js
async function fetchRateCalendar(nid, rateCode) {
  const url = new URL(RATE_CALENDAR_BASE);
  url.searchParams.set("nid", nid);
  url.searchParams.set("adults", "2");
  url.searchParams.set("children", "0");
  if (rateCode) {
    url.searchParams.set("rateCode", rateCode);
  }

  const response = await fetch(url, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`iPrefer rate calendar fetch failed: HTTP ${response.status} for nid=${nid}`);
  }

  const payload = await response.json();
  return isRecord(payload?.results) ? payload.results : {};
}

async function fetchIpreferRates(nid) {
  const [pointsResults, cashResults] = await Promise.all([
    fetchRateCalendar(nid, "IPPOINTS"),
    fetchRateCalendar(nid, null)
  ]);

  const pointsMonths = aggregatePointsMonths(pointsResults);
  const cashMonths = aggregateCashMonths(cashResults);
  const months = buildMonthlyStats(pointsMonths, cashMonths);

  if (!Object.keys(months).length) {
    return null;
  }

  return sortObjectKeys({
    currency: "USD",
    fetched_at: new Date().toISOString(),
    months
  });
}
```

- [ ] **Step 2: Add `writeIpreferArtifacts` orchestration to `fetch-iprefer.mjs`**

After `fetchIpreferRates`, add:

```js
export async function writeIpreferArtifacts() {
  await mkdir(PRICE_DIRECTORY_URL, { recursive: true });

  const [canonicalRegistry, ipreferPointsPayload] = await Promise.all([
    readJsonRequired(CANONICAL_INPUT_URL),
    readJsonRequired(IPREFER_POINTS_INPUT_URL)
  ]);

  const nidLookup = buildNidLookup(ipreferPointsPayload.hotels ?? {});
  const hotels = Object.entries(canonicalRegistry.hotels)
    .filter(([tripadvisorId, hotel]) => {
      if (FILTER_HOTEL_IDS.size && !FILTER_HOTEL_IDS.has(tripadvisorId)) {
        return false;
      }

      return typeof hotel?.iprefer_synxis_id === "string" && hotel.iprefer_synxis_id.trim();
    })
    .sort(([left], [right]) => left.localeCompare(right));

  console.log(`[iprefer] processing ${hotels.length} hotels with iprefer_synxis_id`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let noData = 0;

  await mapWithConcurrency(hotels, CONCURRENCY, async ([tripadvisorId, hotel]) => {
    const synxisId = hotel.iprefer_synxis_id.trim();
    const nid = nidLookup.get(synxisId);

    if (!nid) {
      console.warn(`[iprefer] no nid found for ${tripadvisorId} (synxis_id=${synxisId}), skipping`);
      skipped += 1;
      return;
    }

    const artifactUrl = new URL(`${tripadvisorId}.json`, PRICE_DIRECTORY_URL);
    const existing = await readJsonOptional(artifactUrl);

    if (!shouldFetchIprefer(existing, FORCE_REFRESH)) {
      skipped += 1;
      return;
    }

    try {
      const ipreferData = await fetchIpreferRates(nid);

      if (!ipreferData) {
        console.warn(`[iprefer] no data returned for ${tripadvisorId} (nid=${nid})`);
        noData += 1;
        return;
      }

      const updated = sortObjectKeys({ ...(existing ?? {}), iprefer: ipreferData, metadata: buildMetadata(tripadvisorId, existing) });
      await writeFile(artifactUrl, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
      fetched += 1;
      console.log(`[iprefer] ${tripadvisorId} months=${Object.keys(ipreferData.months).length}`);
    } catch (error) {
      console.warn(`[iprefer] fetch failed for ${tripadvisorId}: ${error.message}`);
      failed += 1;
    }
  });

  console.log(`[iprefer] done: fetched=${fetched} skipped=${skipped} no_data=${noData} failed=${failed}`);
}

function buildMetadata(tripadvisorId, existing) {
  return sortObjectKeys({
    ...(isRecord(existing?.metadata) ? existing.metadata : {}),
    generated_at: new Date().toISOString(),
    stage: "5-price",
    tripadvisor_id: tripadvisorId
  });
}

async function readJsonRequired(url) {
  const raw = await readFile(url, "utf8");
  return JSON.parse(raw);
}

async function readJsonOptional(url) {
  try {
    const raw = await readFile(url, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, values.length || 1)) }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await mapper(values[currentIndex], currentIndex);
      }
    })
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeIpreferArtifacts().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 3: Run existing tests to confirm nothing broken**

```bash
node --test data-pipeline/5-price/fetch-iprefer.test.mjs
```

Expected: 13 passing tests

- [ ] **Step 4: Commit**

```bash
git add data-pipeline/5-price/fetch-iprefer.mjs
git commit -m "feat: add fetchIpreferRates and writeIpreferArtifacts orchestration"
```

---

### Task 6: npm script + smoke test

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add npm script to `package.json`**

In `package.json`, in the `"scripts"` block, add after `"pipeline:stage5:price"`:

```json
"pipeline:stage5:iprefer": "node data-pipeline/5-price/fetch-iprefer.mjs",
```

- [ ] **Step 2: Smoke test against one hotel**

Pick a hotel ID that has `iprefer_synxis_id` — e.g. find one:

```bash
node --input-type=module <<'EOF'
import { readFileSync } from "node:fs";
const h = JSON.parse(readFileSync("data-pipeline/4-unique/hotel.json", "utf8"));
const entry = Object.entries(h.hotels).find(([, v]) => v.iprefer_synxis_id);
console.log(entry[0], entry[1].iprefer_synxis_id);
EOF
```

Run the crawler scoped to that hotel:

```bash
STAGE5_HOTEL_IDS=<tripadvisor_id_from_above> node data-pipeline/5-price/fetch-iprefer.mjs
```

Expected output:
```
[iprefer] processing 1 hotels with iprefer_synxis_id
[iprefer] <id> months=<N>
[iprefer] done: fetched=1 skipped=0 no_data=0 failed=0
```

Check the output artifact:

```bash
node --input-type=module <<'EOF'
import { readFileSync } from "node:fs";
const f = JSON.parse(readFileSync("data-pipeline/5-price/prices/<id>.json", "utf8"));
console.log(JSON.stringify(f.iprefer, null, 2));
EOF
```

Expected: `iprefer` object with `currency`, `fetched_at`, and `months` keyed by `YYYY-MM`.

- [ ] **Step 3: Run full test suite one final time**

```bash
node --test data-pipeline/5-price/fetch-iprefer.test.mjs
node --test data-pipeline/5-price/fetch.test.mjs
```

Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add package.json data-pipeline/5-price/prices/
git commit -m "feat: add pipeline:stage5:iprefer npm script and smoke test artifact"
```
