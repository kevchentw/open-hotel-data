import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { normalizeText } from "./shared/normalize.mjs";

const SOURCE = "hilton_aspire_resort_credit";
const SOURCE_URL = "https://www.hilton.com/en/p/hilton-honors/resort-credit-eligible-hotels/";
const PLAN_NAME = "Hilton Honors Aspire Resort Credit";
const OUTPUT_FILE_URL = new URL("../aspire-hotel.json", import.meta.url);
const OUTPUT_DIRECTORY_URL = new URL("../", import.meta.url);

const BRAND_TABS = [
  "Conrad Hotels & Resorts",
  "Curio Collection by Hilton",
  "DoubleTree by Hilton",
  "Embassy Suites by Hilton",
  "Hampton by Hilton",
  "Hilton Grand Vacation Club",
  "Hilton Hotels & Resorts",
  "Homewood Suites by Hilton",
  "LXR Hotels & Resorts",
  "Signia by Hilton",
  "Tapestry Collection by Hilton",
  "Waldorf Astoria Hotels & Resorts"
];

export async function collectHotels() {
  const html = await fetchSourceHtml();
  const sections = extractBrandSections(html);
  const hotels = [];
  const usedSourceHotelIds = new Map();

  for (const section of sections) {
    const sectionHotels = extractHotelsFromSection(section);

    for (const hotel of sectionHotels) {
      const baseSourceHotelId = createSourceHotelId(hotel.url);
      const sourceHotelId = createUniqueSourceHotelId(
        usedSourceHotelIds,
        baseSourceHotelId,
        hotel.name,
        section.brand
      );

      hotels.push({
        source: SOURCE,
        sourceHotelId,
        name: hotel.name,
        websiteUrl: hotel.url,
        chain: "Hilton",
        brand: section.brand,
        city: "",
        stateRegion: "",
        country: "",
        tripadvisorKey: "",
        latitude: "",
        longitude: "",
        formattedAddress: "",
        geoProvider: "",
        geoConfidence: "",
        geoPlaceId: "",
        geoTypes: "",
        geoPartialMatch: "",
        geoStatus: "",
        lastVerifiedAt: todayIsoDate()
      });
    }
  }

  return hotels.sort((left, right) => {
    return (
      left.brand.localeCompare(right.brand) ||
      left.name.localeCompare(right.name) ||
      left.sourceHotelId.localeCompare(right.sourceHotelId)
    );
  });
}

export async function writeStageOneOutputs() {
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });

  const hotels = await collectHotels();
  const generatedAt = new Date().toISOString();
  const payload = buildStagePayload(hotels, generatedAt);

  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${payload.metadata.record_count} hotels to ${OUTPUT_FILE_URL.pathname}`);
}

async function fetchSourceHtml() {
  const response = await fetch(SOURCE_URL, {
    headers: {
      "user-agent": "open-hotel-data crawler"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Hilton Aspire source page: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function extractBrandSections(html) {
  const panelIds = [...html.matchAll(/id="(tab-panel--page-[^"]+)"/g)].map((match) => match[1]);
  const brandPanelIds = panelIds.slice(0, BRAND_TABS.length);

  if (brandPanelIds.length < BRAND_TABS.length) {
    throw new Error(
      `Expected ${BRAND_TABS.length} Hilton Aspire brand panels but found ${brandPanelIds.length}`
    );
  }

  const sections = brandPanelIds.map((panelId, index) => ({
    brand: BRAND_TABS[index],
    panelId
  }));

  return sections.map((section, index) => {
    const start = html.indexOf(`id="${section.panelId}"`);

    if (start === -1) {
      throw new Error(`Could not find Hilton Aspire tab panel: ${section.panelId}`);
    }

    return {
      brand: section.brand,
      html: extractPanelHtml(html, start)
    };
  });
}

function extractHotelsFromSection(section) {
  const hotelsByKey = new Map();
  const contentHtml = extractSectionContentHtml(section.html);

  for (const match of contentHtml.matchAll(/<a\b[^>]*href="(https:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = normalizeHotelUrl(match[1]);
    const name = decodeHtmlEntities(stripHtml(match[2]));

    if (!url || !name) {
      continue;
    }

    const dedupeKey = `${section.brand}::${name}`;
    const existing = hotelsByKey.get(dedupeKey);

    if (!existing || shouldReplaceHotelUrl(existing.url, url)) {
      hotelsByKey.set(dedupeKey, { name, url });
    }
  }

  return [...hotelsByKey.values()];
}

function extractSectionContentHtml(sectionHtml) {
  return sectionHtml;
}

function shouldReplaceHotelUrl(currentUrl, nextUrl) {
  const currentPath = new URL(currentUrl).pathname;
  const nextPath = new URL(nextUrl).pathname;

  if (nextPath.length !== currentPath.length) {
    return nextPath.length > currentPath.length;
  }

  return nextUrl < currentUrl;
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

function createSourceHotelId(url) {
  const parsedUrl = new URL(url);
  const hiltonPath = parsedUrl.pathname.replace(/^\/[a-z]{2}\/hotels\//, "").replace(/^\/+|\/+$/g, "");

  if (hiltonPath !== parsedUrl.pathname.replace(/^\/+|\/+$/g, "")) {
    return hiltonPath;
  }

  return [parsedUrl.hostname, parsedUrl.pathname]
    .join("/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9/.-]+/g, "-");
}

function normalizeHotelUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    if (url.hostname === "www.hilton.com") {
      url.pathname = url.pathname
        .replace(/^\/[a-z]{2}\//, "/en/")
        .replace(/\/+$/, "");
    } else {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return "";
  }
}

function createUniqueSourceHotelId(usedSourceHotelIds, baseSourceHotelId, name, brand) {
  const currentKey = `${brand}::${name}`;
  const existingKey = usedSourceHotelIds.get(baseSourceHotelId);

  if (!existingKey) {
    usedSourceHotelIds.set(baseSourceHotelId, currentKey);
    return baseSourceHotelId;
  }

  if (existingKey === currentKey) {
    return baseSourceHotelId;
  }

  let candidate = `${baseSourceHotelId}--${slugifyValue(name)}`;
  let counter = 2;

  while (usedSourceHotelIds.has(candidate) && usedSourceHotelIds.get(candidate) !== currentKey) {
    candidate = `${baseSourceHotelId}--${slugifyValue(name)}-${counter}`;
    counter += 1;
  }

  usedSourceHotelIds.set(candidate, currentKey);
  return candidate;
}

function extractPanelHtml(html, startIndex) {
  const divStart = html.lastIndexOf("<div", startIndex);

  if (divStart === -1) {
    throw new Error("Could not locate panel opening div");
  }

  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = divStart;

  let depth = 0;
  let match;

  while ((match = tagPattern.exec(html))) {
    if (match[0].startsWith("</div")) {
      depth -= 1;

      if (depth === 0) {
        return html.slice(divStart, tagPattern.lastIndex);
      }

      continue;
    }

    depth += 1;
  }

  throw new Error("Could not find panel closing div");
}

function stripHtml(value) {
  return normalizeText(String(value).replace(/<[^>]+>/g, " "));
}

function decodeHtmlEntities(value) {
  return normalizeText(
    String(value)
      .replace(/&#x27;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&nbsp;/gi, " ")
  );
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function slugifyValue(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
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
