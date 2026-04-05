import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { normalizeText } from "./shared/normalize.mjs";

const SOURCE = "iprefer_points";
const PLAN_NAME = "I Prefer Reward Nights";
const SOURCE_URL = "https://iprefer.com/search?rateType=IPPOINTS";
const API_URL = "https://ptgapis.com/property-search/v1?site=IPrefer";
const OUTPUT_DIRECTORY_URL = new URL("../", import.meta.url);
const OUTPUT_FILE_URL = new URL("../iprefer-points-hotel.json", import.meta.url);
const BATCH_SIZE = 20;

export async function collectHotels() {
  const catalogPayload = await fetchJson(API_URL);
  const catalogHotels = Object.values(catalogPayload.properties ?? {});
  const eligibleCodes = getEligibleCodes(catalogHotels);
  const hotels = [];

  for (const batchCodes of chunk(eligibleCodes, BATCH_SIZE)) {
    const batchPayload = await fetchJson(`${API_URL}&propertyCodes=${encodeURIComponent(batchCodes.join(","))}`);
    const batchHotels = Object.values(batchPayload.properties ?? {});

    for (const hotel of batchHotels) {
      if (!isPointsEligible(hotel)) {
        continue;
      }

      hotels.push(toStageOneHotel(hotel));
    }
  }

  return sortHotels(hotels);
}

export async function writeStageOneOutputs() {
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });

  console.log(`Fetching iPrefer points catalog from ${API_URL}`);
  const catalogPayload = await fetchJson(API_URL);
  const catalogHotels = Object.values(catalogPayload.properties ?? {});
  const eligibleCodes = getEligibleCodes(catalogHotels);
  const totalBatches = Math.ceil(eligibleCodes.length / BATCH_SIZE);
  const hotels = [];

  console.log(
    `Found ${catalogHotels.length} iPrefer hotels and ${eligibleCodes.length} points-eligible hotels across ${totalBatches} batches`
  );

  await persistHotels(hotels);

  for (const [index, batchCodes] of chunk(eligibleCodes, BATCH_SIZE).entries()) {
    const batchNumber = index + 1;
    console.log(
      `Fetching batch ${batchNumber}/${totalBatches} (${batchCodes.length} hotels): ${batchCodes[0]} -> ${batchCodes[batchCodes.length - 1]}`
    );

    const batchPayload = await fetchJson(`${API_URL}&propertyCodes=${encodeURIComponent(batchCodes.join(","))}`);
    const batchHotels = Object.values(batchPayload.properties ?? {});
    let addedInBatch = 0;

    for (const hotel of batchHotels) {
      if (!isPointsEligible(hotel)) {
        continue;
      }

      hotels.push(toStageOneHotel(hotel));
      addedInBatch += 1;
    }

    const sortedHotels = sortHotels(hotels);
    await persistHotels(sortedHotels);

    console.log(`Saved ${sortedHotels.length} hotels after batch ${batchNumber}/${totalBatches} (+${addedInBatch})`);
  }

  console.log(`Finished iPrefer points crawl. Final output: ${OUTPUT_FILE_URL.pathname}`);
}

function getEligibleCodes(catalogHotels) {
  return catalogHotels
    .filter(isPointsEligible)
    .map((hotel) => normalizeText(hotel.field_item_code))
    .filter(Boolean);
}

function sortHotels(hotels) {
  return [...hotels].sort((left, right) => {
    return (
      left.categoryTag.localeCompare(right.categoryTag) ||
      left.name.localeCompare(right.name) ||
      left.sourceHotelId.localeCompare(right.sourceHotelId)
    );
  });
}

