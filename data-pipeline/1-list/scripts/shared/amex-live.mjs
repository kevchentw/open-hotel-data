import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { normalizeText } from "./normalize.mjs";

const AMEX_TRAVEL_ORIGIN = "https://www.americanexpress.com";
const DEFAULT_ROUTE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const COUNTRY_CODE_MAP = {
  CA: "Canada",
  MX: "Mexico",
  US: "United States"
};
const PROGRAM_SOURCE_MAP = {
  fhr: "amex_fhr",
  thc: "amex_thc"
};
let cachedHotelsPromise = null;

export async function collectAmexLiveHotels(options = {}) {
  const requestedSources = normalizeRequestedSources(options.sources);
  const hotels = await getAllAmexLiveHotels();

  return hotels.filter((hotel) => requestedSources.has(hotel.source));
}

async function getAllAmexLiveHotels() {
  if (!cachedHotelsPromise) {
    cachedHotelsPromise = crawlAllAmexLiveHotels().catch((error) => {
      cachedHotelsPromise = null;
      throw error;
    });
  }

  return cachedHotelsPromise;
}

async function crawlAllAmexLiveHotels() {
  const userDataDir = resolveUserDataDir();
  await mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless: readBooleanEnv("AMEX_HOTELS_HEADLESS", false)
  });

  try {
    const routeIds = parseRouteIds(process.env.AMEX_HOTELS_ROUTE_IDS);
    const hotelMap = new Map();
    const requestedSources = new Set(Object.values(PROGRAM_SOURCE_MAP));

    for (const routeId of routeIds) {
      const hotels = await collectHotelsFromRoute(context, routeId, requestedSources);

      for (const hotel of hotels) {
        hotelMap.set(`${hotel.source}:${hotel.sourceHotelId}`, hotel);
      }
    }

    return Array.from(hotelMap.values());
  } finally {
    await context.close();
  }
}

async function collectHotelsFromRoute(context, routeId, requestedSources) {
  const page = await context.newPage();

  try {
    await navigateToResultsPage(page, routeId);
    await assertResultsPage(page, routeId);

    await page.waitForFunction(
      () => document.querySelectorAll("div.card.mainPropertyCard").length > 0,
      { timeout: 120_000 }
    );

    await page.waitForTimeout(1_000);
    const includeGps = readBooleanEnv("AMEX_HOTELS_FETCH_GPS", true);

    if (includeGps) {
      await page
        .getByRole("button", { name: /view map/i })
        .first()
        .click();
      await page
        .waitForFunction(
          () => Array.isArray(window.markers) && window.markers.length > 0,
          { timeout: 30_000 }
        )
        .catch(() => {});
      await page.waitForTimeout(1_000);
    }

    const hotels = await page.evaluate(({ origin, sourceMap, requested, includeGps }) => {
      const cards = Array.from(document.querySelectorAll("div.card.mainPropertyCard"));
      const markerMap = new Map();

      if (includeGps) {
        const rawMarkers = Array.isArray(window.markers) ? window.markers : [];

        for (const marker of rawMarkers) {
          const supplierNameUrl = String(marker?.supplierNameURL ?? "").trim();
          const lat = typeof marker?.position?.lat === "function" ? marker.position.lat() : marker?.position?.lat;
          const lng = typeof marker?.position?.lng === "function" ? marker.position.lng() : marker?.position?.lng;

          if (!supplierNameUrl || lat == null || lng == null) {
            continue;
          }

          markerMap.set(supplierNameUrl, {
            latitude: String(lat),
            longitude: String(lng),
            supplierId: marker?.supplierID == null ? "" : String(marker.supplierID)
          });
        }
      }

      return cards
        .map((card) => {
          if (!(card instanceof HTMLElement)) {
            return null;
          }

          const programKey = card.className.includes("card-thc")
            ? "thc"
            : card.className.includes("card-fhr")
              ? "fhr"
              : "";

          const source = sourceMap[programKey];

          if (!source || !requested.includes(source)) {
            return null;
          }

          const nameAnchor = card.querySelector('a[href*="/en-us/travel/discover/property/"]');

          if (!(nameAnchor instanceof HTMLAnchorElement)) {
            return null;
          }

          const brand = card.querySelector(".card-brand")?.textContent ?? "";
          const location = card.querySelector(".card-location")?.textContent ?? "";
          const supplierNameUrl = String(
            new URL(nameAnchor.getAttribute("href") ?? "", origin).pathname
              .replace(/^\/en-us\/travel\/discover\/property\//, "")
          ).trim();
          const marker = markerMap.get(supplierNameUrl) ?? null;

          return {
            source,
            name: nameAnchor.textContent ?? "",
            href: new URL(nameAnchor.getAttribute("href") ?? "", origin).toString(),
            brand,
            location,
            latitude: marker?.latitude ?? "",
            longitude: marker?.longitude ?? "",
            geoPlaceId: marker?.supplierId ?? ""
          };
        })
        .filter(Boolean);
    }, {
      origin: AMEX_TRAVEL_ORIGIN,
      sourceMap: {
        fhr: PROGRAM_SOURCE_MAP.fhr,
        thc: PROGRAM_SOURCE_MAP.thc
      },
      requested: Array.from(requestedSources),
      includeGps
    });

    return hotels
      .map((hotel) => toNormalizedRecord(hotel))
      .filter((hotel) => hotel.name && hotel.sourceHotelId);
  } finally {
    await page.close().catch(() => {});
  }
}

async function navigateToResultsPage(page, routeId) {
  return navigateWithRetries(page, buildResultsUrl(routeId));
}

async function navigateWithRetries(page, url) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 120_000
      });

      await page.waitForFunction(
        () =>
          document.readyState === "interactive" ||
          document.readyState === "complete" ||
          /access denied/i.test(document.title) ||
          /access denied/i.test(document.body?.innerText ?? ""),
        { timeout: 120_000 }
      );

      return;
    } catch (error) {
      lastError = error;

      if (attempt === 3) {
        break;
      }

      await page.waitForTimeout(1_500 * attempt);
    }
  }

  throw new Error(`Failed to load ${url} after multiple attempts: ${lastError?.message ?? "unknown error"}`);
}

