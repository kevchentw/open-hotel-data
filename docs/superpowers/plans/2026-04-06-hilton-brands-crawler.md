# Hilton Brands Stage-1 Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stage-1 crawler that fetches hotel lists and cash/points prices from four Hilton brand list pages (SLH, Waldorf Astoria, LXR, Conrad) into a single `hilton-brands-hotel.json` artifact.

**Architecture:** Each brand page embeds a `__NEXT_DATA__` JSON blob that contains a `hotelSummaryExtractUrl`; fetching that URL returns a hotel map with identity, address, coordinates, and lead rates (cash and points). A single stage-1 script fetches all four brands, merges them by `ctyhocn`, and writes the combined file. Pure helper functions are unit-tested with Node's built-in test runner; network calls are not mocked.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, `node:fs/promises`

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `data-pipeline/1-list/scripts/hilton-brands.mjs` | Create | Brand config, network fetching, parsing, record building, file writing |
| `data-pipeline/1-list/scripts/hilton-brands.test.mjs` | Create | Unit tests for pure functions |
| `data-pipeline/1-list/hilton-brands-hotel.json` | Generated | Stage-1 artifact (not committed) |
| `scripts/crawl-hilton-brands.mjs` | Create | Top-level runner (mirrors crawl-hilton-aspire-hotels.mjs) |
| `package.json` | Modify | Add `pipeline:stage1:hilton-brands` and `crawl:hilton-brands` npm scripts |

---

## Task 1: Discover live extract field paths for points pricing

No code changes — this is a live data inspection step to confirm the points fields before writing tests that depend on them.

**Files:** none

- [ ] **Step 1: Run the inspection snippet**

Run this one-off command to fetch the SLH page and print the first hotel's `leadRate` object:

```bash
node --input-type=module <<'EOF'
const html = await fetch("https://www.hilton.com/en/locations/small-luxury-hotels-slh/", {
  headers: { "user-agent": "open-hotel-data crawler" }
}).then(r => r.text());

const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
const nextData = JSON.parse(m[1]);
const queries = nextData?.props?.pageProps?.dehydratedState?.queries ?? [];
const geocodeQuery = queries.find(q => q?.queryKey?.[0]?.operationName === "hotelSummaryOptions_geocodePage");
const extractUrl = geocodeQuery?.state?.data?.geocodePage?.location?.hotelSummaryExtractUrl;
console.log("extractUrl:", extractUrl);

const extract = await fetch(extractUrl, { headers: { "user-agent": "open-hotel-data crawler" } }).then(r => r.json());
const firstHotel = Object.values(extract)[0];
console.log("leadRate:", JSON.stringify(firstHotel?.leadRate, null, 2));
EOF
```

- [ ] **Step 2: Record findings**

Note the exact field paths for:
- Points amount (likely `leadRate.lowestPoints.rateAmount` or similar)
- Points reward type label (the string that maps to "Standard Room Reward" / "Premium Room Rewards")

You will use these exact paths in Task 2 when writing `buildHotelRecord` and `mapPointsRewardType`.

---

## Task 2: Create the module with pure helpers and tests

Write all pure (non-network) functions first with tests, then implement them to pass.

**Files:**
- Create: `data-pipeline/1-list/scripts/hilton-brands.mjs`
- Create: `data-pipeline/1-list/scripts/hilton-brands.test.mjs`

- [ ] **Step 1: Create the module skeleton**

Create `data-pipeline/1-list/scripts/hilton-brands.mjs` with the brand config and exported stubs that tests will call. Replace `POINTS_AMOUNT_PATH` and `POINTS_TYPE_PATH` with the actual field paths you found in Task 1.

