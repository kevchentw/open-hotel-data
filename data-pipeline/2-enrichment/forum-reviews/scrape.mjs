/**
 * Scrapes the FHR/THC hotel stay thread from uscardforum.com.
 *
 * Uses Camoufox (anti-detect browser) to bypass Cloudflare — no cookie or
 * login required. Opens a headed browser, navigates to the /print URL, and
 * extracts all posts into raw-posts.json.
 *
 * Usage:
 *   node data-pipeline/2-enrichment/forum-reviews/scrape.mjs
 *
 * Options (env vars):
 *   FORUM_HEADLESS=true   - run headless (may fail Cloudflare check)
 *   FORUM_TIMEOUT_MS=...  - page load timeout in ms (default: 120000)
 */

import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Camoufox } from "camoufox-js";

const FORUM_PRINT_URL = "https://www.uscardforum.com/t/topic/42589/print";
const OUTPUT_FILE_URL = new URL("./raw-posts.json", import.meta.url);

async function scrapeForumPosts() {
  const headless = readBooleanEnv("FORUM_HEADLESS", false);
  const timeoutMs = readIntegerEnv("FORUM_TIMEOUT_MS", 120_000);

  console.log(`Launching browser (headless: ${headless})...`);
  const browser = await Camoufox({ headless, humanize: true });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  try {
    console.log(`Navigating to ${FORUM_PRINT_URL} ...`);
    await page.goto(FORUM_PRINT_URL, { waitUntil: "networkidle", timeout: timeoutMs });

    // Verify Cloudflare challenge is resolved
    const title = await page.title();
    if (title.toLowerCase().includes("just a moment")) {
      throw new Error(
        'Cloudflare challenge not resolved — try running with FORUM_HEADLESS=false and interact with the browser.'
      );
    }

    console.log(`Page loaded: "${title}"`);

    const posts = await page.evaluate(() => {
      const results = [];

      // This Discourse instance renders the print page as crawler-friendly HTML.
      // Each post (except post 1) is a div.topic-body.crawler-post.
      // Post 1 uses a slightly different wrapper but shares the same inner structure.
      // All posts share: span[itemprop="position"], span[itemprop="name"] (author),
      //                  time[itemprop="datePublished"], div.post[itemprop="text"]
      const posts = document.querySelectorAll(
        ".topic-body.crawler-post, .topic-post .topic-body"
      );

      for (const post of posts) {
        const postNumber =
          post.querySelector("span[itemprop='position']")?.textContent?.trim() || "";

        const author =
          post.querySelector("[itemprop='author'] [itemprop='name']")?.textContent?.trim() ||
          post.querySelector(".creator [itemprop='name']")?.textContent?.trim() ||
          "";

        const timeEl =
          post.querySelector("time[itemprop='datePublished']") ||
          post.querySelector("time.post-time");
        const date = timeEl?.getAttribute("datetime") || "";

        const contentEl = post.querySelector("div.post[itemprop='text']");
        if (!contentEl) continue;

        // Preserve newlines from block elements before stripping tags
        contentEl.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
        contentEl.querySelectorAll("p, div, li, blockquote, h1, h2, h3").forEach((el) => {
          el.prepend("\n");
          el.append("\n");
        });

        const text = contentEl.textContent
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        if (!text) continue;

        results.push({ post_number: postNumber, author, date, text });
      }

      return results;
    });

    console.log(`Extracted ${posts.length} posts`);

    if (posts.length === 0) {
      console.warn("No posts found — saving raw HTML to raw-page.html for inspection");
      const html = await page.content();
      await writeFile(new URL("./raw-page.html", import.meta.url), html, "utf8");
      process.exit(1);
    }

    const payload = {
      metadata: {
        source_url: FORUM_PRINT_URL,
        scraped_at: new Date().toISOString(),
        post_count: posts.length
      },
      posts
    };

    await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Saved to ${OUTPUT_FILE_URL.pathname}`);
  } finally {
    await browser.close();
  }
}

function readBooleanEnv(name, fallback = false) {
  const v = process.env[name];
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function readIntegerEnv(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  scrapeForumPosts().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
