import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inferChainFromBrand } from "../shared/brand-chain.mjs";

const STAGE = "4-unique";
const OUTPUT_FILE_URL = new URL("./hotel.json", import.meta.url);
const OUTPUT_DIRECTORY_URL = new URL("./", import.meta.url);
const RELIABLE_MATCH_CONFIDENCE = new Set(["high", "medium"]);
const SOURCE_CONFIGS = [
  {
    source: "amex_fhr",
    stageOneUrl: new URL("../1-list/amex-fhr-hotel.json", import.meta.url),
    stageTwoUrl: new URL("../2-enrichment/amex-fhr-hotel.json", import.meta.url),
    stageThreeUrl: new URL("../3-tripadvisor/amex-fhr-hotel.json", import.meta.url)
  },
  {
    source: "amex_thc",
    stageOneUrl: new URL("../1-list/amex-thc-hotel.json", import.meta.url),
    stageTwoUrl: new URL("../2-enrichment/amex-thc-hotel.json", import.meta.url),
    stageThreeUrl: new URL("../3-tripadvisor/amex-thc-hotel.json", import.meta.url)
  },
  {
    source: "hilton_aspire_resort_credit",
    stageOneUrl: new URL("../1-list/aspire-hotel.json", import.meta.url),
    stageTwoUrl: new URL("../2-enrichment/hilton-aspire-hotel.json", import.meta.url),
    stageThreeUrl: new URL("../3-tripadvisor/aspire-hotel.json", import.meta.url)
  }
];

export async function buildCanonicalRegistry() {
  const sourceInputs = await Promise.all(SOURCE_CONFIGS.map(readSourceInputs));
  const hotelsByTripadvisorId = new Map();
  const links = {};
  const unmatched = {};

  for (const input of sourceInputs) {
    const sourceHotelIds = Object.keys(input.stageOneHotels).sort((left, right) => left.localeCompare(right));

    for (const sourceHotelId of sourceHotelIds) {
      const stageOneHotel = input.stageOneHotels[sourceHotelId];
      const stageTwoHotel = input.stageTwoHotels[sourceHotelId] ?? {};
      const stageThreeMatch = input.stageThreeMatches[sourceHotelId] ?? null;
      const linkKey = buildLinkKey(input.source, sourceHotelId);
      const tripadvisorId = normalizeString(stageThreeMatch?.tripadvisor_id);
      const matchConfidence = normalizeString(stageThreeMatch?.match_confidence).toLowerCase();

      if (isReliableTripadvisorMatch(stageThreeMatch)) {
        const aggregate = getOrCreateCanonicalAggregate(hotelsByTripadvisorId, tripadvisorId);
        aggregate.contributors.push({
          source: input.source,
          stageOneHotel,
          stageTwoHotel,
          stageThreeMatch
        });

        links[linkKey] = sortObjectKeys({
          source: input.source,
          source_hotel_id: sourceHotelId,
          tripadvisor_id: tripadvisorId,
          tripadvisor_url: normalizeString(stageThreeMatch?.tripadvisor_url),
          match_confidence: matchConfidence,
          matched_at: normalizeString(stageThreeMatch?.matched_at)
        });

        continue;
      }

      unmatched[linkKey] = sortObjectKeys({
        source: input.source,
        source_hotel_id: sourceHotelId,
        reason: getUnmatchedReason(input.hasStageThreeFile, stageThreeMatch),
        name: firstNonEmpty([
          stageTwoHotel.detail_name,
          stageOneHotel.name
        ]),
        formatted_address: firstNonEmpty([
          stageTwoHotel.formatted_address,
          stageOneHotel.address_raw
        ]),
        address: firstNonEmpty([
          stageTwoHotel.detail_address,
          stageOneHotel.address_raw
        ]),
        city: firstNonEmpty([
          stageTwoHotel.detail_city,
          stageOneHotel.city
        ]),
        state_region: firstNonEmpty([
          stageTwoHotel.detail_state_region,
          stageOneHotel.state_region
        ]),
        country: firstNonEmpty([
          stageTwoHotel.detail_country,
          stageOneHotel.country
        ]),
        postal_code: firstNonEmpty([
          stageTwoHotel.detail_postal_code
        ]),
        latitude: firstNonEmpty([
          stageTwoHotel.detail_latitude,
          stageOneHotel.latitude
        ]),
        longitude: firstNonEmpty([
          stageTwoHotel.detail_longitude,
          stageOneHotel.longitude
        ]),
        brand: firstNonEmpty([
          stageOneHotel.brand
        ]),
        chain: inferChainFromBrand(
          firstNonEmpty([
            stageOneHotel.brand
          ]),
          firstNonEmpty([
            stageOneHotel.chain
          ])
        ),
        geo_provider: firstNonEmpty([
          stageTwoHotel.geo_provider
        ]),
        geo_confidence: firstNonEmpty([
          stageTwoHotel.geo_confidence
        ]),
        geo_status: firstNonEmpty([
          stageTwoHotel.geo_status
        ]),
        amenities: uniqueNonEmptyStrings(stageTwoHotel.amenities ?? []),
        plans: uniqueNonEmptyStrings([input.source]),
        match_confidence: matchConfidence,
        tripadvisor_id: tripadvisorId,
        tripadvisor_url: normalizeString(stageThreeMatch?.tripadvisor_url),
        search_query: normalizeString(stageThreeMatch?.search_query)
      });
    }
  }

  const hotels = Object.fromEntries(
    Array.from(hotelsByTripadvisorId.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tripadvisorId, aggregate]) => [tripadvisorId, buildCanonicalHotel(tripadvisorId, aggregate)])
  );

  return {
    metadata: {
      stage: STAGE,
      generated_at: new Date().toISOString(),
      canonical_count: Object.keys(hotels).length,
      link_count: Object.keys(links).length,
      unmatched_count: Object.keys(unmatched).length
    },
    hotels,
    links: sortEntriesObject(links),
    unmatched: sortEntriesObject(unmatched)
  };
}

