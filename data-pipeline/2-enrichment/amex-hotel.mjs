import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const USER_AGENT = "open-hotel-data crawler";
const OUTPUT_DIRECTORY_URL = new URL("./", import.meta.url);
const INPUT_FILE_BY_SOURCE = {
  amex_fhr: new URL("../1-list/amex-fhr-hotel.json", import.meta.url),
  amex_thc: new URL("../1-list/amex-thc-hotel.json", import.meta.url)
};
const OUTPUT_FILE_BY_SOURCE = {
  amex_fhr: new URL("./amex-fhr-hotel.json", import.meta.url),
  amex_thc: new URL("./amex-thc-hotel.json", import.meta.url)
};
const DEFAULT_CONCURRENCY = 8;
const CHECKPOINT_INTERVAL = 10;

export async function writeStageTwoOutputs(options = {}) {
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });

  const sources = normalizeSources(options.sources);

  await Promise.all(
    sources.map(async (source) => {
      const outputUrl = OUTPUT_FILE_BY_SOURCE[source];
      const payload = await buildAmexEnrichmentForSource(source, {
        ...options,
        outputUrl
      });
      await writeFile(outputUrl, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      console.log(
        `Wrote ${payload.metadata.record_count} Amex Stage 2 records to ${outputUrl.pathname} ` +
          `(${payload.metadata.fetched_count} fetched, ${payload.metadata.skipped_count} skipped, ` +
          `${payload.metadata.failed_count} failed)`
      );
    })
  );
}

export async function buildAmexEnrichmentForSource(source, options = {}) {
  const stageOneHotels = await readStageOneHotels(source);
  const existingPayload = await readExistingEnrichment(source);
  const existingHotels = existingPayload.hotels ?? {};
  const generatedAt = new Date().toISOString();
  const requestedHotelIds = normalizeRequestedHotelIds(options.sourceHotelIds);
  const forceRefresh = Boolean(options.forceRefresh);
  const concurrency = normalizeConcurrency(options.concurrency);
  const outputUrl = options.outputUrl;

  const records = {};
  const hotelsToFetch = [];
  let skippedCount = 0;
  let failedCount = 0;
  let completedFetchCount = 0;
  let checkpointPromise = Promise.resolve();

  for (const hotel of Object.values(stageOneHotels)) {
    const existingRecord = existingHotels[hotel.source_hotel_id] ?? {};
    const targetIncluded = requestedHotelIds.size === 0 || requestedHotelIds.has(hotel.source_hotel_id);
    const shouldFetch =
      targetIncluded && (forceRefresh || !hasMeaningfulEnrichment(existingRecord));

    if (shouldFetch) {
      hotelsToFetch.push(hotel);
      continue;
    }

    skippedCount += 1;
    records[hotel.source_hotel_id] = mergeEnrichmentRecords(
      createEmptyEnrichmentRecord(hotel),
      existingRecord
    );
  }

  const fetchResults = await mapWithConcurrency(hotelsToFetch, concurrency, async (hotel) => {
    const existingRecord = existingHotels[hotel.source_hotel_id] ?? {};
    console.log(`[${source}] Fetching ${hotel.source_hotel_id}`);

    try {
      const html = await fetchTextWithRetries(hotel.url);
      const parsedRecord = buildEnrichmentRecordFromHtml(hotel, html, generatedAt);
      console.log(`[${source}] Fetched ${hotel.source_hotel_id}`);

      return {
        source_hotel_id: hotel.source_hotel_id,
        record: mergeEnrichmentRecords(createEmptyEnrichmentRecord(hotel), existingRecord, parsedRecord),
        failed: false
      };
    } catch (error) {
      const fallbackRecord = mergeEnrichmentRecords(
        createEmptyEnrichmentRecord(hotel),
        existingRecord,
        {
          fetch_status: "failed",
          notes: normalizeString(error?.message),
          enriched_at: generatedAt
        }
      );
      console.error(`[${source}] Failed ${hotel.source_hotel_id}: ${normalizeString(error?.message)}`);

      return {
        source_hotel_id: hotel.source_hotel_id,
        record: fallbackRecord,
        failed: true
      };
    }
  }, async (result) => {
    if (result.failed) {
      failedCount += 1;
    }

    records[result.source_hotel_id] = result.record;
    completedFetchCount += 1;

    if (
      outputUrl &&
      completedFetchCount > 0 &&
      completedFetchCount % CHECKPOINT_INTERVAL === 0
    ) {
      console.log(
        `[${source}] Checkpoint write after ${completedFetchCount}/${hotelsToFetch.length} fetched hotels`
      );
      checkpointPromise = checkpointPromise.then(() =>
        writeCheckpointPayload(
          outputUrl,
          createPayload({
            source,
            generatedAt,
            records,
            totalFetchedCount: hotelsToFetch.length,
            completedFetchCount,
            skippedCount,
            failedCount,
            forceRefresh,
            targetedHotelCount: requestedHotelIds.size
          })
        )
      );

      await checkpointPromise;
    }
  });
  await checkpointPromise;

  return createPayload({
    source,
    generatedAt,
    records,
    totalFetchedCount: hotelsToFetch.length,
    completedFetchCount,
    skippedCount,
    failedCount,
    forceRefresh,
    targetedHotelCount: requestedHotelIds.size
  });
}

