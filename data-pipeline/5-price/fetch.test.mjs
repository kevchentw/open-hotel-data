import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCoverageFirstTaskQueue,
  buildRepresentativeFallbackStayDates,
  buildRepresentativeStayDates,
  getDatesToFetchForHotel,
  mapWithConcurrency,
  normalizeSampleAttempts
} from "./fetch.mjs";

test("buildRepresentativeStayDates returns deterministic second Tuesday and Saturday samples", () => {
  assert.deepEqual(
    buildRepresentativeStayDates({
      startDate: "2026-04-04",
      months: 3,
      weekday: 2,
      weekendDay: 6
    }),
    [
      "2026-04-11",
      "2026-04-14",
      "2026-05-09",
      "2026-05-12",
      "2026-06-09",
      "2026-06-13"
    ]
  );
});

test("buildCoverageFirstTaskQueue schedules breadth-first across hotels", () => {
  assert.deepEqual(
    buildCoverageFirstTaskQueue([
      { tripadvisorId: "hotel-a", dates: ["2026-04-14", "2026-05-12"] },
      { tripadvisorId: "hotel-b", dates: ["2026-04-14"] },
      { tripadvisorId: "hotel-c", dates: ["2026-04-14", "2026-05-12", "2026-06-09"] }
    ]),
    [
      { tripadvisorId: "hotel-a", stayDate: "2026-04-14" },
      { tripadvisorId: "hotel-b", stayDate: "2026-04-14" },
      { tripadvisorId: "hotel-c", stayDate: "2026-04-14" },
      { tripadvisorId: "hotel-a", stayDate: "2026-05-12" },
      { tripadvisorId: "hotel-c", stayDate: "2026-05-12" },
      { tripadvisorId: "hotel-c", stayDate: "2026-06-09" }
    ]
  );
});

test("buildRepresentativeFallbackStayDates walks forward within the same month by weekday/weekend kind", () => {
  assert.deepEqual(
    buildRepresentativeFallbackStayDates("2026-04-14"),
    [
      "2026-04-15",
      "2026-04-16",
      "2026-04-17",
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-27",
      "2026-04-28",
      "2026-04-29",
      "2026-04-30"
    ]
  );

  assert.deepEqual(
    buildRepresentativeFallbackStayDates("2026-04-11"),
    ["2026-04-12", "2026-04-18", "2026-04-19", "2026-04-25", "2026-04-26"]
  );
});

test("getDatesToFetchForHotel skips existing prices and terminal no-data attempts", () => {
  assert.deepEqual(
    getDatesToFetchForHotel({
      hotel: { plans: ["amex_fhr"] },
      summaryPrice: null,
      prices: {
        "2026-04-14": {
          cost: "100.00",
          currency: "USD",
          fetched_at: "2026-04-01T00:00:00.000Z",
          source: "xotelo"
        }
      },
      sampleAttempts: {
        "2026-04-11": {
          status: "no_data",
          source: "xotelo",
          fetched_at: "2026-04-01T00:00:00.000Z"
        },
        "2026-05-09": {
          status: "fetch_error",
          source: "xotelo",
          fetched_at: "2026-04-01T00:00:00.000Z"
        }
      },
      sampleStayDates: ["2026-04-11", "2026-04-14", "2026-05-09", "2026-05-12"]
    }),
    ["2026-05-09", "2026-05-12"]
  );
});

test("force refresh bypasses existing prices and no-data attempts", async () => {
  const originalForceRefresh = process.env.STAGE5_FORCE_REFRESH;

  try {
    process.env.STAGE5_FORCE_REFRESH = "true";
    const module = await import(new URL(`./fetch.mjs?force-refresh=${Date.now()}`, import.meta.url));

    assert.deepEqual(
      module.getDatesToFetchForHotel({
        hotel: { plans: ["amex_fhr"] },
        summaryPrice: null,
        prices: {
          "2026-04-14": {
            cost: "100.00",
            currency: "USD",
            fetched_at: "2026-04-01T00:00:00.000Z",
            source: "xotelo"
          }
        },
        sampleAttempts: {
          "2026-04-11": {
            status: "no_data",
            source: "xotelo",
            fetched_at: "2026-04-01T00:00:00.000Z"
          }
        },
        sampleStayDates: ["2026-04-11", "2026-04-14", "2026-05-12"]
      }),
      ["2026-04-11", "2026-04-14", "2026-05-12"]
    );
  } finally {
    if (originalForceRefresh === undefined) {
      delete process.env.STAGE5_FORCE_REFRESH;
    } else {
      process.env.STAGE5_FORCE_REFRESH = originalForceRefresh;
    }
  }
});

test("normalizeSampleAttempts tolerates legacy artifacts and filters invalid records", () => {
  assert.deepEqual(normalizeSampleAttempts(undefined), {});
  assert.deepEqual(
    normalizeSampleAttempts({
      "2026-04-11": {
        status: "no_data",
        source: "xotelo",
        fetched_at: "2026-04-01T00:00:00.000Z"
      },
      "2026-04-14": {
        status: "fetch_error",
        source: "xotelo",
        fetched_at: "2026-04-01T00:00:00.000Z",
        http_status: 500
      },
      bad: {
        status: "no_data"
      },
      "2026-05-12": {
        status: "ignored"
      }
    }),
    {
      "2026-04-11": {
        detail: "",
        fetched_at: "2026-04-01T00:00:00.000Z",
        http_status: "",
        source: "xotelo",
        status: "no_data"
      },
      "2026-04-14": {
        detail: "",
        fetched_at: "2026-04-01T00:00:00.000Z",
        http_status: "",
        source: "xotelo",
        status: "fetch_error"
      }
    }
  );
});

test("mapWithConcurrency respects the configured concurrency ceiling", async () => {
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency(
    Array.from({ length: 12 }, (_, index) => index),
    5,
    async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return value * 2;
    }
  );

  assert.deepEqual(results, Array.from({ length: 12 }, (_, index) => index * 2));
  assert.ok(maxActive <= 5, `expected max concurrency <= 5, received ${maxActive}`);
});
