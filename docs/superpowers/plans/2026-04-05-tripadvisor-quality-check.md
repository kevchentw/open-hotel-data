# TripAdvisor Data Quality Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a quality-check script that scores TripAdvisor URL slug vs hotel name for all stage 3 matches, and a review script that generates an editable queue of flagged entries and applies manual verdicts back into the stage 3 files.

**Architecture:** Three new files — `quality-score.mjs` (pure scoring functions, tested), `quality-check.mjs` (reads all 4 stage 3 + stage 1 files, writes quality fields in place on unreviewed entries), and `quality-review.mjs` (generate and apply modes). Quality fields are written directly onto match entries in the existing stage 3 JSON files; once a `quality_review` verdict is set it is never overwritten.

**Tech Stack:** Node.js ESM, `node:fs/promises`, `node:test` (built-in test runner), no new dependencies.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `data-pipeline/3-tripadvisor/quality-score.mjs` | Pure functions: `extractSlugText`, `tokenize`, `scoreMatch` |
| Create | `data-pipeline/3-tripadvisor/quality-score.test.mjs` | Unit tests for scoring functions |
| Create | `data-pipeline/3-tripadvisor/quality-check.mjs` | CLI: read all 4 sources, score unreviewed matches, write back |
| Create | `data-pipeline/3-tripadvisor/quality-review.mjs` | CLI: generate queue file (default) or apply verdicts (`--apply`) |
| Modify | `package.json` | Add 3 npm scripts |

---

## Task 1: Pure Scoring Module + Tests

**Files:**
- Create: `data-pipeline/3-tripadvisor/quality-score.mjs`
- Create: `data-pipeline/3-tripadvisor/quality-score.test.mjs`

### Background

TripAdvisor URLs look like one of two forms:
- With slug: `https://www.tripadvisor.com/Hotel_Review-g34227-d1555519-Reviews-Conrad_Fort_Lauderdale_Beach-Fort_Lauderdale_Broward_County_Florida.html`
- Without slug: `https://www.tripadvisor.com/Hotel_Review-g660719-d17558173-Reviews-.html`

