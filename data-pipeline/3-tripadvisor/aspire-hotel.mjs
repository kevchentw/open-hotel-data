import { mkdir, readFile, writeFile } from "node:fs/promises";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SOURCE = "hilton_aspire_resort_credit";
const STAGE = "3-tripadvisor";
const TRIPADVISOR_ORIGIN = "https://www.tripadvisor.com/";
const INPUT_STAGE_ONE_FILE_URL = new URL("../1-list/aspire-hotel.json", import.meta.url);
const OUTPUT_FILE_URL = new URL("./aspire-hotel.json", import.meta.url);
const OUTPUT_DIRECTORY_URL = new URL("./", import.meta.url);
const PROFILE_DIRECTORY_URL = new URL("./.playwright/tripadvisor-profile/", import.meta.url);

export async function buildAspireTripadvisorMatches() {
  const stageOneHotels = await readStageOneHotels();
  const existingPayload = await readExistingOutput();
  const pendingHotels = getPendingHotels(stageOneHotels, existingPayload.matches);

  if (pendingHotels.length === 0) {
    return finalizePayload({
      metadata: existingPayload.metadata,
      matches: existingPayload.matches
    });
  }

  const payload = finalizePayload({
    metadata: {
      stage: STAGE,
      source: SOURCE,
      generated_at: new Date().toISOString()
    },
    matches: existingPayload.matches
  });

  const browserSession = await createBrowserSession();

  try {
    await browserSession.openHomePage();
    await browserSession.waitForManualReady(
      "TripAdvisor is open in a headed browser. Complete any cookie or bot checks there, then press Enter here to start backfill."
    );

    for (const hotel of pendingHotels) {
      const matchedAt = new Date().toISOString();
      const result = await browserSession.findHotel(hotel);

      payload.matches[hotel.source_hotel_id] = {
        tripadvisor_id: result.tripadvisorId,
        tripadvisor_url: result.tripadvisorUrl,
        search_query: result.searchQuery,
        match_confidence: result.matchConfidence,
        matched_at: matchedAt
      };

      payload.metadata.generated_at = matchedAt;
      await persistPayload(finalizePayload(payload));

      const summary = result.tripadvisorId || "no match";
      console.log(`Processed ${hotel.name} -> ${summary}`);
    }

    return finalizePayload(payload);
  } finally {
    await browserSession.close();
  }
}

export async function writeStageThreeOutputs() {
  const payload = await buildAspireTripadvisorMatches();

  console.log(
    `Wrote ${payload.metadata.record_count} Aspire stage 3 records to ${OUTPUT_FILE_URL.pathname} ` +
      `(${payload.metadata.matched_count} matched, ${payload.metadata.unmatched_count} unmatched)`
  );
}

async function readStageOneHotels() {
  const raw = await readFile(INPUT_STAGE_ONE_FILE_URL, "utf8");
  const payload = JSON.parse(raw);
  return payload.hotels ?? {};
}

async function readExistingOutput() {
  try {
    const raw = await readFile(OUTPUT_FILE_URL, "utf8");
    const payload = JSON.parse(raw);

    return {
      metadata: payload.metadata ?? {},
      matches: payload.matches ?? {}
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { metadata: {}, matches: {} };
    }

    throw error;
  }
}

function getPendingHotels(stageOneHotels, existingMatches) {
  const limit = readIntegerEnv("TRIPADVISOR_MATCH_LIMIT", Number.POSITIVE_INFINITY);
  const hotels = Object.values(stageOneHotels).filter((hotel) => !hasTripadvisorIdentity(existingMatches[hotel.source_hotel_id]));
  return Number.isFinite(limit) ? hotels.slice(0, Math.max(limit, 0)) : hotels;
}

function hasTripadvisorIdentity(match) {
  if (!match || typeof match !== "object") {
    return false;
  }

  return Boolean(String(match.tripadvisor_id || "").trim() || String(match.tripadvisor_url || "").trim());
}

