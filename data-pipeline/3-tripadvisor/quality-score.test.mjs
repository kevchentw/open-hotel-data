import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSlugText, tokenize, scoreMatch } from "./quality-score.mjs";

// extractSlugText
test("extractSlugText - standard url with slug", () => {
  assert.equal(
    extractSlugText(
      "https://www.tripadvisor.com/Hotel_Review-g34227-d1555519-Reviews-Conrad_Fort_Lauderdale_Beach-Fort_Lauderdale_Broward_County_Florida.html"
    ),
    "Conrad Fort Lauderdale Beach Fort Lauderdale Broward County Florida"
  );
});

test("extractSlugText - url with empty slug (Reviews-.html)", () => {
  assert.equal(
    extractSlugText(
      "https://www.tripadvisor.com/Hotel_Review-g660719-d17558173-Reviews-.html"
    ),
    ""
  );
});

test("extractSlugText - empty string", () => {
  assert.equal(extractSlugText(""), "");
});

test("extractSlugText - non-hotel url", () => {
  assert.equal(extractSlugText("https://www.tripadvisor.com/Tourism-g294013.html"), "");
});

// tokenize
test("tokenize - lowercases and strips punctuation", () => {
  assert.deepEqual(tokenize("Ritz-Carlton"), ["ritz", "carlton"]);
});

test("tokenize - removes stop words", () => {
  assert.deepEqual(tokenize("The Grand Hotel of the Alps"), ["grand", "hotel", "alps"]);
});

test("tokenize - empty string", () => {
  assert.deepEqual(tokenize(""), []);
});

test("tokenize - unicode normalization", () => {
  // é should normalize and be kept
  const result = tokenize("Hôtel des Arts");
  assert.ok(result.includes("arts"));
});

// scoreMatch
test("scoreMatch - perfect match", () => {
  const result = scoreMatch(
    "Conrad Fort Lauderdale Beach",
    "https://www.tripadvisor.com/Hotel_Review-g34227-d1555519-Reviews-Conrad_Fort_Lauderdale_Beach-Fort_Lauderdale_Broward_County_Florida.html"
  );
  assert.equal(result.quality_flag, "ok");
  assert.equal(result.quality_score, 1);
  assert.equal(result.quality_reason, "4/4 name tokens found in slug");
});

test("scoreMatch - suspect: partial token match", () => {
  // Hotel: "Burj Al Arab Jumeirah" tokens: [burj, al, arab, jumeirah]
  // Slug: "Burj_Al_Arab_Terrace_Dubai" → tokens: [burj, al, arab, terrace, dubai]
  // Matches: burj, al, arab → 3/4 = 0.75 → suspect
  const result = scoreMatch(
    "Burj Al Arab Jumeirah",
    "https://www.tripadvisor.com/Hotel_Review-g295424-d191687-Reviews-Burj_Al_Arab_Terrace_Dubai.html"
  );
  assert.equal(result.quality_flag, "suspect");
  assert.equal(result.quality_score, 0.75);
  assert.equal(result.quality_reason, "3/4 name tokens found in slug");
});

test("scoreMatch - likely_wrong: no tokens match", () => {
  // Hotel: "Park Hyatt Milan" tokens: [park, hyatt, milan]
  // Slug: "Grand_Hotel_Tremezzo_Lake_Como" → no overlap
  const result = scoreMatch(
    "Park Hyatt Milan",
    "https://www.tripadvisor.com/Hotel_Review-g187803-d191633-Reviews-Grand_Hotel_Tremezzo_Lake_Como.html"
  );
  assert.equal(result.quality_flag, "likely_wrong");
  assert.ok(result.quality_score < 0.5);
});

test("scoreMatch - empty url → likely_wrong", () => {
  const result = scoreMatch("Some Hotel", "");
  assert.equal(result.quality_flag, "likely_wrong");
  assert.equal(result.quality_reason, "no tripadvisor url");
});

test("scoreMatch - empty slug url → suspect", () => {
  const result = scoreMatch(
    "Conrad Hangzhou Tonglu",
    "https://www.tripadvisor.com/Hotel_Review-g660719-d17558173-Reviews-.html"
  );
  assert.equal(result.quality_flag, "suspect");
  assert.equal(result.quality_reason, "url has no slug text to compare");
});

test("scoreMatch - hotel name with only stop words → ok (nothing to score)", () => {
  const result = scoreMatch(
    "The",
    "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Something_Else.html"
  );
  assert.equal(result.quality_flag, "ok");
  assert.equal(result.quality_reason, "hotel name has no scoreable tokens");
});