async function readStageOneHotels(source) {
  const inputUrl = INPUT_FILE_BY_SOURCE[source];

  if (!inputUrl) {
    throw new Error(`Unsupported Amex source: ${source}`);
  }

  const raw = await readFile(inputUrl, "utf8");
  const payload = JSON.parse(raw);
  return payload.hotels ?? {};
}

async function readExistingEnrichment(source) {
  const outputUrl = OUTPUT_FILE_BY_SOURCE[source];

  try {
    const raw = await readFile(outputUrl, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { metadata: {}, hotels: {} };
    }

    throw error;
  }
}

async function writeCheckpointPayload(outputUrl, payload) {
  await writeFile(outputUrl, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createPayload({
  source,
  generatedAt,
  records,
  totalFetchedCount,
  completedFetchCount,
  skippedCount,
  failedCount,
  forceRefresh,
  targetedHotelCount
}) {
  return {
    metadata: {
      stage: "2-enrichment",
      source,
      generated_at: generatedAt,
      record_count: Object.keys(records).length,
      fetched_count: totalFetchedCount,
      completed_fetch_count: completedFetchCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      force_refresh: forceRefresh,
      targeted_hotel_count: targetedHotelCount
    },
    hotels: Object.fromEntries(
      Object.entries(records).sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

async function fetchTextWithRetries(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;

      if (attempt === 3) {
        break;
      }

      await wait(750 * attempt);
    }
  }

  throw lastError;
}

function buildEnrichmentRecordFromHtml(stageOneHotel, html, enrichedAt) {
  const metaTitle = decodeHtmlEntities(extractTagAttribute(html, "title", "innerHTML"));
  const metaDescription = decodeHtmlEntities(
    extractMetaContent(html, "name", "description") || extractMetaContent(html, "property", "og:description")
  );
  const canonicalUrl = extractLinkHref(html, "canonical") || stageOneHotel.url;
  const heroImageUrl = extractMetaContent(html, "property", "og:image");
  const latitudeLongitude = extractCoordinates(html);
  const ldJsonRecords = extractLdJsonRecords(html);
  const hotelRecord = ldJsonRecords.find((record) => record?.["@type"] === "Hotel") ?? {};
  const localBusinessRecord = ldJsonRecords.find((record) => record?.["@type"] === "LocalBusiness") ?? {};
  const faqRecord = ldJsonRecords.find((record) => record?.["@type"] === "FAQPage") ?? {};
  const address = {
    ...(hotelRecord.address ?? {}),
    ...(localBusinessRecord.address ?? {})
  };
  const ldAmenities = dedupeStrings(
    Array.isArray(hotelRecord.amenityFeature)
      ? hotelRecord.amenityFeature.map((item) => normalizeString(item?.name))
      : []
  );
  const features = extractFeatureList(html);
  const benefits = extractBenefits(html);
  const faqSections = buildFaqSections(faqRecord);
  const gallery = extractGallery(html);
  const detailAddress = normalizeString(address.streetAddress);
  const detailCity = normalizeString(address.addressLocality) || stageOneHotel.city;
  const detailStateRegion = normalizeString(address.addressRegion) || stageOneHotel.state_region;
  const detailCountry = normalizeString(address.addressCountry) || stageOneHotel.country;
  const detailPostalCode = normalizeString(address.postalCode);

  return {
    source_hotel_id: stageOneHotel.source_hotel_id,
    detail_url: canonicalUrl,
    detail_name: normalizeString(hotelRecord.name) || stageOneHotel.name,
    detail_address: detailAddress,
    detail_city: detailCity,
    detail_state_region: detailStateRegion,
    detail_country: detailCountry,
    detail_postal_code: detailPostalCode,
    formatted_address: formatAddress(detailAddress, detailCity, detailStateRegion, detailPostalCode, detailCountry),
    detail_latitude: latitudeLongitude.latitude,
    detail_longitude: latitudeLongitude.longitude,
    geo_provider: latitudeLongitude.latitude && latitudeLongitude.longitude ? "amex_property_map" : "",
    geo_confidence: latitudeLongitude.latitude && latitudeLongitude.longitude ? "high" : "",
    geo_status: latitudeLongitude.latitude && latitudeLongitude.longitude ? "found" : "missing",
    meta_title: metaTitle,
    meta_description: metaDescription,
    hero_image_url: heroImageUrl,
    gallery,
    amenities: ldAmenities.length > 0 ? ldAmenities : features,
    features,
    benefits_current_heading: benefits.currentHeading,
    benefits_next_heading: benefits.nextHeading,
    benefits_current: benefits.current,
    benefits_next: benefits.next,
    benefits_fineprint: benefits.fineprint,
    faq_sections: faqSections,
    fetch_status: "ok",
    notes: "",
    enriched_at: enrichedAt
  };
}

function createEmptyEnrichmentRecord(stageOneHotel) {
  return {
    source_hotel_id: stageOneHotel.source_hotel_id,
    detail_url: stageOneHotel.url,
    detail_name: stageOneHotel.name,
    detail_address: "",
    detail_city: "",
    detail_state_region: "",
    detail_country: "",
    detail_postal_code: "",
    formatted_address: "",
    detail_latitude: "",
    detail_longitude: "",
    geo_provider: "",
    geo_confidence: "",
    geo_status: "",
    meta_title: "",
    meta_description: "",
    hero_image_url: "",
    gallery: [],
    amenities: [],
    features: [],
    benefits_current_heading: "",
    benefits_next_heading: "",
    benefits_current: [],
    benefits_next: [],
    benefits_fineprint: "",
    faq_sections: {},
    fetch_status: "",
    notes: "",
    enriched_at: ""
  };
}

function hasMeaningfulEnrichment(record) {
  if (!record || typeof record !== "object") {
    return false;
  }

  const meaningfulKeys = [
    "detail_address",
    "detail_city",
    "detail_state_region",
    "detail_country",
    "detail_postal_code",
    "formatted_address",
    "detail_latitude",
    "detail_longitude",
    "meta_title",
    "meta_description",
    "hero_image_url",
    "amenities",
    "features",
    "benefits_current",
    "benefits_next",
    "gallery",
    "faq_sections"
  ];

  return meaningfulKeys.some((key) => isMeaningfulValue(record[key]));
}

function mergeEnrichmentRecords(...records) {
  const merged = {};

  for (const record of records) {
    if (!record || typeof record !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(record)) {
      if (!isMeaningfulValue(value) && isMeaningfulValue(merged[key])) {
        continue;
      }

      if (Array.isArray(value)) {
        merged[key] = value.map((item) =>
          item && typeof item === "object" ? { ...item } : item
        );
        continue;
      }

      if (value && typeof value === "object") {
        merged[key] = { ...value };
        continue;
      }

      merged[key] = value;
    }
  }

  return merged;
}

function extractCoordinates(html) {
  const match = html.match(/propertyLatLng\s*=\s*\{\s*lat:\s*([-0-9.]+)\s*,\s*lng:\s*([-0-9.]+)\s*\}/i);

  return {
    latitude: match ? normalizeString(match[1]) : "",
    longitude: match ? normalizeString(match[2]) : ""
  };
}

function extractLdJsonRecords(html) {
  const records = [];
  const pattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    const rawJson = decodeHtmlEntities(match[1]).trim();

    if (!rawJson) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawJson);

      if (Array.isArray(parsed)) {
        records.push(...parsed.filter((item) => item && typeof item === "object"));
      } else if (parsed && typeof parsed === "object") {
        records.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return records;
}

function buildFaqSections(faqRecord) {
  const sections = {};
  const mainEntity = Array.isArray(faqRecord?.mainEntity) ? faqRecord.mainEntity : [];

  for (const question of mainEntity) {
    const heading = normalizeString(question?.name);
    const text = normalizeWhitespace(question?.acceptedAnswer?.text);

    if (!heading || !text) {
      continue;
    }

    sections[toSnakeCase(heading)] = {
      heading,
      text
    };
  }

  return sections;
}

function extractFeatureList(html) {
  const featureSectionMatch = html.match(
    /<div class="pl-section-head sh-normal"[^>]*>\s*(?:<span[^>]*>)?\s*Features\s*(?:<\/span>)?\s*<\/div>\s*<div class="pl-collections"[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="pl-divider">|<div class="pl-section-head|<h2 class="pl-section-head)/i
  );

  if (!featureSectionMatch) {
    return [];
  }

  return dedupeStrings(
    Array.from(
      featureSectionMatch[1].matchAll(/<div class="pl-collection"[^>]*role="listitem"[^>]*>([\s\S]*?)<\/div>/gi),
      (match) => stripHtml(match[1])
    )
  );
}

function extractBenefits(html) {
  const sectionMatch = html.match(/<div class="pi-benefits">([\s\S]*?)<\/div><!--pi-benefits-->/i);

  if (!sectionMatch) {
    return {
      currentHeading: "",
      nextHeading: "",
      current: [],
      next: [],
      fineprint: ""
    };
  }

  const sectionHtml = sectionMatch[1];
  const currentHeading = stripHtml(
    sectionHtml.match(/<div class="pi-benefits-head benefitsCurrent"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""
  );
  const nextHeading = stripHtml(
    sectionHtml.match(/<div class="pi-benefits-head benefitsNext(?: hideMe)?"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""
  );
  const listHtml = sectionHtml.match(/<ul class="pibUL">([\s\S]*?)<p class="fineprint"/i)?.[1] ?? "";
  const current = [];
  const next = [];

  for (const match of listHtml.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/gi)) {
    const attributes = match[1] ?? "";
    const text = stripHtml(match[2]);

    if (!text) {
      continue;
    }

    if (/\bbenefitsNext\b/i.test(attributes)) {
      next.push(text);
      continue;
    }

    current.push(text);

    if (!/\bbenefitsCurrent\b/i.test(attributes)) {
      next.push(text);
    }
  }

  const fineprint = stripHtml(sectionHtml.match(/<p class="fineprint"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");

  return {
    currentHeading,
    nextHeading,
    current,
    next,
    fineprint
  };
}

function extractGallery(html) {
  const entries = [];
  const pattern = /\{\s*src\s*:\s*'([^']+)'\s*,\s*caption:\s*'([^']*)'\s*\}/g;

  for (const match of html.matchAll(pattern)) {
    entries.push({
      url: normalizeString(match[1]),
      caption: decodeJsString(match[2])
    });
  }

  return entries;
}

function extractMetaContent(html, attrName, attrValue) {
  const pattern = new RegExp(
    `<meta[^>]*${attrName}=["']${escapeRegExp(attrValue)}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i"
  );
  const match = html.match(pattern);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function extractLinkHref(html, relValue) {
  const pattern = new RegExp(
    `<link[^>]*rel=["']${escapeRegExp(relValue)}["'][^>]*href=["']([^"']*)["'][^>]*>`,
    "i"
  );
  const match = html.match(pattern);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function extractTagAttribute(html, tagName, attributeName) {
  if (attributeName === "innerHTML") {
    const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
    return match ? match[1] : "";
  }

  return "";
}

function stripHtml(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(value ?? "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, "$1")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+:/g, ":")
    )
  );
}

function formatAddress(streetAddress, city, stateRegion, postalCode, country) {
  const locality = [city, stateRegion, postalCode].filter(Boolean).join(", ");
  return [streetAddress, locality, country].filter(Boolean).join(", ");
}

function normalizeSources(sources) {
  const values = (Array.isArray(sources) ? sources : String(sources || "").split(","))
    .map((value) => normalizeString(value))
    .filter(Boolean);

  if (values.length === 0) {
    return Object.keys(INPUT_FILE_BY_SOURCE);
  }

  return values;
}

function normalizeRequestedHotelIds(sourceHotelIds) {
  return new Set(
    (Array.isArray(sourceHotelIds) ? sourceHotelIds : String(sourceHotelIds || "").split(","))
      .map((value) => normalizeString(value))
      .filter(Boolean)
  );
}

function normalizeConcurrency(value) {
  const number = Number.parseInt(String(value ?? DEFAULT_CONCURRENCY), 10);

  if (!Number.isFinite(number) || number < 1) {
    return DEFAULT_CONCURRENCY;
  }

  return Math.min(number, 24);
}

async function mapWithConcurrency(items, concurrency, iteratee, onResult) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);

      if (onResult) {
        await onResult(results[currentIndex], currentIndex);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}

function isMeaningfulValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return normalizeString(value) !== "";
}

function dedupeStrings(values) {
  return [...new Set(values.map((value) => normalizeString(value)).filter(Boolean))];
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeWhitespace(value) {
  return normalizeString(value).replace(/\s+/g, " ");
}

function toSnakeCase(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function decodeHtmlEntities(value) {
  return normalizeString(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&dagger;/g, "\u2020")
    .replace(/&Dagger;/g, "\u2021")
    .replace(/&ddagger;/gi, "\u2021")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeJsString(value) {
  return normalizeString(value)
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readBooleanEnv(name, fallback = false) {
  const value = process.env[name];

  if (value == null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeStageTwoOutputs({
    sources: process.env.AMEX_HOTELS_SOURCES,
    sourceHotelIds: process.env.AMEX_HOTELS_SOURCE_HOTEL_IDS,
    forceRefresh: readBooleanEnv("AMEX_HOTELS_FORCE_REFRESH", false),
    concurrency: process.env.AMEX_HOTELS_CONCURRENCY
  });
}