The scoring compares the hotel name (from stage 1) against the text embedded in the slug. Empty-slug URLs get flagged `suspect` (can't confirm, not definitely wrong). Entries with `match_confidence: "none"` are skipped by the caller — `scoreMatch` does not need to handle them.

- [ ] **Step 1: Write the failing tests**

Create `data-pipeline/3-tripadvisor/quality-score.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test data-pipeline/3-tripadvisor/quality-score.test.mjs
```

Expected: multiple failures with `Cannot find module './quality-score.mjs'` or similar import error.

- [ ] **Step 3: Implement quality-score.mjs**

Create `data-pipeline/3-tripadvisor/quality-score.mjs`:

```js
const STOP_WORDS = new Set(["the", "a", "an", "and", "of", "at", "in", "by"]);

export function extractSlugText(url) {
  if (!url || typeof url !== "string") return "";

  try {
    const pathname = new URL(url).pathname;
    // Matches: /Hotel_Review-gNNN-dNNN-Reviews-<slug>.html
    const match = pathname.match(/\/Hotel_Review-g\d+-d\d+-Reviews-(.+?)\.html$/i);
    if (!match || !match[1]) return "";
    return match[1].replace(/_/g, " ").trim();
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
node --test data-pipeline/3-tripadvisor/quality-score.test.mjs
```

Expected: all tests pass, output like:
```
✔ extractSlugText - standard url with slug
✔ extractSlugText - url with empty slug (Reviews-.html)
...
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

- [ ] **Step 5: Commit**

```bash
git add data-pipeline/3-tripadvisor/quality-score.mjs data-pipeline/3-tripadvisor/quality-score.test.mjs
git commit -m "feat: add tripadvisor quality scoring functions with tests"
```

---

## Task 2: Quality Check Script

**Files:**
- Create: `data-pipeline/3-tripadvisor/quality-check.mjs`

Reads all 4 stage 3 files, looks up hotel names from the corresponding stage 1 files, scores each unreviewed entry (skips any with `quality_review` set or `match_confidence === "none"`), writes `quality_score`, `quality_flag`, `quality_reason` back in place.

- [ ] **Step 1: Create quality-check.mjs**

Create `data-pipeline/3-tripadvisor/quality-check.mjs`:

```js
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
```

- [ ] **Step 2: Run against real data and spot-check output**

```bash
node data-pipeline/3-tripadvisor/quality-check.mjs
```

Expected: output per source, e.g.:
```
amex_fhr: 1750 ok, 42 suspect, 8 likely_wrong, 11 skipped
amex_thc: ...
hilton_aspire: ...
chase_edit: ...

Total: XXXX ok, YY suspect, ZZ likely_wrong, WW skipped
```

Open `data-pipeline/3-tripadvisor/amex-fhr-hotel.json` and verify a few entries now have `quality_score`, `quality_flag`, `quality_reason` fields. Spot-check one `ok` and one `suspect` entry to confirm the scoring makes sense.

Running the script a second time should show all entries as `skipped` (already have `quality_score`).

> **Note:** The script skips entries with `quality_review` set but does NOT skip entries that already have `quality_score`. If you want to re-run cleanly on a fresh copy, that's fine — the design says option B (skip unreviewed = skip entries without any quality fields). Wait — re-read the design: "only score unreviewed matches — skip entries that already have a `quality_review` field". So the skip condition is `quality_review` is set, NOT `quality_score`. This means running the checker twice WILL re-score entries that haven't been manually reviewed. That's intentional — the checker can re-score as new matches are added.

- [ ] **Step 3: Commit**

```bash
git add data-pipeline/3-tripadvisor/quality-check.mjs
git commit -m "feat: add tripadvisor quality-check script for all sources"
```

---

## Task 3: Quality Review Script — Generate Mode

**Files:**
- Create: `data-pipeline/3-tripadvisor/quality-review.mjs`

Generates `quality-review-queue.json` containing all entries where `quality_flag` is `suspect` or `likely_wrong` AND `quality_review` is not set. Includes `hotel_name` from stage 1 for context.

- [ ] **Step 1: Create quality-review.mjs with generate mode**

Create `data-pipeline/3-tripadvisor/quality-review.mjs`:

```js
import { readFile, writeFile } from "node:fs/promises";

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

const isApplyMode = process.argv.includes("--apply");

if (isApplyMode) {
  // apply mode is added in the next task
  console.error("Apply mode not yet implemented");
  process.exitCode = 1;
} else {
  generateQueue().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: Run generate mode and verify output**

```bash
node data-pipeline/3-tripadvisor/quality-review.mjs
```

Expected output like:
```
Wrote 87 entries to quality-review-queue.json
  likely_wrong: 12
  suspect: 75
```

Open `data-pipeline/3-tripadvisor/quality-review-queue.json` and confirm:
- Entries have all required fields: `source`, `source_hotel_id`, `hotel_name`, `tripadvisor_url`, `quality_score`, `quality_flag`, `quality_reason`, `verdict`, `corrected_url`
- `likely_wrong` entries appear before `suspect` entries
- `verdict` and `corrected_url` are empty strings (ready to fill in)
- No `ok` entries appear
- No entries with `quality_review` already set appear

- [ ] **Step 3: Commit**

```bash
git add data-pipeline/3-tripadvisor/quality-review.mjs
git commit -m "feat: add tripadvisor quality-review generate mode"
```

---

## Task 4: Quality Review Script — Apply Mode

**Files:**
- Modify: `data-pipeline/3-tripadvisor/quality-review.mjs`

Reads `quality-review-queue.json`, applies verdicts to stage 3 files, removes applied entries from the queue. When `verdict: "wrong"` and `corrected_url` is provided, also updates `tripadvisor_url` and `tripadvisor_id` on the match.

- [ ] **Step 1: Add helper functions and applyQueue to quality-review.mjs**

Replace the bottom of `quality-review.mjs` (from `const isApplyMode = ...` onwards) and add the helpers. The final file should look like this — showing only the additions/changes after the `generateQueue` function:

```js
// Add these two helpers after the generateQueue function:

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
          match.tripadvisor_url = normalizedUrl;
          match.tripadvisor_id = extractTripadvisorId(normalizedUrl);
          match.quality_corrected_url = entry.corrected_url;
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

// Replace the old isApplyMode block at the bottom:
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
```

- [ ] **Step 2: Test apply mode with a small edited queue**

Edit `data-pipeline/3-tripadvisor/quality-review-queue.json` — pick one entry and set:
```json
"verdict": "approved",
"corrected_url": ""
```

Pick a second entry (a `likely_wrong` one if available) and set:
```json
"verdict": "wrong",
"corrected_url": "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Correct_Hotel_Name.html"
```

Run:
```bash
node data-pipeline/3-tripadvisor/quality-review.mjs --apply
```

Expected output:
```
  Applied 'approved' to <Hotel Name> (<source_hotel_id>)
  Applied 'wrong' to <Hotel Name> (<source_hotel_id>)

Applied 2 verdicts. <N-2> entries remain in queue.
```

Then verify:
1. The approved entry in the stage 3 file now has `"quality_review": "approved"`
2. The wrong entry has `"quality_review": "wrong"`, `"tripadvisor_url"` updated, `"tripadvisor_id"` updated, `"quality_corrected_url"` set
3. Both entries are gone from `quality-review-queue.json`
4. Running apply again with an empty-verdict queue prints the "no entries" message

- [ ] **Step 3: Revert the test edits to the queue file**

```bash
# Re-generate the queue to restore it to its correct state
node data-pipeline/3-tripadvisor/quality-review.mjs
```

> **Note:** If your test applied verdicts to real entries, those entries now have `quality_review` set and won't appear in the queue. That's fine — they've been reviewed. If you want to undo, manually remove the `quality_review` field from those entries in the stage 3 file.

- [ ] **Step 4: Commit**

```bash
git add data-pipeline/3-tripadvisor/quality-review.mjs
git commit -m "feat: add tripadvisor quality-review apply mode"
```

---

## Task 5: Wire Up npm Scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add three scripts to package.json**

In `package.json`, add these three lines to the `"scripts"` block (after the existing `pipeline:stage3:chase-edit` line is a natural place):

```json
"pipeline:stage3:quality-check": "node data-pipeline/3-tripadvisor/quality-check.mjs",
"pipeline:stage3:quality-review": "node data-pipeline/3-tripadvisor/quality-review.mjs",
"pipeline:stage3:quality-apply": "node data-pipeline/3-tripadvisor/quality-review.mjs --apply",
```

- [ ] **Step 2: Verify the scripts work via npm run**

```bash
npm run pipeline:stage3:quality-check
```

Expected: same output as running the file directly (all entries skipped since already scored).

```bash
npm run pipeline:stage3:quality-review
```

Expected: queue file regenerated with current flagged count.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add npm scripts for tripadvisor quality check and review"
```

---

## Typical Workflow (for reference)

```bash
# After running a stage 3 matcher:
npm run pipeline:stage3:quality-check

# Generate the review queue:
npm run pipeline:stage3:quality-review

# Open quality-review-queue.json, fill in verdict / corrected_url for each entry

# Apply your verdicts:
npm run pipeline:stage3:quality-apply

# Repeat generate + apply until queue is empty or all remaining entries are deferred
```
