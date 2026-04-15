import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inferChainFromBrand } from "../shared/brand-chain.mjs";
import { convertToUsd } from "../shared/currency.mjs";

const STAGE = "6-output";
const CANONICAL_INPUT_URL = new URL("../4-unique/hotel.json", import.meta.url);
const PRICE_DIRECTORY_URL = new URL("../5-price/prices/", import.meta.url);
const ASPIRE_TALLY_URL = new URL("../2-enrichment/aspire-tally-submissions.json", import.meta.url);
const PIPELINE_OUTPUT_URL = new URL("./hotels.json", import.meta.url);
const APP_OUTPUT_URL = new URL("../../public/data/hotels.json", import.meta.url);

const TALLY_QUESTION = {
  HOTEL_ID: "xQZOWJ",
  CREDIT_WITH_STAY: "R4LE2j",
  VENUE: "oBOXgx",
  STAY_DATE: "lARJgv",
};

export async function buildStageSixOutputs() {
  const canonicalRegistry = await readJsonRequired(CANONICAL_INPUT_URL);
  validateCanonicalRegistry(canonicalRegistry);

  const { byTripadvisorId: priceByTripadvisorId, byIpreferId: priceByIpreferId } = await readPriceDirectory();
  const aspireCreditByTripadvisorId = await readAspireCreditWithStay();
  const canonicalHotels = buildCanonicalHotels(canonicalRegistry.hotels, priceByTripadvisorId, aspireCreditByTripadvisorId);
  const fallbackHotels = buildFallbackHotels(canonicalRegistry.unmatched, priceByIpreferId);
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
        price_file_count: priceByTripadvisorId.size + priceByIpreferId.size
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

function buildCanonicalHotels(hotels, priceByTripadvisorId, aspireCreditByTripadvisorId = new Map()) {
  return Object.fromEntries(
    Object.entries(hotels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tripadvisorId, hotel]) => {
        const priceSummary = summarizePrices(priceByTripadvisorId.get(tripadvisorId));
        const aspireCreditWithStay = aspireCreditByTripadvisorId.get(tripadvisorId) ?? null;
        const canonicalHotel = {
          ...pickHotelFields(hotel),
          tripadvisor_id: normalizeString(hotel.tripadvisor_id) || tripadvisorId,
          tripadvisor_url: normalizeString(hotel.tripadvisor_url),
          source_keys: normalizeStringArray(hotel.source_keys),
          prices: priceSummary.prices,
          currency: priceSummary.currency
        };

        if (aspireCreditWithStay) {
          canonicalHotel.aspire_credit_with_stay = aspireCreditWithStay;
        }

        if (priceSummary.summaryPrice) {
          canonicalHotel.summary_price = priceSummary.summaryPrice;
        }

        if (priceSummary.ipreferPrices) {
          canonicalHotel.iprefer_prices = priceSummary.ipreferPrices;
        }

        if (priceSummary.choicePrices) {
          canonicalHotel.choice_prices = priceSummary.choicePrices;
        }

        const rawCash = canonicalHotel.hilton_cash_price;
        const rawCurrency = canonicalHotel.hilton_cash_currency;
        const rawPoints = canonicalHotel.hilton_standard_points_price || canonicalHotel.hilton_points_price;
        if (rawCash && rawCurrency && rawPoints) {
          try {
            const cashUsd = convertToUsd(rawCash, rawCurrency);
            const pointsNum = Number.parseFloat(rawPoints);
            const cashUsdNum = Number.parseFloat(cashUsd);
            if (cashUsd && Number.isFinite(pointsNum) && pointsNum > 0 && Number.isFinite(cashUsdNum)) {
              canonicalHotel.hilton_cash_price_usd = cashUsd;
              canonicalHotel.hilton_cpp = ((cashUsdNum / pointsNum) * 100).toFixed(4);
            }
          } catch (e) {
            console.warn(`[hilton] skipping CPP computation: ${e.message}`);
          }
        }

        return [
          tripadvisorId,
          sortObjectKeys(canonicalHotel)
        ];
      })
  );
}

