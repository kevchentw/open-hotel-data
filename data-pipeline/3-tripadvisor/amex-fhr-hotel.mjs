import { mkdir, readFile, writeFile } from "node:fs/promises";
import readline from "node:readline/promises";
import { Camoufox } from "camoufox-js";

const SOURCE = "amex_fhr";
const STAGE = "3-tripadvisor";
const BRAVE_SEARCH_ORIGIN = "https://search.brave.com/";
const TRIPADVISOR_ORIGIN = "https://www.tripadvisor.com/";
const INPUT_STAGE_ONE_FILE_URL = new URL("../1-list/amex-fhr-hotel.json", import.meta.url);
const OUTPUT_FILE_URL = new URL("./amex-fhr-hotel.json", import.meta.url);
const OUTPUT_DIRECTORY_URL = new URL("./", import.meta.url);
export async function buildAmexFhrTripadvisorMatches() {
  const stageOneHotels = await readStageOneHotels();
  const existingPayload = await readExistingOutput();
  const pendingHotels = getPendingHotels(stageOneHotels, existingPayload.matches);
  const totalHotels = Object.keys(stageOneHotels).length;
  const existingCount = totalHotels - pendingHotels.length;

  if (pendingHotels.length === 0) {
    console.log(`FHR TripAdvisor backfill is up to date. ${totalHotels}/${totalHotels} hotels already have TripAdvisor data.`);
    return finalizePayload({
      metadata: existingPayload.metadata,
      matches: existingPayload.matches
    });
  }

  console.log(
    `Starting FHR TripAdvisor backfill. ${existingCount}/${totalHotels} already matched, ${pendingHotels.length} pending.`
  );

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
      "Brave Search is open in a headed browser. Complete any cookie or bot checks there, then press Enter here to start FHR backfill."
    );

    for (const [index, hotel] of pendingHotels.entries()) {
      const matchedAt = new Date().toISOString();
      console.log(`[${index + 1}/${pendingHotels.length}] Processing ${hotel.name} (${hotel.source_hotel_id})`);
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
      console.log(`[${index + 1}/${pendingHotels.length}] Saved ${OUTPUT_FILE_URL.pathname}`);

      const summary = result.tripadvisorId || "no match";
      console.log(`[${index + 1}/${pendingHotels.length}] Processed ${hotel.name} -> ${summary}`);
    }

    return finalizePayload(payload);
  } finally {
    await browserSession.close();
  }
}

