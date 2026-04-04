import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SOURCE = "hilton_aspire_resort_credit";
const LIST_PAGE_URL = "https://www.hilton.com/en/locations/resorts/";
const INPUT_FILE_URL = new URL("../1-list/aspire-hotel.json", import.meta.url);
const OUTPUT_FILE_URL = new URL("./hilton-aspire-hotel.json", import.meta.url);
const OUTPUT_DIRECTORY_URL = new URL("./", import.meta.url);

export async function buildHiltonResortEnrichment() {
  const stageOneHotels = await readStageOneHotels();
  const { extractUrl, extractUpdatedAt } = await fetchResortListMetadata();
  const hotelSummaryExtract = await fetchHotelSummaryExtract(extractUrl);
  const extractLookup = buildExtractLookup(hotelSummaryExtract);
  const generatedAt = new Date().toISOString();

  let matchedCount = 0;
  const hotels = {};

  for (const hotel of Object.values(stageOneHotels)) {
    const { hotel: match, method } = findExtractMatch(extractLookup, hotel);
    if (match) {
      matchedCount += 1;
    }

    hotels[hotel.source_hotel_id] = buildEnrichmentRecord(hotel, match, method, generatedAt);
  }

  return {
    metadata: {
      stage: "2-enrichment",
      source: SOURCE,
      generated_at: generatedAt,
      record_count: Object.keys(hotels).length,
      matched_count: matchedCount,
      unmatched_count: Object.keys(hotels).length - matchedCount,
      source_url: LIST_PAGE_URL,
      extract_url: extractUrl,
      extract_last_modified: extractUpdatedAt
    },
    hotels
  };
}

