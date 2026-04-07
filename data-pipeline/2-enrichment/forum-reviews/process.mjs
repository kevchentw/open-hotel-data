/**
 * Processes raw scraped forum posts into structured hotel reviews.
 *
 * For each post, uses Claude to:
 *   1. Extract individual hotel stay reviews
 *   2. Translate Chinese content to fluent English
 *
 * Incremental: every processed post (with or without reviews) is recorded so
 * it is never re-processed on re-run.
 * Saves forum-reviews.json after every single post.
 *
 * Hotel matching: uses normalized name + city against public/data/hotels.json.
 *
 * Usage:
 *   node data-pipeline/2-enrichment/forum-reviews/process.mjs
 *
 * Requires the `claude` CLI to be installed and authenticated (claude.ai/code).
 *
 * Options (env vars):
 *   FORUM_CONCURRENCY   - parallel Claude requests (default: 1)
 *   FORUM_POST_IDS      - comma-separated post numbers to (re)process
 *   FORUM_FORCE_REFRESH - re-process all posts (default: false)
 *   CLAUDE_BIN          - path to claude CLI binary (default: "claude")
 */

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const RAW_POSTS_URL = new URL("./raw-posts.json", import.meta.url);
const OUTPUT_FILE_URL = new URL("./forum-reviews.json", import.meta.url);
const HOTELS_FILE_URL = new URL("../../../public/data/hotels.json", import.meta.url);

const SOURCE_TOPIC_URL = "https://www.uscardforum.com/t/topic/42589";
const DEFAULT_CONCURRENCY = 1; // Claude CLI does not support parallel sessions
const DEFAULT_BATCH_SIZE = 15; // posts per Claude call — balances startup overhead vs prompt size

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function processForumPosts(options = {}) {
  const rawPayload = JSON.parse(await readFile(RAW_POSTS_URL, "utf8"));
  const existingPayload = await readExistingOutput();
  const hotelsMap = await buildHotelsMap();

  const forceRefresh = Boolean(options.forceRefresh);
  const targetPostNumbers = normalizePostNumbers(options.postNumbers);
  const concurrency = normalizeConcurrency(options.concurrency);

  // Track every processed post number (with AND without reviews) so we never re-run them.
  // Stored in metadata.processed_post_numbers across runs.
  const processedPostNumbers = new Set(
    forceRefresh ? [] : (existingPayload.metadata.processed_post_numbers ?? []).map(String)
  );

  const postsToProcess = rawPayload.posts.filter((post) => {
    if (targetPostNumbers.size > 0 && !targetPostNumbers.has(String(post.post_number))) {
      return false;
    }
    return forceRefresh || !processedPostNumbers.has(String(post.post_number));
  });

  console.log(
    `${postsToProcess.length} posts to process ` +
      `(${processedPostNumbers.size} already done, ${rawPayload.posts.length} total)`
  );

  if (postsToProcess.length === 0) {
    console.log("Nothing to do.");
    return existingPayload;
  }

  // Keep existing reviews, dropping any for force-refreshed post numbers
  const allReviews = existingPayload.reviews.filter(
    (r) =>
      !forceRefresh ||
      targetPostNumbers.size === 0 ||
      !targetPostNumbers.has(String(r.post_number))
  );

  // Split into batches — skip posts with no review signals before batching
  const batchSize = normalizeBatchSize(options.batchSize);
  const reviewPosts = postsToProcess.filter((p) => looksLikeReview(p.text));
  const skippedCount = postsToProcess.length - reviewPosts.length;
  const batches = chunk(reviewPosts, batchSize);

  // Mark skipped posts as processed immediately
  for (const post of postsToProcess) {
    if (!looksLikeReview(post.text)) {
      console.log(`[post-${post.post_number}] Skipped (no review signals)`);
      processedPostNumbers.add(String(post.post_number));
    }
  }

  console.log(
    `${reviewPosts.length} posts with review signals in ${batches.length} batches of up to ${batchSize}. ` +
      `${skippedCount} skipped.`
  );

  let newReviewCount = 0;
  let failedCount = 0;

  await mapWithConcurrency(
    batches,
    concurrency,
    async (batch) => {
      const postNums = batch.map((p) => p.post_number).join(", ");
      console.log(`[batch posts ${postNums}] Processing ${batch.length} posts...`);

      try {
        const resultsByPost = await extractAndTranslateBatch(batch);

        const batchResults = batch.map((post) => {
          const extracted = resultsByPost[String(post.post_number)] ?? [];
          const matched = extracted.map((review) => ({
            ...review,
            ...matchHotel(review.hotel_name_en, review.hotel_city, hotelsMap)
          }));
          return { post_number: post.post_number, reviews: matched, failed: false };
        });

        console.log(
          `[batch posts ${postNums}] ${batchResults.reduce((n, r) => n + r.reviews.length, 0)} review(s) extracted`
        );
        return { batchResults, failed: false };
      } catch (err) {
        console.warn(`[batch posts ${postNums}] Batch parse failed (${err.message}) — retrying individually`);

        const batchResults = [];
        for (const post of batch) {
          try {
            const resultsByPost = await extractAndTranslateBatch([post]);
            const extracted = resultsByPost[String(post.post_number)] ?? [];
            const matched = extracted.map((review) => ({
              ...review,
              ...matchHotel(review.hotel_name_en, review.hotel_city, hotelsMap)
            }));
            console.log(`[post-${post.post_number}] ${matched.length} review(s) extracted (individual fallback)`);
            batchResults.push({ post_number: post.post_number, reviews: matched, failed: false });
          } catch (innerErr) {
            console.error(`[post-${post.post_number}] Failed: ${innerErr.message}`);
            batchResults.push({ post_number: post.post_number, reviews: [], failed: true });
          }
        }
        return { batchResults, failed: false };
      }
    },
    async (result) => {
      for (const postResult of result.batchResults) {
        if (!postResult.failed) {
          processedPostNumbers.add(String(postResult.post_number));
          allReviews.push(...postResult.reviews);
          newReviewCount += postResult.reviews.length;
        } else {
          failedCount += 1;
        }
      }
      await saveOutput(allReviews, processedPostNumbers, rawPayload.metadata);
    }
  );

  const payload = await saveOutput(allReviews, processedPostNumbers, rawPayload.metadata);

  console.log(
    `Done. ${newReviewCount} new reviews, ${skippedCount} posts skipped, ` +
      `${failedCount} failed. ${allReviews.length} total reviews.`
  );

  return payload;
}