```js
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SOURCE = "hilton_brands";
const OUTPUT_FILE_URL = new URL("../hilton-brands-hotel.json", import.meta.url);
const OUTPUT_DIRECTORY_URL = new URL("../", import.meta.url);

const BRAND_SLUGS = [
  { slug: "small-luxury-hotels-slh",  brand: "Small Luxury Hotels of the World" },
  { slug: "waldorf-astoria",          brand: "Waldorf Astoria Hotels & Resorts" },
  { slug: "lxr-hotels",              brand: "LXR Hotels & Resorts" },
  { slug: "conrad-hotels",           brand: "Conrad Hotels & Resorts" },
];

export function extractHotelSummaryExtractUrl(nextData) {
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries ?? [];
  const geocodeQuery = queries.find(
    (q) => q?.queryKey?.[0]?.operationName === "hotelSummaryOptions_geocodePage"
  );
  return geocodeQuery?.state?.data?.geocodePage?.location?.hotelSummaryExtractUrl ?? "";
}

export function buildHotelRecord(extractHotel, brand, collectedAt) {
  const address = extractHotel?.address ?? {};
  const coordinate = extractHotel?.localization?.coordinate ?? {};
  const lowestCash = extractHotel?.leadRate?.lowest ?? {};
  // NOTE: replace the two lines below with actual paths found in Task 1
  const lowestPoints = extractHotel?.leadRate?.lowestPoints ?? {};
  const pointsTypeRaw = lowestPoints?.ratePlan?.ratePlanName ?? "";

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
    lowest_points_price: stringifyNumber(lowestPoints.rateAmount),
    points_reward_type: mapPointsRewardType(pointsTypeRaw),
    collected_at: collectedAt
  };
}

export function mapPointsRewardType(raw) {
  const normalized = String(raw ?? "").toLowerCase();
  if (normalized.includes("standard")) return "Standard Room Reward";
  if (normalized.includes("premium")) return "Premium Room Rewards";
  return "";
}

export function normalizeHiltonHotelUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/[a-z]{2}\/hotels\/([^/]+)/i);
    if (!match) return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    return `${url.origin}/en/hotels/${match[1].toLowerCase()}`;
  } catch {
    return "";
  }
}

function stringifyNumber(value) {
  return typeof value === "number" ? String(value) : "";
}

export async function writeStageOneOutputs() {
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });
  const collectedAt = new Date().toISOString();
  const hotels = {};
  const sourceUrls = [];

  for (const { slug, brand } of BRAND_SLUGS) {
    const pageUrl = `https://www.hilton.com/en/locations/${slug}/`;
    sourceUrls.push(pageUrl);
    console.log(`[hilton-brands] fetching ${pageUrl}`);

    const html = await fetchText(pageUrl);
    const nextData = extractNextData(html, slug);
    const extractUrl = extractHotelSummaryExtractUrl(nextData);

    if (!extractUrl) {
      throw new Error(`[hilton-brands] hotelSummaryExtractUrl not found for slug: ${slug}`);
    }

    console.log(`[hilton-brands] fetching extract for ${slug}`);
    const extract = await fetchJson(extractUrl);

    for (const extractHotel of Object.values(extract)) {
      if (!extractHotel || typeof extractHotel !== "object") continue;
      const record = buildHotelRecord(extractHotel, brand, collectedAt);
      if (!record.source_hotel_id) continue;

      if (hotels[record.source_hotel_id]) {
        console.warn(`[hilton-brands] duplicate ctyhocn ${record.source_hotel_id} (${brand}), overwriting`);
      }
      hotels[record.source_hotel_id] = record;
    }
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

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "open-hotel-data crawler" } });
  if (!response.ok) throw new Error(`[hilton-brands] fetch failed ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "user-agent": "open-hotel-data crawler" } });
  if (!response.ok) throw new Error(`[hilton-brands] fetch failed ${url}: ${response.status} ${response.statusText}`);
  return response.json();
}

function extractNextData(html, slug) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`[hilton-brands] __NEXT_DATA__ not found on page for slug: ${slug}`);
  return JSON.parse(match[1]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeStageOneOutputs().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: Write tests**

Create `data-pipeline/1-list/scripts/hilton-brands.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHotelRecord,
  extractHotelSummaryExtractUrl,
  mapPointsRewardType,
  normalizeHiltonHotelUrl,
} from "./hilton-brands.mjs";

// ── extractHotelSummaryExtractUrl ──────────────────────────────────────────

test("extractHotelSummaryExtractUrl returns URL from valid __NEXT_DATA__", () => {
  const nextData = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            {
              queryKey: [{ operationName: "hotelSummaryOptions_geocodePage" }],
              state: {
                data: {
                  geocodePage: {
                    location: { hotelSummaryExtractUrl: "https://cdn.hilton.com/extract.json" }
                  }
                }
              }
            }
          ]
        }
      }
    }
  };
  assert.equal(extractHotelSummaryExtractUrl(nextData), "https://cdn.hilton.com/extract.json");
});

test("extractHotelSummaryExtractUrl returns empty string when query is missing", () => {
  assert.equal(extractHotelSummaryExtractUrl({}), "");
});

test("extractHotelSummaryExtractUrl returns empty string when operationName does not match", () => {
  const nextData = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            { queryKey: [{ operationName: "somethingElse" }], state: { data: {} } }
          ]
        }
      }
    }
  };
  assert.equal(extractHotelSummaryExtractUrl(nextData), "");
});

