import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const STAGE = "5-price";
const CANONICAL_INPUT_URL = new URL("../4-unique/hotel.json", import.meta.url);
const ASPIRE_ENRICHMENT_URL = new URL("../2-enrichment/hilton-aspire-hotel.json", import.meta.url);
const PRICE_DIRECTORY_URL = new URL("./prices/", import.meta.url);
const XOTELO_ENDPOINT = "https://data.xotelo.com/api/rates";
const DEFAULT_XOTELO_CONCURRENCY = 5;
const DEFAULT_STAY_NIGHTS = 1;
const DEFAULT_SAMPLE_MODE = "representative";
const DEFAULT_SAMPLE_MONTHS = 12;
const DEFAULT_SAMPLE_WEEKDAY = 2;
const DEFAULT_SAMPLE_WEEKEND = 6;
const REPRESENTATIVE_WEEKEND_DAYS = new Set([0, 6]);
const FORCE_REFRESH = parseBoolean(process.env.STAGE5_FORCE_REFRESH);
const FORCE_XOTELO = parseBoolean(process.env.STAGE5_FORCE_XOTELO);
const XOTELO_CONCURRENCY = parsePositiveInteger(process.env.STAGE5_XOTELO_CONCURRENCY, DEFAULT_XOTELO_CONCURRENCY);
const STAY_NIGHTS = parsePositiveInteger(process.env.STAGE5_STAY_NIGHTS, DEFAULT_STAY_NIGHTS);
const SAMPLE_MODE = getSampleMode();
const SAMPLE_STAY_DATES = getSampleStayDates();
const FILTER_HOTEL_IDS = getFilterHotelIds();
const FILTER_HOTEL_PLANS = getFilterHotelPlans();
const CURRENCY_TO_USD = Object.freeze({
  USD: 1,
  AED: 0.27229,   // pegged ~3.6725/USD — stable, unchanged
  AUD: 0.69090,   // 1.4474 AUD/USD (x-rates Apr 3)
  CAD: 0.71820,   // 1.3924 CAD/USD (x-rates Apr 3)
  CNY: 0.14535,   // 6.8800 CNY/USD (x-rates Apr 3)
  EUR: 1.15355,   // 0.8669 EUR/USD (x-rates Apr 3) — nearly unchanged from your original
  FJD: 0.44949,   // ~2.225 FJD/USD (Wise/exchange-rates.org Mar–Apr 2026)
  IDR: 0.00005880, // ~17,006 IDR/USD (x-rates Apr 3)
  INR: 0.01077,   // 92.89 INR/USD (x-rates Apr 3)
  JOD: 1.41044,   // pegged ~0.7090 JOD/USD — stable (exchange-rates.org Apr 4)
  JPY: 0.00626,   // ~159.6 JPY/USD (TradingEconomics Apr 3)
  KRW: 0.000662,  // ~1,509.7 KRW/USD (x-rates Apr 3)
  MAD: 0.10638,   // ~9.40 MAD/USD (XE Apr 4)
  MXN: 0.05598,   // 17.863 MXN/USD (x-rates Apr 3)
  MYR: 0.24785,   // 4.0347 MYR/USD (x-rates Apr 3)
  NZD: 0.57121,   // 1.7507 NZD/USD (x-rates Apr 3)
  OMR: 2.59820,   // pegged ~0.3849 OMR/USD (x-rates Apr 3)
  PHP: 0.01657,   // 60.349 PHP/USD (x-rates Apr 3)
  PLN: 0.26965,   // 3.7086 PLN/USD (x-rates Apr 3)
  QAR: 0.27473,   // pegged ~3.64 QAR/USD — stable
  THB: 0.03062,   // 32.663 THB/USD (x-rates Apr 3)
  VND: 0.00003796, // ~26,340 VND/USD (TradingEconomics/XE Apr 3–4)
  XPF: 0.00967,   // ~103.4 XPF/USD (Wise Mar–Apr 2026)
});

export async function buildPriceArtifacts() {
  return runPriceStage({ persistArtifacts: false });
}

export async function writePriceArtifacts() {
  return runPriceStage({ persistArtifacts: true });
}

