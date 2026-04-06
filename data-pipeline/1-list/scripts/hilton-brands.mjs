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

const SOURCE = "hilton_brands";
const OUTPUT_FILE_URL = new URL("../hilton-brands-hotel.json", import.meta.url);
const OUTPUT_DIRECTORY_URL = new URL("../", import.meta.url);
const HISTORY_FILE_URL = new URL("../hilton-brands-points-history.json", import.meta.url);
const MANUAL_CSV_FILE_URL = new URL("../hilton-brands-points-manual.csv", import.meta.url);

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

export function extractBrandCode(nextData) {
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries ?? [];
  const geocodeQuery = queries.find(
    (q) => q?.queryKey?.[0]?.operationName === "hotelSummaryOptions_geocodePage"
  );
  return geocodeQuery?.state?.data?.geocodePage?.location?.brandCode ?? "";
}

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

  // Filter, resolve persistence, and build records per brand
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
        manualRowsToAdd.set(ctyhocn, buildManualCsvRow(ctyhocn, extractHotel?.name ?? ""));
      }

      hotels[ctyhocn] = buildHotelRecord(extractHotel, brand, collectedAt, standardLowestPointsPrice);
    }
  }

  // Save updated history
  await writeFile(HISTORY_FILE_URL, serializePointsHistory(history, collectedAt), "utf8");

  // Append new rows to manual CSV (only hotels not already present)
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

async function readFileOptional(fileUrl) {
  try {
    return await readFile(fileUrl, "utf8");
  } catch {
    return "";
  }
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