function buildFallbackHotels(unmatched, priceByIpreferId) {
  return Object.fromEntries(
    Object.entries(unmatched)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fallbackId, hotel]) => {
        const ipreferSourceId = normalizeString(hotel.source_hotel_id);
        const priceSummary = ipreferSourceId ? summarizePrices(priceByIpreferId.get(ipreferSourceId)) : null;
        const entry = sortObjectKeys({
          id: fallbackId,
          record_type: "fallback",
          source: normalizeString(hotel.source),
          source_hotel_id: normalizeString(hotel.source_hotel_id),
          amex_url: normalizeString(hotel.amex_url),
          bilt_url: normalizeString(hotel.bilt_url),
          chase_url: normalizeString(hotel.chase_url),
          hilton_url: normalizeString(hotel.hilton_url),
          iprefer_url: normalizeString(hotel.iprefer_url),
          iprefer_points: normalizeString(hotel.iprefer_points),
          iprefer_synxis_id: normalizeString(hotel.iprefer_synxis_id),
          chase_2026_credit: normalizeString(hotel.chase_2026_credit),
          hilton_cash_currency: normalizeString(hotel.hilton_cash_currency),
          hilton_cash_price: normalizeString(hotel.hilton_cash_price),
          hilton_points_price: normalizeString(hotel.hilton_points_price),
          hilton_points_reward_type: normalizeString(hotel.hilton_points_reward_type),
          hilton_standard_points_price: normalizeString(hotel.hilton_standard_points_price),
          name: normalizeString(hotel.name),
          city: normalizeString(hotel.city),
          state_region: normalizeString(hotel.state_region),
          country: normalizeCountry(hotel.country),
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
        });

        if (priceSummary?.ipreferPrices) {
          entry.iprefer_prices = priceSummary.ipreferPrices;
        }

        if (priceSummary?.choicePrices) {
          entry.choice_prices = priceSummary.choicePrices;
        }

        const rawCash = entry.hilton_cash_price;
        const rawCurrency = entry.hilton_cash_currency;
        const rawPoints = entry.hilton_standard_points_price || entry.hilton_points_price;
        if (rawCash && rawCurrency && rawPoints) {
          try {
            const cashUsd = convertToUsd(rawCash, rawCurrency);
            const pointsNum = Number.parseFloat(rawPoints);
            const cashUsdNum = Number.parseFloat(cashUsd);
            if (cashUsd && Number.isFinite(pointsNum) && pointsNum > 0 && Number.isFinite(cashUsdNum)) {
              entry.hilton_cash_price_usd = cashUsd;
              entry.hilton_cpp = ((cashUsdNum / pointsNum) * 100).toFixed(4);
            }
          } catch (e) {
            console.warn(`[hilton] skipping CPP computation: ${e.message}`);
          }
        }

        return [fallbackId, sortObjectKeys(entry)];
      })
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

async function readAspireCreditWithStay() {
  let payload;
  try {
    payload = await readJsonRequired(ASPIRE_TALLY_URL);
  } catch {
    return new Map();
  }

  const submissions = Array.isArray(payload?.submissions) ? payload.submissions : [];
  const byTripadvisorId = new Map();

  for (const submission of submissions) {
    if (!submission.isCompleted) continue;

    const responses = Array.isArray(submission.responses) ? submission.responses : [];
    const byQuestion = Object.fromEntries(responses.map((r) => [r.questionId, r.answer]));

    const rawHotelId = byQuestion[TALLY_QUESTION.HOTEL_ID];
    const hotelId = normalizeString(typeof rawHotelId === "object" ? rawHotelId?.hotel_id : rawHotelId);
    if (!hotelId) continue;

    const creditAnswer = Array.isArray(byQuestion[TALLY_QUESTION.CREDIT_WITH_STAY])
      ? byQuestion[TALLY_QUESTION.CREDIT_WITH_STAY][0]
      : byQuestion[TALLY_QUESTION.CREDIT_WITH_STAY];
    const creditYes = normalizeString(creditAnswer).toLowerCase() === "yes";

    const venue = normalizeString(byQuestion[TALLY_QUESTION.VENUE]);
    const stayDate = normalizeString(byQuestion[TALLY_QUESTION.STAY_DATE]);

    if (!byTripadvisorId.has(hotelId)) {
      byTripadvisorId.set(hotelId, { yesCount: 0, noCount: 0, venues: [], lastReported: "" });
    }

    const entry = byTripadvisorId.get(hotelId);
    if (creditYes) {
      entry.yesCount += 1;
    } else {
      entry.noCount += 1;
    }
    if (venue) entry.venues.push(venue);
    if (stayDate && stayDate > entry.lastReported) entry.lastReported = stayDate;
  }

  const result = new Map();
  for (const [hotelId, entry] of byTripadvisorId) {
    const status =
      entry.yesCount > 0 && entry.noCount === 0
        ? "success"
        : entry.yesCount === 0 && entry.noCount > 0
          ? "failure"
          : "mixed";
    result.set(hotelId, sortObjectKeys({
      last_reported: entry.lastReported,
      no_count: entry.noCount,
      status,
      venues: [...new Set(entry.venues)].sort(),
      yes_count: entry.yesCount
    }));
  }

  return result;
}

