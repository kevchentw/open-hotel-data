import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const STAGE = "5-price";
const CANONICAL_INPUT_URL = new URL("../4-unique/hotel.json", import.meta.url);
const ASPIRE_ENRICHMENT_URL = new URL("../2-enrichment/hilton-aspire-hotel.json", import.meta.url);
const PRICE_DIRECTORY_URL = new URL("./prices/", import.meta.url);
const XOTELO_ENDPOINT = "https://data.xotelo.com/api/rates";
const DEFAULT_SAMPLE_OFFSETS = [30, 90];
const DEFAULT_XOTELO_CONCURRENCY = 4;
const DEFAULT_STAY_NIGHTS = 1;
const FORCE_REFRESH = parseBoolean(process.env.STAGE5_FORCE_REFRESH);
const FORCE_XOTELO = parseBoolean(process.env.STAGE5_FORCE_XOTELO);
const XOTELO_CONCURRENCY = parsePositiveInteger(process.env.STAGE5_XOTELO_CONCURRENCY, DEFAULT_XOTELO_CONCURRENCY);
const STAY_NIGHTS = parsePositiveInteger(process.env.STAGE5_STAY_NIGHTS, DEFAULT_STAY_NIGHTS);
const SAMPLE_STAY_DATES = getSampleStayDates();
const FILTER_HOTEL_IDS = getFilterHotelIds();
const CURRENCY_TO_USD = Object.freeze({
  USD: 1,
  AED: 0.27229408,
  AUD: 0.68932335,
  CAD: 0.71767828,
  CNY: 0.14511227,
  EUR: 1.15288793,
  FJD: 0.44333394,
  IDR: 0.00005881,
  INR: 0.01072347,
  JOD: 1.41043724,
  JPY: 0.00626832,
  KRW: 0.00066228,
  MAD: 0.10676457,
  MXN: 0.0559244,
  MYR: 0.24801021,
  NZD: 0.56956301,
  OMR: 2.60080053,
  PHP: 0.01653939,
  PLN: 0.26963721,
  QAR: 0.27472527,
  THB: 0.03062289,
  VND: 0.00003804,
  XPF: 0.00966122
});

export async function buildPriceArtifacts() {
  const { aspireHotels, existingArtifacts, hotels } = await loadPriceStageInputs();
  const artifactEntries = [];

  for (const [tripadvisorId, hotel] of hotels) {
    artifactEntries.push([
      tripadvisorId,
      await buildPriceArtifact({
        tripadvisorId,
        hotel,
        aspireHotels,
        existingArtifact: existingArtifacts.get(tripadvisorId) ?? null
      })
    ]);
  }

  return {
    metadata: {
      stage: STAGE,
      generated_at: new Date().toISOString(),
      hotel_count: artifactEntries.length,
      stay_date_count: SAMPLE_STAY_DATES.length,
      force_refresh: FORCE_REFRESH,
      force_xotelo: FORCE_XOTELO
    },
    artifacts: new Map(artifactEntries)
  };
}

export async function writePriceArtifacts() {
  const startedAt = new Date().toISOString();
  const { aspireHotels, existingArtifacts, hotels } = await loadPriceStageInputs();
  await mkdir(PRICE_DIRECTORY_URL, { recursive: true });
  const artifacts = new Map();

  console.log(
    `[stage5] starting price fetch for ${hotels.length} hotels ` +
      `(sample stay dates: ${SAMPLE_STAY_DATES.join(", ") || "none"})`
  );

  for (const [tripadvisorId, hotel] of hotels) {
    const artifact = await buildPriceArtifact({
      tripadvisorId,
      hotel,
      aspireHotels,
      existingArtifact: existingArtifacts.get(tripadvisorId) ?? null
    });

    await writeJson(new URL(`${tripadvisorId}.json`, PRICE_DIRECTORY_URL), artifact);
    artifacts.set(tripadvisorId, artifact);
    console.log(formatArtifactLogLine(tripadvisorId, hotel, artifact));
  }

  const metadata = {
    stage: STAGE,
    generated_at: startedAt,
    hotel_count: artifacts.size,
    stay_date_count: SAMPLE_STAY_DATES.length,
    force_refresh: FORCE_REFRESH,
    force_xotelo: FORCE_XOTELO
  };

  console.log(
    `[stage5] wrote ${artifacts.size} price artifacts to ${fileURLToPath(PRICE_DIRECTORY_URL)} ` +
      `(sample stay dates: ${SAMPLE_STAY_DATES.join(", ") || "none"})`
  );

  return { metadata, artifacts };
}