export async function writeStageThreeOutputs() {
  const payload = await buildAmexFhrTripadvisorMatches();

  console.log(
    `Wrote ${payload.metadata.record_count} FHR stage 3 records to ${OUTPUT_FILE_URL.pathname} ` +
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
  const browser = await Camoufox({
    headless: readBooleanEnv("TRIPADVISOR_HEADLESS", false),
    humanize: true
  });

  const context = await browser.newContext({
    viewport: null
  });
  const page = await context.newPage();
  page.setDefaultTimeout(readIntegerEnv("TRIPADVISOR_TIMEOUT_MS", 30_000));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return {
    async openHomePage() {
      console.log(`Opening ${BRAVE_SEARCH_ORIGIN}`);
      await page.goto(BRAVE_SEARCH_ORIGIN, {
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
      const manualOnly = readBooleanEnv("TRIPADVISOR_MANUAL_ONLY", false);

      if (manualOnly) {
        return promptForManualMatch(rl, hotel, searchTerms);
      }

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
      await browser.close();
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

async function promptForManualMatch(rl, hotel, searchTerms) {
  const searchQuery = searchTerms[0] || hotel.name || "";
  const locationBits = [hotel.city, hotel.state_region, hotel.country].filter(Boolean).join(", ");

  console.log("");
  console.log(`Search Brave for: ${searchQuery}`);
  if (locationBits) {
    console.log(`Location hint: ${locationBits}`);
  }
  console.log(`Hotel key: ${hotel.source_hotel_id}`);
  console.log("After you open the final TripAdvisor hotel page, paste the full URL here.");
  console.log("Press Enter on an empty line to save this hotel as unmatched.");

  const pastedUrl = (await rl.question("TripAdvisor hotel URL: ")).trim();
  const tripadvisorUrl = normalizeTripadvisorHotelUrl(pastedUrl);
  const tripadvisorId = extractTripadvisorId(tripadvisorUrl);

  if (!tripadvisorId) {
    return {
      searchQuery,
      tripadvisorId: "",
      tripadvisorUrl: "",
      matchConfidence: "none"
    };
  }

  return {
    searchQuery,
    tripadvisorId,
    tripadvisorUrl,
    matchConfidence: "high"
  };
}

async function ensureSearchReady(page, rl, hotelName) {
  const blocked = await pageLooksBlocked(page);
  if (blocked) {
    console.log(`Waiting for manual Brave clearance before searching ${hotelName}`);
    console.log(`Current page before search: ${page.url()}`);
    await rl.question(`Brave Search appears to be challenging access while preparing "${hotelName}". Clear it in the browser, then press Enter here.\n`);
  }

  if (!page.url().startsWith(BRAVE_SEARCH_ORIGIN)) {
    console.log(`Navigating back to ${BRAVE_SEARCH_ORIGIN}`);
    await page.goto(BRAVE_SEARCH_ORIGIN, {
      waitUntil: "domcontentloaded",
      timeout: 120_000
    });
    await page.waitForTimeout(readIntegerEnv("TRIPADVISOR_HOME_PAUSE_MS", 2_000));
  }
}

async function submitSearch(page, searchTerm) {
  const braveQuery = `${searchTerm} TripAdvisor`;
  const searchUrl = `${BRAVE_SEARCH_ORIGIN}search?q=${encodeURIComponent(braveQuery)}&source=web`;

  console.log(`Searching Brave for: ${braveQuery}`);
  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForTimeout(readIntegerEnv("TRIPADVISOR_AFTER_SUBMIT_MS", 3_000));
}

async function waitForSearchResults(page, rl, hotelName) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await pageLooksBlocked(page)) {
      console.log(`Waiting for manual Brave clearance after search for ${hotelName}`);
      console.log(`Current page after search: ${page.url()}`);
      await rl.question(`Brave Search challenge detected after searching "${hotelName}". Clear it in the browser, then press Enter here.\n`);
    }

    const reachedResults = await page
      .waitForFunction(
        () => {
          const hasHotelLink = Array.from(document.querySelectorAll("a")).some((anchor) => {
            const href = anchor.getAttribute("href") || "";
            return /tripadvisor\.com/i.test(href) && /Hotel_Review-/i.test(href);
          });
          const bodyText = (document.body?.innerText ?? "").toLowerCase();

          return hasHotelLink || /no results|did you mean|results/i.test(bodyText);
        },
        { timeout: 20_000 }
      )
      .then(() => true)
      .catch(() => false);

    if (reachedResults) {
      console.log(`Brave results loaded for ${hotelName}`);
      await page.waitForTimeout(readIntegerEnv("TRIPADVISOR_RESULTS_PAUSE_MS", 2_000));
      return;
    }
  }

  throw new Error(`Timed out waiting for TripAdvisor search results for "${hotelName}"`);
}

async function extractBestHotelMatch(page, searchTerm) {
  console.log(`Extracting TripAdvisor candidates from Brave results for: ${searchTerm}`);
  const candidateLinks = await page
    .locator("a")
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
      hotelUrl: resolveTripadvisorHotelUrl(candidate.href),
      score: scoreCandidate(candidate, normalizedSearch)
    }))
    .filter((candidate) => candidate.hotelUrl)
    .sort((left, right) => right.score - left.score)[0];

  if (!bestCandidate?.hotelUrl) {
    console.log(`No TripAdvisor hotel result found in Brave results for: ${searchTerm}`);
    return null;
  }

  console.log(`Found TripAdvisor URL from Brave results: ${bestCandidate.hotelUrl}`);
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
  const combined = `${title} ${bodyText}`;

  return [
    /are you a robot/i,
    /verify you are human/i,
    /press and hold/i,
    /complete the security check/i,
    /unusual traffic/i,
    /captcha/i,
    /challenge expired/i,
    /access denied/i,
    /please enable javascript and disable any ad blocker/i
  ].some((pattern) => pattern.test(combined));
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

function resolveTripadvisorHotelUrl(value) {
  const directUrl = normalizeTripadvisorHotelUrl(value);
  if (directUrl) {
    return directUrl;
  }

  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const url = new URL(value, BRAVE_SEARCH_ORIGIN);
    const nestedUrl = url.searchParams.get("url") || url.searchParams.get("u") || "";
    return normalizeTripadvisorHotelUrl(nestedUrl);
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
