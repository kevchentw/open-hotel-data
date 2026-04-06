import test from "node:test";
import assert from "node:assert/strict";

import {
  parsePointsHistory,
  updatePointsHistory,
  serializePointsHistory,
  parseManualCsv,
  serializeManualCsv,
  buildManualCsvRow,
  resolveStandardPointsPrice,
  shouldAddToManualCsv,
} from "./hilton-brands-points-persistence.mjs";

// ── parsePointsHistory ─────────────────────────────────────────────────────

test("parsePointsHistory returns empty structure for empty string", () => {
  const result = parsePointsHistory("");
  assert.deepEqual(result, { metadata: {}, hotels: {} });
});

test("parsePointsHistory returns empty structure for invalid JSON", () => {
  const result = parsePointsHistory("not json");
  assert.deepEqual(result, { metadata: {}, hotels: {} });
});

test("parsePointsHistory parses valid history JSON", () => {
  const json = JSON.stringify({
    metadata: { updated_at: "2026-04-06T00:00:00.000Z" },
    hotels: {
      auhetci: { standard_lowest_points_price: "50000", captured_at: "2026-04-06T00:00:00.000Z" }
    }
  });
  const result = parsePointsHistory(json);
  assert.equal(result.hotels.auhetci.standard_lowest_points_price, "50000");
});

// ── updatePointsHistory ────────────────────────────────────────────────────

test("updatePointsHistory adds new hotel to empty history", () => {
  const history = { metadata: {}, hotels: {} };
  const updated = updatePointsHistory(history, "auhetci", "50000", "2026-04-06T00:00:00.000Z");
  assert.equal(updated.hotels.auhetci.standard_lowest_points_price, "50000");
  assert.equal(updated.hotels.auhetci.captured_at, "2026-04-06T00:00:00.000Z");
});

test("updatePointsHistory overwrites existing entry with higher price", () => {
  const history = {
    metadata: {},
    hotels: { auhetci: { standard_lowest_points_price: "50000", captured_at: "2026-01-01T00:00:00.000Z" } }
  };
  const updated = updatePointsHistory(history, "auhetci", "60000", "2026-04-06T00:00:00.000Z");
  assert.equal(updated.hotels.auhetci.standard_lowest_points_price, "60000");
});

test("updatePointsHistory overwrites existing entry with lower price", () => {
  const history = {
    metadata: {},
    hotels: { auhetci: { standard_lowest_points_price: "60000", captured_at: "2026-01-01T00:00:00.000Z" } }
  };
  const updated = updatePointsHistory(history, "auhetci", "40000", "2026-04-06T00:00:00.000Z");
  assert.equal(updated.hotels.auhetci.standard_lowest_points_price, "40000");
});

test("updatePointsHistory preserves other hotels", () => {
  const history = {
    metadata: {},
    hotels: { lonwahi: { standard_lowest_points_price: "80000", captured_at: "2026-01-01T00:00:00.000Z" } }
  };
  const updated = updatePointsHistory(history, "auhetci", "50000", "2026-04-06T00:00:00.000Z");
  assert.equal(updated.hotels.lonwahi.standard_lowest_points_price, "80000");
  assert.equal(updated.hotels.auhetci.standard_lowest_points_price, "50000");
});

// ── serializePointsHistory ─────────────────────────────────────────────────

test("serializePointsHistory produces valid JSON with updated_at in metadata", () => {
  const history = {
    metadata: {},
    hotels: { auhetci: { standard_lowest_points_price: "50000", captured_at: "2026-04-06T00:00:00.000Z" } }
  };
  const json = serializePointsHistory(history, "2026-04-06T12:00:00.000Z");
  const parsed = JSON.parse(json);
  assert.equal(parsed.metadata.updated_at, "2026-04-06T12:00:00.000Z");
  assert.equal(parsed.hotels.auhetci.standard_lowest_points_price, "50000");
});

// ── parseManualCsv ─────────────────────────────────────────────────────────

test("parseManualCsv returns empty Map for empty string", () => {
  assert.equal(parseManualCsv("").size, 0);
});

test("parseManualCsv parses row with filled standard_points", () => {
  const csv = "source_hotel_id,hotel_name,standard_points,notes\nauhetci,Conrad Abu Dhabi,60000,verified";
  const map = parseManualCsv(csv);
  assert.equal(map.get("auhetci").standard_points, "60000");
  assert.equal(map.get("auhetci").hotel_name, "Conrad Abu Dhabi");
  assert.equal(map.get("auhetci").notes, "verified");
});

