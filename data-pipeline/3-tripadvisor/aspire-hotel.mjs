import { mkdir, readFile, writeFile } from "node:fs/promises";
import Papa from "papaparse";

const SOURCE = "hilton_aspire_resort_credit";
const INPUT_STAGE_ONE_FILE_URL = new URL("../1-list/aspire-hotel.json", import.meta.url);
const INPUT_CSV_FILE_URL = new URL("./input/aspire-hotel.csv", import.meta.url);
const OUTPUT_FILE_URL = new URL("./aspire-hotel.json", import.meta.url);
const OUTPUT_DIRECTORY_URL = new URL("./", import.meta.url);

export async function buildAspireTripadvisorMatches() {
  const [stageOneHotels, csvRows] = await Promise.all([readStageOneHotels(), readInputCsv()]);
  const generatedAt = new Date().toISOString();
  const stageOneEntries = Object.values(stageOneHotels);
  const stageOneLookup = buildStageOneLookup(stageOneEntries);
  const matches = {};

  for (const row of csvRows) {
    const stageOneHotel = findStageOneHotelForRow(stageOneLookup, row);

    if (!stageOneHotel) {
      throw new Error(`Could not map CSV row back to stage 1 hotel: ${row["Hilton 官網"] || row["飯店名稱"]}`);
    }

    matches[stageOneHotel.source_hotel_id] = buildMatchRecord(stageOneHotel, row, generatedAt);

  }

  for (const hotel of stageOneEntries) {
    if (matches[hotel.source_hotel_id]) {
      continue;
    }

    matches[hotel.source_hotel_id] = buildUnmatchedRecord(hotel, generatedAt);
  }

  const recordCount = Object.keys(matches).length;
  const matchedCount = Object.values(matches).filter((match) => match.tripadvisor_id).length;

  return {
    metadata: {
      stage: "3-tripadvisor",
      source: SOURCE,
      generated_at: generatedAt,
      record_count: recordCount,
      matched_count: matchedCount,
      unmatched_count: recordCount - matchedCount,
      input_csv: INPUT_CSV_FILE_URL.pathname
    },
    matches
  };
}

export async function writeStageThreeOutputs() {
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });
  const payload = await buildAspireTripadvisorMatches();
  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${payload.metadata.record_count} Aspire stage 3 records to ${OUTPUT_FILE_URL.pathname} ` +
      `(${payload.metadata.matched_count} matched)`
  );
}

async function readStageOneHotels() {
  const raw = await readFile(INPUT_STAGE_ONE_FILE_URL, "utf8");
  const payload = JSON.parse(raw);
  return payload.hotels ?? {};
}

async function readInputCsv() {
  const raw = await readFile(INPUT_CSV_FILE_URL, "utf8");
  const parsed = Papa.parse(raw, {
    header: true,
    skipEmptyLines: true
  });

  if (parsed.errors.length > 0) {
    throw new Error(`Failed to parse Aspire TripAdvisor CSV: ${parsed.errors[0].message}`);
  }

  return parsed.data;
}

function buildStageOneLookup(stageOneEntries) {
  const byUrl = new Map();
  const byBrandAndName = new Map();

  for (const hotel of stageOneEntries) {
    const normalizedUrl = normalizeHiltonUrl(hotel.url);
    if (normalizedUrl) {
      const existing = byUrl.get(normalizedUrl) ?? [];
      existing.push(hotel);
      byUrl.set(normalizedUrl, existing);
    }

    byBrandAndName.set(createBrandNameKey(hotel.brand, hotel.name), hotel);
  }

  return { byUrl, byBrandAndName };
}

function findStageOneHotelForRow(stageOneLookup, row) {
  const brandNameKey = createBrandNameKey(row.品牌, row["飯店名稱"]);
  if (stageOneLookup.byBrandAndName.has(brandNameKey)) {
    return stageOneLookup.byBrandAndName.get(brandNameKey);
  }

  const normalizedHiltonUrl = normalizeHiltonUrl(row["Hilton 官網"]);
  const urlMatches = normalizedHiltonUrl ? stageOneLookup.byUrl.get(normalizedHiltonUrl) ?? [] : [];

  if (urlMatches.length === 1) {
    return urlMatches[0];
  }

  if (urlMatches.length > 1) {
    const normalizedName = normalizeText(row["飯店名稱"]);
    const exactNameMatch = urlMatches.find((hotel) => normalizeText(hotel.name) === normalizedName);
    if (exactNameMatch) {
      return exactNameMatch;
    }
  }

  return null;
}

function buildMatchRecord(stageOneHotel, row, matchedAt) {
  const tripadvisorUrl = normalizeWebUrl(row.TripAdvisor);
  const tripadvisorId = extractTripadvisorId(tripadvisorUrl);

  if (!tripadvisorId) {
    return buildUnmatchedRecord(stageOneHotel, matchedAt, row);
  }

  return {
    tripadvisor_id: tripadvisorId,
    tripadvisor_url: tripadvisorUrl,
    search_query: buildSearchQuery(row, stageOneHotel),
    match_confidence: "high",
    matched_at: matchedAt
  };
}

function buildUnmatchedRecord(stageOneHotel, matchedAt, row = null) {
  return {
    tripadvisor_id: "",
    tripadvisor_url: "",
    search_query: buildSearchQuery(row, stageOneHotel),
    match_confidence: "none",
    matched_at: matchedAt
  };
}

function buildSearchQuery(row, stageOneHotel) {
  const parts = [
    row?.["飯店名稱"] || stageOneHotel.name || "",
    row?.城市 || stageOneHotel.city || "",
    row?.國家 || stageOneHotel.country || "",
    "TripAdvisor"
  ];

  return parts.filter(Boolean).join(" ");
}

function extractTripadvisorId(url) {
  if (!url) {
    return "";
  }

  const match = url.match(/g\d+-d\d+/i);
  return match ? match[0] : "";
}

function normalizeHiltonUrl(value) {
  const url = normalizeWebUrl(value);
  if (!url) {
    return "";
  }

  const parsedUrl = new URL(url);
  const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "");
  return `${parsedUrl.origin}${normalizedPath}`.toLowerCase();
}

function normalizeWebUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

function createBrandNameKey(brand, name) {
  return [brand, name]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join("::");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  writeStageThreeOutputs().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