async function persistHotels(hotels) {
  const generatedAt = new Date().toISOString();
  const payload = buildStagePayload(hotels, generatedAt);

  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "open-hotel-data crawler"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch iPrefer property data: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function isPointsEligible(hotel) {
  return hotel?.field_i_prefer_book_with_points === "1" || hotel?.field_i_prefer_points_with_cash === "1";
}

function toStageOneHotel(hotel) {
  const categoryTags = extractCategoryTags(hotel.field_preferred_collections);
  const points = extractPointsFromBuckets(hotel.field_private_offer_buckets);
  const url = normalizeHotelUrl(hotel.entity_url);

  return {
    source: SOURCE,
    sourceHotelId: normalizeText(hotel.field_item_code),
    nid: normalizeText(hotel.nid),
    synxisId: normalizeText(hotel.field_synxis_id),
    name: normalizeText(hotel.field_display_title),
    websiteUrl: url,
    chain: "Preferred Hotels & Resorts",
    brand: "Preferred Hotels & Resorts",
    city: normalizeText(hotel.field_address?.locality),
    stateRegion: normalizeText(hotel.field_state_name),
    country: normalizeText(hotel.field_country_name),
    tripadvisorKey: "",
    latitude: normalizeText(hotel.field_geolocation?.lat),
    longitude: normalizeText(hotel.field_geolocation?.lng),
    formattedAddress: formatAddress(hotel.field_address),
    geoProvider: "",
    geoConfidence: "",
    geoPlaceId: "",
    geoTypes: "",
    geoPartialMatch: "",
    geoStatus: "",
    points,
    categoryTag: categoryTags[0] ?? "",
    categoryTags,
    description: extractDescription(hotel.body),
    redemptionType: getRedemptionType(hotel),
    lastVerifiedAt: todayIsoDate()
  };
}

function buildStagePayload(hotels, generatedAt) {
  const entries = hotels.map((hotel) => ({
    source: hotel.source,
    source_hotel_id: hotel.sourceHotelId,
    nid: hotel.nid,
    synxis_id: hotel.synxisId,
    name: hotel.name,
    address_raw: hotel.formattedAddress,
    city: hotel.city,
    state_region: hotel.stateRegion,
    country: hotel.country,
    url: hotel.websiteUrl,
    plan: PLAN_NAME,
    brand: hotel.brand,
    chain: hotel.chain,
    latitude: hotel.latitude,
    longitude: hotel.longitude,
    points: hotel.points,
    category_tag: hotel.categoryTag,
    category_tags: hotel.categoryTags,
    description: hotel.description,
    redemption_type: hotel.redemptionType,
    collected_at: generatedAt
  }));

  return {
    metadata: {
      stage: "1-list",
      source: SOURCE,
      generated_at: generatedAt,
      record_count: entries.length,
      source_url: SOURCE_URL,
      api_url: API_URL
    },
    hotels: Object.fromEntries(entries.map((hotel) => [hotel.source_hotel_id, hotel]))
  };
}

function extractCategoryTags(collections) {
  if (!Array.isArray(collections)) {
    return [];
  }

  return collections
    .map((collection) => normalizeText(collection?.name))
    .filter(Boolean);
}

function extractPointsFromBuckets(buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return "";
  }

  const pointValues = buckets
    .map((bucket) => {
      const name = normalizeText(bucket?.name ?? "").toLowerCase();
      if (!name.includes("per night") || name.includes("cash")) {
        return null;
      }
      const match = name.match(/([\d,]+)\s*points/);
      if (!match) return null;
      return Number(match[1].replace(/,/g, ""));
    })
    .filter((v) => v !== null && Number.isFinite(v) && v > 0)
    .sort((left, right) => left - right);

  if (pointValues.length === 0) {
    return "";
  }

  const min = pointValues[0];
  const max = pointValues[pointValues.length - 1];
  return min === max ? String(min) : `${min}-${max}`;
}

function extractDescription(body) {
  const summary = normalizeText(body?.summary);
  const fullText = htmlToText(body?.value);

  return fullText || summary;
}

function htmlToText(value) {
  const text = String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ldquo;/gi, "\"")
    .replace(/&rdquo;/gi, "\"");

  return normalizeText(text);
}

function formatAddress(address) {
  if (!address || typeof address !== "object") {
    return "";
  }

  const parts = [
    normalizeText(address.address_line1),
    normalizeText(address.address_line2),
    normalizeText(address.locality),
    normalizeText(address.administrative_area),
    normalizeText(address.postal_code),
    normalizeText(address.country)
  ].filter(Boolean);

  return parts.join(", ");
}

function normalizeHotelUrl(value) {
  const raw = normalizeText(value);

  if (!raw) {
    return "";
  }

  try {
    const url = raw.startsWith("http") ? new URL(raw) : new URL(raw, "https://iprefer.com");
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function getRedemptionType(hotel) {
  const hasPoints = hotel?.field_i_prefer_book_with_points === "1";
  const hasPointsCash = hotel?.field_i_prefer_points_with_cash === "1";

  if (hasPoints && hasPointsCash) {
    return "points, points_plus_cash";
  }

  if (hasPoints) {
    return "points";
  }

  if (hasPointsCash) {
    return "points_plus_cash";
  }

  return "";
}

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  await writeStageOneOutputs();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
