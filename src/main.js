import "./styles.css";

const HOTELS_URL = "./data/hotels.json";
const FORUM_REVIEWS_URL = "./data/forum-reviews.json";
const DEFAULT_BUCKET = "aspire";
const LIST_PAGE_SIZE = 120;
const PRICE_BUCKET_SIZE = 100;
const PRICE_COLOR_STOPS = [
  { bucketStart: 0, color: "#2a9d8f" },
  { bucketStart: 300, color: "#65b96f" },
  { bucketStart: 600, color: "#e9c46a" },
  { bucketStart: 900, color: "#f4a261" },
  { bucketStart: 1200, color: "#e76f51" },
  { bucketStart: 1600, color: "#c8553d" },
  { bucketStart: 2200, color: "#7d4e57" },
  { bucketStart: 3000, color: "#5c4d7d" },
  { bucketStart: 5000, color: "#355070" },
];
const POINTS_BUCKET_SIZE = 5000;
const POINTS_COLOR_STOPS = [
  { bucketStart: 0, color: "#2a9d8f" },
  { bucketStart: 10000, color: "#65b96f" },
  { bucketStart: 20000, color: "#e9c46a" },
  { bucketStart: 35000, color: "#f4a261" },
  { bucketStart: 50000, color: "#e76f51" },
  { bucketStart: 75000, color: "#c8553d" },
  { bucketStart: 100000, color: "#7d4e57" },
  { bucketStart: 150000, color: "#355070" },
];
const CHOICE_POINTS_BUCKET_SIZE = 5000;
const CHOICE_POINTS_COLOR_STOPS = [
  { bucketStart: 20000, color: "#2a9d8f" },
  { bucketStart: 30000, color: "#65b96f" },
  { bucketStart: 40000, color: "#e9c46a" },
  { bucketStart: 50000, color: "#f4a261" },
  { bucketStart: 60000, color: "#e76f51" },
  { bucketStart: 70000, color: "#c8553d" },
  { bucketStart: 80000, color: "#7d4e57" },
  { bucketStart: 90000, color: "#355070" },
];
const WORLD_VIEW = {
  center: [20, 0],
  zoom: 2,
};

const PLAN_CONFIG = {
  aspire: {
    key: "aspire",
    label: "Aspire",
    plans: ["hilton_aspire_resort_credit"],
    description: "Hilton Aspire resorts that are not also in Amex FHR or THC.",
  },
  fhr_thc: {
    key: "fhr_thc",
    label: "FHR/THC",
    plans: ["amex_fhr", "amex_thc"],
    description: "Amex Fine Hotels + Resorts and The Hotel Collection properties.",
  },
  iprefer: {
    key: "iprefer",
    label: "iPrefer",
    plans: ["iprefer_points"],
    description: "I Prefer hotels that support points redemption.",
  },
  edit: {
    key: "edit",
    label: "Edit",
    plans: ["chase_edit"],
    description: "Chase Edit hotels from the 2026 stack source (Award Helper). Indicates whether each hotel has chase_2026_credit.",
  },
  hilton: {
    key: "hilton",
    label: "Hilton",
    plans: ["hilton_brands"],
    description: "Hilton luxury brands (Conrad, Waldorf Astoria, LXR, SLH) scraped from hilton.com with live points and cash pricing.",
  },
  bilt_hafh: {
    key: "bilt_hafh",
    label: "Bilt",
    plans: ["bilt_hafh"],
    description: "Bilt Home Away From Home hotels eligible for Bilt Rewards points.",
  },
};

const PLAN_LABELS = {
  hilton_aspire_resort_credit: "Aspire",
  amex_fhr: "FHR",
  amex_thc: "THC",
  chase_edit: "Edit",
  hilton_brands: "Hilton",
  iprefer_points: "iPrefer",
  bilt_hafh: "Bilt",
};

const state = {
  hotels: [],
  hotelsById: new Map(),
  filteredHotels: [],
  mapViewportHotels: [],
  visibleListHotels: [],
  selectedHotelId: null,
  listPanelMode: "list",
  bucket: DEFAULT_BUCKET,
  search: "",
  brand: "all",
  chain: "all",
  country: "all",
  overlapPlan: "all",
  amenities: [],
  sort: "price-asc",
  listLimit: LIST_PAGE_SIZE,
  meta: {},
  shouldResetMapView: true,
  preserveDetailUntil: 0,
  ipreferMapMode: "cash",
  hiltonMapMode: "points",
  hiltonStandardOnly: true,
  ipreferHasPoints: false,
  choiceHasPoints: false,
  editSelectHotels: false,
  hasForumReview: false,
  aspireCreditWithStayFilter: false,
  fhrThcSubFilter: "fhr",
  lastTrackedBucket: null,
};

let map = null;
let markersLayer = null;
let dom = {};
let forumReviewsMap = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toFiniteNumber(value) {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeCountry(value) {
  if (value === "Taiwan China") return "Taiwan";
  if (value === "USA") return "United States";
  return value;
}

function titleCaseWords(value) {
  return String(value ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function trackEvent(name, params = {}) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") {
    return;
  }

  window.gtag("event", name, params);
}

function getBucketLabel(bucket) {
  return PLAN_CONFIG[bucket]?.label || bucket;
}

function getHotelAnalyticsParams(hotel) {
  return {
    hotel_id: hotel.id,
    hotel_name: hotel.name,
    hotel_brand: hotel.brand,
    hotel_city: hotel.city,
    hotel_country: hotel.country,
    hotel_bucket: hotel.bucket,
    hotel_bucket_label: getBucketLabel(hotel.bucket),
    hotel_plans: hotel.plans.join(","),
    hotel_plan_labels: hotel.planLabels.join(","),
  };
}

function trackBucketView() {
  if (state.lastTrackedBucket === state.bucket) {
    return;
  }

  state.lastTrackedBucket = state.bucket;
  const bucketHotels = getBucketHotels();
  trackEvent("hotel_plan_view", {
    hotel_bucket: state.bucket,
    hotel_bucket_label: getBucketLabel(state.bucket),
    hotel_count: bucketHotels.length,
  });
}

function formatPointsLabel(pointsRaw) {
  if (!pointsRaw) return "Reward Nights";
  const parts = String(pointsRaw).split("-").map((p) => {
    const n = Number(p.trim());
    return Number.isFinite(n) ? formatNumber(n) : p.trim();
  });
  return `${parts.join("–")} pts/night`;
}

function formatIpreferPointsLabel(pointsMin, pointsMax) {
  if (pointsMin === null) return "N/A";
  if (pointsMax === null || pointsMin === pointsMax) return `${formatNumber(pointsMin)} pts`;
  return `${formatNumber(pointsMin)}–${formatNumber(pointsMax)} pts`;
}

function buildIpreferSummary(rawHotel) {
  const ipreferPrices = rawHotel.iprefer_prices;
  const choicePrices = rawHotel.choice_prices;
  const hasIprefer = ipreferPrices && typeof ipreferPrices === "object" && !Array.isArray(ipreferPrices);
  const hasChoice = choicePrices && typeof choicePrices === "object" && !Array.isArray(choicePrices);

  if (!hasIprefer && !hasChoice) {
    return { pointsMin: null, pointsMax: null, cashMin: null, cashMax: null, currency: "USD", choicePointsValue: null, months: [] };
  }

  const currency = (hasIprefer && ipreferPrices.currency) || "USD";
  const choicePointsValue = hasChoice ? toFiniteNumber(choicePrices.choice_points_value) : null;
  let pointsMin = null;
  let pointsMax = null;
  let cashMin = null;
  let cashMax = null;

  // Collect all month keys from both iprefer and choice
  const allMonthKeys = new Set([
    ...Object.keys((hasIprefer && ipreferPrices.months) || {}),
    ...Object.keys((hasChoice && choicePrices.months) || {}),
  ]);

  const months = [];

  for (const monthKey of allMonthKeys) {
    const ipreferData = hasIprefer ? (ipreferPrices.months || {})[monthKey] : null;
    const choiceData = hasChoice ? (choicePrices.months || {})[monthKey] : null;

    const data = ipreferData && typeof ipreferData === "object" ? ipreferData : {};

    const pMin = toFiniteNumber(data.points_min);
    const pMax = toFiniteNumber(data.points_max);
    const cMin = toFiniteNumber(data.cash_min);
    const cMax = toFiniteNumber(data.cash_max);

    if (pMin !== null) pointsMin = pointsMin === null ? pMin : Math.min(pointsMin, pMin);
    if (pMax !== null) pointsMax = pointsMax === null ? pMax : Math.max(pointsMax, pMax);
    if (cMin !== null) cashMin = cashMin === null ? cMin : Math.min(cashMin, cMin);
    if (cMax !== null) cashMax = cashMax === null ? cMax : Math.max(cashMax, cMax);

    const parsedDate = new Date(`${monthKey}-01T00:00:00.000Z`);
    const monthLabel = Number.isNaN(parsedDate.getTime())
      ? monthKey
      : parsedDate.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

    months.push({
      key: monthKey,
      label: monthLabel,
      pointsMin: pMin,
      pointsMax: pMax,
      cashMin: cMin,
      cashMax: cMax,
      cashAvailableNights: typeof data.cash_available_nights === "number" ? data.cash_available_nights : null,
      pointsAvailableNights: typeof data.points_available_nights === "number" ? data.points_available_nights : null,
      choiceAvailableNights: choiceData && typeof choiceData === "object" && typeof choiceData.choice_available_nights === "number"
        ? choiceData.choice_available_nights : null,
    });
  }

  months.sort((left, right) => left.key.localeCompare(right.key));

  return { pointsMin, pointsMax, cashMin, cashMax, currency, choicePointsValue, months };
}

function formatCurrency(value, currency = "USD") {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Price pending";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: value >= 1000 ? 0 : 0,
  }).format(value);
}

