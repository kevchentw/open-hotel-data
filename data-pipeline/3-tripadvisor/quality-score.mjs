const STOP_WORDS = new Set(["the", "a", "an", "and", "of", "at", "in", "by"]);

export function extractSlugText(url) {
  if (!url || typeof url !== "string") return "";

  try {
    const pathname = new URL(url).pathname;
    // Matches: /Hotel_Review-gNNN-dNNN-Reviews-<slug>.html
    const match = pathname.match(/\/Hotel_Review-g\d+-d\d+-Reviews-(.+?)\.html$/i);
    if (!match || !match[1]) return "";
    return match[1].replace(/[_-]/g, " ").trim();
  } catch {
    return "";
  }
}

export function tokenize(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

export function scoreMatch(hotelName, tripadvisorUrl) {
  if (!tripadvisorUrl || !String(tripadvisorUrl).trim()) {
    return { quality_score: 0, quality_flag: "likely_wrong", quality_reason: "no tripadvisor url" };
  }

  const slugText = extractSlugText(tripadvisorUrl);

  if (!slugText) {
    return { quality_score: 0, quality_flag: "suspect", quality_reason: "url has no slug text to compare" };
  }

  const nameTokens = tokenize(hotelName);

  if (nameTokens.length === 0) {
    return { quality_score: 1, quality_flag: "ok", quality_reason: "hotel name has no scoreable tokens" };
  }

  const slugTokenSet = new Set(tokenize(slugText));
  const matchedCount = nameTokens.filter((t) => slugTokenSet.has(t)).length;
  const score = Math.round((matchedCount / nameTokens.length) * 100) / 100;

  let quality_flag;
  if (score >= 0.8) quality_flag = "ok";
  else if (score >= 0.5) quality_flag = "suspect";
  else quality_flag = "likely_wrong";

  return {
    quality_score: score,
    quality_flag,
    quality_reason: `${matchedCount}/${nameTokens.length} name tokens found in slug`,
  };
}
