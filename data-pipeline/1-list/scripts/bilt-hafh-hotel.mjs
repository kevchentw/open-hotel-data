import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeText } from "./shared/normalize.mjs";

const SOURCE = "bilt_hafh";
const PLAN_NAME = "Bilt Home Away From Home";
const SOURCE_URL = "https://www.nextcard.com/tools/bilt-hafh-hotel-map?view=list";
const API_URL = "https://www.nextcard.com/api/rpc/hotel/searchViewport/__batch__";
const OUTPUT_FILE_URL = new URL("../bilt-hafh-hotel.json", import.meta.url);
const OUTPUT_DIRECTORY_URL = new URL("../", import.meta.url);

export async function collectHotels() {
  const rawHotels = await fetchAllHotels();

  return rawHotels
    .filter((h) => h.name && h.sourceHotelId)
    .map(toNormalizedRecord)
    .sort((a, b) => a.country.localeCompare(b.country) || a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
}

async function fetchAllHotels() {
  const requestBody = JSON.stringify([
    {
      body: {
        json: {
          bounds: { north: 85, south: -85, east: 180, west: -180 },
          sources: ["bilt-hafh"]
        }
      },
      url: "https://www.nextcard.com/api/rpc/hotel/searchViewport"
    }
  ]);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "referer": SOURCE_URL,
      "x-orpc-batch": "streaming",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    },
    body: requestBody
  });

  if (!response.ok && response.status !== 207) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return parseHotelsFromSseResponse(text);
}

function parseHotelsFromSseResponse(text) {
  const lines = text.split("\n").filter((l) => l.startsWith("data:"));

  for (const line of lines) {
    let data;

    try {
      data = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }

    const entries = data?.body?.json?.entries;

    if (Array.isArray(entries) && entries.length > 0) {
      return entries;
    }
  }

  return [];
}

function toNormalizedRecord(raw) {
  const loyalty = normalizeText(
    raw.biltLoyaltyProgram ?? raw.metadata?.loyaltyProgram ?? ""
  );
  const sourceHotelId = normalizeText(raw.sourceHotelId);
  const websiteUrl = sourceHotelId
    ? `https://www.biltrewards.com/rewards/travel/hotel/${sourceHotelId}`
    : "";

  return {
    source: SOURCE,
    sourceHotelId,
    name: normalizeText(raw.name),
    websiteUrl,
    chain: loyalty,
    brand: loyalty,
    city: normalizeText(raw.city ?? ""),
    stateRegion: normalizeText(raw.state ?? ""),
    country: normalizeText(raw.countryCode ?? ""),
    tripadvisorKey: "",
    latitude: normalizeText(raw.latitude ?? ""),
    longitude: normalizeText(raw.longitude ?? ""),
    formattedAddress: normalizeText(raw.address ?? ""),
    geoProvider: raw.latitude && raw.longitude ? "bilt_hafh_api" : "",
    geoConfidence: raw.latitude && raw.longitude ? "high" : "",
    geoPlaceId: normalizeText(raw.hotelId ?? ""),
    geoTypes: "",
    geoPartialMatch: "",
    geoStatus: raw.latitude && raw.longitude ? "OK" : "",
    lastVerifiedAt: todayIsoDate()
  };
}

export async function writeStageOneOutputs() {
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });

  const hotels = await collectHotels();
  const generatedAt = new Date().toISOString();
  const payload = buildStagePayload(hotels, generatedAt);

  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${payload.metadata.record_count} hotels to ${fileURLToPath(OUTPUT_FILE_URL)}`);
}

function buildStagePayload(hotels, generatedAt) {
  const entries = hotels.map((hotel) => ({
    source: hotel.source,
    source_hotel_id: hotel.sourceHotelId,
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
    collected_at: generatedAt
  }));

  return {
    metadata: {
      stage: "1-list",
      source: SOURCE,
      generated_at: generatedAt,
      record_count: entries.length,
      source_url: SOURCE_URL
    },
    hotels: Object.fromEntries(entries.map((hotel) => [hotel.source_hotel_id, hotel]))
  };
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
