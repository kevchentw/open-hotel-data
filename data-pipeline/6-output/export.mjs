import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inferChainFromBrand } from "../shared/brand-chain.mjs";

const STAGE = "6-output";
const CANONICAL_INPUT_URL = new URL("../4-unique/hotel.json", import.meta.url);
const PRICE_DIRECTORY_URL = new URL("../5-price/prices/", import.meta.url);
const PIPELINE_OUTPUT_URL = new URL("./hotels.json", import.meta.url);
const APP_OUTPUT_URL = new URL("../../public/data/hotels.json", import.meta.url);

export async function buildStageSixOutputs() {
  const canonicalRegistry = await readJsonRequired(CANONICAL_INPUT_URL);
  validateCanonicalRegistry(canonicalRegistry);

  const priceByTripadvisorId = await readPriceDirectory();
  const canonicalHotels = buildCanonicalHotels(canonicalRegistry.hotels, priceByTripadvisorId);
  const fallbackHotels = buildFallbackHotels(canonicalRegistry.unmatched);
  const appHotels = buildAppHotels(canonicalHotels, fallbackHotels);
  const generatedAt = new Date().toISOString();

  return {
    pipeline: {
      metadata: sortObjectKeys({
        stage: STAGE,
        generated_at: generatedAt,
        canonical_count: Object.keys(canonicalHotels).length,
        fallback_count: Object.keys(fallbackHotels).length,
        app_hotel_count: appHotels.length,
        price_file_count: priceByTripadvisorId.size
      }),
      hotels: sortEntriesObject(canonicalHotels),
      fallback_hotels: sortEntriesObject(fallbackHotels)
    },
    app: {
      metadata: sortObjectKeys({
        stage: STAGE,
        generated_at: generatedAt,
        hotel_count: appHotels.length,
        canonical_count: Object.keys(canonicalHotels).length,
        fallback_count: Object.keys(fallbackHotels).length
      }),
      hotels: appHotels
    }
  };
}

export async function writeStageSixOutputs() {
  const outputs = await buildStageSixOutputs();
  await mkdir(new URL("./", PIPELINE_OUTPUT_URL), { recursive: true });
  await mkdir(new URL("./", APP_OUTPUT_URL), { recursive: true });
  await writeJson(PIPELINE_OUTPUT_URL, outputs.pipeline);
  await writeJson(APP_OUTPUT_URL, outputs.app);

  console.log(
    `Wrote ${Object.keys(outputs.pipeline.hotels).length} canonical and ` +
      `${Object.keys(outputs.pipeline.fallback_hotels).length} fallback hotels`
  );

  return outputs;
}

function validateCanonicalRegistry(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Malformed stage-4 canonical registry: expected object payload");
  }

  if (!isRecord(payload.hotels)) {
    throw new Error('Malformed stage-4 canonical registry: expected object key "hotels"');
  }

  if (!isRecord(payload.unmatched)) {
    throw new Error('Malformed stage-4 canonical registry: expected object key "unmatched"');
  }
}

function buildCanonicalHotels(hotels, priceByTripadvisorId) {
  return Object.fromEntries(
    Object.entries(hotels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tripadvisorId, hotel]) => {
        const priceSummary = summarizePrices(priceByTripadvisorId.get(tripadvisorId));
        const canonicalHotel = {
          ...pickHotelFields(hotel),
          tripadvisor_id: normalizeString(hotel.tripadvisor_id) || tripadvisorId,
          tripadvisor_url: normalizeString(hotel.tripadvisor_url),
          source_keys: normalizeStringArray(hotel.source_keys),
          prices: priceSummary.prices,
          currency: priceSummary.currency
        };

        if (priceSummary.summaryPrice) {
          canonicalHotel.summary_price = priceSummary.summaryPrice;
        }

        return [
          tripadvisorId,
          sortObjectKeys(canonicalHotel)
        ];
      })
  );
}

function buildFallbackHotels(unmatched) {
  return Object.fromEntries(
    Object.entries(unmatched)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fallbackId, hotel]) => [
        fallbackId,
        sortObjectKeys({
          id: fallbackId,
          record_type: "fallback",
          source: normalizeString(hotel.source),
          source_hotel_id: normalizeString(hotel.source_hotel_id),
          name: normalizeString(hotel.name),
          city: normalizeString(hotel.city),
          state_region: normalizeString(hotel.state_region),
          country: normalizeString(hotel.country),
          formatted_address: normalizeString(hotel.formatted_address),
          address: normalizeString(hotel.address),
          postal_code: normalizeString(hotel.postal_code),
          latitude: normalizeString(hotel.latitude),
          longitude: normalizeString(hotel.longitude),
          brand: normalizeString(hotel.brand),
          chain: inferChainFromBrand(hotel.brand, hotel.chain),
          plans: normalizeStringArray(hotel.plans).length ? normalizeStringArray(hotel.plans) : inferPlansFromSource(hotel.source),
          amenities: normalizeStringArray(hotel.amenities),
          fallback_reason: normalizeString(hotel.reason),
          tripadvisor_id: normalizeString(hotel.tripadvisor_id),
          tripadvisor_url: normalizeString(hotel.tripadvisor_url),
          match_confidence: normalizeString(hotel.match_confidence),
          search_query: normalizeString(hotel.search_query)
        })
      ])
  );
}

