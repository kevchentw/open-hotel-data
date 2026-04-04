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
  const sourceRecords = buildSourceRecords(sourceInputs);
  const hotelsByTripadvisorId = new Map();
  const canonicalNameToTripadvisorIds = new Map();
  const links = {};
  const unmatched = {};

  for (const record of sourceRecords) {
    if (!record.hasReliableTripadvisorMatch) {
      continue;
    }

    const aggregate = getOrCreateCanonicalAggregate(hotelsByTripadvisorId, record.tripadvisorId);
    aggregate.contributors.push({
      source: record.source,
      stageOneHotel: record.stageOneHotel,
      stageTwoHotel: record.stageTwoHotel,
      stageThreeMatch: record.stageThreeMatch
    });
    registerCanonicalName(canonicalNameToTripadvisorIds, record.canonicalName, record.tripadvisorId);

    links[record.linkKey] = sortObjectKeys({
      source: record.source,
      source_hotel_id: record.sourceHotelId,
      tripadvisor_id: record.tripadvisorId,
      tripadvisor_url: normalizeString(record.stageThreeMatch?.tripadvisor_url),
      match_confidence: record.matchConfidence,
      matched_at: normalizeString(record.stageThreeMatch?.matched_at),
      match_method: "tripadvisor_id"
    });
  }

  for (const record of sourceRecords) {
    if (record.hasReliableTripadvisorMatch) {
      continue;
    }

    const matchedTripadvisorId = getCanonicalTripadvisorIdForName(
      canonicalNameToTripadvisorIds,
      record.canonicalName
    );

    if (matchedTripadvisorId) {
      const aggregate = getOrCreateCanonicalAggregate(hotelsByTripadvisorId, matchedTripadvisorId);
      aggregate.contributors.push({
        source: record.source,
        stageOneHotel: record.stageOneHotel,
        stageTwoHotel: record.stageTwoHotel,
        stageThreeMatch: record.stageThreeMatch
      });

      links[record.linkKey] = sortObjectKeys({
        source: record.source,
        source_hotel_id: record.sourceHotelId,
        tripadvisor_id: matchedTripadvisorId,
        tripadvisor_url: normalizeString(record.stageThreeMatch?.tripadvisor_url),
        match_confidence: record.matchConfidence,
        matched_at: normalizeString(record.stageThreeMatch?.matched_at),
        match_method: "name"
      });

      continue;
    }

    unmatched[record.linkKey] = buildUnmatchedRecord(record);
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

function buildSourceRecords(sourceInputs) {
  const records = [];

  for (const input of sourceInputs) {
    const sourceHotelIds = Object.keys(input.stageOneHotels).sort((left, right) => left.localeCompare(right));

    for (const sourceHotelId of sourceHotelIds) {
      const stageOneHotel = input.stageOneHotels[sourceHotelId];
      const stageTwoHotel = input.stageTwoHotels[sourceHotelId] ?? {};
      const stageThreeMatch = input.stageThreeMatches[sourceHotelId] ?? null;
      const tripadvisorId = normalizeString(stageThreeMatch?.tripadvisor_id);
      const matchConfidence = normalizeString(stageThreeMatch?.match_confidence).toLowerCase();

      records.push({
        source: input.source,
        sourceHotelId,
        hasStageThreeFile: input.hasStageThreeFile,
        stageOneHotel,
        stageTwoHotel,
        stageThreeMatch,
        linkKey: buildLinkKey(input.source, sourceHotelId),
        tripadvisorId,
        matchConfidence,
        hasReliableTripadvisorMatch: isReliableTripadvisorMatch(stageThreeMatch),
        canonicalName: normalizeHotelName(firstNonEmpty([stageTwoHotel.detail_name, stageOneHotel.name]))
      });
    }
  }

  return records;
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

function registerCanonicalName(canonicalNameToTripadvisorIds, canonicalName, tripadvisorId) {
  if (!canonicalName || !tripadvisorId) {
    return;
  }

  const existing = canonicalNameToTripadvisorIds.get(canonicalName) ?? new Set();
  existing.add(tripadvisorId);
  canonicalNameToTripadvisorIds.set(canonicalName, existing);
}

function getCanonicalTripadvisorIdForName(canonicalNameToTripadvisorIds, canonicalName) {
  if (!canonicalName) {
    return "";
  }

  const tripadvisorIds = canonicalNameToTripadvisorIds.get(canonicalName);
  if (!tripadvisorIds || tripadvisorIds.size !== 1) {
    return "";
  }

  return Array.from(tripadvisorIds)[0] ?? "";
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
    amex_url: pickSourcePageUrl(contributors, ["amex_fhr", "amex_thc"]),
    hilton_url: pickSourcePageUrl(contributors, ["hilton_aspire_resort_credit"]),
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

function buildUnmatchedRecord(record) {
  return sortObjectKeys({
    source: record.source,
    source_hotel_id: record.sourceHotelId,
    reason: getUnmatchedReason(record.hasStageThreeFile, record.stageThreeMatch),
    amex_url: isAmexSource(record.source)
      ? firstNonEmpty([record.stageTwoHotel.detail_url, record.stageOneHotel.url])
      : "",
    hilton_url: record.source === "hilton_aspire_resort_credit"
      ? firstNonEmpty([record.stageTwoHotel.detail_url, record.stageOneHotel.url])
      : "",
    name: firstNonEmpty([
      record.stageTwoHotel.detail_name,
      record.stageOneHotel.name
    ]),
    formatted_address: firstNonEmpty([
      record.stageTwoHotel.formatted_address,
      record.stageOneHotel.address_raw
    ]),
    address: firstNonEmpty([
      record.stageTwoHotel.detail_address,
      record.stageOneHotel.address_raw
    ]),
    city: firstNonEmpty([
      record.stageTwoHotel.detail_city,
      record.stageOneHotel.city
    ]),
    state_region: firstNonEmpty([
      record.stageTwoHotel.detail_state_region,
      record.stageOneHotel.state_region
    ]),
    country: firstNonEmpty([
      record.stageTwoHotel.detail_country,
      record.stageOneHotel.country
    ]),
    postal_code: firstNonEmpty([
      record.stageTwoHotel.detail_postal_code
    ]),
    latitude: firstNonEmpty([
      record.stageTwoHotel.detail_latitude,
      record.stageOneHotel.latitude
    ]),
    longitude: firstNonEmpty([
      record.stageTwoHotel.detail_longitude,
      record.stageOneHotel.longitude
    ]),
    brand: firstNonEmpty([
      record.stageOneHotel.brand
    ]),
    chain: inferChainFromBrand(
      firstNonEmpty([
        record.stageOneHotel.brand
      ]),
      firstNonEmpty([
        record.stageOneHotel.chain
      ])
    ),
    geo_provider: firstNonEmpty([
      record.stageTwoHotel.geo_provider
    ]),
    geo_confidence: firstNonEmpty([
      record.stageTwoHotel.geo_confidence
    ]),
    geo_status: firstNonEmpty([
      record.stageTwoHotel.geo_status
    ]),
    amenities: uniqueNonEmptyStrings(record.stageTwoHotel.amenities ?? []),
    plans: uniqueNonEmptyStrings([record.source]),
    match_confidence: record.matchConfidence,
    tripadvisor_id: record.tripadvisorId,
    tripadvisor_url: normalizeString(record.stageThreeMatch?.tripadvisor_url),
    search_query: normalizeString(record.stageThreeMatch?.search_query)
  });
}

function buildLinkKey(source, sourceHotelId) {
  return `${source}::${sourceHotelId}`;
}

function pickSourcePageUrl(contributors, sources) {
  const sourceSet = new Set(sources);

  for (const contributor of contributors) {
    if (!sourceSet.has(contributor.source)) {
      continue;
    }

    const value = firstNonEmpty([contributor.stageTwoHotel?.detail_url, contributor.stageOneHotel?.url]);
    if (value) {
      return value;
    }
  }

  return "";
}

function isAmexSource(source) {
  return source === "amex_fhr" || source === "amex_thc";
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

function normalizeHotelName(value) {
  return normalizeString(value).toLowerCase().replace(/\s+/gu, " ");
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