export async function writeStageTwoOutputs() {
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });
  const payload = await buildHiltonResortEnrichment();
  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${payload.metadata.record_count} Hilton Stage 2 records to ${OUTPUT_FILE_URL.pathname} ` +
      `(${payload.metadata.matched_count} matched)`
  );
}

async function readStageOneHotels() {
  const raw = await readFile(INPUT_FILE_URL, "utf8");
  const payload = JSON.parse(raw);
  return payload.hotels ?? {};
}

async function fetchResortListMetadata() {
  const response = await fetch(LIST_PAGE_URL, {
    headers: {
      "user-agent": "open-hotel-data crawler"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Hilton resorts list page: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const nextData = extractNextData(html);
  const dehydratedQueries = nextData?.props?.pageProps?.dehydratedState?.queries ?? [];
  const geocodeQuery = dehydratedQueries.find(
    (query) => query?.queryKey?.[0]?.operationName === "hotelSummaryOptions_geocodePage"
  );

  const extractUrl = geocodeQuery?.state?.data?.geocodePage?.location?.hotelSummaryExtractUrl;

  if (!extractUrl) {
    throw new Error("Could not find Hilton hotel summary extract URL on the resorts list page.");
  }

  return {
    extractUrl,
    extractUpdatedAt: response.headers.get("last-modified") || ""
  };
}

async function fetchHotelSummaryExtract(extractUrl) {
  const response = await fetch(extractUrl, {
    headers: {
      "user-agent": "open-hotel-data crawler"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Hilton hotel summary extract: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);

  if (!match) {
    throw new Error("Could not find Hilton __NEXT_DATA__ payload.");
  }

  return JSON.parse(match[1]);
}

function buildExtractLookup(hotelSummaryExtract) {
  const byUrl = new Map();
  const byCode = new Map();
  const byName = new Map();
  const duplicateNames = new Set();

  for (const hotel of Object.values(hotelSummaryExtract)) {
    if (!hotel || typeof hotel !== "object") {
      continue;
    }

    const templateUrl = hotel?.facilityOverview?.homeUrlTemplate;
    const normalizedUrl = normalizeHiltonHotelUrl(templateUrl);

    if (!normalizedUrl) {
      if (hotel.ctyhocn) {
        byCode.set(hotel.ctyhocn, hotel);
      }
    } else {
      byUrl.set(normalizedUrl, hotel);
    }

    if (hotel.ctyhocn) {
      byCode.set(hotel.ctyhocn, hotel);
    }

    const normalizedName = normalizeHotelName(hotel.name);
    if (normalizedName) {
      if (byName.has(normalizedName)) {
        duplicateNames.add(normalizedName);
      } else {
        byName.set(normalizedName, hotel);
      }
    }
  }

  for (const duplicateName of duplicateNames) {
    byName.delete(duplicateName);
  }

  return { byUrl, byCode, byName };
}

function findExtractMatch(extractLookup, stageOneHotel) {
  const normalizedUrl = normalizeHiltonHotelUrl(stageOneHotel.url);
  if (normalizedUrl && extractLookup.byUrl.has(normalizedUrl)) {
    return { hotel: extractLookup.byUrl.get(normalizedUrl), method: "url" };
  }

  const code = extractHiltonCode(stageOneHotel.url) || extractHiltonCode(stageOneHotel.source_hotel_id);
  if (code && extractLookup.byCode.has(code)) {
    return { hotel: extractLookup.byCode.get(code), method: "ctyhocn" };
  }

  const normalizedName = normalizeHotelName(stageOneHotel.name);
  if (normalizedName && extractLookup.byName.has(normalizedName)) {
    return { hotel: extractLookup.byName.get(normalizedName), method: "name" };
  }

  return { hotel: null, method: "none" };
}

function buildEnrichmentRecord(stageOneHotel, extractHotel, matchMethod, enrichedAt) {
  const amenityIds = Array.isArray(extractHotel?.amenityIds) ? extractHotel.amenityIds : [];
  const address = extractHotel?.address ?? {};
  const coordinate = extractHotel?.localization?.coordinate ?? {};
  const leadRate = extractHotel?.leadRate?.lowest ?? {};
  const ratePlan = leadRate?.ratePlan ?? {};
  const display = extractHotel?.display ?? {};
  const masterImage = extractHotel?.images?.master?.ratios?.find((ratio) => ratio?.url)?.url ?? "";

  return {
    source_hotel_id: stageOneHotel.source_hotel_id,
    detail_url: extractHotel?.facilityOverview?.homeUrlTemplate ?? normalizeHiltonHotelUrl(stageOneHotel.url),
    detail_name: extractHotel?.name ?? stageOneHotel.name,
    detail_address: address.addressLine1 ?? "",
    detail_city: address.city ?? "",
    detail_state_region: address.stateName ?? "",
    detail_country: address.countryName ?? "",
    detail_country_code: address.country ?? "",
    detail_latitude: stringifyNumber(coordinate.latitude),
    detail_longitude: stringifyNumber(coordinate.longitude),
    phone_number: extractHotel?.contactInfo?.phoneNumber ?? "",
    amenity_ids: amenityIds,
    amenities: amenityIds.map(formatAmenityId),
    lowest_public_price: stringifyNumber(leadRate.rateAmount),
    lowest_public_price_display: leadRate.rateAmountFmt ?? "",
    price_currency: extractHotel?.localization?.currencyCode ?? "",
    rate_plan_code: leadRate.ratePlanCode ?? "",
    rate_plan_name: ratePlan.ratePlanName ?? "",
    rate_plan_description: ratePlan.ratePlanDesc ?? "",
    brand_code: extractHotel?.brandCode ?? "",
    ctyhocn: extractHotel?.ctyhocn ?? extractHiltonCode(stageOneHotel.url),
    opened_on: display.openDate ?? "",
    bookable: typeof display.resEnabled === "boolean" ? display.resEnabled : null,
    allow_adults_only:
      typeof extractHotel?.facilityOverview?.allowAdultsOnly === "boolean"
        ? extractHotel.facilityOverview.allowAdultsOnly
        : null,
    master_image_url: masterImage,
    matched_from_resorts_list: Boolean(extractHotel),
    match_method: matchMethod,
    enriched_at: enrichedAt
  };
}

function normalizeHiltonHotelUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/[a-z]{2}\/hotels\/([^/]+)/i);

    if (!match) {
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    }

    return `${url.origin}/en/hotels/${match[1].toLowerCase()}`;
  } catch {
    return "";
  }
}

function extractHiltonCode(value) {
  const normalizedUrl = normalizeHiltonHotelUrl(value);
  const match = normalizedUrl.match(/\/en\/hotels\/([a-z0-9]+)/i);
  return match ? match[1].toUpperCase() : "";
}

function normalizeHotelName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatAmenityId(value) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
}

function stringifyNumber(value) {
  return typeof value === "number" ? String(value) : "";
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeStageTwoOutputs();
}
