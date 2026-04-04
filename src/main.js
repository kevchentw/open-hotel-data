import "./styles.css";

const HOTELS_URL = "./data/hotels.json";
const DEFAULT_BUCKET = "thc";
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
const WORLD_VIEW = {
  center: [20, 0],
  zoom: 2,
};

const PLAN_CONFIG = {
  thc: {
    key: "thc",
    label: "Amex THC",
    plans: ["amex_thc"],
    description: "Hotel Collection properties from the latest export.",
  },
  fhr: {
    key: "fhr",
    label: "FHR",
    plans: ["amex_fhr"],
    description: "Fine Hotels + Resorts properties, including shared Aspire resorts.",
  },
  aspire: {
    key: "aspire",
    label: "Aspire",
    plans: ["hilton_aspire_resort_credit"],
    description: "Hilton Aspire resorts that are not also in Amex FHR or THC.",
  },
};

const PLAN_LABELS = {
  amex_thc: "Amex THC",
  amex_fhr: "FHR",
  hilton_aspire_resort_credit: "Aspire",
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
  country: "all",
  overlapPlan: "all",
  amenities: [],
  sort: "price-asc",
  listLimit: LIST_PAGE_SIZE,
  meta: {},
  shouldResetMapView: true,
  preserveDetailUntil: 0,
};