// ── mapPointsRewardType ────────────────────────────────────────────────────

test("mapPointsRewardType maps 'Standard Room Reward' variants", () => {
  assert.equal(mapPointsRewardType("Standard Room Reward"), "Standard Room Reward");
  assert.equal(mapPointsRewardType("STANDARD room reward"), "Standard Room Reward");
});

test("mapPointsRewardType maps 'Premium Room Rewards' variants", () => {
  assert.equal(mapPointsRewardType("Premium Room Rewards"), "Premium Room Rewards");
  assert.equal(mapPointsRewardType("PREMIUM ROOM REWARDS"), "Premium Room Rewards");
});

test("mapPointsRewardType returns empty string for unknown values", () => {
  assert.equal(mapPointsRewardType(""), "");
  assert.equal(mapPointsRewardType(null), "");
  assert.equal(mapPointsRewardType("Flex Rate"), "");
});

// ── normalizeHiltonHotelUrl ────────────────────────────────────────────────

test("normalizeHiltonHotelUrl converts locale prefix to /en/", () => {
  assert.equal(
    normalizeHiltonHotelUrl("https://www.hilton.com/fr/hotels/lonlxwa-lxr-test/"),
    "https://www.hilton.com/en/hotels/lonlxwa-lxr-test"
  );
});

test("normalizeHiltonHotelUrl returns empty string for empty input", () => {
  assert.equal(normalizeHiltonHotelUrl(""), "");
  assert.equal(normalizeHiltonHotelUrl(null), "");
});

// ── buildHotelRecord ───────────────────────────────────────────────────────

const MOCK_EXTRACT_HOTEL = {
  ctyhocn: "LONLXWA",
  name: "LXR Test Hotel",
  address: {
    addressLine1: "1 Test Street",
    city: "London",
    stateName: "",
    countryName: "United Kingdom"
  },
  localization: {
    coordinate: { latitude: 51.5, longitude: -0.1 },
    currencyCode: "GBP"
  },
  facilityOverview: {
    homeUrlTemplate: "https://www.hilton.com/en/hotels/lonlxwa-lxr-test/"
  },
  leadRate: {
    lowest: { rateAmount: 300, rateAmountFmt: "£300" },
    // NOTE: update lowestPoints path if Task 1 reveals a different structure
    lowestPoints: { rateAmount: 40000, ratePlan: { ratePlanName: "Standard Room Reward" } }
  }
};

test("buildHotelRecord sets required stage-1 fields", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.source, "hilton_brands");
  assert.equal(record.source_hotel_id, "lonlxwa");
  assert.equal(record.name, "LXR Test Hotel");
  assert.equal(record.chain, "Hilton");
  assert.equal(record.brand, "LXR Hotels & Resorts");
  assert.equal(record.plan, "");
  assert.equal(record.collected_at, "2026-04-06T00:00:00.000Z");
});

test("buildHotelRecord maps address and coordinates", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.address_raw, "1 Test Street");
  assert.equal(record.city, "London");
  assert.equal(record.country, "United Kingdom");
  assert.equal(record.latitude, "51.5");
  assert.equal(record.longitude, "-0.1");
});

test("buildHotelRecord maps cash price fields", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.lowest_cash_price, "300");
  assert.equal(record.lowest_cash_price_currency, "GBP");
  assert.equal(record.lowest_cash_price_display, "£300");
});

test("buildHotelRecord maps points price and reward type", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.lowest_points_price, "40000");
  assert.equal(record.points_reward_type, "Standard Room Reward");
});