async function readPriceDirectory() {
  try {
    const names = await readdir(PRICE_DIRECTORY_URL);
    const jsonNames = names.filter((name) => name.endsWith(".json")).sort((left, right) => left.localeCompare(right));
    const payloads = await Promise.all(
      jsonNames.map((name) => readJsonRequired(new URL(name, PRICE_DIRECTORY_URL)))
    );

    const byTripadvisorId = new Map();
    const byIpreferId = new Map();

    for (const payload of payloads) {
      const tripadvisorId = normalizeString(payload?.metadata?.tripadvisor_id);
      const ipreferId = normalizeString(payload?.metadata?.iprefer_source_id);

      if (tripadvisorId) {
        byTripadvisorId.set(tripadvisorId, payload);
      }

      if (ipreferId) {
        byIpreferId.set(ipreferId, payload);
      }
    }

    return { byTripadvisorId, byIpreferId };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { byTripadvisorId: new Map(), byIpreferId: new Map() };
    }

    throw error;
  }
}

function summarizePrices(payload) {
  if (!payload) {
    return {
      prices: {},
      currency: "",
      summaryPrice: null,
      ipreferPrices: null
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
    summaryPrice,
    ipreferPrices: summarizeIpreferPrices(payload.iprefer),
    choicePrices: summarizeChoicePrices(payload.choice)
  };
}

function summarizeIpreferPrices(iprefer) {
  if (!isRecord(iprefer) || !isRecord(iprefer.months)) {
    return null;
  }

  const months = sortEntriesObject(
    Object.fromEntries(
      Object.entries(iprefer.months)
        .map(([month, data]) => {
          if (!isRecord(data)) {
            return null;
          }

          const entry = {};
          const cashMin = normalizeString(data.cash_min);
          const cashMax = normalizeString(data.cash_max);
          const pointsMin = normalizeString(data.points_min);
          const pointsMax = normalizeString(data.points_max);

          if (cashMin) entry.cash_min = cashMin;
          if (cashMax) entry.cash_max = cashMax;
          if (typeof data.cash_available_nights === "number") entry.cash_available_nights = data.cash_available_nights;
          if (pointsMin) entry.points_min = pointsMin;
          if (pointsMax) entry.points_max = pointsMax;
          if (typeof data.points_available_nights === "number") entry.points_available_nights = data.points_available_nights;

          return [month, sortObjectKeys(entry)];
        })
        .filter(Boolean)
    )
  );

  if (!Object.keys(months).length) {
    return null;
  }

  return sortObjectKeys({
    currency: normalizeString(iprefer.currency),
    fetched_at: normalizeString(iprefer.fetched_at),
    months
  });
}

function summarizeChoicePrices(choice) {
  if (!isRecord(choice) || !isRecord(choice.months)) {
    return null;
  }

  const choicePointsValue = normalizeString(choice.choice_points_value);
  if (!choicePointsValue) {
    return null;
  }

  const months = sortEntriesObject(
    Object.fromEntries(
      Object.entries(choice.months)
        .map(([month, data]) => {
          if (!isRecord(data)) {
            return null;
          }

          const entry = {};
          if (typeof data.choice_available_nights === "number") entry.choice_available_nights = data.choice_available_nights;

          return [month, sortObjectKeys(entry)];
        })
        .filter(Boolean)
    )
  );

  if (!Object.keys(months).length) {
    return null;
  }

  return sortObjectKeys({
    choice_points_value: choicePointsValue,
    fetched_at: normalizeString(choice.fetched_at),
    months
  });
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
    amex_url: normalizeString(hotel.amex_url),
    bilt_url: normalizeString(hotel.bilt_url),
    chase_url: normalizeString(hotel.chase_url),
    hilton_url: normalizeString(hotel.hilton_url),
    iprefer_url: normalizeString(hotel.iprefer_url),
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
    iprefer_points: normalizeString(hotel.iprefer_points),
    iprefer_synxis_id: normalizeString(hotel.iprefer_synxis_id),
    chase_2026_credit: normalizeString(hotel.chase_2026_credit),
    hilton_cash_currency: normalizeString(hotel.hilton_cash_currency),
    hilton_cash_price: normalizeString(hotel.hilton_cash_price),
    hilton_points_price: normalizeString(hotel.hilton_points_price),
    hilton_points_reward_type: normalizeString(hotel.hilton_points_reward_type),
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

function normalizeCountry(value) {
  const s = normalizeString(value);
  if (s === "Taiwan China") return "Taiwan";
  return s;
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
