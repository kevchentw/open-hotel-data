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

// --- helpers ---

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