async function loadPriceStageInputs() {
  const canonicalRegistry = await readJsonRequired(CANONICAL_INPUT_URL);
  const aspireEnrichment = await readJsonRequired(ASPIRE_ENRICHMENT_URL);
  validateCanonicalRegistry(canonicalRegistry);
  validateEnrichmentPayload(aspireEnrichment, "hilton_aspire_resort_credit");

  const existingArtifacts = await readExistingPriceArtifacts();
  const hotels = Object.entries(canonicalRegistry.hotels)
    .filter(([tripadvisorId]) => !FILTER_HOTEL_IDS.size || FILTER_HOTEL_IDS.has(tripadvisorId))
    .sort(([left], [right]) => left.localeCompare(right));

  return {
    aspireHotels: aspireEnrichment.hotels ?? {},
    existingArtifacts,
    hotels
  };
}

async function buildPriceArtifact({ tripadvisorId, hotel, aspireHotels, existingArtifact }) {
  const generatedAt = new Date().toISOString();
  const previousSummary = normalizeSummaryPrice(existingArtifact?.summary_price);
  const previousPrices = normalizePrices(existingArtifact?.prices);
  let summaryPrice = previousSummary;
  let prices = previousPrices;

  const aspireResult = buildAspireSummaryPrice(hotel, aspireHotels);
  if (aspireResult && (FORCE_REFRESH || !summaryPrice)) {
    summaryPrice = aspireResult;
  }

  if (shouldFetchFhrPrices(hotel, summaryPrice, prices)) {
    prices = await mergeXoteloPrices({ tripadvisorId, existingPrices: prices });
  }

  const artifact = {
    metadata: sortObjectKeys({
      stage: STAGE,
      generated_at: generatedAt,
      tripadvisor_id: tripadvisorId
    }),
    prices
  };

  if (summaryPrice) {
    artifact.summary_price = summaryPrice;
  }

  return sortObjectKeys(artifact);
}

function buildAspireSummaryPrice(hotel, aspireHotels) {
  const sourceHotelId = getSourceHotelId(hotel, "hilton_aspire_resort_credit");
  if (!sourceHotelId) {
    return null;
  }

  const upstreamHotel = aspireHotels[sourceHotelId];
  if (!isRecord(upstreamHotel)) {
    return null;
  }

  const numericLowestPublicPrice = normalizeDecimal(upstreamHotel.lowest_public_price);
  const display = normalizeString(upstreamHotel.lowest_public_price_display);
  const originalCurrency = normalizeString(upstreamHotel.price_currency).toUpperCase();
  if (!numericLowestPublicPrice && !display) {
    return null;
  }

  let usdCost = "";
  if (display && originalCurrency && originalCurrency !== "USD") {
    const parsedDisplayAmount = parseDisplayAmount(display, originalCurrency);
    if (parsedDisplayAmount !== null) {
      usdCost = convertToUsd(parsedDisplayAmount, originalCurrency);
    }
  }

  if (!usdCost && numericLowestPublicPrice) {
    usdCost = normalizeDecimal(numericLowestPublicPrice);
  }

  if (!usdCost) {
    return null;
  }

  return sortObjectKeys({
    currency: "USD",
    source: "hilton_aspire_resort_credit",
    cost: usdCost,
    display,
    fetched_at: normalizeString(upstreamHotel.enriched_at) || new Date().toISOString(),
    original_currency: originalCurrency
  });
}

function shouldFetchFhrPrices(hotel, summaryPrice, prices) {
  const plans = normalizeStringArray(hotel.plans);
  if (!plans.includes("amex_fhr")) {
    return false;
  }

  if (summaryPrice && !FORCE_XOTELO && !FORCE_REFRESH) {
    return false;
  }

  if (FORCE_REFRESH) {
    return true;
  }

  return SAMPLE_STAY_DATES.some((stayDate) => !isRecord(prices[stayDate]));
}

async function mergeXoteloPrices({ tripadvisorId, existingPrices }) {
  const prices = { ...existingPrices };
  const datesToFetch = FORCE_REFRESH
    ? SAMPLE_STAY_DATES
    : SAMPLE_STAY_DATES.filter((stayDate) => !isRecord(prices[stayDate]));

  const fetchedEntries = await mapWithConcurrency(
    datesToFetch,
    XOTELO_CONCURRENCY,
    async (stayDate) => [stayDate, await fetchXoteloPrice(tripadvisorId, stayDate)]
  );

  for (const [stayDate, priceEntry] of fetchedEntries) {
    if (priceEntry) {
      prices[stayDate] = priceEntry;
    }
  }

  return sortEntriesObject(prices);
}