test("parseManualCsv parses row with blank standard_points", () => {
  const csv = "source_hotel_id,hotel_name,standard_points,notes\nlonwahi,Waldorf London,,";
  const map = parseManualCsv(csv);
  assert.equal(map.get("lonwahi").standard_points, "");
});

test("parseManualCsv handles hotel name with comma via quoting", () => {
  const csv = `source_hotel_id,hotel_name,standard_points,notes\nauhetci,"Conrad, Abu Dhabi",50000,`;
  const map = parseManualCsv(csv);
  assert.equal(map.get("auhetci").hotel_name, "Conrad, Abu Dhabi");
});

// ── serializeManualCsv ─────────────────────────────────────────────────────

test("serializeManualCsv produces header row", () => {
  const map = new Map();
  const csv = serializeManualCsv(map);
  assert.ok(csv.startsWith("source_hotel_id,hotel_name,standard_points,notes"));
});

test("serializeManualCsv sorts rows by source_hotel_id", () => {
  const map = new Map([
    ["zzz", { hotel_name: "Z Hotel", standard_points: "", notes: "" }],
    ["aaa", { hotel_name: "A Hotel", standard_points: "50000", notes: "" }],
  ]);
  const csv = serializeManualCsv(map);
  const lines = csv.trim().split("\n");
  assert.ok(lines[1].startsWith("aaa,"));
  assert.ok(lines[2].startsWith("zzz,"));
});

test("serializeManualCsv round-trips with parseManualCsv", () => {
  const original = new Map([
    ["auhetci", { hotel_name: "Conrad Abu Dhabi", standard_points: "60000", notes: "verified" }],
    ["lonwahi", { hotel_name: "Waldorf London", standard_points: "", notes: "" }],
  ]);
  const csv = serializeManualCsv(original);
  const roundTripped = parseManualCsv(csv);
  assert.equal(roundTripped.get("auhetci").standard_points, "60000");
  assert.equal(roundTripped.get("lonwahi").standard_points, "");
});

// ── buildManualCsvRow ──────────────────────────────────────────────────────

test("buildManualCsvRow creates blank row with source_hotel_id and hotel_name", () => {
  const row = buildManualCsvRow("lonwahi", "Waldorf Astoria London");
  assert.deepEqual(row, {
    source_hotel_id: "lonwahi",
    hotel_name: "Waldorf Astoria London",
    standard_points: "",
    notes: ""
  });
});

// ── resolveStandardPointsPrice ─────────────────────────────────────────────

test("resolveStandardPointsPrice returns currentStandard when present", () => {
  assert.equal(
    resolveStandardPointsPrice("40000", { standard_lowest_points_price: "50000" }, "60000"),
    "40000"
  );
});

test("resolveStandardPointsPrice falls back to history when no currentStandard", () => {
  assert.equal(
    resolveStandardPointsPrice("", { standard_lowest_points_price: "50000" }, "60000"),
    "50000"
  );
});

test("resolveStandardPointsPrice falls back to manual when no currentStandard and no history", () => {
  assert.equal(
    resolveStandardPointsPrice("", null, "60000"),
    "60000"
  );
});

test("resolveStandardPointsPrice returns empty string when nothing available", () => {
  assert.equal(resolveStandardPointsPrice("", null, ""), "");
});

// ── shouldAddToManualCsv ───────────────────────────────────────────────────

test("shouldAddToManualCsv returns true when Premium only, no history, not in CSV", () => {
  assert.equal(shouldAddToManualCsv("", null, null), true);
});

test("shouldAddToManualCsv returns false when Standard found this crawl", () => {
  assert.equal(shouldAddToManualCsv("40000", null, null), false);
});

test("shouldAddToManualCsv returns false when history exists", () => {
  assert.equal(shouldAddToManualCsv("", { standard_lowest_points_price: "50000" }, null), false);
});

test("shouldAddToManualCsv returns false when manual entry exists (blank or filled)", () => {
  assert.equal(shouldAddToManualCsv("", null, { standard_points: "" }), false);
  assert.equal(shouldAddToManualCsv("", null, { standard_points: "60000" }), false);
});