function buildAppHotels(canonicalHotels, fallbackHotels) {
  return [
    ...Object.entries(canonicalHotels).map(([id, hotel]) =>
      sortObjectKeys({
        id,
        record_type: "canonical",
        display_state: "ready",
        ...hotel
      })
    ),
    ...Object.entries(fallbackHotels).map(([id, hotel]) =>
      sortObjectKeys({
        id,
        display_state: "fallback",
        ...hotel
      })
    )
  ].sort(compareAppHotels);
}

async function readPriceDirectory() {
  try {
    const names = await readdir(PRICE_DIRECTORY_URL);
    const jsonNames = names.filter((name) => name.endsWith(".json")).sort((left, right) => left.localeCompare(right));
    const entries = await Promise.all(
      jsonNames.map(async (name) => {
        const payload = await readJsonRequired(new URL(name, PRICE_DIRECTORY_URL));
        return [normalizeString(payload?.metadata?.tripadvisor_id || name.replace(/\.json$/u, "")), payload];
      })
    );

    return new Map(entries.filter(([tripadvisorId]) => tripadvisorId));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return new Map();
    }

    throw error;
  }
}

function summarizePrices(payload) {
  if (!payload) {
    return {
      prices: {},
      currency: "",
      summaryPrice: null
    };
  }

  const summaryPrice = normalizeSummaryPrice(payload.summary_price);
  const prices = sortEntriesObject(
    Object.fromEntries(
      Object.entries(isRecord(payload.prices) ? payload.prices : {}).map(([stayDate, price]) => [
        stayDate,
        sortObjectKeys({
          currency: normalizeString(price?.currency),
          fetched_at: normalizeString(price?.fetched_at),
          source: normalizeString(price?.source),
          cost: normalizeString(price?.cost)
        })
      ])
    )
  );

  const firstPrice = Object.values(prices)[0] ?? {};

  return {
    prices,
    currency: normalizeString(firstPrice.currency) || normalizeString(summaryPrice?.currency),
    summaryPrice
  };
}

function normalizeSummaryPrice(summaryPrice) {
  if (!isRecord(summaryPrice)) {
    return null;
  }

  const cost = normalizeString(summaryPrice.cost);
  if (!cost) {
    return null;
  }

  return sortObjectKeys({
    currency: normalizeString(summaryPrice.currency),
    source: normalizeString(summaryPrice.source),
    cost,
    display: normalizeString(summaryPrice.display),
    fetched_at: normalizeString(summaryPrice.fetched_at),
    original_currency: normalizeString(summaryPrice.original_currency)
  });
}

function pickHotelFields(hotel) {
  return {
    record_type: "canonical",
    name: normalizeString(hotel.name),
    city: normalizeString(hotel.city),
    state_region: normalizeString(hotel.state_region),
    country: normalizeString(hotel.country),
    formatted_address: normalizeString(hotel.formatted_address),
    address: normalizeString(hotel.address),
    postal_code: normalizeString(hotel.postal_code),
    latitude: normalizeString(hotel.latitude),
    longitude: normalizeString(hotel.longitude),
    brand: normalizeString(hotel.brand),
    chain: inferChainFromBrand(hotel.brand, hotel.chain),
    plans: normalizeStringArray(hotel.plans),
    amenities: normalizeStringArray(hotel.amenities),
    geo_provider: normalizeString(hotel.geo_provider),
    geo_confidence: normalizeString(hotel.geo_confidence),
    geo_status: normalizeString(hotel.geo_status),
    source_count: normalizeInteger(hotel.source_count)
  };
}

async function readJsonRequired(url) {
  const raw = await readFile(url, "utf8");
  return JSON.parse(raw);
}

async function writeJson(url, payload) {
  await writeFile(url, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function compareAppHotels(left, right) {
  const nameComparison = normalizeString(left.name).localeCompare(normalizeString(right.name));
  if (nameComparison !== 0) {
    return nameComparison;
  }

  return normalizeString(left.id).localeCompare(normalizeString(right.id));
}

function inferPlansFromSource(source) {
  const normalized = normalizeString(source);
  return normalized ? [normalized] : [];
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(values.map((value) => normalizeString(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function normalizeInteger(value) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortEntriesObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function sortObjectKeys(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  await writeStageSixOutputs();
}
