import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { collectAmexLiveHotels } from "./shared/amex-live.mjs";

const OUTPUT_DIRECTORY_URL = new URL("../", import.meta.url);
const OUTPUT_FILE_BY_SOURCE = {
  amex_fhr: new URL("../amex-fhr-hotel.json", import.meta.url),
  amex_thc: new URL("../amex-thc-hotel.json", import.meta.url)
};
const PLAN_NAME_BY_SOURCE = {
  amex_fhr: "Fine Hotels + Resorts",
  amex_thc: "The Hotel Collection"
};

export async function collectHotels(options = {}) {
  return collectAmexLiveHotels({
    sources: options.sources
  });
}

export async function writeStageOneOutputs(options = {}) {
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });

  const amexHotels = await collectHotels({
    sources: options.sources ?? Object.keys(OUTPUT_FILE_BY_SOURCE)
  });

  const generatedAt = new Date().toISOString();
  const groupedHotels = groupHotelsBySource(amexHotels);

  await Promise.all(
    Object.entries(groupedHotels).map(async ([source, hotels]) => {
      const outputUrl = OUTPUT_FILE_BY_SOURCE[source];

      if (!outputUrl) {
        return;
      }

      const payload = buildStagePayload(source, hotels, generatedAt);
      await writeFile(outputUrl, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      console.log(`Wrote ${payload.metadata.record_count} hotels to ${outputUrl.pathname}`);
    })
  );
}

function buildStagePayload(source, hotels, generatedAt) {
  const entries = hotels
    .map((hotel) => toStageOneHotel(hotel, generatedAt))
    .filter((hotel) => hotel.source_hotel_id)
    .sort((left, right) => left.source_hotel_id.localeCompare(right.source_hotel_id));

  return {
    metadata: {
      stage: "1-list",
      source,
      generated_at: generatedAt,
      record_count: entries.length
    },
    hotels: Object.fromEntries(entries.map((hotel) => [hotel.source_hotel_id, hotel]))
  };
}

function groupHotelsBySource(hotels) {
  const groupedHotels = Object.fromEntries(
    Object.keys(OUTPUT_FILE_BY_SOURCE).map((source) => [source, []])
  );

  for (const hotel of hotels) {
    const source = normalizeString(hotel.source);

    if (!groupedHotels[source]) {
      groupedHotels[source] = [];
    }

    groupedHotels[source].push(hotel);
  }

  return groupedHotels;
}

function toStageOneHotel(hotel, generatedAt) {
  return {
    source: normalizeString(hotel.source),
    source_hotel_id: normalizeString(hotel.sourceHotelId),
    name: normalizeString(hotel.name),
    address_raw: normalizeString(hotel.formattedAddress),
    city: normalizeString(hotel.city),
    state_region: normalizeString(hotel.stateRegion),
    country: normalizeString(hotel.country),
    url: normalizeString(hotel.websiteUrl),
    plan: PLAN_NAME_BY_SOURCE[hotel.source] ?? "",
    brand: normalizeString(hotel.brand),
    chain: normalizeString(hotel.chain),
    latitude: normalizeString(hotel.latitude),
    longitude: normalizeString(hotel.longitude),
    collected_at: generatedAt
  };
}

function normalizeString(value) {
  return String(value ?? "").trim();
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