function finalizePayload(payload) {
  const matches = payload.matches ?? {};
  const recordCount = Object.keys(matches).length;
  const matchedCount = Object.values(matches).filter((match) => hasTripadvisorIdentity(match)).length;

  return {
    metadata: {
      ...(payload.metadata ?? {}),
      stage: STAGE,
      source: SOURCE,
      generated_at: payload.metadata?.generated_at ?? new Date().toISOString(),
      record_count: recordCount,
      matched_count: matchedCount,
      unmatched_count: recordCount - matchedCount
    },
    matches
  };
}

async function persistPayload(payload) {
  const finalPayload = finalizePayload(payload);
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });
  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(finalPayload, null, 2)}\n`, "utf8");
}

async function createBrowserSession() {
  const userDataDir = fileURLToPath(PROFILE_DIRECTORY_URL);
  await mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.TRIPADVISOR_BROWSER_CHANNEL || "chrome",
    headless: readBooleanEnv("TRIPADVISOR_HEADLESS", false),
    slowMo: readIntegerEnv("TRIPADVISOR_SLOW_MO_MS", 250),
    viewport: { width: 1440, height: 960 }
  });

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(readIntegerEnv("TRIPADVISOR_TIMEOUT_MS", 30_000));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return {
    async openHomePage() {
      await page.goto(TRIPADVISOR_ORIGIN, {
        waitUntil: "domcontentloaded",
        timeout: 120_000
      });

      await page.waitForTimeout(readIntegerEnv("TRIPADVISOR_HOME_PAUSE_MS", 2_000));
      await dismissCookieBanner(page);
    },

    async waitForManualReady(prompt) {
      await rl.question(`${prompt}\n`);
    },

    async findHotel(hotel) {
      const searchTerms = buildSearchTerms(hotel);

      for (const searchTerm of searchTerms) {
        await ensureSearchReady(page, rl, hotel.name);
        await submitSearch(page, searchTerm);
        await waitForSearchResults(page, rl, hotel.name);

        const result = await extractBestHotelMatch(page, searchTerm);
        if (result) {
          return {
            searchQuery: searchTerm,
            tripadvisorId: result.tripadvisorId,
            tripadvisorUrl: result.tripadvisorUrl,
            matchConfidence: result.matchConfidence
          };
        }
      }

      return {
        searchQuery: searchTerms[0] || hotel.name || "",
        tripadvisorId: "",
        tripadvisorUrl: "",
        matchConfidence: "none"
      };
    },

    async close() {
      rl.close();
      await context.close();
    }
  };
}

async function dismissCookieBanner(page) {
  const button = page.getByRole("button", { name: /accept|got it|agree|ok/i }).first();

  if (await button.isVisible().catch(() => false)) {
    await button.click().catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function ensureSearchReady(page, rl, hotelName) {
  const blocked = await pageLooksBlocked(page);
  if (blocked) {
    await rl.question(`TripAdvisor appears to be challenging access while preparing "${hotelName}". Clear it in the browser, then press Enter here.\n`);
  }

  if (!page.url().startsWith(TRIPADVISOR_ORIGIN)) {
    await page.goto(TRIPADVISOR_ORIGIN, {
      waitUntil: "domcontentloaded",
      timeout: 120_000
    });
    await page.waitForTimeout(readIntegerEnv("TRIPADVISOR_HOME_PAUSE_MS", 2_000));
  }
}

async function submitSearch(page, searchTerm) {
  const searchInput = page
    .locator('input[type="search"], input[placeholder*="Search"], input[aria-label*="Search"]')
    .first();

  await searchInput.waitFor({ state: "visible", timeout: 60_000 });
  await searchInput.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await typeSlowly(page, searchInput, searchTerm);
  await page.waitForTimeout(readIntegerEnv("TRIPADVISOR_BEFORE_SUBMIT_MS", 1_500));
  await searchInput.press("Enter");
}

async function waitForSearchResults(page, rl, hotelName) {
  await page.waitForTimeout(readIntegerEnv("TRIPADVISOR_AFTER_SUBMIT_MS", 3_000));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await pageLooksBlocked(page)) {
      await rl.question(`TripAdvisor challenge detected after searching "${hotelName}". Clear it in the browser, then press Enter here.\n`);
    }

    const reachedResults = await page
      .waitForFunction(
        () => {
          const hasHotelLink = Boolean(document.querySelector('a[href*="/Hotel_Review-"]'));
          const currentUrl = window.location.href;
          const bodyText = (document.body?.innerText ?? "").toLowerCase();

          return (
            hasHotelLink ||
            /hotel_review/i.test(currentUrl) ||
            /no results|did you mean|properties/i.test(bodyText)
          );
        },
        { timeout: 20_000 }
      )
      .then(() => true)
      .catch(() => false);

    if (reachedResults) {
      await page.waitForTimeout(readIntegerEnv("TRIPADVISOR_RESULTS_PAUSE_MS", 2_000));
      return;
    }
  }

  throw new Error(`Timed out waiting for TripAdvisor search results for "${hotelName}"`);
}

async function extractBestHotelMatch(page, searchTerm) {
  const currentUrl = page.url();
  const directHotelUrl = normalizeTripadvisorHotelUrl(currentUrl);

  if (directHotelUrl) {
    return {
      tripadvisorId: extractTripadvisorId(directHotelUrl),
      tripadvisorUrl: directHotelUrl,
      matchConfidence: "high"
    };
  }

  const candidateLinks = await page
    .locator('a[href*="/Hotel_Review-"]')
    .evaluateAll((links) =>
      links
        .map((link) => ({
          href: link instanceof HTMLAnchorElement ? link.href : "",
          text: (link.textContent ?? "").trim()
        }))
        .filter((link) => link.href)
    )
    .catch(() => []);

  const normalizedSearch = normalizeText(searchTerm);
  const bestCandidate = candidateLinks
    .map((candidate) => ({
      ...candidate,
      hotelUrl: normalizeTripadvisorHotelUrl(candidate.href),
      score: scoreCandidate(candidate, normalizedSearch)
    }))
    .filter((candidate) => candidate.hotelUrl)
    .sort((left, right) => right.score - left.score)[0];

  if (!bestCandidate?.hotelUrl) {
    return null;
  }

  return {
    tripadvisorId: extractTripadvisorId(bestCandidate.hotelUrl),
    tripadvisorUrl: bestCandidate.hotelUrl,
    matchConfidence: bestCandidate.score >= 2 ? "high" : "medium"
  };
}

function scoreCandidate(candidate, normalizedSearch) {
  const normalizedText = normalizeText(candidate.text);
  const normalizedHref = String(candidate.hotelUrl || candidate.href || "").toLowerCase();
  let score = 0;

  if (normalizedText.includes(normalizedSearch)) {
    score += 2;
  }

  if (normalizedHref.includes(normalizedSearch.replace(/\s+/g, "-"))) {
    score += 1;
  }

  return score;
}

function buildSearchTerms(hotel) {
  const exactName = String(hotel.name || "").trim();
  const expanded = [hotel.name, hotel.city, hotel.state_region, hotel.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");

  return Array.from(new Set([exactName, expanded].filter(Boolean)));
}

async function pageLooksBlocked(page) {
  const title = normalizeText(await page.title().catch(() => ""));
  const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
  return /robot|captcha|security|verify|human|unusual traffic|bot/i.test(`${title} ${bodyText}`);
}

async function typeSlowly(page, locator, value) {
  await locator.focus();

  for (const character of value) {
    await page.keyboard.type(character);
    await page.waitForTimeout(readIntegerEnv("TRIPADVISOR_KEYSTROKE_DELAY_MS", 120));
  }
}

function normalizeTripadvisorHotelUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const url = new URL(value, TRIPADVISOR_ORIGIN);

    if (!/tripadvisor\.com$/i.test(url.hostname) || !/\/Hotel_Review-/i.test(url.pathname)) {
      return "";
    }

    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}

function extractTripadvisorId(url) {
  if (!url) {
    return "";
  }

  const match = url.match(/g\d+-d\d+/i);
  return match ? match[0] : "";
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function readBooleanEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue == null || rawValue === "") {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(rawValue);
}

function readIntegerEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue == null || rawValue === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  writeStageThreeOutputs().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