test("buildHotelRecord stores empty strings for missing price fields", () => {
  const record = buildHotelRecord({ ctyhocn: "TESTCI", name: "Test" }, "Conrad Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.lowest_cash_price, "");
  assert.equal(record.lowest_points_price, "");
  assert.equal(record.points_reward_type, "");
});
```

- [ ] **Step 3: Run tests — expect failures**

```bash
node --test data-pipeline/1-list/scripts/hilton-brands.test.mjs
```

Expected: tests run and some may pass immediately (normalizeHiltonHotelUrl, mapPointsRewardType), others may fail if the module skeleton has issues. Fix any import errors before continuing.

- [ ] **Step 4: Adjust `buildHotelRecord` points paths if Task 1 revealed different field paths**

If the actual points fields in the live extract differ from `leadRate.lowestPoints.rateAmount` / `leadRate.lowestPoints.ratePlan.ratePlanName`, update both the implementation in `hilton-brands.mjs` and the `MOCK_EXTRACT_HOTEL` in the test file to match the real structure. Keep the two in sync.

- [ ] **Step 5: Run tests — all must pass**

```bash
node --test data-pipeline/1-list/scripts/hilton-brands.test.mjs
```

Expected output:
```
# tests 13
# pass 13
# fail 0
```

- [ ] **Step 6: Commit**

```bash
git add data-pipeline/1-list/scripts/hilton-brands.mjs data-pipeline/1-list/scripts/hilton-brands.test.mjs
git commit -m "feat: add Hilton brands stage-1 crawler with cash and points pricing"
```

---

## Task 3: Create the runner script and add npm scripts

**Files:**
- Create: `scripts/crawl-hilton-brands.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create the runner script**

Create `scripts/crawl-hilton-brands.mjs`:

```js
import { writeStageOneOutputs } from "../data-pipeline/1-list/scripts/hilton-brands.mjs";

writeStageOneOutputs().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add npm scripts to package.json**

In `package.json`, add inside the `"scripts"` object after `"pipeline:stage1:iprefer"`:

```json
"pipeline:stage1:hilton-brands": "node data-pipeline/1-list/scripts/hilton-brands.mjs",
```

And after `"crawl:hilton-aspire"`:

```json
"crawl:hilton-brands": "node scripts/crawl-hilton-brands.mjs",
```

- [ ] **Step 3: Run the crawler end-to-end**

```bash
node scripts/crawl-hilton-brands.mjs
```

Expected output (counts will vary):
```
[hilton-brands] fetching https://www.hilton.com/en/locations/small-luxury-hotels-slh/
[hilton-brands] fetching extract for small-luxury-hotels-slh
[hilton-brands] fetching https://www.hilton.com/en/locations/waldorf-astoria/
[hilton-brands] fetching extract for waldorf-astoria
[hilton-brands] fetching https://www.hilton.com/en/locations/lxr-hotels/
[hilton-brands] fetching extract for lxr-hotels
[hilton-brands] fetching https://www.hilton.com/en/locations/conrad-hotels/
[hilton-brands] fetching extract for conrad-hotels
[hilton-brands] wrote NNN hotels to .../data-pipeline/1-list/hilton-brands-hotel.json
```

- [ ] **Step 4: Spot-check the output**

```bash
node --input-type=module <<'EOF'
import { readFile } from "node:fs/promises";
const data = JSON.parse(await readFile("data-pipeline/1-list/hilton-brands-hotel.json", "utf8"));
console.log("record_count:", data.metadata.record_count);
const hotels = Object.values(data.hotels);
const withCash = hotels.filter(h => h.lowest_cash_price !== "");
const withPoints = hotels.filter(h => h.lowest_points_price !== "");
const standard = hotels.filter(h => h.points_reward_type === "Standard Room Reward");
const premium = hotels.filter(h => h.points_reward_type === "Premium Room Rewards");
console.log("with cash price:", withCash.length);
console.log("with points price:", withPoints.length);
console.log("Standard Room Reward:", standard.length);
console.log("Premium Room Rewards:", premium.length);
console.log("brands:", [...new Set(hotels.map(h => h.brand))]);
console.log("sample hotel:", JSON.stringify(hotels[0], null, 2));
EOF
```

Verify: all 4 brands appear, cash/points counts are non-zero, the sample hotel has expected fields.

- [ ] **Step 5: Commit**

```bash
git add scripts/crawl-hilton-brands.mjs package.json
git commit -m "feat: add crawl:hilton-brands npm script and runner"
```

---

## Task 4: Add hilton-brands-hotel.json to .gitignore (if not already covered)

Generated artifacts should not be committed unless that is the project convention.

**Files:** `.gitignore` (check first)

- [ ] **Step 1: Check existing .gitignore**

```bash
cat .gitignore
```

Check whether `data-pipeline/1-list/*.json` or similar patterns already exclude generated JSON. Look at what other stage-1 JSON files are in git:

```bash
git ls-files data-pipeline/1-list/*.json
```

- [ ] **Step 2: Match the convention**

If other stage-1 JSON files (e.g. `aspire-hotel.json`) are tracked in git, commit `hilton-brands-hotel.json` too:

```bash
git add data-pipeline/1-list/hilton-brands-hotel.json
git commit -m "data: add initial hilton-brands-hotel.json stage-1 artifact"
```

If they are ignored, ensure `hilton-brands-hotel.json` is also ignored (no action needed if already covered by a pattern).