async function assertResultsPage(page, routeId) {
  const title = normalizeText(await page.title());
  const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));

  if (/access denied/i.test(title) || /access denied/i.test(bodyText)) {
    throw new Error(buildBlockedMessage(`route ${routeId}`, buildResultsUrl(routeId)));
  }

  if (!/my results/i.test(title)) {
    throw new Error(`Unexpected page title for route ${routeId}: "${title || "<empty>"}"`);
  }
}

function buildBlockedMessage(label, url) {
  return [
    `American Express blocked ${label} while loading ${url}.`,
    "Re-run with AMEX_HOTELS_HEADLESS=false so Chrome can complete any challenge,",
    `then keep using the same profile at ${resolveUserDataDir()}.`
  ].join(" ");
}

function toNormalizedRecord(record) {
  const location = parseLocation(record.location);
  const websiteUrl = stripQueryString(record.href);

  return {
    source: normalizeText(record.source),
    sourceHotelId: extractSourceHotelId(websiteUrl),
    name: normalizeText(record.name),
    websiteUrl,
    chain: "",
    brand: normalizeText(record.brand),
    city: location.city,
    stateRegion: location.stateRegion,
    country: location.country,
    tripadvisorKey: "",
    latitude: normalizeText(record.latitude),
    longitude: normalizeText(record.longitude),
    formattedAddress: "",
    geoProvider: record.latitude && record.longitude ? "amex_results_map" : "",
    geoConfidence: record.latitude && record.longitude ? "high" : "",
    geoPlaceId: normalizeText(record.geoPlaceId),
    geoTypes: "",
    geoPartialMatch: "",
    geoStatus: record.latitude && record.longitude ? "OK" : "",
    lastVerifiedAt: todayIsoDate()
  };
}

function parseLocation(rawValue) {
  const parts = normalizeText(rawValue)
    .split(",")
    .map((part) => normalizeText(part))
    .filter(Boolean);

  if (parts.length >= 3) {
    const [city, stateRegion, countryPart] = parts;

    return {
      city,
      stateRegion,
      country: normalizeCountryPart(countryPart)
    };
  }

  const [city = "", regionPart = ""] = parts;
  const regionalMatch = regionPart.match(/^(.*\S)\s+(US|CA|MX)$/);

  if (regionalMatch) {
    return {
      city,
      stateRegion: normalizeText(regionalMatch[1]),
      country: COUNTRY_CODE_MAP[regionalMatch[2]] ?? regionalMatch[2]
    };
  }

  return {
    city,
    stateRegion: "",
    country: normalizeCountryPart(regionPart)
  };
}

function normalizeCountryPart(value) {
  const normalized = normalizeText(value);
  return COUNTRY_CODE_MAP[normalized] ?? normalized;
}

function extractSourceHotelId(urlValue) {
  const url = normalizeText(urlValue);

  if (!url) {
    return "";
  }

  try {
    const pathname = new URL(url).pathname;
    const propertyPath = pathname.match(/\/property\/(.+)$/)?.[1];
    return propertyPath ? decodeURIComponent(propertyPath) : pathname;
  } catch {
    return url;
  }
}

function stripQueryString(urlValue) {
  const url = normalizeText(urlValue);

  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

function buildResultsUrl(routeId) {
  return `${AMEX_TRAVEL_ORIGIN}/en-us/travel/discover/property-results/r/${routeId}`;
}

function parseRouteIds(value) {
  const parsedIds = normalizeText(value)
    .split(",")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isInteger(part) && part > 0);

  return parsedIds.length ? parsedIds : DEFAULT_ROUTE_IDS;
}

function normalizeRequestedSources(sources) {
  const normalized = (Array.isArray(sources) ? sources : [])
    .map((source) => normalizeText(source))
    .filter(Boolean);

  return new Set(normalized.length ? normalized : Object.values(PROGRAM_SOURCE_MAP));
}

function readBooleanEnv(name, fallbackValue) {
  const value = normalizeText(process.env[name]);

  if (!value) {
    return fallbackValue;
  }

  return /^(1|true|yes)$/i.test(value);
}

function resolveUserDataDir() {
  const explicitPath = normalizeText(process.env.AMEX_HOTELS_USER_DATA_DIR);

  if (explicitPath) {
    return explicitPath;
  }

  const legacyPath = normalizeText(process.env.AMEX_THC_USER_DATA_DIR);

  if (legacyPath) {
    return legacyPath;
  }

  const currentFilePath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(currentFilePath), "..", "..", "..", "..");
  return path.join(repoRoot, ".cache", "amex-hotels-chrome");
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
