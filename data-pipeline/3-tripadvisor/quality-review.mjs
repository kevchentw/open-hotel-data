import { readFile, writeFile, unlink } from "node:fs/promises";

const SOURCES = [
  {
    source: "amex_fhr",
    stage3FileUrl: new URL("./amex-fhr-hotel.json", import.meta.url),
    stage1FileUrl: new URL("../1-list/amex-fhr-hotel.json", import.meta.url),
  },
  {
    source: "amex_thc",
    stage3FileUrl: new URL("./amex-thc-hotel.json", import.meta.url),
    stage1FileUrl: new URL("../1-list/amex-thc-hotel.json", import.meta.url),
  },
  {
    source: "hilton_aspire",
    stage3FileUrl: new URL("./aspire-hotel.json", import.meta.url),
    stage1FileUrl: new URL("../1-list/aspire-hotel.json", import.meta.url),
  },
  {
    source: "chase_edit",
    stage3FileUrl: new URL("./chase-edit-hotel.json", import.meta.url),
    stage1FileUrl: new URL("../1-list/chase-edit-hotel.json", import.meta.url),
  },
];

const QUEUE_FILE_URL = new URL("./quality-review-queue.json", import.meta.url);
const PRICES_DIR_URL = new URL("../5-price/prices/", import.meta.url);

async function readJson(fileUrl) {
  const raw = await readFile(fileUrl, "utf8");
  return JSON.parse(raw);
}

async function writeJson(fileUrl, data) {
  await writeFile(fileUrl, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function generateQueue() {
  const queue = [];

  for (const source of SOURCES) {
    let stage3;
    try {
      stage3 = await readJson(source.stage3FileUrl);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    let stage1;
    try {
      stage1 = await readJson(source.stage1FileUrl);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    const hotels = stage1.hotels ?? {};
    const matches = stage3.matches ?? {};

    for (const [hotelId, match] of Object.entries(matches)) {
      if (match.quality_review) continue;
      if (!match.quality_flag || match.quality_flag === "ok") continue;

      queue.push({
        source: source.source,
        source_hotel_id: hotelId,
        hotel_name: hotels[hotelId]?.name ?? hotelId,
        tripadvisor_url: match.tripadvisor_url ?? "",
        quality_score: match.quality_score ?? 0,
        quality_flag: match.quality_flag,
        quality_reason: match.quality_reason ?? "",
        verdict: "",
        corrected_url: "",
      });
    }
  }

  // Sort: likely_wrong first, then suspect; within each group sort by hotel_name
  queue.sort((a, b) => {
    const flagOrder = { likely_wrong: 0, suspect: 1 };
    const flagDiff = (flagOrder[a.quality_flag] ?? 2) - (flagOrder[b.quality_flag] ?? 2);
    if (flagDiff !== 0) return flagDiff;
    return a.hotel_name.localeCompare(b.hotel_name);
  });

  await writeJson(QUEUE_FILE_URL, queue);
  console.log(`Wrote ${queue.length} entries to quality-review-queue.json`);
  console.log(`  likely_wrong: ${queue.filter((e) => e.quality_flag === "likely_wrong").length}`);
  console.log(`  suspect: ${queue.filter((e) => e.quality_flag === "suspect").length}`);
}

function normalizeTripadvisorHotelUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    if (!/tripadvisor\.com$/i.test(url.hostname) || !/\/Hotel_Review-/i.test(url.pathname)) return "";
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}

function extractTripadvisorId(url) {
  const match = String(url || "").match(/g\d+-d\d+/i);
  return match ? match[0] : "";
}

async function applyQueue() {
  let queue;
  try {
    queue = await readJson(QUEUE_FILE_URL);
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log("No queue file found. Run without --apply to generate one.");
      return;
    }
    throw error;
  }

  // Separate entries with verdicts from those without
  const toApply = queue.filter((e) => e.verdict === "approved" || e.verdict === "wrong");
  const remaining = queue.filter((e) => e.verdict !== "approved" && e.verdict !== "wrong");

  if (toApply.length === 0) {
    console.log("No entries with verdicts found in queue. Edit quality-review-queue.json and set verdict to 'approved' or 'wrong'.");
    return;
  }

  // Group by source for efficient file I/O
  const bySource = {};
  for (const entry of toApply) {
    (bySource[entry.source] ??= []).push(entry);
  }

  let appliedCount = 0;

  for (const [sourceSlug, entries] of Object.entries(bySource)) {
    const sourceConfig = SOURCES.find((s) => s.source === sourceSlug);
    if (!sourceConfig) {
      console.warn(`Unknown source "${sourceSlug}" in queue, skipping ${entries.length} entries`);
      continue;
    }

    const stage3 = await readJson(sourceConfig.stage3FileUrl);
    const matches = stage3.matches ?? {};

    for (const entry of entries) {
      const match = matches[entry.source_hotel_id];
      if (!match) {
        console.warn(`  No match found for ${entry.source_hotel_id} in ${sourceSlug}, skipping`);
        continue;
      }

      match.quality_review = entry.verdict;

      if (entry.verdict === "wrong" && entry.corrected_url) {
        const normalizedUrl = normalizeTripadvisorHotelUrl(entry.corrected_url);
        if (normalizedUrl) {
          const oldTripadvisorId = match.tripadvisor_id;
          const newTripadvisorId = extractTripadvisorId(normalizedUrl);

          match.tripadvisor_url = normalizedUrl;
          match.tripadvisor_id = newTripadvisorId;
          match.quality_corrected_url = entry.corrected_url;

          if (oldTripadvisorId && oldTripadvisorId !== newTripadvisorId) {
            const priceFileUrl = new URL(`${oldTripadvisorId}.json`, PRICES_DIR_URL);
            try {
              await unlink(priceFileUrl);
              console.log(`  Deleted stale price file: ${oldTripadvisorId}.json`);
            } catch (error) {
              if (error?.code !== "ENOENT") throw error;
            }
          }
        }
      }

      console.log(`  Applied '${entry.verdict}' to ${entry.hotel_name} (${entry.source_hotel_id})`);
      appliedCount++;
    }

    await writeJson(sourceConfig.stage3FileUrl, stage3);
  }

  // Write back only entries that still have no verdict
  await writeJson(QUEUE_FILE_URL, remaining);

  console.log(`\nApplied ${appliedCount} verdicts. ${remaining.length} entries remain in queue.`);
}

const isApplyMode = process.argv.includes("--apply");

if (isApplyMode) {
  applyQueue().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  generateQueue().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