async function runPriceStage({ persistArtifacts }) {
  const startedAt = new Date().toISOString();
  const { aspireHotels, existingArtifacts, hotels } = await loadPriceStageInputs();
  const artifacts = new Map();
  const hotelStates = new Map();
  const progress = {
    completedTasks: 0,
    totalTasks: 0
  };

  if (persistArtifacts) {
    await mkdir(PRICE_DIRECTORY_URL, { recursive: true });
  }

  console.log(
    `[stage5] starting price fetch for ${hotels.length} hotels ` +
      `(sample mode: ${SAMPLE_MODE}, stay dates: ${SAMPLE_STAY_DATES.join(", ") || "none"})`
  );

  for (const [tripadvisorId, hotel] of hotels) {
    const hotelState = buildHotelState({
      tripadvisorId,
      hotel,
      aspireHotels,
      existingArtifact: existingArtifacts.get(tripadvisorId) ?? null
    });
    hotelStates.set(tripadvisorId, hotelState);
  }

  const taskQueue = buildCoverageFirstTaskQueue(
    hotels
      .map(([tripadvisorId]) => {
        const state = hotelStates.get(tripadvisorId);
        return {
          tripadvisorId,
          dates: state?.datesToFetch ?? []
        };
      })
      .filter(({ dates }) => dates.length)
  );
  progress.totalTasks = taskQueue.length;

  for (const [tripadvisorId, hotel] of hotels) {
    const state = hotelStates.get(tripadvisorId);
    if (!state || state.pendingTaskCount > 0) {
      continue;
    }

    await finalizeHotelState({ state, artifacts, persistArtifacts });
    console.log(formatArtifactLogLine(tripadvisorId, hotel, state.artifact));
  }

  await mapWithConcurrency(
    taskQueue,
    XOTELO_CONCURRENCY,
    async (task) => ({
      task,
      result: await fetchXoteloPrice(task.tripadvisorId, task.stayDate)
    }),
    async ({ task, result }) => {
      const state = hotelStates.get(task.tripadvisorId);
      if (!state) {
        return;
      }

      applyFetchResult({
        state,
        stayDate: task.stayDate,
        result
      });

      state.pendingTaskCount -= 1;
      progress.completedTasks += 1;
      logStageProgress(progress, task, result);
      if (state.pendingTaskCount === 0) {
        await finalizeHotelState({ state, artifacts, persistArtifacts });
        console.log(formatArtifactLogLine(task.tripadvisorId, state.hotel, state.artifact));
      }
    }
  );

  const metadata = sortObjectKeys({
    stage: STAGE,
    generated_at: startedAt,
    hotel_count: artifacts.size,
    stay_date_count: SAMPLE_STAY_DATES.length,
    sample_mode: SAMPLE_MODE,
    sample_months: SAMPLE_MODE === "representative"
      ? parsePositiveInteger(process.env.STAGE5_SAMPLE_MONTHS, DEFAULT_SAMPLE_MONTHS)
      : 0,
    force_refresh: FORCE_REFRESH,
    force_xotelo: FORCE_XOTELO,
    xotelo_concurrency: XOTELO_CONCURRENCY
  });

  console.log(
    `[stage5] ${persistArtifacts ? "wrote" : "built"} ${artifacts.size} price artifacts ` +
      `${persistArtifacts ? `to ${fileURLToPath(PRICE_DIRECTORY_URL)} ` : ""}` +
      `(sample mode: ${SAMPLE_MODE}, stay dates: ${SAMPLE_STAY_DATES.join(", ") || "none"})`
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

function buildHotelState({ tripadvisorId, hotel, aspireHotels, existingArtifact }) {
  const previousSummary = normalizeSummaryPrice(existingArtifact?.summary_price);
  const previousPrices = normalizePrices(existingArtifact?.prices);
  const previousSampleAttempts = normalizeSampleAttempts(existingArtifact?.sample_attempts);
  let summaryPrice = previousSummary;

  const aspireResult = buildAspireSummaryPrice(hotel, aspireHotels);
  if (aspireResult && (FORCE_REFRESH || !summaryPrice)) {
    summaryPrice = aspireResult;
  }

  const datesToFetch = getDatesToFetchForHotel({
    hotel,
    summaryPrice,
    prices: previousPrices,
    sampleAttempts: previousSampleAttempts,
    sampleStayDates: SAMPLE_STAY_DATES
  });

  return {
    tripadvisorId,
    hotel,
    summaryPrice,
    prices: { ...previousPrices },
    sampleAttempts: { ...previousSampleAttempts },
    datesToFetch,
    pendingTaskCount: datesToFetch.length,
    artifact: null,
    finalized: false
  };
}

async function finalizeHotelState({ state, artifacts, persistArtifacts }) {
  if (state.finalized) {
    return;
  }

  state.artifact = buildArtifactFromState(state);
  state.finalized = true;
  artifacts.set(state.tripadvisorId, state.artifact);

  if (persistArtifacts) {
    await writeJson(new URL(`${state.tripadvisorId}.json`, PRICE_DIRECTORY_URL), state.artifact);
  }
}

function buildArtifactFromState(state) {
  const artifact = {
    metadata: sortObjectKeys({
      stage: STAGE,
      generated_at: new Date().toISOString(),
      tripadvisor_id: state.tripadvisorId
    }),
    prices: sortEntriesObject(state.prices),
    sample_attempts: sortEntriesObject(state.sampleAttempts)
  };

  if (state.summaryPrice) {
    artifact.summary_price = state.summaryPrice;
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

export function getDatesToFetchForHotel({ hotel, summaryPrice, prices, sampleAttempts, sampleStayDates }) {
  const plans = normalizeStringArray(hotel?.plans);
  if (!plans.some((plan) => FILTER_HOTEL_PLANS.has(plan))) {
    return [];
  }

  if (summaryPrice && !FORCE_XOTELO && !FORCE_REFRESH) {
    return [];
  }

  if (FORCE_REFRESH) {
    return [...sampleStayDates];
  }

  return sampleStayDates.filter((stayDate) => {
    if (isRecord(prices[stayDate])) {
      return false;
    }

    return !isTerminalNoDataAttempt(sampleAttempts[stayDate]);
  });
}

export function buildCoverageFirstTaskQueue(hotelDatePlans) {
  const taskQueue = [];
  const maxDepth = hotelDatePlans.reduce((max, plan) => Math.max(max, plan.dates.length), 0);

  for (let index = 0; index < maxDepth; index += 1) {
    for (const plan of hotelDatePlans) {
      const stayDate = plan.dates[index];
      if (!stayDate) {
        continue;
      }

      taskQueue.push({
        tripadvisorId: plan.tripadvisorId,
        stayDate
      });
    }
  }

  return taskQueue;
}

function applyFetchResult({ state, stayDate, result }) {
  const fetchedAt = new Date().toISOString();
  const attempts = Array.isArray(result?.attempts) && result.attempts.length
    ? result.attempts
    : [{ stayDate, ...result }];

  for (const attempt of attempts) {
    delete state.sampleAttempts[attempt.stayDate];

    if (attempt.status === "price" && attempt.priceEntry) {
      state.prices[attempt.stayDate] = attempt.priceEntry;
      continue;
    }

    if (attempt.status === "no_data" || attempt.status === "fetch_error") {
      state.sampleAttempts[attempt.stayDate] = sortObjectKeys({
        fetched_at: fetchedAt,
        source: "xotelo",
        status: attempt.status,
        detail: normalizeString(attempt.detail),
        http_status: normalizeString(attempt.httpStatus)
      });
    }
  }
}

async function fetchXoteloPrice(tripadvisorId, stayDate) {
  const stayDatesToTry = SAMPLE_MODE === "representative"
    ? [stayDate, ...buildRepresentativeFallbackStayDates(stayDate)]
    : [stayDate];
  const attempts = [];

  for (const candidateStayDate of stayDatesToTry) {
    const result = await fetchSingleXoteloPrice(tripadvisorId, candidateStayDate);
    attempts.push({
      stayDate: candidateStayDate,
      ...result
    });

    if (result.status === "price") {
      return {
        status: "price",
        effectiveStayDate: candidateStayDate,
        priceEntry: result.priceEntry,
        attempts
      };
    }

    if (result.status === "fetch_error") {
      return {
        status: "fetch_error",
        effectiveStayDate: candidateStayDate,
        detail: result.detail,
        httpStatus: result.httpStatus,
        attempts
      };
    }
  }

  const lastAttempt = attempts[attempts.length - 1] ?? {
    stayDate,
    status: "no_data",
    detail: "no_usable_rates"
  };

  return {
    status: "no_data",
    effectiveStayDate: lastAttempt.stayDate,
    detail: lastAttempt.detail,
    httpStatus: lastAttempt.httpStatus,
    attempts
  };
}

async function fetchSingleXoteloPrice(tripadvisorId, stayDate) {
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
      return {
        status: "fetch_error",
        detail: "http_error",
        httpStatus: String(response.status)
      };
    }

    const payload = await response.json();
    const result = payload?.result;
    const currency = normalizeString(result?.currency).toUpperCase() || "USD";
    const rates = Array.isArray(result?.rates) ? result.rates : [];
    const lowestCost = getLowestXoteloUsdCost(rates, currency);
    if (!lowestCost) {
      console.warn(`Stage 5 xotelo returned no usable rates for ${tripadvisorId} ${stayDate}`);
      return {
        status: "no_data",
        detail: "no_usable_rates"
      };
    }

    return {
      status: "price",
      priceEntry: sortObjectKeys({
        currency: "USD",
        fetched_at: new Date().toISOString(),
        source: "xotelo",
        cost: lowestCost
      })
    };
  } catch (error) {
    console.warn(`Stage 5 xotelo fetch failed for ${tripadvisorId} ${stayDate}: ${error.message}`);
    return {
      status: "fetch_error",
      detail: normalizeString(error.message) || "fetch_exception"
    };
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

export function normalizeSampleAttempts(sampleAttempts) {
  if (!isRecord(sampleAttempts)) {
    return {};
  }

  return sortEntriesObject(
    Object.fromEntries(
      Object.entries(sampleAttempts)
        .filter(([stayDate]) => isIsoDate(stayDate))
        .map(([stayDate, attempt]) => [
          stayDate,
          sortObjectKeys({
            fetched_at: normalizeString(attempt?.fetched_at),
            source: normalizeString(attempt?.source),
            status: normalizeString(attempt?.status),
            detail: normalizeString(attempt?.detail),
            http_status: normalizeString(attempt?.http_status)
          })
        ])
        .filter(([, attempt]) => attempt.status === "no_data" || attempt.status === "fetch_error")
    )
  );
}

export function buildRepresentativeFallbackStayDates(stayDate) {
  if (!isIsoDate(stayDate)) {
    return [];
  }

  const parsedDate = new Date(`${stayDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    return [];
  }

  const isWeekendSeed = REPRESENTATIVE_WEEKEND_DAYS.has(parsedDate.getUTCDay());
  const currentMonth = parsedDate.getUTCMonth();
  const candidate = new Date(parsedDate);
  const fallbackDates = [];

  candidate.setUTCDate(candidate.getUTCDate() + 1);

  while (candidate.getUTCMonth() === currentMonth) {
    const candidateIsWeekend = REPRESENTATIVE_WEEKEND_DAYS.has(candidate.getUTCDay());
    if (candidateIsWeekend === isWeekendSeed) {
      fallbackDates.push(candidate.toISOString().slice(0, 10));
    }

    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return fallbackDates;
}

function isTerminalNoDataAttempt(attempt) {
  return isRecord(attempt) && normalizeString(attempt.status) === "no_data";
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
  const sampleAttempts = normalizeSampleAttempts(artifact?.sample_attempts);
  const stayDates = Object.keys(prices);
  const noDataCount = Object.values(sampleAttempts).filter((attempt) => attempt.status === "no_data").length;
  const retryableErrorCount = Object.values(sampleAttempts).filter((attempt) => attempt.status === "fetch_error").length;
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
    `stays=${stayDates.length}`,
    `no_data=${noDataCount}`,
    `retryable_errors=${retryableErrorCount}`
  ];

  if (stayDates.length) {
    parts.push(`dates=${stayDates.join(",")}`);
  }

  return parts.join(" ");
}

function logStageProgress(progress, task, result) {
  if (!progress.totalTasks) {
    return;
  }

  const status = normalizeString(result?.status) || "unknown";
  const effectiveStayDate = normalizeString(result?.effectiveStayDate);
  const resolvedSuffix = effectiveStayDate && effectiveStayDate !== task.stayDate
    ? ` -> ${effectiveStayDate}`
    : "";
  const percent = Math.floor((progress.completedTasks / progress.totalTasks) * 100);
  console.log(
    `[stage5] progress ${progress.completedTasks}/${progress.totalTasks} (${percent}%) ` +
      `${task.tripadvisorId} ${task.stayDate}${resolvedSuffix} ${status}`
  );
}

function getSampleMode() {
  if (normalizeString(process.env.STAGE5_XOTELO_STAY_DATES)) {
    return "explicit";
  }

  if (normalizeString(process.env.STAGE5_XOTELO_STAY_MONTHS)) {
    return "months";
  }

  const requestedMode = normalizeString(process.env.STAGE5_SAMPLE_MODE).toLowerCase();
  return requestedMode === "explicit" ? "explicit" : DEFAULT_SAMPLE_MODE;
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

  const explicitMonths = normalizeString(process.env.STAGE5_XOTELO_STAY_MONTHS);
  if (explicitMonths) {
    const workday = normalizeDayOfWeek(process.env.STAGE5_SAMPLE_WEEKDAY, DEFAULT_SAMPLE_WEEKDAY);
    const weekend = normalizeDayOfWeek(process.env.STAGE5_SAMPLE_WEEKEND, DEFAULT_SAMPLE_WEEKEND);
    return buildStayDatesForMonths({
      months: explicitMonths.split(",").map((value) => normalizeString(value)).filter(isIsoYearMonth),
      weekday: workday,
      weekendDay: weekend
    });
  }

  if (SAMPLE_MODE === "explicit") {
    return [];
  }

  const sampleMonths = parsePositiveInteger(process.env.STAGE5_SAMPLE_MONTHS, DEFAULT_SAMPLE_MONTHS);
  const workday = normalizeDayOfWeek(process.env.STAGE5_SAMPLE_WEEKDAY, DEFAULT_SAMPLE_WEEKDAY);
  const weekend = normalizeDayOfWeek(process.env.STAGE5_SAMPLE_WEEKEND, DEFAULT_SAMPLE_WEEKEND);
  return buildRepresentativeStayDates({
    startDate: getCurrentMonthAnchorDate(),
    months: sampleMonths,
    weekday: workday,
    weekendDay: weekend
  });
}

export function buildStayDatesForMonths({ months, weekday, weekendDay }) {
  const sampleDates = [];

  for (const yearMonth of months) {
    const [year, month] = yearMonth.split("-").map(Number);
    const monthIndex = month - 1;
    sampleDates.push(getNthWeekdayOfMonth({ year, monthIndex, dayOfWeek: weekday, occurrence: 2 }));
    sampleDates.push(getNthWeekdayOfMonth({ year, monthIndex, dayOfWeek: weekendDay, occurrence: 2 }));
  }

  return Array.from(new Set(sampleDates)).sort((left, right) => left.localeCompare(right));
}

export function buildRepresentativeStayDates({ startDate, months, weekday, weekendDay }) {
  const normalizedStartDate = isIsoDate(startDate) ? startDate : new Date().toISOString().slice(0, 10);
  const start = new Date(`${normalizedStartDate}T00:00:00.000Z`);
  const sampleDates = [];

  for (let offset = 0; offset < Math.max(0, months); offset += 1) {
    const year = start.getUTCFullYear();
    const monthIndex = start.getUTCMonth() + offset;
    const currentYear = year + Math.floor(monthIndex / 12);
    const currentMonth = monthIndex % 12;

    sampleDates.push(getNthWeekdayOfMonth({ year: currentYear, monthIndex: currentMonth, dayOfWeek: weekday, occurrence: 2 }));
    sampleDates.push(getNthWeekdayOfMonth({ year: currentYear, monthIndex: currentMonth, dayOfWeek: weekendDay, occurrence: 2 }));
  }

  return Array.from(new Set(sampleDates)).sort((left, right) => left.localeCompare(right));
}

function getCurrentMonthAnchorDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function getNthWeekdayOfMonth({ year, monthIndex, dayOfWeek, occurrence }) {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const firstDayOfWeek = firstOfMonth.getUTCDay();
  const dayOffset = (dayOfWeek - firstDayOfWeek + 7) % 7;
  const dayOfMonth = 1 + dayOffset + ((occurrence - 1) * 7);
  return new Date(Date.UTC(year, monthIndex, dayOfMonth)).toISOString().slice(0, 10);
}

function normalizeDayOfWeek(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6 ? parsed : fallback;
}

function getFilterHotelIds() {
  return new Set(
    normalizeString(process.env.STAGE5_HOTEL_IDS)
      .split(",")
      .map((value) => normalizeString(value))
      .filter(Boolean)
  );
}

function getFilterHotelPlans() {
  const explicit = normalizeString(process.env.STAGE5_HOTEL_PLANS)
    .split(",")
    .map((value) => normalizeString(value))
    .filter(Boolean);
  return new Set(explicit.length ? explicit : ["amex_fhr"]);
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
    if (value.includes(",") && !value.includes(".")) {
      const parts = value.split(",");
      if (
        parts.length === 2 &&
        /^\d{1,3}$/u.test(parts[0]) &&
        /^\d{3}$/u.test(parts[1])
      ) {
        return ".";
      }

      return ",";
    }

    return ".";
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

export async function mapWithConcurrency(values, concurrency, mapper, onResult) {
  const results = new Array(values.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, values.length || 1)) }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(values[currentIndex], currentIndex);
        if (typeof onResult === "function") {
          await onResult(results[currentIndex], currentIndex);
        }
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

function isIsoYearMonth(value) {
  return /^\d{4}-\d{2}$/u.test(normalizeString(value));
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