async function fetchXoteloPrice(tripadvisorId, stayDate) {
  const checkOutDate = addDays(stayDate, STAY_NIGHTS);
  const url = new URL(XOTELO_ENDPOINT);
  url.searchParams.set("hotel_key", tripadvisorId);
  url.searchParams.set("chk_in", stayDate);
  url.searchParams.set("chk_out", checkOutDate);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      console.warn(`Stage 5 xotelo fetch failed for ${tripadvisorId} ${stayDate}: HTTP ${response.status}`);
      return null;
    }

    const payload = await response.json();
    const result = payload?.result;
    const currency = normalizeString(result?.currency).toUpperCase() || "USD";
    const rates = Array.isArray(result?.rates) ? result.rates : [];
    const lowestCost = getLowestXoteloUsdCost(rates, currency);
    if (!lowestCost) {
      console.warn(`Stage 5 xotelo returned no usable rates for ${tripadvisorId} ${stayDate}`);
      return null;
    }

    return sortObjectKeys({
      currency: "USD",
      fetched_at: new Date().toISOString(),
      source: "xotelo",
      cost: lowestCost
    });
  } catch (error) {
    console.warn(`Stage 5 xotelo fetch failed for ${tripadvisorId} ${stayDate}: ${error.message}`);
    return null;
  }
}

function getLowestXoteloUsdCost(rates, currency) {
  const amounts = rates
    .map((rate) => {
      const baseRate = Number.parseFloat(String(rate?.rate ?? ""));
      const taxRate = Number.parseFloat(String(rate?.tax ?? ""));
      const total = Number.isFinite(baseRate) ? baseRate + (Number.isFinite(taxRate) ? taxRate : 0) : Number.NaN;
      return Number.isFinite(total) ? total : null;
    })
    .filter((value) => typeof value === "number");

  if (!amounts.length) {
    return "";
  }

  const lowest = Math.min(...amounts);
  return convertToUsd(lowest, currency);
}

async function readExistingPriceArtifacts() {
  try {
    const names = await readdir(PRICE_DIRECTORY_URL);
    const jsonNames = names.filter((name) => name.endsWith(".json")).sort((left, right) => left.localeCompare(right));
    const artifacts = await Promise.all(
      jsonNames.map(async (name) => {
        const payload = await readJsonRequired(new URL(name, PRICE_DIRECTORY_URL));
        const tripadvisorId = normalizeString(payload?.metadata?.tripadvisor_id || name.replace(/\.json$/u, ""));
        return [tripadvisorId, payload];
      })
    );
    return new Map(artifacts.filter(([tripadvisorId]) => tripadvisorId));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return new Map();
    }

    throw error;
  }
}

async function readJsonRequired(url) {
  const raw = await readFile(url, "utf8");
  return JSON.parse(raw);
}

