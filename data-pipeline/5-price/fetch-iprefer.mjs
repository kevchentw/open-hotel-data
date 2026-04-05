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
