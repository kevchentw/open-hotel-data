/**
 * Exports forum-reviews.json into a frontend-friendly format at
 * public/data/forum-reviews.json, indexed by hotel id.
 *
 * Usage:
 *   node data-pipeline/7-forum-reviews/export.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REVIEWS_FILE_URL = new URL("./forum-reviews.json", import.meta.url);
const OUTPUT_FILE_URL = new URL("../../../public/data/forum-reviews.json", import.meta.url);
const OUTPUT_DIR_URL = new URL("../../../public/data/", import.meta.url);

export async function exportForumReviews() {
  const payload = JSON.parse(await readFile(REVIEWS_FILE_URL, "utf8"));
  const reviews = payload.reviews ?? [];

  // Group by matched_hotel_id; unmatched reviews go into an "unmatched" bucket
  const byHotel = {};

  for (const review of reviews) {
    const key = review.matched_hotel_id ?? "unmatched";

    if (!byHotel[key]) {
      byHotel[key] = [];
    }

    byHotel[key].push(buildPublicReview(review));
  }

  const matchedCount = Object.keys(byHotel).filter((k) => k !== "unmatched").length;

  const output = {
    metadata: {
      stage: "7-forum-reviews-export",
      source_url: payload.metadata?.source_url ?? "",
      generated_at: new Date().toISOString(),
      review_count: reviews.length,
      hotel_count: matchedCount,
      unmatched_count: byHotel["unmatched"]?.length ?? 0,
      translated_count: payload.metadata?.translated_count ?? 0
    },
    reviews_by_hotel: byHotel
  };

  await mkdir(OUTPUT_DIR_URL, { recursive: true });
  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(
    `Exported ${reviews.length} reviews for ${matchedCount} hotels ` +
      `(${byHotel["unmatched"]?.length ?? 0} unmatched) to ${OUTPUT_FILE_URL.pathname}`
  );

  return output;
}

function buildPublicReview(review) {
  return {
    id: review.id,
    post_url: review.post_url,
    author: review.author,
    post_date: review.post_date,
    hotel_name_en: review.hotel_name_en,
    program: review.program,
    stay_date: review.stay_date,
    content: review.content_en || review.content_original,
    language: review.language
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportForumReviews().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