function formatCompactCurrency(value, currency = "USD") {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value) {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function buildBucketKey(plans = []) {
  if (plans.includes("amex_thc") || plans.includes("amex_fhr")) {
    return "fhr_thc";
  }

  if (plans.includes("iprefer_points")) {
    return "iprefer";
  }

  if (plans.includes("hilton_brands")) {
    return "hilton";
  }

  if (plans.includes("hilton_aspire_resort_credit")) {
    return "aspire";
  }

  if (plans.includes("chase_edit")) {
    return "edit";
  }

  if (plans.includes("bilt_hafh")) {
    return "bilt_hafh";
  }

  return null;
}

function buildLocationLabel(rawHotel) {
  return (
    unique([rawHotel.city, rawHotel.state_region, rawHotel.country]).join(", ") ||
    rawHotel.formatted_address ||
    "Location pending"
  );
}

function buildQuality(rawHotel, hasCoordinates) {
  if (rawHotel.record_type === "canonical" && hasCoordinates) {
    return "mapped";
  }

  if (rawHotel.record_type === "canonical") {
    return "canonical";
  }

  return "fallback";
}

function buildPriceValue(rawHotel) {
  const summaryPrice = toFiniteNumber(rawHotel.summary_price?.cost);
  if (summaryPrice !== null) {
    return summaryPrice;
  }

  const sampledPrices = Object.values(rawHotel.prices || {})
    .map((entry) => toFiniteNumber(entry?.cost))
    .filter((value) => value !== null);

  return sampledPrices.length ? Math.min(...sampledPrices) : null;
}

function buildSampledPriceSummary(rawHotel) {
  const priceEntries = Object.entries(rawHotel.prices || {})
    .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/u.test(date))
    .map(([date, entry]) => {
      const priceValue = toFiniteNumber(entry?.cost);
      if (priceValue === null) {
        return null;
      }

      const parsedDate = new Date(`${date}T00:00:00.000Z`);
      if (Number.isNaN(parsedDate.getTime())) {
        return null;
      }

      return {
        date,
        monthKey: date.slice(0, 7),
        monthLabel: parsedDate.toLocaleDateString("en-US", {
          month: "short",
          timeZone: "UTC",
        }),
        isWeekend: parsedDate.getUTCDay() === 0 || parsedDate.getUTCDay() === 6,
        value: priceValue,
        currency: entry?.currency || rawHotel.summary_price?.currency || rawHotel.currency || "USD",
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (!priceEntries.length) {
    return {
      count: 0,
      helperText: "",
      months: [],
    };
  }

  const monthMap = new Map();
  priceEntries.forEach((entry) => {
    if (!monthMap.has(entry.monthKey)) {
      monthMap.set(entry.monthKey, {
        key: entry.monthKey,
        label: entry.monthLabel,
        currency: entry.currency,
        weekdayValue: null,
        weekendValue: null,
        minValue: entry.value,
        maxValue: entry.value,
      });
    }

    const month = monthMap.get(entry.monthKey);
    month.minValue = Math.min(month.minValue, entry.value);
    month.maxValue = Math.max(month.maxValue, entry.value);

    if (entry.isWeekend) {
      month.weekendValue = entry.value;
    } else {
      month.weekdayValue = entry.value;
    }
  });

  const months = [...monthMap.values()].sort((left, right) => left.key.localeCompare(right.key));
  const hasWeekday = months.some((month) => month.weekdayValue !== null);
  const hasWeekend = months.some((month) => month.weekendValue !== null);
  const helperText = hasWeekday && hasWeekend
    ? `${months.length} months sampled · weekday and weekend snapshots`
    : hasWeekend
      ? `${months.length} months sampled · weekend snapshots only`
      : `${months.length} months sampled · weekday snapshots only`;

  return {
    count: priceEntries.length,
    helperText,
    months,
    entries: priceEntries,
  };
}

function formatPlanLabel(plan) {
  return PLAN_LABELS[plan] || plan;
}

function joinValues(values = [], fallback = "Unknown") {
  const cleaned = unique(values);
  return cleaned.length ? cleaned.join(" · ") : fallback;
}

function renderPlanPills(labels = []) {
  const cleaned = unique(labels);
  if (!cleaned.length) {
    return "";
  }

  return cleaned
    .map((label) => `<span class="brand-pill detail-plan-pill">${escapeHtml(label)}</span>`)
    .join("");
}

function renderSampledPricePattern(hotel) {
  if (!hotel.sampledPriceSummary?.months?.length) {
    return "";
  }

  const detailRows = hotel.sampledPriceSummary.entries
    .map((entry) => {
      const dayLabel = entry.isWeekend ? "Weekend" : "Weekday";
      return `
        <div class="sampled-price-detail__row">
          <span>${escapeHtml(entry.date)}</span>
          <span>${escapeHtml(dayLabel)}</span>
          <strong>${escapeHtml(formatCompactCurrency(entry.value, entry.currency))}</strong>
        </div>
      `;
    })
    .join("");

  const chips = hotel.sampledPriceSummary.months
    .map((month) => {
      const weekdayPrice = formatCompactCurrency(month.weekdayValue, month.currency);
      const weekendPrice = formatCompactCurrency(month.weekendValue, month.currency);

      return `
        <article class="sampled-month-chip">
          <div class="sampled-month-chip__topline">
            <strong>${escapeHtml(month.label)}</strong>
            <span>${escapeHtml(formatCompactCurrency(month.minValue, month.currency))}</span>
          </div>
          <div class="sampled-month-chip__rows">
            <div class="sampled-month-chip__row ${month.weekdayValue === null ? "is-muted" : ""}">
              <span>Weekday</span>
              <strong>${escapeHtml(weekdayPrice)}</strong>
            </div>
            <div class="sampled-month-chip__row ${month.weekendValue === null ? "is-muted" : ""}">
              <span>Weekend</span>
              <strong>${escapeHtml(weekendPrice)}</strong>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  return `
    <section class="sampled-price-pattern" aria-label="Sampled price pattern">
      <div class="sampled-price-pattern__header">
        <span class="sampled-price-pattern__eyebrow">Sampled price pattern</span>
      </div>
      <div class="sampled-price-pattern__grid">
        ${chips}
      </div>
      <details class="sampled-price-detail">
        <summary>Show detailed sampled prices</summary>
        <div class="sampled-price-detail__list">
          ${detailRows}
        </div>
      </details>
    </section>
  `;
}

function renderIpreferPricePattern(hotel) {
  if (!hotel.ipreferMonths?.length) {
    return "";
  }

  const hasPoints = hotel.ipreferMonths.some((m) => m.pointsMin !== null);
  const hasChoice = hotel.choicePointsValue !== null && hotel.ipreferMonths.some((m) => m.choiceAvailableNights !== null);

  const rows = hotel.ipreferMonths
    .map((month) => {
      const cashNights = month.cashAvailableNights !== null
        ? ` <span class="iprefer-table__muted">${escapeHtml(String(month.cashAvailableNights))}d</span>`
        : "";
      const cashCell = month.cashMin !== null
        ? `${escapeHtml(formatCompactCurrency(month.cashMin, hotel.ipreferCurrency))}${month.cashMax !== null && month.cashMax !== month.cashMin ? `–${escapeHtml(formatCompactCurrency(month.cashMax, hotel.ipreferCurrency))}` : ""}${cashNights}`
        : `<span class="iprefer-table__muted">—</span>`;

      const ptsNights = month.pointsAvailableNights !== null
        ? ` <span class="iprefer-table__muted">${escapeHtml(String(month.pointsAvailableNights))}d</span>`
        : "";
      const ptsCell = month.pointsMin !== null
        ? `${escapeHtml(formatNumber(month.pointsMin))}${month.pointsMax !== null && month.pointsMax !== month.pointsMin ? `–${escapeHtml(formatNumber(month.pointsMax))}` : ""}${ptsNights}`
        : `<span class="iprefer-table__muted">—</span>`;

      const choiceCell = hasChoice
        ? (month.choiceAvailableNights !== null
          ? `${escapeHtml(formatNumber(hotel.choicePointsValue))} <span class="iprefer-table__muted">${escapeHtml(String(month.choiceAvailableNights))}d</span>`
          : `<span class="iprefer-table__muted">—</span>`)
        : "";

      return `
        <tr>
          <td class="iprefer-table__month">${escapeHtml(month.label)}</td>
          <td class="iprefer-table__cash">${cashCell}</td>
          ${hasPoints ? `<td class="iprefer-table__points">${ptsCell}</td>` : ""}
          ${hasChoice ? `<td class="iprefer-table__points">${choiceCell}</td>` : ""}
        </tr>`;
    })
    .join("");

  const cppParts = [];
  if (hotel.ipreferCpp !== null) {
    cppParts.push(`iPrefer CPP: ${hotel.ipreferCpp.toFixed(2)}¢/pt`);
  }
  if (hotel.choiceCpp !== null) {
    cppParts.push(`Choice CPP: ${hotel.choiceCpp.toFixed(2)}¢/pt`);
  }
  const cppSummary = cppParts.length > 0
    ? `<div class="detail-row">${escapeHtml(cppParts.join("  |  "))}</div>`
    : "";

  return `
    ${cppSummary}
    <section class="sampled-price-pattern" aria-label="iPrefer price availability">
      <span class="sampled-price-pattern__eyebrow">iPrefer availability by month</span>
      <table class="iprefer-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Cash</th>
            ${hasPoints ? "<th>iPrefer Pts</th>" : ""}
            ${hasChoice ? "<th>Choice Pts</th>" : ""}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function normalizeHotel([id, rawHotel]) {
  const latitude = toFiniteNumber(rawHotel.latitude);
  const longitude = toFiniteNumber(rawHotel.longitude);
  const hasCoordinates = latitude !== null && longitude !== null;
  const bucket = buildBucketKey(rawHotel.plans || []);
  const locationLabel = buildLocationLabel(rawHotel);
  const priceValue = buildPriceValue(rawHotel);
  const quality = buildQuality(rawHotel, hasCoordinates);
  const sampledPriceSummary = buildSampledPriceSummary(rawHotel);

  const amenityValues = unique(rawHotel.amenities || []);
  const normalizedAmenities = unique(amenityValues.map(normalizeText));
  const ipreferSummary = buildIpreferSummary(rawHotel);

  const hotel = {
    id,
    rawHotel,
    name: rawHotel.name || "Unnamed hotel",
    brand: rawHotel.brand || rawHotel.chain || "Independent",
    city: rawHotel.city || "",
    region: rawHotel.state_region || "",
    country: normalizeCountry(rawHotel.country || ""),
    locationLabel,
    plans: rawHotel.plans || [],
    planLabels: (rawHotel.plans || []).map(formatPlanLabel),
    bucket,
    quality,
    searchText: normalizeText(
      [
        rawHotel.name,
        rawHotel.brand,
        rawHotel.chain,
        rawHotel.city,
        rawHotel.state_region,
        rawHotel.country,
        rawHotel.formatted_address,
      ].join(" "),
    ),
    hasCoordinates,
    latitude,
    longitude,
    priceValue,
    ipreferPoints: ipreferSummary.pointsMin,
    ipreferPointsMin: ipreferSummary.pointsMin,
    ipreferPointsMax: ipreferSummary.pointsMax,
    ipreferCashMin: ipreferSummary.cashMin,
    ipreferCashMax: ipreferSummary.cashMax,
    ipreferCurrency: ipreferSummary.currency,
    ipreferMonths: ipreferSummary.months,
    ipreferCpp: (ipreferSummary.cashMin !== null && ipreferSummary.pointsMin !== null && ipreferSummary.pointsMin > 0)
      ? ipreferSummary.cashMin / ipreferSummary.pointsMin * 100
      : null,
    choicePointsValue: ipreferSummary.choicePointsValue,
    choiceCpp: (ipreferSummary.cashMin !== null && ipreferSummary.choicePointsValue !== null && ipreferSummary.choicePointsValue > 0)
      ? ipreferSummary.cashMin / ipreferSummary.choicePointsValue * 100
      : null,
    ipreferPriceLabel: formatIpreferPointsLabel(ipreferSummary.pointsMin, ipreferSummary.pointsMax),
    priceLabel: formatCurrency(priceValue, rawHotel.summary_price?.currency || rawHotel.currency || "USD"),
    priceSubLabel:
      rawHotel.summary_price?.display &&
      rawHotel.summary_price?.original_currency &&
      rawHotel.summary_price.original_currency !== (rawHotel.summary_price?.currency || rawHotel.currency || "USD")
        ? rawHotel.summary_price.display
        : "",
    amexUrl: rawHotel.amex_url || "",
    chaseUrl: rawHotel.chase_url || "",
    hiltonUrl: rawHotel.hilton_url || "",
    ipreferUrl: rawHotel.iprefer_url || "",
    biltUrl: rawHotel.bilt_url || "",
    tripadvisorUrl: rawHotel.tripadvisor_url || "",
    tripadvisorId: rawHotel.tripadvisor_id || "",
    summaryPrice: rawHotel.summary_price || null,
    formattedAddress: rawHotel.formatted_address || rawHotel.address || "",
    postalCode: rawHotel.postal_code || "",
    amenities: amenityValues,
    normalizedAmenities,
    geoProvider: rawHotel.geo_provider || "",
    geoStatus: rawHotel.geo_status || "",
    geoConfidence: rawHotel.geo_confidence || "",
    fallbackReason: rawHotel.fallback_reason || "",
    source: rawHotel.source || "",
    sourceCount: toFiniteNumber(rawHotel.source_count),
    sourceHotelId: rawHotel.source_hotel_id || "",
    sourceKeys: rawHotel.source_keys || [],
    chase2026Credit: (rawHotel.chase_2026_credit || "").toUpperCase() === "TRUE",
    aspireCreditWithStay: rawHotel.aspire_credit_with_stay || null,
    generatedSource: rawHotel.display_state || rawHotel.record_type || "",
    sampledPriceSummary,
    hiltonPointsPrice: toFiniteNumber(rawHotel.hilton_points_price),
    hiltonStandardPointsPrice: toFiniteNumber(rawHotel.hilton_standard_points_price),
    hiltonEffectivePointsPrice: toFiniteNumber(rawHotel.hilton_standard_points_price) ?? toFiniteNumber(rawHotel.hilton_points_price),
    hiltonCashPriceUsd: toFiniteNumber(rawHotel.hilton_cash_price_usd),
    hiltonCpp: toFiniteNumber(rawHotel.hilton_cpp),
    hiltonCashCurrency: rawHotel.hilton_cash_currency || "",
    hiltonPointsRewardType: rawHotel.hilton_points_reward_type || "",
    forumReviews: [],
    forumReviewCount: 0,
    marker: null,
  };

  return hotel;
}

function compareHotels(left, right) {
  if (state.sort === "name") {
    return left.name.localeCompare(right.name);
  }

  if (state.sort === "cpp-iprefer-desc" || state.sort === "cpp-choice-desc" || state.sort === "cpp-hilton-desc") {
    const field = state.sort === "cpp-iprefer-desc" ? "ipreferCpp"
      : state.sort === "cpp-choice-desc" ? "choiceCpp"
      : "hiltonCpp";
    const leftCpp = left[field];
    const rightCpp = right[field];
    if (leftCpp !== null && rightCpp !== null && leftCpp !== rightCpp) {
      return rightCpp - leftCpp;
    }
    if (leftCpp !== null && rightCpp === null) return -1;
    if (leftCpp === null && rightCpp !== null) return 1;
    return left.name.localeCompare(right.name);
  }

  const leftPrice = state.bucket === "iprefer"
    ? (state.ipreferMapMode === "choice" ? left.choicePointsValue
      : state.ipreferMapMode === "points" ? left.ipreferPointsMin
      : left.ipreferCashMin)
    : state.bucket === "hilton"
      ? (state.hiltonMapMode === "points" ? left.hiltonEffectivePointsPrice : left.hiltonCashPriceUsd)
      : left.priceValue;
  const rightPrice = state.bucket === "iprefer"
    ? (state.ipreferMapMode === "choice" ? right.choicePointsValue
      : state.ipreferMapMode === "points" ? right.ipreferPointsMin
      : right.ipreferCashMin)
    : state.bucket === "hilton"
      ? (state.hiltonMapMode === "points" ? right.hiltonEffectivePointsPrice : right.hiltonCashPriceUsd)
      : right.priceValue;

  if (leftPrice !== null && rightPrice !== null && leftPrice !== rightPrice) {
    return state.sort === "price-desc" ? rightPrice - leftPrice : leftPrice - rightPrice;
  }

  if (leftPrice !== null && rightPrice === null) {
    return -1;
  }

  if (leftPrice === null && rightPrice !== null) {
    return 1;
  }

  return left.name.localeCompare(right.name);
}

function hotelMatchesBucket(hotel, bucket = state.bucket) {
  if (bucket === "fhr_thc") {
    const sub = state.fhrThcSubFilter;
    if (sub === "fhr") return hotel.plans.includes("amex_fhr");
    if (sub === "thc") return hotel.plans.includes("amex_thc");
    // "fhr+thc" — either plan
    return hotel.plans.includes("amex_fhr") || hotel.plans.includes("amex_thc");
  }
  const plans = PLAN_CONFIG[bucket]?.plans || [];
  return plans.some((plan) => hotel.plans.includes(plan));
}

function getBucketHotels(bucket = state.bucket) {
  return state.hotels.filter((hotel) => hotelMatchesBucket(hotel, bucket));
}

function getHotelChain(hotel) {
  return hotel.rawHotel.chain || hotel.brand;
}

function readCountries(hotels) {
  return unique(hotels.map((hotel) => hotel.country)).sort((a, b) => a.localeCompare(b));
}

function readBrands(hotels) {
  return unique(hotels.map((hotel) => hotel.brand)).sort((a, b) => a.localeCompare(b));
}

function readChains(hotels) {
  return unique(hotels.map((hotel) => getHotelChain(hotel))).sort((a, b) => a.localeCompare(b));
}

function hotelMatchesActiveFilters(hotel, excludedFilters = []) {
  const excluded = new Set(excludedFilters);
  const search = normalizeText(state.search);

  if (!excluded.has("search") && search && !hotel.searchText.includes(search)) {
    return false;
  }

  if (!excluded.has("country") && state.country !== "all" && hotel.country !== state.country) {
    return false;
  }

  if (!excluded.has("brand") && state.brand !== "all" && hotel.brand !== state.brand) {
    return false;
  }

  if (!excluded.has("chain") && state.chain !== "all" && getHotelChain(hotel) !== state.chain) {
    return false;
  }

  if (!excluded.has("overlapPlan") && state.overlapPlan !== "all" && !hotel.plans.includes(state.overlapPlan)) {
    return false;
  }

  if (
    !excluded.has("amenities") &&
    state.amenities.length &&
    !state.amenities.every((amenity) => hotel.normalizedAmenities.includes(amenity))
  ) {
    return false;
  }

  if (!excluded.has("ipreferHasPoints") && state.ipreferHasPoints && hotel.ipreferPointsMin === null) {
    return false;
  }

  if (!excluded.has("choiceHasPoints") && state.choiceHasPoints && hotel.choicePointsValue === null) {
    return false;
  }

  if (!excluded.has("editSelectHotels") && state.editSelectHotels && !hotel.chase2026Credit) {
    return false;
  }

  if (!excluded.has("hasForumReview") && state.hasForumReview && hotel.forumReviewCount === 0) {
    return false;
  }

  if (
    !excluded.has("aspireCreditWithStayFilter") &&
    state.aspireCreditWithStayFilter &&
    hotel.aspireCreditWithStay?.status !== "success"
  ) {
    return false;
  }

  if (
    !excluded.has("hiltonStandardOnly") &&
    state.bucket === "hilton" &&
    state.hiltonStandardOnly &&
    hotel.hiltonPointsRewardType !== "Standard Room Reward" &&
    hotel.hiltonStandardPointsPrice === null
  ) {
    return false;
  }

  return true;
}

function getScopedHotels(excludedFilters = [], bucket = state.bucket) {
  return getBucketHotels(bucket).filter((hotel) => hotelMatchesActiveFilters(hotel, excludedFilters));
}

function readCountedOptions(hotels, getValue, getLabel = (value) => value) {
  const counts = new Map();

  hotels.forEach((hotel) => {
    const value = getValue(hotel);
    if (!value) {
      return;
    }

    counts.set(value, (counts.get(value) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((left, right) => getLabel(left[0]).localeCompare(getLabel(right[0])))
    .map(([value, count]) => ({
      value,
      label: `${getLabel(value)} (${formatNumber(count)})`,
    }));
}

function populateSelect(select, options, defaultLabel) {
  select.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = defaultLabel;
  select.append(allOption);

  options.forEach((entry) => {
    const option = document.createElement("option");
    if (typeof entry === "string") {
      option.value = entry;
      option.textContent = entry;
    } else {
      option.value = entry.value;
      option.textContent = entry.label;
    }
    select.append(option);
  });
}

function readOverlapOptions(hotels, bucket = state.bucket) {
  const activePlans = new Set(PLAN_CONFIG[bucket]?.plans || []);
  const counts = new Map();

  hotels.forEach((hotel) => {
    hotel.plans.forEach((plan) => {
      if (activePlans.has(plan)) {
        return;
      }
      counts.set(plan, (counts.get(plan) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => (PLAN_LABELS[left[0]] || left[0]).localeCompare(PLAN_LABELS[right[0]] || right[0]))
    .map(([plan, count]) => ({
      value: plan,
      label: `${PLAN_LABELS[plan] || plan} (${formatNumber(count)})`,
    }));
}

function readAmenityOptions(hotels) {
  const counts = new Map();
  const labels = new Map();

  hotels.forEach((hotel) => {
    hotel.amenities.forEach((amenity) => {
      const value = normalizeText(amenity);
      if (!value) {
        return;
      }

      counts.set(value, (counts.get(value) || 0) + 1);

      if (!labels.has(value)) {
        const label = amenity === amenity.toLowerCase() ? titleCaseWords(amenity) : amenity;
        labels.set(value, label);
      }
    });
  });

  return [...counts.entries()]
    .sort((left, right) => {
      const leftLabel = labels.get(left[0]) || left[0];
      const rightLabel = labels.get(right[0]) || right[0];
      return leftLabel.localeCompare(rightLabel);
    })
    .map(([value, count]) => ({
      value,
      label: `${labels.get(value) || value} (${formatNumber(count)})`,
    }));
}

function formatAmenitiesButtonLabel() {
  if (!state.amenities.length) {
    return "Any amenities";
  }

  if (state.amenities.length === 1) {
    const selectedOption = dom.amenitiesMenu.querySelector(`input[value="${CSS.escape(state.amenities[0])}"]`);
    return selectedOption?.dataset.label || "1 amenity";
  }

  return `${formatNumber(state.amenities.length)} amenities`;
}

function getBucketCounts() {
  const counts = {
    fhr_thc: 0,
    aspire: 0,
    iprefer: 0,
    edit: 0,
    hilton: 0,
    bilt_hafh: 0,
  };

  Object.keys(counts).forEach((bucket) => {
    counts[bucket] = getBucketHotels(bucket).length;
  });

  return counts;
}

function updateBucketTabs() {
  const counts = getBucketCounts();

  document.querySelectorAll("[data-bucket]").forEach((button) => {
    const bucket = button.dataset.bucket;
    const config = PLAN_CONFIG[bucket];
    button.classList.toggle("is-active", bucket === state.bucket);
    button.innerHTML = `
      <span>${escapeHtml(config.label)}</span>
      <strong>${escapeHtml(formatNumber(counts[bucket]))}</strong>
    `;
  });
}

function updateFilterOptions() {
  const bucketHotels = getBucketHotels();
  const brandOptions = readCountedOptions(getScopedHotels(["brand"]), (hotel) => hotel.brand);
  populateSelect(dom.brand, brandOptions, "All brands");

  if (state.brand !== "all" && !brandOptions.some((option) => option.value === state.brand)) {
    state.brand = "all";
  }
  dom.brand.value = state.brand;

  const chainOptions = readCountedOptions(getScopedHotels(["chain"]), (hotel) => getHotelChain(hotel));
  populateSelect(dom.chain, chainOptions, "All chains");

  if (state.chain !== "all" && !chainOptions.some((option) => option.value === state.chain)) {
    state.chain = "all";
  }
  dom.chain.value = state.chain;

  const countryOptions = readCountedOptions(getScopedHotels(["country"]), (hotel) => hotel.country);
  populateSelect(dom.country, countryOptions, "All countries");

  if (state.country !== "all" && !countryOptions.some((option) => option.value === state.country)) {
    state.country = "all";
  }
  dom.country.value = state.country;

  const overlapOptions = readOverlapOptions(getScopedHotels(["overlapPlan"]));
  populateSelect(dom.overlapPlan, overlapOptions, "Any overlap");

  if (state.overlapPlan !== "all" && !overlapOptions.some((option) => option.value === state.overlapPlan)) {
    state.overlapPlan = "all";
  }

  dom.overlapPlan.disabled = overlapOptions.length === 0;
  dom.overlapPlan.value = state.overlapPlan;
  const baseSortOptions = [
    { value: "price-asc", label: "Lowest price" },
    { value: "price-desc", label: "Highest price" },
  ];
  const cppSortOptions = state.bucket === "iprefer"
    ? [
        { value: "cpp-iprefer-desc", label: "Best iPrefer CPP" },
        { value: "cpp-choice-desc", label: "Best Choice CPP" },
      ]
    : state.bucket === "hilton"
      ? [{ value: "cpp-hilton-desc", label: "Best Hilton CPP" }]
      : [];
  const sortOptions = [...baseSortOptions, ...cppSortOptions, { value: "name", label: "Name" }];
  if (!sortOptions.some((o) => o.value === state.sort)) {
    state.sort = sortOptions[0].value;
  }
  dom.sort.innerHTML = sortOptions.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join("");
  dom.sort.value = state.sort;

  const amenityOptions = readAmenityOptions(getScopedHotels(["amenities"]));
  const amenityValues = new Set(amenityOptions.map((option) => option.value));
  state.amenities = state.amenities.filter((amenity) => amenityValues.has(amenity));

  dom.amenitiesMenu.innerHTML = amenityOptions
    .map(
      (option) => `
        <label class="amenities-option">
          <input
            type="checkbox"
            value="${escapeHtml(option.value)}"
            data-label="${escapeHtml(option.label.replace(/\s+\(\d+\)$/, ""))}"
            ${state.amenities.includes(option.value) ? "checked" : ""}
          />
          <span>${escapeHtml(option.label)}</span>
        </label>
      `,
    )
    .join("");

  dom.amenitiesToggle.disabled = amenityOptions.length === 0;
  dom.amenitiesPanel.hidden = true;
  dom.amenitiesToggle.setAttribute("aria-expanded", "false");
  dom.amenitiesToggle.textContent = amenityOptions.length ? formatAmenitiesButtonLabel() : "No amenities available";
  dom.amenitiesInfo.hidden = !state.amenities.length;
  dom.amenitiesInfo.textContent = state.amenities.length ? `${formatNumber(state.amenities.length)} selected` : "";
}

function applyFilters() {
  state.filteredHotels = getScopedHotels().sort(compareHotels);
  syncListToMapViewport();
}

function ensureSelectedHotel() {
  if (!state.mapViewportHotels.length) {
    state.selectedHotelId = null;
    return;
  }

  const stillVisible = state.mapViewportHotels.some((hotel) => hotel.id === state.selectedHotelId);
  if (!stillVisible) {
    state.selectedHotelId = state.mapViewportHotels[0].id;
  }
}

function getSelectedHotel() {
  return state.hotelsById.get(state.selectedHotelId) || null;
}

function buildGoogleMapsUrl(hotel) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${hotel.name} ${hotel.locationLabel}`,
  )}`;
}

function updateMeta() {
  const bucketHotels = getBucketHotels();
  const viewportHotels = state.mapViewportHotels.length;

  dom.resultsCount.textContent = `${formatNumber(viewportHotels)} shown of ${formatNumber(
    state.filteredHotels.length,
  )} filtered · ${formatNumber(
    bucketHotels.length,
  )} total`;
  dom.generatedAt.textContent = `Updated ${formatDateTime(state.meta.generated_at)}`;
}

function createHotelRow(hotel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hotel-row";
  button.dataset.hotelId = hotel.id;
  const rowPriceHtml = state.bucket === "iprefer"
    ? (() => {
        const ipreferLine = `${escapeHtml(hotel.ipreferPriceLabel)} iPrefer pts`;
        const choiceLine = hotel.choicePointsValue !== null ? `${escapeHtml(formatNumber(hotel.choicePointsValue))} Choice pts` : null;
        const cashLine = hotel.ipreferCashMin !== null ? escapeHtml(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency)) : null;
        let primary, secondaries;
        if (state.ipreferMapMode === "choice" && choiceLine) {
          primary = choiceLine;
          secondaries = [ipreferLine, cashLine];
        } else if (state.ipreferMapMode === "cash" && cashLine) {
          primary = cashLine;
          secondaries = [ipreferLine, choiceLine];
        } else {
          primary = ipreferLine;
          secondaries = [choiceLine, cashLine];
        }
        return `<div class="row-price-iprefer">
          <span class="row-price">${primary}</span>
          ${secondaries.filter(Boolean).map((s) => `<span class="row-price-cash">${s}</span>`).join("")}
        </div>`;
      })()
    : state.bucket === "hilton"
      ? `<div class="row-price-iprefer">
          <span class="row-price">${escapeHtml(
            state.hiltonMapMode === "points"
              ? (hotel.hiltonEffectivePointsPrice !== null ? `${formatNumber(hotel.hiltonEffectivePointsPrice)} pts` : "N/A")
              : (hotel.hiltonCashPriceUsd !== null ? formatCompactCurrency(hotel.hiltonCashPriceUsd, "USD") : "N/A")
          )}</span>
          ${hotel.hiltonCpp !== null ? `<span class="row-price-cash">${escapeHtml(hotel.hiltonCpp.toFixed(2))}¢/pt</span>` : ""}
        </div>`
      : `<span class="row-price">${escapeHtml(hotel.priceLabel)}</span>`;

  button.innerHTML = `
    <div class="hotel-row__main">
      <div class="hotel-row__headline">
        <strong>${escapeHtml(hotel.name)}</strong>
        ${rowPriceHtml}
      </div>
      <p>${escapeHtml(hotel.locationLabel)}</p>
      <div class="hotel-row__meta">
        <span class="brand-pill">${escapeHtml(hotel.brand)}</span>
        <span class="brand-pill">${escapeHtml(hotel.rawHotel.chain || hotel.brand)}</span>
        <span>${escapeHtml(joinValues(hotel.planLabels))}</span>
        ${state.bucket === "edit" && hotel.chase2026Credit ? `<span class="brand-pill">$250 Chase Travel Credit Eligible</span>` : ""}
        ${state.bucket === "aspire" && hotel.aspireCreditWithStay?.yes_count > 0 ? `<span class="brand-pill">Credit without Stay</span>` : ""}
        ${hotel.forumReviewCount > 0 ? `<span class="brand-pill forum-review-pill">${hotel.forumReviewCount} review${hotel.forumReviewCount !== 1 ? "s" : ""}</span>` : ""}
      </div>
    </div>
  `;

  button.addEventListener("click", () => {
    selectHotel(hotel.id, { focusMap: true, source: "list" });
  });

  return button;
}

function renderListView() {
  dom.backToList.hidden = true;
  dom.list.innerHTML = "";

  if (!state.filteredHotels.length) {
    dom.list.innerHTML = `
      <div class="empty-state">
        <h3>No hotels match those filters</h3>
        <p>Try a broader search, switch tab, or clear one of the active filters.</p>
      </div>
    `;
    dom.loadMore.hidden = true;
    return;
  }

  if (!state.mapViewportHotels.length) {
    dom.list.innerHTML = `
      <div class="empty-state">
        <h3>No hotels in the current map view</h3>
        <p>Pan or zoom the map to another area, or broaden the active filters.</p>
      </div>
    `;
    dom.loadMore.hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  state.visibleListHotels.forEach((hotel) => {
    fragment.append(createHotelRow(hotel));
  });

  dom.list.append(fragment);
  dom.loadMore.hidden = state.visibleListHotels.length >= state.mapViewportHotels.length;
  dom.loadMore.textContent = `Load ${Math.min(
    LIST_PAGE_SIZE,
    state.mapViewportHotels.length - state.visibleListHotels.length,
  )} more`;
  highlightSelection();
}

function renderDetailView() {
  const hotel = getSelectedHotel();

  if (!hotel) {
    state.listPanelMode = "list";
    renderListView();
    return;
  }

  const amenitiesLabel = joinValues(hotel.amenities, "Amenities pending");
  const planPills = renderPlanPills(hotel.planLabels);
  const sampledPricePattern = renderSampledPricePattern(hotel);
  const ipreferPricePattern = state.bucket === "iprefer" ? renderIpreferPricePattern(hotel) : "";
  const hiltonPricingSection = state.bucket === "hilton" && (hotel.hiltonPointsPrice !== null || hotel.hiltonCashPriceUsd !== null)
    ? `
      <section class="sampled-price-pattern" aria-label="Hilton pricing">
        <span class="sampled-price-pattern__eyebrow">Hilton pricing</span>
        <div class="detail-grid">
          ${hotel.hiltonPointsPrice !== null ? `
          <div class="detail-row">
            <span>Points/night</span>
            <strong>${escapeHtml(formatNumber(hotel.hiltonPointsPrice))} pts</strong>
          </div>` : ""}
          ${hotel.hiltonStandardPointsPrice !== null ? `
          <div class="detail-row">
            <span>Standard reward</span>
            <strong>${escapeHtml(formatNumber(hotel.hiltonStandardPointsPrice))} pts</strong>
          </div>` : ""}
          ${hotel.hiltonCashPriceUsd !== null ? `
          <div class="detail-row">
            <span>Cash/night (USD)</span>
            <strong>${escapeHtml(formatCompactCurrency(hotel.hiltonCashPriceUsd, "USD"))}${hotel.hiltonCashCurrency && hotel.hiltonCashCurrency !== "USD" ? ` <span style="opacity:0.6">(${escapeHtml(hotel.hiltonCashCurrency)})</span>` : ""}</strong>
          </div>` : ""}
          ${hotel.hiltonCpp !== null ? `
          <div class="detail-row">
            <span>CPP</span>
            <strong>${escapeHtml(hotel.hiltonCpp.toFixed(2))}¢/pt</strong>
          </div>` : ""}
        </div>
      </section>`
    : "";
  const sourceActions = [
    hotel.amexUrl
      ? `<a class="primary-button" href="${hotel.amexUrl}" target="_blank" rel="noreferrer" data-analytics-link="amex">Amex</a>`
      : "",
    hotel.chaseUrl
      ? `<a class="primary-button" href="${hotel.chaseUrl}" target="_blank" rel="noreferrer" data-analytics-link="chase">Chase</a>`
      : "",
    hotel.hiltonUrl
      ? `<a class="primary-button" href="${hotel.hiltonUrl}" target="_blank" rel="noreferrer" data-analytics-link="hilton">Hilton</a>`
      : "",
    hotel.ipreferUrl
      ? `<a class="primary-button" href="${hotel.ipreferUrl}" target="_blank" rel="noreferrer" data-analytics-link="iprefer">iPrefer</a>`
      : "",
    hotel.biltUrl
      ? `<a class="primary-button" href="${hotel.biltUrl}" target="_blank" rel="noreferrer" data-analytics-link="bilt">Bilt</a>`
      : "",
  ]
    .filter(Boolean)
    .join("");
  dom.backToList.hidden = false;

  dom.list.innerHTML = `
    <article class="detail-card detail-card--in-list">
      <div class="card-topline">
        ${planPills ? `<div class="detail-plan-pills detail-plan-pills--inline">${planPills}</div>` : "<div></div>"}
        <span class="price-pill">${escapeHtml(
          state.bucket === "iprefer"
            ? hotel.ipreferPriceLabel
            : state.bucket === "hilton"
              ? (state.hiltonMapMode === "points"
                  ? (hotel.hiltonEffectivePointsPrice !== null ? `${formatNumber(hotel.hiltonEffectivePointsPrice)} pts` : "N/A")
                  : (hotel.hiltonCashPriceUsd !== null ? formatCompactCurrency(hotel.hiltonCashPriceUsd, "USD") : "N/A"))
              : hotel.priceLabel
        )}</span>
      </div>
      <h2>${escapeHtml(hotel.name)}</h2>
      <p class="detail-location">${escapeHtml(hotel.locationLabel)}</p>

      ${state.bucket !== "iprefer" && hotel.summaryPrice ? `
      <div class="detail-price-summary">
        <span class="detail-price-summary__eyebrow">Lowest sampled price</span>
        <strong>${escapeHtml(hotel.priceLabel)}</strong>
        ${hotel.priceSubLabel ? `<p>${escapeHtml(hotel.priceSubLabel)}</p>` : ""}
      </div>` : ""}

      ${ipreferPricePattern}
      ${hiltonPricingSection}
      ${sampledPricePattern}

      <div class="detail-grid">
        <div class="detail-row">
          <span>Brand</span>
          <strong>${escapeHtml(hotel.brand)}</strong>
        </div>
        <div class="detail-row">
          <span>Address</span>
          <strong>${escapeHtml(hotel.formattedAddress || hotel.locationLabel)}</strong>
        </div>
        <div class="detail-row">
          <span>Amenities</span>
          <strong>${escapeHtml(amenitiesLabel)}</strong>
        </div>
      </div>

      ${
        hotel.plans.includes("hilton_aspire_resort_credit")
          ? `
      <div class="aspire-resort-credit-info">
        <h3>Hilton Aspire Resort Credit</h3>

        <p class="aspire-resort-credit-question">Did you receive the resort credit without stay?</p>
        <div class="aspire-resort-credit-status">
          ${
            hotel.aspireCreditWithStay
              ? `
            <div class="status-badge-container">
              <span class="status-badge status-badge--${hotel.aspireCreditWithStay.status}">
                ${
                  hotel.aspireCreditWithStay.status === "success"
                    ? "✅ Yes"
                    : hotel.aspireCreditWithStay.status === "failure"
                      ? "❌ No"
                      : "⚠️ Mixed"
                }
              </span>
              ${hotel.aspireCreditWithStay.last_reported ? `<span class="status-date">As of ${escapeHtml(hotel.aspireCreditWithStay.last_reported)}</span>` : ""}
            </div>
            ${
              hotel.aspireCreditWithStay.venues?.length
                ? `<p class="status-restaurants">Used at: ${escapeHtml(hotel.aspireCreditWithStay.venues.join(", "))}</p>`
                : ""
            }
          `
              : '<p class="status-placeholder">No reports yet. Be the first to help!</p>'
          }
        </div>

        <button class="ghost-button tally-button" id="tally-open-btn">
          Report your experience
        </button>
        <div id="tally-embed-container" class="tally-embed-container"></div>
      </div>
      `
          : ""
      }

      ${hotel.forumReviewCount > 0 ? `
      <section class="forum-reviews-section">
        <h3>Reviews (${hotel.forumReviewCount})</h3>
        <div class="forum-reviews-list">
          ${hotel.forumReviews.map((review) => `
            <div class="forum-review">
              <div class="forum-review__header">
                <span class="forum-review__author">${escapeHtml(review.author)}</span>
                ${review.stay_date ? `<span class="forum-review__date">Stayed ${escapeHtml(review.stay_date)}</span>` : ""}
                ${review.program ? `<span class="brand-pill">${escapeHtml(review.program)}</span>` : ""}
                <a href="${escapeHtml(review.post_url)}" target="_blank" rel="noreferrer" class="forum-review__source">Source</a>
              </div>
              <p class="forum-review__content">${escapeHtml(review.content)}</p>
            </div>
          `).join("")}
        </div>
      </section>` : ""}

      <div class="detail-actions">
        ${sourceActions}
        ${
          hotel.tripadvisorUrl
            ? `<a class="primary-button" href="${hotel.tripadvisorUrl}" target="_blank" rel="noreferrer" data-analytics-link="tripadvisor">TripAdvisor</a>`
            : ""
        }
        <a class="ghost-button" href="${buildGoogleMapsUrl(hotel)}" target="_blank" rel="noreferrer" data-analytics-link="google_maps">Google Map</a>
      </div>
    </article>
  `;

  const tallyBtn = dom.list.querySelector("#tally-open-btn");
  if (tallyBtn) {
    tallyBtn.addEventListener("click", () => {
      const container = dom.list.querySelector("#tally-embed-container");
      if (container.innerHTML === "") {
        container.innerHTML = `
          <iframe 
            data-tally-src="https://tally.so/embed/QKYpak?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1&hotel_name=${encodeURIComponent(hotel.name)}&hotel_id=${encodeURIComponent(hotel.id)}" 
            loading="lazy" 
            width="100%" 
            height="500" 
            frameborder="0" 
            marginheight="0" 
            marginwidth="0" 
            title="Hilton Aspire Resort Credit - Dining Experience">
          </iframe>
        `;
        if (window.Tally) {
          window.Tally.loadEmbeds();
        }
      }
      container.classList.toggle("is-visible");
      tallyBtn.textContent = container.classList.contains("is-visible") ? "Close form" : "Report your experience";
    });
  }

  dom.list.querySelectorAll("[data-analytics-link]").forEach((link) => {
    link.addEventListener("click", () => {
      trackEvent("hotel_outbound_click", {
        ...getHotelAnalyticsParams(hotel),
        link_type: link.dataset.analyticsLink,
      });
    });
  });

  dom.loadMore.hidden = true;
}

function renderListPanel() {
  if (state.listPanelMode === "detail") {
    renderDetailView();
    return;
  }

  renderListView();
}

function syncListToMapViewport() {
  const mappableHotels = state.filteredHotels.filter((hotel) => hotel.hasCoordinates);

  if (!map || !mappableHotels.length) {
    state.mapViewportHotels = state.filteredHotels;
    state.visibleListHotels = state.mapViewportHotels.slice(0, state.listLimit);
    return;
  }

  const bounds = map.getBounds();
  if (!bounds || !bounds.isValid()) {
    state.mapViewportHotels = mappableHotels;
    state.visibleListHotels = state.mapViewportHotels.slice(0, state.listLimit);
    return;
  }

  state.mapViewportHotels = mappableHotels.filter((hotel) => bounds.contains([hotel.latitude, hotel.longitude]));
  state.visibleListHotels = state.mapViewportHotels.slice(0, state.listLimit);
}

function markerHtml(hotel) {
  if (state.bucket === "iprefer") {
    if (state.ipreferMapMode === "choice") {
      const label = hotel.choicePointsValue !== null
        ? `${Math.round(hotel.choicePointsValue / 1000)}k`
        : "N/A";
      return `<div class="map-pin ${mapPinClass(hotel)}" style="${mapPinStyle(hotel)}">${escapeHtml(label)}</div>`;
    }

    if (state.ipreferMapMode === "points") {
      const label = hotel.ipreferPointsMin !== null
        ? `${formatNumber(hotel.ipreferPointsMin / 1000)}k`
        : "N/A";
      return `
        <div class="map-pin ${mapPinClass(hotel)}" style="${mapPinStyle(hotel)}">
          <span>${escapeHtml(label)}</span>
        </div>
      `;
    }

    const label = hotel.ipreferCashMin !== null
      ? formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency)
      : "—";
    return `
      <div class="map-pin ${mapPinClass(hotel)}" style="${mapPinStyle(hotel)}">
        <span>${escapeHtml(label)}</span>
      </div>
    `;
  }

  if (state.bucket === "hilton") {
    if (state.hiltonMapMode === "points") {
      const label = hotel.hiltonEffectivePointsPrice !== null
        ? `${formatNumber(hotel.hiltonEffectivePointsPrice / 1000)}k`
        : "N/A";
      return `
        <div class="map-pin ${mapPinClass(hotel)}" style="${mapPinStyle(hotel)}">
          <span>${escapeHtml(label)}</span>
        </div>
      `;
    }

    const label = hotel.hiltonCashPriceUsd !== null
      ? formatCompactCurrency(hotel.hiltonCashPriceUsd, "USD")
      : "—";
    return `
      <div class="map-pin ${mapPinClass(hotel)}" style="${mapPinStyle(hotel)}">
        <span>${escapeHtml(label)}</span>
      </div>
    `;
  }

  return `
    <div class="map-pin ${mapPinClass(hotel)}" style="${mapPinStyle(hotel)}">
      <span>${escapeHtml(hotel.priceValue !== null ? formatCurrency(hotel.priceValue) : "View")}</span>
    </div>
  `;
}

function mapPinClass(hotel) {
  if (state.bucket === "iprefer") {
    if (state.ipreferMapMode === "choice") {
      return hotel.choicePointsValue !== null ? "map-pin--priced" : "map-pin--pending";
    }
    const hasValue = state.ipreferMapMode === "points"
      ? hotel.ipreferPointsMin !== null
      : hotel.ipreferCashMin !== null;
    return hasValue ? "map-pin--priced" : "map-pin--pending";
  }

  if (state.bucket === "hilton") {
    const hasValue = state.hiltonMapMode === "points"
      ? hotel.hiltonEffectivePointsPrice !== null
      : hotel.hiltonCashPriceUsd !== null;
    return hasValue ? "map-pin--priced" : "map-pin--pending";
  }

  return hotel.priceValue === null ? "map-pin--pending" : "map-pin--priced";
}

function getBucketColor(value, bucketSize, colorStops) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "var(--pin-pending)";
  }

  const bucketStart = Math.max(0, Math.floor(value / bucketSize) * bucketSize);

  if (bucketStart <= colorStops[0].bucketStart) {
    return colorStops[0].color;
  }

  for (let index = 1; index < colorStops.length; index += 1) {
    const leftStop = colorStops[index - 1];
    const rightStop = colorStops[index];
    if (bucketStart > rightStop.bucketStart) {
      continue;
    }

    const progress =
      (bucketStart - leftStop.bucketStart) / (rightStop.bucketStart - leftStop.bucketStart || 1);

    return interpolateHexColor(leftStop.color, rightStop.color, progress);
  }

  return colorStops[colorStops.length - 1].color;
}

function getPriceBucketColor(priceValue) {
  return getBucketColor(priceValue, PRICE_BUCKET_SIZE, PRICE_COLOR_STOPS);
}

function getPointsBucketColor(pointsValue) {
  return getBucketColor(pointsValue, POINTS_BUCKET_SIZE, POINTS_COLOR_STOPS);
}

function getChoicePointsBucketColor(pointsValue) {
  return getBucketColor(pointsValue, CHOICE_POINTS_BUCKET_SIZE, CHOICE_POINTS_COLOR_STOPS);
}

function mapPinStyle(hotel) {
  if (state.bucket === "iprefer") {
    if (state.ipreferMapMode === "choice") {
      return `--pin-color: ${getChoicePointsBucketColor(hotel.choicePointsValue)};`;
    }

    if (state.ipreferMapMode === "points") {
      return `--pin-color: ${getPointsBucketColor(hotel.ipreferPointsMin)};`;
    }

    return `--pin-color: ${getPriceBucketColor(hotel.ipreferCashMin)};`;
  }

  if (state.bucket === "hilton") {
    if (state.hiltonMapMode === "points") {
      return `--pin-color: ${getPointsBucketColor(hotel.hiltonEffectivePointsPrice)};`;
    }

    return `--pin-color: ${getPriceBucketColor(hotel.hiltonCashPriceUsd)};`;
  }

  return `--pin-color: ${getPriceBucketColor(hotel.priceValue)};`;
}

function interpolateHexColor(leftHex, rightHex, progress) {
  const left = hexToRgb(leftHex);
  const right = hexToRgb(rightHex);
  const clamp = Math.max(0, Math.min(1, progress));
  const rgb = {
    red: Math.round(left.red + (right.red - left.red) * clamp),
    green: Math.round(left.green + (right.green - left.green) * clamp),
    blue: Math.round(left.blue + (right.blue - left.blue) * clamp),
  };

  return `rgb(${rgb.red}, ${rgb.green}, ${rgb.blue})`;
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function getLowestPriceHotel(hotels) {
  const getValue = (hotel) => {
    if (state.bucket === "iprefer") {
      return state.ipreferMapMode === "choice"
        ? hotel.choicePointsValue
        : state.ipreferMapMode === "points"
          ? hotel.ipreferPointsMin
          : hotel.ipreferCashMin;
    }

    if (state.bucket === "hilton") {
      return state.hiltonMapMode === "points" ? hotel.hiltonEffectivePointsPrice : hotel.hiltonCashPriceUsd;
    }

    return hotel.priceValue;
  };

  return hotels.reduce((lowestHotel, hotel) => {
    if (!lowestHotel) {
      return hotel;
    }

    const value = getValue(hotel);
    const lowestValue = getValue(lowestHotel);

    if (typeof value !== "number" || Number.isNaN(value)) {
      return lowestHotel;
    }

    if (typeof lowestValue !== "number" || Number.isNaN(lowestValue)) {
      return hotel;
    }

    return value < lowestValue ? hotel : lowestHotel;
  }, null);
}

function markerClusterHtml(count, lowestPriceHotel) {
  return `
    <div
      class="map-cluster-pin ${lowestPriceHotel ? mapPinClass(lowestPriceHotel) : "map-cluster-pin--default"}"
      style="${lowestPriceHotel ? mapPinStyle(lowestPriceHotel) : ""}"
    >
      <span>${formatNumber(count)}</span>
    </div>
  `;
}

function renderMap() {
  if (!map || !markersLayer) {
    return;
  }

  state.hotels.forEach((hotel) => {
    hotel.marker = null;
  });
  markersLayer.clearLayers();
  map.invalidateSize(false);

  const mappableHotels = state.filteredHotels.filter((hotel) => hotel.hasCoordinates);

  if (!mappableHotels.length) {
    map.setView(WORLD_VIEW.center, WORLD_VIEW.zoom);
    state.shouldResetMapView = false;
    return;
  }

  const bounds = [];
  mappableHotels.forEach((hotel) => {
    const marker = window.L.marker([hotel.latitude, hotel.longitude], {
      icon: window.L.divIcon({
        className: "map-pin-wrapper",
        html: markerHtml(hotel),
        iconSize: [56, 34],
        iconAnchor: [28, 17],
      }),
    });

    const popupPriceHtml = state.bucket === "iprefer"
      ? (() => {
          const parts = [];
          if (state.ipreferMapMode === "choice") {
            parts.push(hotel.choicePointsValue !== null ? `${formatNumber(hotel.choicePointsValue)} choice pts` : "N/A");
            parts.push(hotel.ipreferPriceLabel);
          } else if (state.ipreferMapMode === "cash") {
            if (hotel.ipreferCashMin !== null) parts.push(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency));
            else parts.push("N/A");
            parts.push(hotel.ipreferPriceLabel);
          } else {
            parts.push(hotel.ipreferPriceLabel);
            if (hotel.choicePointsValue !== null) parts.push(`${formatNumber(hotel.choicePointsValue)} choice`);
          }
          if (state.ipreferMapMode !== "cash" && hotel.ipreferCashMin !== null) {
            parts.push(formatCompactCurrency(hotel.ipreferCashMin, hotel.ipreferCurrency));
          }
          return `<span>${parts.map(escapeHtml).join(" · ")}</span>`;
        })()
      : state.bucket === "hilton"
        ? `<span>${escapeHtml(
            state.hiltonMapMode === "points"
              ? (hotel.hiltonEffectivePointsPrice !== null ? `${formatNumber(hotel.hiltonEffectivePointsPrice)} pts` : "N/A")
              : (hotel.hiltonCashPriceUsd !== null ? formatCompactCurrency(hotel.hiltonCashPriceUsd, "USD") : "N/A")
          )}${hotel.hiltonCpp !== null ? ` · ${escapeHtml(hotel.hiltonCpp.toFixed(2))}¢/pt` : ""}</span>`
        : `<span>${escapeHtml(hotel.priceLabel)}</span>`;

    marker.bindPopup(`
      <div class="popup-card">
        <strong>${escapeHtml(hotel.name)}</strong>
        <span>${escapeHtml(hotel.locationLabel)}</span>
        ${popupPriceHtml}
      </div>
    `);

    marker.on("click", () => {
      selectHotel(hotel.id, { showDetail: true, source: "map" });
    });

    marker.hotel = hotel;
    markersLayer.addLayer(marker);
    hotel.marker = marker;
    bounds.push([hotel.latitude, hotel.longitude]);
  });

  if (state.shouldResetMapView) {
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 6 });
    state.shouldResetMapView = false;
  }

  syncListToMapViewport();
}

function highlightSelection() {
  document.querySelectorAll(".hotel-row").forEach((row) => {
    row.classList.toggle("hotel-row--active", row.dataset.hotelId === state.selectedHotelId);
  });
}

function focusHotelOnMap(hotel) {
  if (!hotel?.marker || !map) {
    return;
  }

  state.preserveDetailUntil = Date.now() + 1200;

  if (typeof markersLayer.zoomToShowLayer === "function") {
    markersLayer.zoomToShowLayer(hotel.marker, () => {
      const target = hotel.marker.getLatLng();
      const zoom = Math.max(map.getZoom(), 7);
      map.flyTo(target, zoom, { duration: 0.6 });
      hotel.marker.openPopup();
    });
    return;
  }

  const target = hotel.marker.getLatLng();
  const zoom = Math.max(map.getZoom(), 7);
  map.flyTo(target, zoom, { duration: 0.6 });
  hotel.marker.openPopup();
}

function syncUrlFromState() {
  const hotelPart = state.listPanelMode === "detail" && state.selectedHotelId
    ? `/${state.selectedHotelId}`
    : "";
  const hash = `#${state.bucket}${hotelPart}`;
  if (window.location.hash !== hash) {
    history.pushState(null, "", hash);
  }
}

function syncStateFromUrl() {
  const hash = window.location.hash.slice(1); // remove leading #
  if (!hash) return;
  const [bucket, hotelId] = hash.split("/");

  // Redirect legacy fhr/thc hashes to the merged tab
  const resolvedBucket = (bucket === "fhr" || bucket === "thc") ? "fhr_thc" : bucket;

  if (PLAN_CONFIG[resolvedBucket]) {
    state.bucket = resolvedBucket;
    // Set sub-filter for legacy URLs
    if (bucket === "thc") {
      state.fhrThcSubFilter = "thc";
    }
    // Apply iprefer defaults when loading directly onto the iprefer tab
    if (resolvedBucket === "iprefer") {
      state.sort = "cpp-iprefer-desc";
      state.ipreferHasPoints = true;
    }
    if (resolvedBucket === "hilton") {
      state.sort = "cpp-hilton-desc";
    }
  }
  if (hotelId) {
    state.selectedHotelId = hotelId;
    state.listPanelMode = "detail";
  }
}

function showListPanel() {
  state.listPanelMode = "list";
  state.selectedHotelId = null;
  syncUrlFromState();
  renderListPanel();
}

function showDetailPanel() {
  state.listPanelMode = "detail";
  syncUrlFromState();
  renderListPanel();
}

function selectHotel(hotelId, { focusMap = false, showDetail = true, source = "unknown" } = {}) {
  state.selectedHotelId = hotelId;
  const hotel = getSelectedHotel();

  if (hotel) {
    trackEvent("hotel_select", {
      ...getHotelAnalyticsParams(hotel),
      interaction_source: source,
      detail_opened: showDetail,
      map_focused: focusMap,
    });
  }

  highlightSelection();

  if (showDetail) {
    showDetailPanel();
  } else {
    showListPanel();
  }

  if (focusMap) {
    focusHotelOnMap(getSelectedHotel());
  }
}

function updateMoreFiltersBadge() {
  const activeCount = [
    state.brand !== "all",
    state.hasForumReview,
    state.amenities.length > 0,
  ].filter(Boolean).length;
  dom.moreFiltersBtn.textContent = activeCount > 0 ? `More · ${activeCount}` : "+ More";
  dom.moreFiltersBtn.classList.toggle("is-active", activeCount > 0);
  dom.moreFiltersBtn.setAttribute("aria-expanded", String(!dom.moreFiltersPanel.hidden));
}

function render() {
  updateBucketTabs();
  updateFilterOptions();
  applyFilters();
  trackBucketView();
  const isIprefer = state.bucket === "iprefer";
  dom.ipreferMapToggle.hidden = !isIprefer;
  dom.ipreferMapToggle.querySelectorAll("[data-mode]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.mode === state.ipreferMapMode);
  });
  dom.ipreferHasPointsGroup.hidden = !isIprefer;
  const isHilton = state.bucket === "hilton";
  dom.hiltonMapToggle.hidden = !isHilton;
  dom.hiltonMapToggle.querySelectorAll("[data-mode]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.mode === state.hiltonMapMode);
  });
  dom.hiltonFiltersGroup.hidden = !isHilton;
  dom.hiltonStandardOnlyBtn.classList.toggle("is-active", state.hiltonStandardOnly);
  dom.ipreferHasPointsBtn.classList.toggle("is-active", state.ipreferHasPoints);
  dom.choiceHasPointsBtn.classList.toggle("is-active", state.choiceHasPoints);
  const isEdit = state.bucket === "edit";
  dom.editSelectHotelsGroup.hidden = !isEdit;
  dom.editSelectHotelsBtn.classList.toggle("is-active", state.editSelectHotels);
  const isAspire = state.bucket === "aspire";
  dom.aspireCreditWithStayGroup.hidden = !isAspire;
  dom.aspireCreditWithStayBtn.classList.toggle("is-active", state.aspireCreditWithStayFilter);
  dom.forumReviewFilterBtn.classList.toggle("is-active", state.hasForumReview);
  updateMoreFiltersBadge();
  const isFhrThc = state.bucket === "fhr_thc";
  dom.fhrThcToggle.hidden = !isFhrThc;
  dom.fhrThcToggle.querySelectorAll("[data-subfilter]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.subfilter === state.fhrThcSubFilter);
  });
  renderMap();
  ensureSelectedHotel();
  updateMeta();
  renderListPanel();
}

function initMap() {
  if (!window.L) {
    return;
  }

  map = window.L.map(dom.map, {
    zoomControl: false,
    worldCopyJump: true,
  }).setView(WORLD_VIEW.center, WORLD_VIEW.zoom);

  window.L.control.zoom({ position: "bottomright" }).addTo(map);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  markersLayer =
    typeof window.L.markerClusterGroup === "function"
      ? window.L.markerClusterGroup({
          chunkedLoading: true,
          showCoverageOnHover: false,
          removeOutsideVisibleBounds: true,
          spiderfyOnMaxZoom: true,
          maxClusterRadius: 42,
          iconCreateFunction(cluster) {
            const lowestPriceHotel = getLowestPriceHotel(
              cluster.getAllChildMarkers().map((marker) => marker.hotel).filter(Boolean),
            );

            return window.L.divIcon({
              className: "map-cluster-wrapper",
              html: markerClusterHtml(cluster.getChildCount(), lowestPriceHotel),
              iconSize: [54, 54],
            });
          },
        }).addTo(map)
      : window.L.layerGroup().addTo(map);

  map.on("moveend", () => {
    syncListToMapViewport();
    ensureSelectedHotel();
    updateMeta();
    if (Date.now() < state.preserveDetailUntil) {
      renderListPanel();
      return;
    }

    showListPanel();
  });
}

function buildShell() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <main class="page-shell">
      <section class="top-card">
        <section class="top-card__row">
          <header class="page-header">
            <h1>Open Hotel Data</h1>
            <div class="page-meta">
              <strong id="results-count">Loading hotels...</strong>
              <span id="generated-at">Preparing data…</span>
            </div>
          </header>

          <section class="bucket-strip">
            <div class="bucket-tabs">
              <button class="bucket-tab" data-bucket="aspire" type="button"></button>
              <button class="bucket-tab" data-bucket="fhr_thc" type="button"></button>
              <button class="bucket-tab" data-bucket="iprefer" type="button"></button>
              <button class="bucket-tab" data-bucket="edit" type="button"></button>
              <button class="bucket-tab" data-bucket="hilton" type="button"></button>
              <button class="bucket-tab" data-bucket="bilt_hafh" type="button"></button>
            </div>
            <div id="fhr-thc-toggle" class="map-mode-toggle" hidden>
              <button class="map-mode-toggle__btn is-active" data-subfilter="fhr" type="button">FHR</button>
              <button class="map-mode-toggle__btn" data-subfilter="thc" type="button">THC</button>
              <button class="map-mode-toggle__btn" data-subfilter="fhr+thc" type="button">FHR+THC</button>
            </div>
          </section>
        </section>

        <section class="toolbar">
        <label class="toolbar-group toolbar-group--search">
          <span>Search</span>
          <input id="search-input" type="search" placeholder="Hotel, brand, city, country" />
        </label>

        <label class="toolbar-group">
          <span>Chain</span>
          <select id="chain-select"></select>
        </label>

        <label class="toolbar-group">
          <span>Country</span>
          <select id="country-select"></select>
        </label>

        <label class="toolbar-group">
          <span>Also eligible for</span>
          <select id="overlap-plan-select"></select>
        </label>

        <label class="toolbar-group">
          <span>Sort</span>
          <select id="sort-select"></select>
        </label>

        <label id="iprefer-has-points-group" class="toolbar-group" hidden>
          <span>iPrefer filter</span>
          <div class="split-btn-group">
            <button id="iprefer-has-points-btn" class="filter-toggle-btn split-left" type="button">iPrefer Pts</button>
            <button id="choice-has-points-btn" class="filter-toggle-btn split-right" type="button">Choice Pts</button>
          </div>
        </label>

        <label id="edit-select-hotels-group" class="toolbar-group" hidden>
          <span>Edit filter</span>
          <button id="edit-select-hotels-btn" class="filter-toggle-btn" type="button">$250 Select Hotels</button>
        </label>

        <label id="aspire-credit-with-stay-group" class="toolbar-group" hidden>
          <span>Aspire filter</span>
          <button id="aspire-credit-with-stay-btn" class="filter-toggle-btn" type="button">Credit without Stay</button>
        </label>

        <label id="hilton-filters-group" class="toolbar-group" hidden>
          <span>Hilton filters</span>
          <button id="hilton-standard-only-btn" class="filter-toggle-btn" type="button">Standard reward</button>
        </label>

        <label class="toolbar-group">
          <span>More</span>
          <div class="more-filters-wrapper" id="more-filters-wrapper">
            <button id="more-filters-btn" class="filter-toggle-btn" type="button" aria-expanded="false">+ More</button>
            <div id="more-filters-panel" class="filter-dropdown__panel more-filters-panel" hidden>
              <label class="toolbar-group">
                <span>Brand</span>
                <select id="brand-select"></select>
              </label>
              <label class="toolbar-group">
                <span>Reviews</span>
                <button id="forum-review-filter-btn" class="filter-toggle-btn" type="button">Has review</button>
              </label>
              <label class="toolbar-group toolbar-group--amenities">
                <span>Amenities</span>
                <div class="filter-dropdown" id="amenities-dropdown">
                  <button
                    id="amenities-toggle"
                    class="filter-dropdown__toggle"
                    type="button"
                    aria-haspopup="true"
                    aria-expanded="false"
                  >
                    Any amenities
                  </button>
                  <div id="amenities-panel" class="filter-dropdown__panel" hidden>
                    <div id="amenities-menu" class="filter-dropdown__menu"></div>
                  </div>
                </div>
                <small id="amenities-info" hidden></small>
              </label>
            </div>
          </div>
        </label>
        </section>
      </section>

      <section class="workspace">
        <section class="content-panel">
          <div class="panel-header">
            <h2>Hotel list</h2>
            <button id="back-to-list" class="ghost-button" type="button" hidden>Back to list</button>
          </div>
          <div id="list-panel" class="hotel-list"></div>
          <div class="panel-footer">
            <button id="load-more" class="ghost-button" type="button">Load more</button>
          </div>
        </section>

        <section class="map-stack">
          <section class="content-panel">
            <div class="panel-header">
              <h2>Map</h2>
              <div id="iprefer-map-toggle" class="map-mode-toggle" hidden>
                <button class="map-mode-toggle__btn is-active" data-mode="cash" type="button">Cash</button>
                <button class="map-mode-toggle__btn" data-mode="points" type="button">iPrefer Pts</button>
                <button class="map-mode-toggle__btn" data-mode="choice" type="button">Choice Pts</button>
              </div>
              <div id="hilton-map-toggle" class="map-mode-toggle" hidden>
                <button class="map-mode-toggle__btn" data-mode="cash" type="button">Cash</button>
                <button class="map-mode-toggle__btn is-active" data-mode="points" type="button">Points</button>
              </div>
            </div>
            <div id="map"></div>
          </section>
        </section>
      </section>
    </main>
  `;

  dom = {
    resultsCount: document.querySelector("#results-count"),
    generatedAt: document.querySelector("#generated-at"),
    search: document.querySelector("#search-input"),
    brand: document.querySelector("#brand-select"),
    chain: document.querySelector("#chain-select"),
    country: document.querySelector("#country-select"),
    overlapPlan: document.querySelector("#overlap-plan-select"),
    sort: document.querySelector("#sort-select"),
    amenitiesDropdown: document.querySelector("#amenities-dropdown"),
    amenitiesToggle: document.querySelector("#amenities-toggle"),
    amenitiesPanel: document.querySelector("#amenities-panel"),
    amenitiesMenu: document.querySelector("#amenities-menu"),
    amenitiesInfo: document.querySelector("#amenities-info"),
    moreFiltersBtn: document.querySelector("#more-filters-btn"),
    moreFiltersPanel: document.querySelector("#more-filters-panel"),
    moreFiltersWrapper: document.querySelector("#more-filters-wrapper"),
    list: document.querySelector("#list-panel"),
    backToList: document.querySelector("#back-to-list"),
    loadMore: document.querySelector("#load-more"),
    map: document.querySelector("#map"),
    ipreferMapToggle: document.querySelector("#iprefer-map-toggle"),
    hiltonMapToggle: document.querySelector("#hilton-map-toggle"),
    ipreferHasPointsGroup: document.querySelector("#iprefer-has-points-group"),
    ipreferHasPointsBtn: document.querySelector("#iprefer-has-points-btn"),
    choiceHasPointsBtn: document.querySelector("#choice-has-points-btn"),
    editSelectHotelsGroup: document.querySelector("#edit-select-hotels-group"),
    editSelectHotelsBtn: document.querySelector("#edit-select-hotels-btn"),
    aspireCreditWithStayGroup: document.querySelector("#aspire-credit-with-stay-group"),
    aspireCreditWithStayBtn: document.querySelector("#aspire-credit-with-stay-btn"),
    fhrThcToggle: document.querySelector("#fhr-thc-toggle"),
    hiltonFiltersGroup: document.querySelector("#hilton-filters-group"),
    hiltonStandardOnlyBtn: document.querySelector("#hilton-standard-only-btn"),
    forumReviewFilterBtn: document.querySelector("#forum-review-filter-btn"),
  };

  dom.overlapPlan.value = state.overlapPlan;
  dom.sort.value = state.sort;
}

function bindEvents() {
  document.querySelectorAll("[data-bucket]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextBucket = button.dataset.bucket;
      if (nextBucket === state.bucket) {
        return;
      }

      state.bucket = nextBucket;
      state.listLimit = LIST_PAGE_SIZE;
      state.brand = "all";
      state.chain = "all";
      state.country = "all";
      state.overlapPlan = "all";
      state.amenities = [];
      state.sort = nextBucket === "iprefer" ? "cpp-iprefer-desc"
        : nextBucket === "hilton" ? "cpp-hilton-desc"
        : "price-asc";
      state.ipreferHasPoints = nextBucket === "iprefer";
      state.choiceHasPoints = false;
      state.editSelectHotels = false;
      state.aspireCreditWithStayFilter = false;
      state.hasForumReview = false;
      state.fhrThcSubFilter = "fhr";
      state.hiltonStandardOnly = true;
      state.shouldResetMapView = true;
      state.listPanelMode = "list";
      state.selectedHotelId = null;
      syncUrlFromState();
      render();
    });
  });

  dom.search.addEventListener("input", (event) => {
    state.search = event.target.value;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.brand.addEventListener("change", (event) => {
    state.brand = event.target.value;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.chain.addEventListener("change", (event) => {
    state.chain = event.target.value;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.country.addEventListener("change", (event) => {
    state.country = event.target.value;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.overlapPlan.addEventListener("change", (event) => {
    state.overlapPlan = event.target.value;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.listPanelMode = "list";
    render();
  });

  dom.amenitiesToggle.addEventListener("click", () => {
    const isOpen = !dom.amenitiesPanel.hidden;
    dom.amenitiesPanel.hidden = isOpen;
    dom.amenitiesToggle.setAttribute("aria-expanded", String(!isOpen));
  });

  dom.moreFiltersBtn.addEventListener("click", () => {
    const isOpen = !dom.moreFiltersPanel.hidden;
    dom.moreFiltersPanel.hidden = isOpen;
    dom.moreFiltersBtn.setAttribute("aria-expanded", String(!isOpen));
  });

  dom.amenitiesMenu.addEventListener("change", () => {
    state.amenities = [...dom.amenitiesMenu.querySelectorAll("input:checked")].map((input) => input.value);
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  document.addEventListener("click", (event) => {
    if (!dom.amenitiesDropdown.contains(event.target)) {
      dom.amenitiesPanel.hidden = true;
      dom.amenitiesToggle.setAttribute("aria-expanded", "false");
    }
    if (!dom.moreFiltersWrapper.contains(event.target)) {
      dom.moreFiltersPanel.hidden = true;
      dom.moreFiltersBtn.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dom.amenitiesPanel.hidden = true;
      dom.amenitiesToggle.setAttribute("aria-expanded", "false");
      dom.moreFiltersPanel.hidden = true;
      dom.moreFiltersBtn.setAttribute("aria-expanded", "false");
    }
  });

  dom.loadMore.addEventListener("click", () => {
    state.listLimit += LIST_PAGE_SIZE;
    renderListView();
  });

  dom.backToList.addEventListener("click", () => {
    showListPanel();
  });

  dom.ipreferHasPointsBtn.addEventListener("click", () => {
    state.ipreferHasPoints = !state.ipreferHasPoints;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.choiceHasPointsBtn.addEventListener("click", () => {
    state.choiceHasPoints = !state.choiceHasPoints;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.editSelectHotelsBtn.addEventListener("click", () => {
    state.editSelectHotels = !state.editSelectHotels;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.aspireCreditWithStayBtn.addEventListener("click", () => {
    state.aspireCreditWithStayFilter = !state.aspireCreditWithStayFilter;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.forumReviewFilterBtn.addEventListener("click", () => {
    state.hasForumReview = !state.hasForumReview;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.ipreferMapToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-mode]");
    if (!btn || btn.dataset.mode === state.ipreferMapMode) return;

    state.ipreferMapMode = btn.dataset.mode;
    dom.ipreferMapToggle.querySelectorAll("[data-mode]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.mode === state.ipreferMapMode);
    });
    applyFilters();
    renderMap();
    renderListPanel();
  });

  dom.hiltonStandardOnlyBtn.addEventListener("click", () => {
    state.hiltonStandardOnly = !state.hiltonStandardOnly;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  dom.hiltonMapToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-mode]");
    if (!btn || btn.dataset.mode === state.hiltonMapMode) return;

    state.hiltonMapMode = btn.dataset.mode;
    dom.hiltonMapToggle.querySelectorAll("[data-mode]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.mode === state.hiltonMapMode);
    });
    applyFilters();
    renderMap();
    renderListPanel();
  });

  dom.fhrThcToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-subfilter]");
    if (!btn || btn.dataset.subfilter === state.fhrThcSubFilter) return;

    state.fhrThcSubFilter = btn.dataset.subfilter;
    state.listLimit = LIST_PAGE_SIZE;
    state.shouldResetMapView = true;
    state.listPanelMode = "list";
    render();
  });

  window.addEventListener("popstate", () => {
    state.listPanelMode = "list";
    state.selectedHotelId = null;
    syncStateFromUrl();
    render();
  });
}

async function loadHotels() {
  const response = await fetch(HOTELS_URL);
  if (!response.ok) {
    throw new Error(`Unable to load ${HOTELS_URL}: ${response.status}`);
  }

  const payload = await response.json();
  const hotels = payload.hotels.map((hotel) => normalizeHotel([hotel.id, hotel]));

  state.meta = payload.metadata || {};
  state.hotels = hotels.filter((hotel) => hotel.bucket);
  state.hotelsById = new Map(state.hotels.map((hotel) => [hotel.id, hotel]));
}

async function loadForumReviews() {
  try {
    const response = await fetch(FORUM_REVIEWS_URL);
    if (!response.ok) return;
    const payload = await response.json();
    const reviewsByHotel = payload.reviews_by_hotel || {};
    for (const [id, reviews] of Object.entries(reviewsByHotel)) {
      if (id !== "unmatched" && Array.isArray(reviews)) {
        forumReviewsMap.set(id, reviews);
      }
    }
  } catch {
    // non-fatal: forum reviews are optional
  }
}

function renderError(error) {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <main class="error-shell">
      <p class="eyebrow">Open Hotel Data</p>
      <h1>Frontend failed to load</h1>
      <p>${escapeHtml(error.message || "Unknown error")}</p>
    </main>
  `;
}

async function init() {
  try {
    buildShell();
    initMap();
    bindEvents();
    await Promise.all([loadHotels(), loadForumReviews()]);
    state.hotels.forEach((hotel) => {
      const reviews = forumReviewsMap.get(hotel.id) || [];
      hotel.forumReviews = reviews;
      hotel.forumReviewCount = reviews.length;
    });
    syncStateFromUrl();
    render();
    if (state.listPanelMode === "detail" && state.selectedHotelId) {
      const hotel = getSelectedHotel();
      if (hotel) focusHotelOnMap(hotel);
    }
  } catch (error) {
    console.error(error);
    renderError(error);
  }
}

init();