// ---------------------------------------------------------------------------
// Pre-filter: cheap heuristic before calling Claude
// ---------------------------------------------------------------------------

// Structured review posts on this forum follow a template with labelled fields.
// We look for any of these signals — if none match, skip the Claude call entirely.
const REVIEW_SIGNALS = [
  // Structured DP template field labels (Chinese)
  /酒店名称[：:]/,       // "Hotel name:"
  /预定渠道[：:]/,       // "Booking channel:"
  /入住时段[：:]/,       // "Stay period:"
  /实际入住房型[：:]/,   // "Actual room type:"
  /预定房型[：:]/,       // "Booked room type:"

  // Program keywords
  /\bFHR\b/i,
  /\bTHC\b/i,
  /\bLHRC\b/i,
  /\bThe\s*Edit\b/i,
  /\bAspire\b/i,
  /\bPrepay\b/i,
  /\bPay\s*Later\b/i,
];

function looksLikeReview(text) {
  return REVIEW_SIGNALS.some((pattern) => pattern.test(text));
}

// ---------------------------------------------------------------------------
// Claude extraction + translation (via CLI)
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `You extract hotel stay reviews from forum posts about travel credit card hotel benefits.

Programs to recognize:
- FHR = Fine Hotels + Resorts (Amex Platinum)
- THC = The Hotel Collection (Amex Gold/Platinum)
- LHRC = Luxury Hotels & Resorts Collection (Visa Infinite)
- Aspire = Hilton Aspire resort credit stays

Hotel nickname mappings (forum slang):
- 栗子 = Ritz-Carlton

For each individual hotel stay mentioned in a post, return one JSON object.
If the post contains no hotel stay reviews, return an empty array [].

Return ONLY a valid JSON array, no markdown, no explanation.`;

