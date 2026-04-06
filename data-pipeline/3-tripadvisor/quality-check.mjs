import { readFile, writeFile } from "node:fs/promises";
import { scoreMatch } from "./quality-score.mjs";

const SOURCES = [
  {
    label: "amex_fhr",
    stage3FileUrl: new URL("./amex-fhr-hotel.json", import.meta.url),
    stage1FileUrl: new URL("../1-list/amex-fhr-hotel.json", import.meta.url),
  },
  {
    label: "amex_thc",
    stage3FileUrl: new URL("./amex-thc-hotel.json", import.meta.url),
    stage1FileUrl: new URL("../1-list/amex-thc-hotel.json", import.meta.url),
  },
  {
    label: "hilton_aspire",
    stage3FileUrl: new URL("./aspire-hotel.json", import.meta.url),
    stage1FileUrl: new URL("../1-list/aspire-hotel.json", import.meta.url),
  },
  {
    label: "chase_edit",
    stage3FileUrl: new URL("./chase-edit-hotel.json", import.meta.url),
    stage1FileUrl: new URL("../1-list/chase-edit-hotel.json", import.meta.url),
  },
];

async function readJson(fileUrl) {
  const raw = await readFile(fileUrl, "utf8");
  return JSON.parse(raw);
}

async function writeJson(fileUrl, data) {
  await writeFile(fileUrl, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function runQualityCheck() {
  let totalOk = 0;
  let totalSuspect = 0;
  let totalLikelyWrong = 0;
  let totalSkipped = 0;

  for (const source of SOURCES) {
    let stage3;
    try {
      stage3 = await readJson(source.stage3FileUrl);
    } catch (error) {
      if (error?.code === "ENOENT") {
        console.log(`${source.label}: stage 3 file not found, skipping`);
        continue;
      }
      throw error;
    }

    let stage1;
    try {
      stage1 = await readJson(source.stage1FileUrl);
    } catch (error) {
      if (error?.code === "ENOENT") {
        console.log(`${source.label}: stage 1 file not found, skipping`);
        continue;
      }
      throw error;
    }

    const hotels = stage1.hotels ?? {};
    const matches = stage3.matches ?? {};

    let ok = 0;
    let suspect = 0;
    let likelyWrong = 0;
    let skipped = 0;

    for (const [hotelId, match] of Object.entries(matches)) {
      if (match.quality_review) {
        skipped++;
        continue;
      }

      if (match.match_confidence === "none") {
        skipped++;
        continue;
      }

      const hotelName = hotels[hotelId]?.name ?? hotelId;
      const { quality_score, quality_flag, quality_reason } = scoreMatch(hotelName, match.tripadvisor_url);

      match.quality_score = quality_score;
      match.quality_flag = quality_flag;
      match.quality_reason = quality_reason;

      if (quality_flag === "ok") ok++;
      else if (quality_flag === "suspect") suspect++;
      else likelyWrong++;
    }

    await writeJson(source.stage3FileUrl, stage3);

    console.log(`${source.label}: ${ok} ok, ${suspect} suspect, ${likelyWrong} likely_wrong, ${skipped} skipped`);

    totalOk += ok;
    totalSuspect += suspect;
    totalLikelyWrong += likelyWrong;
    totalSkipped += skipped;
  }

  console.log(`\nTotal: ${totalOk} ok, ${totalSuspect} suspect, ${totalLikelyWrong} likely_wrong, ${totalSkipped} skipped`);
}

runQualityCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