async function writeJson(url, payload) {
  await writeFile(url, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function validateCanonicalRegistry(payload) {
  if (!payload || typeof payload !== "object" || !isRecord(payload.hotels)) {
    throw new Error('Malformed stage-4 canonical registry: expected object key "hotels"');
  }
}

function validateEnrichmentPayload(payload, expectedSource) {
  if (!payload || typeof payload !== "object" || !isRecord(payload.hotels)) {
    throw new Error('Malformed stage-2 enrichment payload: expected object key "hotels"');
  }

  const source = normalizeString(payload?.metadata?.source);
  if (source !== expectedSource) {
    throw new Error(`Unexpected stage-2 enrichment source: expected "${expectedSource}", received "${source}"`);
  }
}

function normalizeSummaryPrice(summaryPrice) {
  if (!isRecord(summaryPrice)) {
    return null;
  }

  const cost = normalizeDecimal(summaryPrice.cost);
  if (!cost) {
    return null;
  }

  return sortObjectKeys({
    currency: "USD",
    source: normalizeString(summaryPrice.source),
    cost,
    display: normalizeString(summaryPrice.display),
    fetched_at: normalizeString(summaryPrice.fetched_at),
    original_currency: normalizeString(summaryPrice.original_currency)
  });
}

function normalizePrices(prices) {
  if (!isRecord(prices)) {
    return {};
  }

  return sortEntriesObject(
    Object.fromEntries(
      Object.entries(prices)
        .filter(([stayDate]) => isIsoDate(stayDate))
        .map(([stayDate, price]) => [
          stayDate,
          sortObjectKeys({
            currency: "USD",
            fetched_at: normalizeString(price?.fetched_at),
            source: normalizeString(price?.source),
            cost: normalizeDecimal(price?.cost)
          })
        ])
        .filter(([, price]) => price.cost)
    )
  );
}

function getSourceHotelId(hotel, source) {
  const sourceKeys = normalizeStringArray(hotel?.source_keys);
  for (const sourceKey of sourceKeys) {
    const [keySource, ...rest] = sourceKey.split("::");
    if (keySource === source && rest.length) {
      return rest.join("::");
    }
  }

  return "";
}

function formatArtifactLogLine(tripadvisorId, hotel, artifact) {
  const plans = normalizeStringArray(hotel?.plans);
  const summaryPrice = normalizeSummaryPrice(artifact?.summary_price);
  const prices = normalizePrices(artifact?.prices);
  const stayDates = Object.keys(prices);
  const route = plans.includes("hilton_aspire_resort_credit")
    ? "aspire-upstream"
    : plans.includes("amex_fhr")
      ? "fhr-xotelo"
      : "noop";

  const parts = [
    "[stage5]",
    tripadvisorId,
    route,
    `summary=${summaryPrice ? summaryPrice.cost : "none"}`,
    `stays=${stayDates.length}`
  ];

  if (stayDates.length) {
    parts.push(`dates=${stayDates.join(",")}`);
  }

  return parts.join(" ");
}

function getSampleStayDates() {
  const explicitDates = normalizeString(process.env.STAGE5_XOTELO_STAY_DATES);
  if (explicitDates) {
    return Array.from(
      new Set(
        explicitDates
          .split(",")
          .map((value) => normalizeString(value))
          .filter((value) => isIsoDate(value))
      )
    ).sort((left, right) => left.localeCompare(right));
  }

  return DEFAULT_SAMPLE_OFFSETS.map((offset) => addDays(new Date().toISOString().slice(0, 10), offset));
}

function getFilterHotelIds() {
  return new Set(
    normalizeString(process.env.STAGE5_HOTEL_IDS)
      .split(",")
      .map((value) => normalizeString(value))
      .filter(Boolean)
  );
}

function parseDisplayAmount(display, currency) {
  const normalized = normalizeString(display);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/\s+/gu, "");
  const numericPortion = compact.replace(/[^\d.,-]/gu, "");
  if (!numericPortion) {
    return null;
  }

  const decimalSeparator = inferDecimalSeparator(numericPortion, currency);
  let normalizedNumber = numericPortion;

  if (decimalSeparator === ",") {
    normalizedNumber = normalizedNumber.replace(/\./gu, "").replace(/,/gu, ".");
  } else {
    normalizedNumber = normalizedNumber.replace(/,/gu, "");
  }

  const parsed = Number.parseFloat(normalizedNumber);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferDecimalSeparator(value, currency) {
  if (currency === "EUR" || currency === "PLN") {
    return value.includes(",") && !value.includes(".") ? "," : ".";
  }

  return ".";
}

function convertToUsd(amount, currency) {
  const numericAmount = Number.parseFloat(String(amount));
  if (!Number.isFinite(numericAmount)) {
    return "";
  }

  const normalizedCurrency = normalizeString(currency).toUpperCase() || "USD";
  const multiplier = CURRENCY_TO_USD[normalizedCurrency];
  if (!Number.isFinite(multiplier)) {
    throw new Error(`Missing USD transform rule for currency "${normalizedCurrency}"`);
  }

  return numericAmount === 0 ? "0.00" : numericAmountToString(numericAmount * multiplier);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, values.length || 1)) }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(values[currentIndex], currentIndex);
      }
    })
  );

  return results;
}

function numericAmountToString(value) {
  return value.toFixed(2);
}

function parseBoolean(value) {
  return /^true$/iu.test(normalizeString(value));
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeString(value))
    .filter(Boolean);
}

function normalizeDecimal(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/gu, ""));
  return Number.isFinite(parsed) ? numericAmountToString(parsed) : "";
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(normalizeString(value));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortEntriesObject(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

function sortObjectKeys(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writePriceArtifacts().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