async function callClaude(prompt) {
  const bin = process.env.CLAUDE_BIN || "claude";
  // --bare skips hooks/LSP/memory for faster startup; only use when API key is set
  // since --bare disables OAuth. Without API key, rely on existing OAuth session.
  const args = ["--print", "--output-format", "text", "--model", "haiku"];

  if (process.env.ANTHROPIC_API_KEY) {
    args.push("--bare");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude timed out after 120s`));
    }, 120_000);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.trim()}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(prompt, "utf8");
    child.stdin.end();
  });
}

// Returns { [post_number]: review[] }
async function extractAndTranslateBatch(posts) {
  const postsBlock = posts
    .map(
      (post) =>
        `=== POST ${post.post_number} (author: ${post.author}, date: ${post.date}) ===\n${post.text}`
    )
    .join("\n\n");

  const prompt = `${EXTRACTION_PROMPT}

Below are ${posts.length} forum posts separated by === POST N === headers.
Return a JSON object where each key is the post number (as a string) and each value is an array of hotel stay reviews extracted from that post.
Use empty array [] for posts with no hotel stays.

Example shape:
{
  "2": [ { ...review fields... }, { ...review fields... } ],
  "5": [],
  "7": [ { ...review fields... } ]
}

For each review include:
{
  "hotel_name_original": "exact name as written (Chinese or English)",
  "hotel_name_en": "official English hotel name",
  "hotel_city": "city name in English",
  "hotel_country": "country name in English",
  "program": "FHR|THC|LHRC|Aspire|other",
  "booking_type": "e.g. FHR Prepay, FHR Pay Later, THC, TheEdit — from 预定渠道",
  "stay_period": "e.g. 2021-08, weekend, holiday, weekday — from 入住时段, translate to English",
  "booked_room_type": "room type as booked — from 预定房型, translate to English if Chinese",
  "actual_room_type": "room type actually stayed in — from 实际入住房型, translate to English if Chinese",
  "hotel_membership": "hotel loyalty status — from 酒店会员, translate to English (e.g. Marriott Gold)",
  "snp_stacking": "whether membership SNP/benefits stacked with FHR/THC, and what was received — from SNP/会员福利, translate to English",
  "stay_date": "YYYY-MM or YYYY (best guess from context)",
  "content_original": "the review text for this hotel exactly as written",
  "content_en": "fluent English — translate Chinese naturally, keep English as-is; clear and concise",
  "language": "zh|en|mixed"
}

${postsBlock}`;

  const raw = await callClaude(prompt);
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    parsed = JSON.parse(match[0]);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Response was not a JSON object");
  }

  const translatedAt = new Date().toISOString();
  const result = {};

  for (const post of posts) {
    const key = String(post.post_number);
    const items = Array.isArray(parsed[key]) ? parsed[key] : [];

    result[key] = items
      .filter((item) => item && typeof item === "object" && item.hotel_name_en)
      .map((item, index) => ({
        id: `post-${post.post_number}-${index}`,
        post_number: post.post_number,
        post_url: `${SOURCE_TOPIC_URL}/${post.post_number}`,
        author: post.author,
        post_date: post.date ? post.date.slice(0, 10) : "",
        hotel_name_original: String(item.hotel_name_original ?? "").trim(),
        hotel_name_en: String(item.hotel_name_en ?? "").trim(),
        hotel_city: String(item.hotel_city ?? "").trim(),
        hotel_country: String(item.hotel_country ?? "").trim(),
        program: String(item.program ?? "").trim(),
        booking_type: String(item.booking_type ?? "").trim(),
        stay_period: String(item.stay_period ?? "").trim(),
        stay_date: String(item.stay_date ?? "").trim(),
        booked_room_type: String(item.booked_room_type ?? "").trim(),
        actual_room_type: String(item.actual_room_type ?? "").trim(),
        hotel_membership: String(item.hotel_membership ?? "").trim(),
        snp_stacking: String(item.snp_stacking ?? "").trim(),
        content_original: String(item.content_original ?? "").trim(),
        content_en: String(item.content_en ?? "").trim(),
        language: String(item.language ?? "en").trim(),
        translated: item.language === "zh" || item.language === "mixed",
        translated_at: translatedAt
      }));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hotel matching
// ---------------------------------------------------------------------------
//
// Two-level lookup against public/data/hotels.json:
//
//   1. nameKey = normalizeHotelName(hotel.name)
//   2. cityKey = normalizeCity(hotel.city)
//
// Matching strategy (in order of confidence):
//   HIGH   — exact nameKey match, only one hotel has that name
//   HIGH   — exact nameKey match + cityKey match (disambiguates chains)
//   MEDIUM — exact nameKey match but multiple hotels share the name (city used to pick best)
//   MEDIUM — nameKey is a substring of hotel nameKey or vice-versa, single result after city filter
//   LOW    — substring match, no city available to disambiguate
//
// ---------------------------------------------------------------------------

async function buildHotelsMap() {
  let raw;

  try {
    raw = await readFile(HOTELS_FILE_URL, "utf8");
  } catch {
    console.warn("hotels.json not found — hotel matching disabled");
    return { byName: new Map(), byNameCity: new Map() };
  }

  const payload = JSON.parse(raw);
  const hotels = Array.isArray(payload.hotels) ? payload.hotels : [];
  const byName = new Map();     // normalizedName  → hotel[]
  const byNameCity = new Map(); // normalizedName|normalizedCity → hotel[]

  for (const hotel of hotels) {
    if (!hotel.id || !hotel.name) continue;

    const nk = normalizeHotelName(hotel.name);
    const ck = normalizeCity(hotel.city);

    if (!byName.has(nk)) byName.set(nk, []);
    byName.get(nk).push(hotel);

    const nck = `${nk}|${ck}`;
    if (!byNameCity.has(nck)) byNameCity.set(nck, []);
    byNameCity.get(nck).push(hotel);
  }

  console.log(`Loaded ${hotels.length} hotels for matching`);
  return { byName, byNameCity };
}

function matchHotel(hotelNameEn, hotelCity, { byName, byNameCity }) {
  if (!hotelNameEn || byName.size === 0) {
    return { matched_hotel_id: null, match_confidence: "", needs_manual_match: true };
  }

  const nk = normalizeHotelName(hotelNameEn);
  const ck = normalizeCity(hotelCity);

  // 1. Exact name + city match
  if (ck) {
    const nck = `${nk}|${ck}`;
    const hits = byNameCity.get(nck);
    if (hits?.length >= 1) {
      return { matched_hotel_id: hits[0].id, match_confidence: "high", needs_manual_match: false };
    }
  }

  // 2. Exact name match
  const nameHits = byName.get(nk);
  if (nameHits?.length === 1) {
    return { matched_hotel_id: nameHits[0].id, match_confidence: "high", needs_manual_match: false };
  }
  if (nameHits?.length > 1) {
    const cityMatch = ck ? nameHits.find((h) => normalizeCity(h.city) === ck) : null;
    const best = cityMatch ?? nameHits[0];
    return { matched_hotel_id: best.id, match_confidence: cityMatch ? "high" : "medium", needs_manual_match: false };
  }

  // 3. Substring match — query inside hotel name or hotel name inside query
  const substringHits = [];
  for (const [hotelKey, hotels] of byName.entries()) {
    if (hotelKey.includes(nk) || nk.includes(hotelKey)) {
      substringHits.push(...hotels);
    }
  }

  if (substringHits.length === 0) {
    return { matched_hotel_id: null, match_confidence: "", needs_manual_match: true };
  }

  if (ck) {
    const cityMatch = substringHits.find((h) => normalizeCity(h.city) === ck);
    if (cityMatch) {
      return { matched_hotel_id: cityMatch.id, match_confidence: "medium", needs_manual_match: false };
    }
  }

  if (substringHits.length === 1) {
    return { matched_hotel_id: substringHits[0].id, match_confidence: "medium", needs_manual_match: false };
  }

  return { matched_hotel_id: substringHits[0].id, match_confidence: "low", needs_manual_match: false };
}

function normalizeHotelName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\bthe\b/g, "")
    .replace(/\b(hotel|resort|hotels|resorts|spa|&|and)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalizeCity(city) {
  return String(city ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

async function readExistingOutput() {
  try {
    const raw = await readFile(OUTPUT_FILE_URL, "utf8");
    return JSON.parse(raw);
  } catch {
    return { metadata: { processed_post_numbers: [] }, reviews: [] };
  }
}

async function saveOutput(reviews, processedPostNumbers, scrapeMetadata) {
  const translatedCount = reviews.filter((r) => r.translated).length;
  const matchedCount = reviews.filter((r) => r.matched_hotel_id).length;
  const needsManualMatchCount = reviews.filter((r) => r.needs_manual_match).length;
  const processedArr = [...processedPostNumbers].map(Number).sort((a, b) => a - b);

  const payload = {
    metadata: {
      stage: "2-enrichment-forum-reviews",
      source_url: SOURCE_TOPIC_URL,
      generated_at: new Date().toISOString(),
      scraped_at: scrapeMetadata?.scraped_at ?? "",
      post_count_total: scrapeMetadata?.post_count ?? 0,
      post_count_processed: processedArr.length,
      post_count_remaining: Math.max(0, (scrapeMetadata?.post_count ?? 0) - processedArr.length),
      review_count: reviews.length,
      translated_count: translatedCount,
      matched_count: matchedCount,
      needs_manual_match_count: needsManualMatchCount,
      processed_post_numbers: processedArr
    },
    reviews: reviews.slice().sort((a, b) => Number(a.post_number) - Number(b.post_number))
  };

  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function mapWithConcurrency(items, concurrency, iteratee, onResult) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
      if (onResult) await onResult(results[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker())
  );
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function normalizeBatchSize(value) {
  const n = Number.parseInt(String(value ?? DEFAULT_BATCH_SIZE), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 50) : DEFAULT_BATCH_SIZE;
}

function normalizePostNumbers(value) {
  return new Set(
    (Array.isArray(value) ? value : String(value ?? "").split(","))
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

function normalizeConcurrency(value) {
  const n = Number.parseInt(String(value ?? DEFAULT_CONCURRENCY), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 16) : DEFAULT_CONCURRENCY;
}

function readBooleanEnv(name, fallback = false) {
  const v = process.env[name];
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await processForumPosts({
    concurrency: process.env.FORUM_CONCURRENCY,
    batchSize: process.env.FORUM_BATCH_SIZE,
    postNumbers: process.env.FORUM_POST_IDS,
    forceRefresh: readBooleanEnv("FORUM_FORCE_REFRESH", false)
  });
}