let map = null;
let markersLayer = null;
let dom = {};

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
  if (plans.includes("amex_thc")) {
    return "thc";
  }

  if (plans.includes("amex_fhr")) {
    return "fhr";
  }

  if (plans.includes("hilton_aspire_resort_credit")) {
    return "aspire";
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

function normalizeHotel([id, rawHotel]) {
  const latitude = toFiniteNumber(rawHotel.latitude);
  const longitude = toFiniteNumber(rawHotel.longitude);
  const hasCoordinates = latitude !== null && longitude !== null;
  const bucket = buildBucketKey(rawHotel.plans || []);
  const locationLabel = buildLocationLabel(rawHotel);
  const priceValue = buildPriceValue(rawHotel);
  const quality = buildQuality(rawHotel, hasCoordinates);

  const amenityValues = unique(rawHotel.amenities || []);
  const normalizedAmenities = unique(amenityValues.map(normalizeText));

  const hotel = {
    id,
    rawHotel,
    name: rawHotel.name || "Unnamed hotel",
    brand: rawHotel.brand || rawHotel.chain || "Independent",
    city: rawHotel.city || "",
    region: rawHotel.state_region || "",
    country: rawHotel.country || "",
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
    priceLabel: formatCurrency(priceValue, rawHotel.summary_price?.currency || rawHotel.currency || "USD"),
    priceSubLabel: rawHotel.summary_price?.display
      ? `Reference display ${rawHotel.summary_price.display}`
      : rawHotel.record_type === "canonical"
        ? "Canonical hotel record"
        : "Fallback hotel record",
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
    generatedSource: rawHotel.display_state || rawHotel.record_type || "",
    marker: null,
  };

  return hotel;
}

function compareHotels(left, right) {
  if (state.sort === "name") {
    return left.name.localeCompare(right.name);
  }

  const leftPrice = left.priceValue;
  const rightPrice = right.priceValue;

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
  const plans = PLAN_CONFIG[bucket]?.plans || [];
  return plans.some((plan) => hotel.plans.includes(plan));
}

function getBucketHotels(bucket = state.bucket) {
  return state.hotels.filter((hotel) => hotelMatchesBucket(hotel, bucket));
}

function readCountries(hotels) {
  return unique(hotels.map((hotel) => hotel.country)).sort((a, b) => a.localeCompare(b));
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
    thc: 0,
    fhr: 0,
    aspire: 0,
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
  const countries = readCountries(bucketHotels);
  populateSelect(dom.country, countries, "All countries");

  if (state.country !== "all" && !countries.includes(state.country)) {
    state.country = "all";
  }
  dom.country.value = state.country;

  const overlapOptions = readOverlapOptions(bucketHotels);
  populateSelect(dom.overlapPlan, overlapOptions, "Any overlap");

  if (state.overlapPlan !== "all" && !overlapOptions.some((option) => option.value === state.overlapPlan)) {
    state.overlapPlan = "all";
  }

  dom.overlapPlan.disabled = overlapOptions.length === 0;
  dom.overlapPlan.value = state.overlapPlan;

  const amenityOptions = readAmenityOptions(bucketHotels);
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
  const search = normalizeText(state.search);

  state.filteredHotels = getBucketHotels()
    .filter((hotel) => {
      if (search && !hotel.searchText.includes(search)) {
        return false;
      }

      if (state.country !== "all" && hotel.country !== state.country) {
        return false;
      }

      if (state.overlapPlan !== "all" && !hotel.plans.includes(state.overlapPlan)) {
        return false;
      }

      if (
        state.amenities.length &&
        !state.amenities.every((amenity) => hotel.normalizedAmenities.includes(amenity))
      ) {
        return false;
      }

      return true;
    })
    .sort(compareHotels);
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
  button.innerHTML = `
    <div class="hotel-row__main">
      <div class="hotel-row__headline">
        <strong>${escapeHtml(hotel.name)}</strong>
        <span class="row-price">${escapeHtml(hotel.priceLabel)}</span>
      </div>
      <p>${escapeHtml(hotel.locationLabel)}</p>
      <div class="hotel-row__meta">
        <span>${escapeHtml(hotel.brand)}</span>
        <span>${escapeHtml(joinValues(hotel.planLabels))}</span>
      </div>
    </div>
  `;

  button.addEventListener("click", () => {
    selectHotel(hotel.id, { focusMap: true });
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
  dom.backToList.hidden = false;

  dom.list.innerHTML = `
    <article class="detail-card detail-card--in-list">
      <div class="card-topline">
        ${planPills ? `<div class="detail-plan-pills detail-plan-pills--inline">${planPills}</div>` : "<div></div>"}
        <span class="price-pill">${escapeHtml(hotel.priceLabel)}</span>
      </div>
      <h2>${escapeHtml(hotel.name)}</h2>
      <p class="detail-location">${escapeHtml(hotel.locationLabel)}</p>

      <div class="detail-price-summary ${hotel.priceValue === null ? "detail-price-summary--pending" : ""}">
        <span class="detail-price-summary__eyebrow">Reference price</span>
        <strong>${escapeHtml(hotel.priceLabel)}</strong>
        <p>${escapeHtml(hotel.priceSubLabel)}</p>
      </div>

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

      <div class="detail-actions">
        ${
          hotel.tripadvisorUrl
            ? `<a class="primary-button" href="${hotel.tripadvisorUrl}" target="_blank" rel="noreferrer">TripAdvisor</a>`
            : ""
        }
        <a class="ghost-button" href="${buildGoogleMapsUrl(hotel)}" target="_blank" rel="noreferrer">Google Map</a>
      </div>
    </article>
  `;
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
  return `
    <div class="map-pin ${mapPinClass(hotel)}" style="${mapPinStyle(hotel)}">
      <span>${escapeHtml(hotel.priceValue !== null ? formatCurrency(hotel.priceValue) : "View")}</span>
    </div>
  `;
}

function mapPinClass(hotel) {
  return hotel.priceValue === null ? "map-pin--pending" : "map-pin--priced";
}

function getPriceBucketStart(priceValue) {
  if (typeof priceValue !== "number" || Number.isNaN(priceValue)) {
    return null;
  }

  return Math.max(0, Math.floor(priceValue / PRICE_BUCKET_SIZE) * PRICE_BUCKET_SIZE);
}

function getPriceBucketColor(priceValue) {
  const bucketStart = getPriceBucketStart(priceValue);
  if (bucketStart === null) {
    return "var(--pin-pending)";
  }

  if (bucketStart <= PRICE_COLOR_STOPS[0].bucketStart) {
    return PRICE_COLOR_STOPS[0].color;
  }

  for (let index = 1; index < PRICE_COLOR_STOPS.length; index += 1) {
    const leftStop = PRICE_COLOR_STOPS[index - 1];
    const rightStop = PRICE_COLOR_STOPS[index];
    if (bucketStart > rightStop.bucketStart) {
      continue;
    }

    const progress =
      (bucketStart - leftStop.bucketStart) / (rightStop.bucketStart - leftStop.bucketStart || 1);

    return interpolateHexColor(leftStop.color, rightStop.color, progress);
  }

  return PRICE_COLOR_STOPS[PRICE_COLOR_STOPS.length - 1].color;
}

function mapPinStyle(hotel) {
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
  return hotels.reduce((lowestHotel, hotel) => {
    if (!lowestHotel) {
      return hotel;
    }

    if (typeof hotel.priceValue !== "number" || Number.isNaN(hotel.priceValue)) {
      return lowestHotel;
    }

    if (typeof lowestHotel.priceValue !== "number" || Number.isNaN(lowestHotel.priceValue)) {
      return hotel;
    }

    return hotel.priceValue < lowestHotel.priceValue ? hotel : lowestHotel;
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

    marker.bindPopup(`
      <div class="popup-card">
        <strong>${escapeHtml(hotel.name)}</strong>
        <span>${escapeHtml(hotel.locationLabel)}</span>
        <span>${escapeHtml(hotel.priceLabel)}</span>
      </div>
    `);

    marker.on("click", () => {
      selectHotel(hotel.id, { showDetail: true });
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

function showListPanel() {
  state.listPanelMode = "list";
  renderListPanel();
}

function showDetailPanel() {
  state.listPanelMode = "detail";
  renderListPanel();
}

function selectHotel(hotelId, { focusMap = false, showDetail = true } = {}) {
  state.selectedHotelId = hotelId;
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

function render() {
  updateBucketTabs();
  updateFilterOptions();
  applyFilters();
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
              <button class="bucket-tab" data-bucket="thc" type="button"></button>
              <button class="bucket-tab" data-bucket="fhr" type="button"></button>
              <button class="bucket-tab" data-bucket="aspire" type="button"></button>
            </div>
          </section>
        </section>
      </section>

      <section class="toolbar">
        <label class="toolbar-group toolbar-group--search">
          <span>Search</span>
          <input id="search-input" type="search" placeholder="Hotel, brand, city, country" />
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
          <select id="sort-select">
            <option value="price-asc">Lowest price</option>
            <option value="price-desc">Highest price</option>
            <option value="name">Name</option>
          </select>
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
    country: document.querySelector("#country-select"),
    overlapPlan: document.querySelector("#overlap-plan-select"),
    sort: document.querySelector("#sort-select"),
    amenitiesDropdown: document.querySelector("#amenities-dropdown"),
    amenitiesToggle: document.querySelector("#amenities-toggle"),
    amenitiesPanel: document.querySelector("#amenities-panel"),
    amenitiesMenu: document.querySelector("#amenities-menu"),
    amenitiesInfo: document.querySelector("#amenities-info"),
    list: document.querySelector("#list-panel"),
    backToList: document.querySelector("#back-to-list"),
    loadMore: document.querySelector("#load-more"),
    map: document.querySelector("#map"),
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
      state.country = "all";
      state.overlapPlan = "all";
      state.amenities = [];
      state.shouldResetMapView = true;
      state.listPanelMode = "list";
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
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dom.amenitiesPanel.hidden = true;
      dom.amenitiesToggle.setAttribute("aria-expanded", "false");
    }
  });

  dom.loadMore.addEventListener("click", () => {
    state.listLimit += LIST_PAGE_SIZE;
    renderListView();
  });

  dom.backToList.addEventListener("click", () => {
    showListPanel();
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
    await loadHotels();
    render();
  } catch (error) {
    console.error(error);
    renderError(error);
  }
}

init();
