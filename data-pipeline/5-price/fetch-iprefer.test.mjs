import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePointsMonths, aggregateCashMonths, buildMonthlyStats, shouldFetchIprefer } from "./fetch-iprefer.mjs";

test("aggregatePointsMonths groups available nights by month", () => {
  const results = {
    "2026-04-10": { is_available: true, has_inventory: true, allows_check_in: true, points: 50000 },
    "2026-04-11": { is_available: true, has_inventory: true, allows_check_in: true, points: 60000 },
    "2026-04-12": { is_available: false, has_inventory: true, allows_check_in: true, points: 40000 },
    "2026-05-01": { is_available: true, has_inventory: true, allows_check_in: true, points: 50000 }
  };
  assert.deepEqual(aggregatePointsMonths(results), {
    "2026-04": { points_min: "50000", points_max: "60000", points_available_nights: 2 },
    "2026-05": { points_min: "50000", points_max: "50000", points_available_nights: 1 }
  });
});

test("aggregatePointsMonths skips nights with zero or missing points", () => {
  const results = {
    "2026-04-10": { is_available: true, has_inventory: true, allows_check_in: true, points: 0 },
    "2026-04-11": { is_available: true, has_inventory: true, allows_check_in: true, points: 50000 }
  };
  assert.deepEqual(aggregatePointsMonths(results), {
    "2026-04": { points_min: "50000", points_max: "50000", points_available_nights: 1 }
  });
});

test("aggregatePointsMonths returns empty object for empty results", () => {
  assert.deepEqual(aggregatePointsMonths({}), {});
});

test("aggregateCashMonths groups available nights by month using rate+tax", () => {
  const results = {
    "2026-04-10": { is_available: true, has_inventory: true, allows_check_in: true, rate: 168, tax: 33 },
    "2026-04-11": { is_available: true, has_inventory: true, allows_check_in: true, rate: 300, tax: 60 },
    "2026-04-12": { is_available: false, has_inventory: true, allows_check_in: true, rate: 100, tax: 20 },
    "2026-05-01": { is_available: true, has_inventory: true, allows_check_in: true, rate: 200, tax: 40 }
  };
  assert.deepEqual(aggregateCashMonths(results), {
    "2026-04": { cash_min: "201.00", cash_max: "360.00", cash_available_nights: 2 },
    "2026-05": { cash_min: "240.00", cash_max: "240.00", cash_available_nights: 1 }
  });
});

test("aggregateCashMonths skips nights where rate is zero or negative", () => {
  const results = {
    "2026-04-10": { is_available: true, has_inventory: true, allows_check_in: true, rate: 0, tax: 0 },
    "2026-04-11": { is_available: true, has_inventory: true, allows_check_in: true, rate: 200, tax: 40 }
  };
  assert.deepEqual(aggregateCashMonths(results), {
    "2026-04": { cash_min: "240.00", cash_max: "240.00", cash_available_nights: 1 }
  });
});

test("aggregateCashMonths returns empty object for empty results", () => {
  assert.deepEqual(aggregateCashMonths({}), {});
});

test("buildMonthlyStats merges points and cash months, omits months with no data", () => {
  const pointsMonths = {
    "2026-04": { points_min: "50000", points_max: "60000", points_available_nights: 10 }
  };
  const cashMonths = {
    "2026-04": { cash_min: "168.00", cash_max: "522.00", cash_available_nights: 18 },
    "2026-05": { cash_min: "200.00", cash_max: "300.00", cash_available_nights: 12 }
  };
  assert.deepEqual(buildMonthlyStats(pointsMonths, cashMonths), {
    "2026-04": {
      cash_min: "168.00",
      cash_max: "522.00",
      cash_available_nights: 18,
      points_min: "50000",
      points_max: "60000",
      points_available_nights: 10
    },
    "2026-05": {
      cash_min: "200.00",
      cash_max: "300.00",
      cash_available_nights: 12
    }
  });
});

test("buildMonthlyStats returns empty object when both inputs are empty", () => {
  assert.deepEqual(buildMonthlyStats({}, {}), {});
});

test("shouldFetchIprefer returns true when artifact has no iprefer field", () => {
  assert.equal(shouldFetchIprefer({ prices: {} }, false), true);
});

test("shouldFetchIprefer returns false when iprefer already present and no force refresh", () => {
  assert.equal(shouldFetchIprefer({ iprefer: { months: {} } }, false), false);
});

test("shouldFetchIprefer returns true when force refresh is set even if iprefer exists", () => {
  assert.equal(shouldFetchIprefer({ iprefer: { months: {} } }, true), true);
});