export async function writeCanonicalRegistry() {
  const payload = await buildCanonicalRegistry();
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });
  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${payload.metadata.canonical_count} canonical hotels to ${OUTPUT_FILE_URL.pathname} ` +
      `(${payload.metadata.link_count} links, ${payload.metadata.unmatched_count} unmatched)`
  );
  return payload;
}

async function readSourceInputs(config) {
  const stageOnePayload = await readJsonRequired(config.stageOneUrl);
  const stageTwoPayload = await readJsonOptional(config.stageTwoUrl);
  const stageThreePayload = await readJsonOptional(config.stageThreeUrl);

  validateSourcePayload(config.source, "stage-1", stageOnePayload, "hotels");
  validateSourcePayload(config.source, "stage-2", stageTwoPayload, "hotels");
  validateSourcePayload(config.source, "stage-3", stageThreePayload, "matches");

  return {
    source: config.source,
    hasStageThreeFile: stageThreePayload !== null,
    stageOneHotels: stageOnePayload.hotels ?? {},
    stageTwoHotels: stageTwoPayload?.hotels ?? {},
    stageThreeMatches: stageThreePayload?.matches ?? {}
  };
}

function validateSourcePayload(source, stageLabel, payload, key) {
  if (payload === null) {
    return;
  }

  if (!payload || typeof payload !== "object" || typeof payload[key] !== "object" || Array.isArray(payload[key])) {
    throw new Error(`Malformed ${stageLabel} payload for ${source}: expected object key "${key}"`);
  }
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
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function isReliableTripadvisorMatch(match) {
  if (!match || typeof match !== "object") {
    return false;
  }

  const tripadvisorId = normalizeString(match.tripadvisor_id);
  const matchConfidence = normalizeString(match.match_confidence).toLowerCase();

  return Boolean(tripadvisorId) && RELIABLE_MATCH_CONFIDENCE.has(matchConfidence);
}

function getOrCreateCanonicalAggregate(hotelsByTripadvisorId, tripadvisorId) {
  const existing = hotelsByTripadvisorId.get(tripadvisorId);
  if (existing) {
    return existing;
  }

  const created = { contributors: [] };
  hotelsByTripadvisorId.set(tripadvisorId, created);
  return created;
}

function buildCanonicalHotel(tripadvisorId, aggregate) {
  const contributors = [...aggregate.contributors].sort(compareContributors);
  const plans = Array.from(new Set(contributors.map((contributor) => contributor.source))).sort((left, right) =>
    left.localeCompare(right)
  );
  const amenities = uniqueNonEmptyStrings(
    contributors.flatMap((contributor) => contributor.stageTwoHotel?.amenities ?? [])
  );
  const sourceKeys = contributors.map((contributor) =>
    buildLinkKey(contributor.source, contributor.stageOneHotel.source_hotel_id)
  );

  return sortObjectKeys({
    tripadvisor_id: tripadvisorId,
    tripadvisor_url: pickField(contributors, (contributor) => contributor.stageThreeMatch?.tripadvisor_url),
    name: pickField(contributors, (contributor) =>
      firstNonEmpty([contributor.stageTwoHotel?.detail_name, contributor.stageOneHotel?.name])
    ),
    city: pickField(contributors, (contributor) =>
      firstNonEmpty([contributor.stageTwoHotel?.detail_city, contributor.stageOneHotel?.city])
    ),
    state_region: pickField(contributors, (contributor) =>
      firstNonEmpty([contributor.stageTwoHotel?.detail_state_region, contributor.stageOneHotel?.state_region])
    ),
    country: pickField(contributors, (contributor) =>
      firstNonEmpty([contributor.stageTwoHotel?.detail_country, contributor.stageOneHotel?.country])
    ),
    postal_code: pickField(contributors, (contributor) => contributor.stageTwoHotel?.detail_postal_code),
    brand: pickField(contributors, (contributor) => contributor.stageOneHotel?.brand),
    chain: pickField(contributors, (contributor) =>
      inferChainFromBrand(contributor.stageOneHotel?.brand, contributor.stageOneHotel?.chain)
    ),
    latitude: pickField(contributors, (contributor) =>
      firstNonEmpty([contributor.stageTwoHotel?.detail_latitude, contributor.stageOneHotel?.latitude])
    ),
    longitude: pickField(contributors, (contributor) =>
      firstNonEmpty([contributor.stageTwoHotel?.detail_longitude, contributor.stageOneHotel?.longitude])
    ),
    formatted_address: pickField(contributors, (contributor) =>
      firstNonEmpty([contributor.stageTwoHotel?.formatted_address, contributor.stageOneHotel?.address_raw])
    ),
    address: pickField(contributors, (contributor) =>
      firstNonEmpty([contributor.stageTwoHotel?.detail_address, contributor.stageOneHotel?.address_raw])
    ),
    geo_provider: pickField(contributors, (contributor) => contributor.stageTwoHotel?.geo_provider),
    geo_confidence: pickField(contributors, (contributor) => contributor.stageTwoHotel?.geo_confidence),
    geo_status: pickField(contributors, (contributor) => contributor.stageTwoHotel?.geo_status),
    amenities,
    plans,
    source_count: contributors.length,
    source_keys: sourceKeys
  });
}

function compareContributors(left, right) {
  const sourceComparison = compareSourceOrder(left.source, right.source);
  if (sourceComparison !== 0) {
    return sourceComparison;
  }

  return left.stageOneHotel.source_hotel_id.localeCompare(right.stageOneHotel.source_hotel_id);
}

function compareSourceOrder(left, right) {
  return getSourceOrder(left) - getSourceOrder(right) || left.localeCompare(right);
}

function getSourceOrder(source) {
  const index = SOURCE_CONFIGS.findIndex((config) => config.source === source);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function pickField(contributors, selector) {
  for (const contributor of contributors) {
    const value = normalizeString(selector(contributor));
    if (value) {
      return value;
    }
  }

  return "";
}

function getUnmatchedReason(hasStageThreeFile, match) {
  if (!hasStageThreeFile) {
    return "missing_tripadvisor_stage";
  }

  if (!match || typeof match !== "object") {
    return "missing_tripadvisor_record";
  }

  const tripadvisorId = normalizeString(match.tripadvisor_id);
  const matchConfidence = normalizeString(match.match_confidence).toLowerCase();

  if (!tripadvisorId) {
    return "missing_tripadvisor_match";
  }

  if (!RELIABLE_MATCH_CONFIDENCE.has(matchConfidence)) {
    return "untrusted_tripadvisor_match";
  }

  return "missing_tripadvisor_match";
}

function buildLinkKey(source, sourceHotelId) {
  return `${source}::${sourceHotelId}`;
}

function uniqueNonEmptyStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function firstNonEmpty(values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function sortEntriesObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function sortObjectKeys(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right))
  );
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  await writeCanonicalRegistry();
}
