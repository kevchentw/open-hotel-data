import { mkdir, readFile, writeFile } from "node:fs/promises";

const TALLY_FORM_ID = "QKYpak";
const TALLY_API_BASE = "https://api.tally.so";
const OUTPUT_FILE_URL = new URL("./aspire-tally-submissions.json", import.meta.url);
const ENV_FILE_URL = new URL("../../.env", import.meta.url);

async function loadEnv() {
  const content = await readFile(ENV_FILE_URL, "utf8");
  const token = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("TALLY_API_TOKEN="))
    .map((line) => line.slice("TALLY_API_TOKEN=".length))[0];

  if (!token) {
    throw new Error("TALLY_API_TOKEN not found in .env file");
  }
  return token;
}

async function fetchAllSubmissions(token) {
  const submissions = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `${TALLY_API_BASE}/forms/${TALLY_FORM_ID}/submissions?page=${page}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Tally API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const pageSubmissions = data.submissions ?? data.data ?? [];
    submissions.push(...pageSubmissions);

    const totalPages = data.totalNumberOfPages ?? data.meta?.totalPages ?? 1;
    hasMore = page < totalPages;
    page++;

    if (pageSubmissions.length === 0) {
      hasMore = false;
    }
  }

  return submissions;
}

export async function fetchAspireTallySubmissions() {
  const token = await loadEnv();

  console.log(`Fetching Tally form submissions for form ${TALLY_FORM_ID}...`);
  const submissions = await fetchAllSubmissions(token);
  console.log(`Fetched ${submissions.length} submissions`);

  await mkdir(new URL("./", import.meta.url), { recursive: true });

  const payload = {
    metadata: {
      stage: "2-enrichment",
      source: "aspire_tally_submissions",
      form_id: TALLY_FORM_ID,
      generated_at: new Date().toISOString(),
      record_count: submissions.length
    },
    submissions
  };

  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${submissions.length} submissions to ${OUTPUT_FILE_URL.pathname}`);

  return payload;
}

await fetchAspireTallySubmissions();
