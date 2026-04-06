import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHotelRecord,
  extractBrandCode,
  extractHotelSummaryExtractUrl,
  mapPointsRewardType,
  normalizeHiltonHotelUrl,
} from "./hilton-brands.mjs";

// ── extractHotelSummaryExtractUrl ──────────────────────────────────────────

test("extractHotelSummaryExtractUrl returns URL from valid __NEXT_DATA__", () => {
  const nextData = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            {
              queryKey: [{ operationName: "hotelSummaryOptions_geocodePage" }],
              state: {
                data: {
                  geocodePage: {
                    location: { hotelSummaryExtractUrl: "https://cdn.hilton.com/extract.json" }
                  }
                }
              }
            }
          ]
        }
      }
    }
  };
  assert.equal(extractHotelSummaryExtractUrl(nextData), "https://cdn.hilton.com/extract.json");
});

test("extractHotelSummaryExtractUrl returns empty string when query is missing", () => {
  assert.equal(extractHotelSummaryExtractUrl({}), "");
});

test("extractHotelSummaryExtractUrl returns empty string when operationName does not match", () => {
  const nextData = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            { queryKey: [{ operationName: "somethingElse" }], state: { data: {} } }
          ]
        }
      }
    }
  };
  assert.equal(extractHotelSummaryExtractUrl(nextData), "");
});

// ── extractBrandCode ──────────────────────────────────────────────────────

test("extractBrandCode returns brandCode from valid __NEXT_DATA__", () => {
  const nextData = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            {
              queryKey: [{ operationName: "hotelSummaryOptions_geocodePage" }],
              state: {
                data: {
                  geocodePage: {
                    location: { brandCode: "WA", hotelSummaryExtractUrl: "https://cdn.hilton.com/extract.json" }
                  }
                }
              }
            }
          ]
        }
      }
    }
  };
  assert.equal(extractBrandCode(nextData), "WA");
});

test("extractBrandCode returns empty string when brandCode is missing", () => {
  assert.equal(extractBrandCode({}), "");
});

// ── mapPointsRewardType ────────────────────────────────────────────────────

test("mapPointsRewardType maps 'Standard Room Reward' variants", () => {
  assert.equal(mapPointsRewardType("Standard Room Reward"), "Standard Room Reward");
  assert.equal(mapPointsRewardType("STANDARD room reward"), "Standard Room Reward");
});

test("mapPointsRewardType maps 'Premium Room Rewards' variants", () => {
  assert.equal(mapPointsRewardType("Premium Room Rewards"), "Premium Room Rewards");
  assert.equal(mapPointsRewardType("PREMIUM ROOM REWARDS"), "Premium Room Rewards");
});

test("mapPointsRewardType returns empty string for unknown values", () => {
  assert.equal(mapPointsRewardType(""), "");
  assert.equal(mapPointsRewardType(null), "");
  assert.equal(mapPointsRewardType("Flex Rate"), "");
});

// ── normalizeHiltonHotelUrl ────────────────────────────────────────────────

test("normalizeHiltonHotelUrl converts locale prefix to /en/", () => {
  assert.equal(
    normalizeHiltonHotelUrl("https://www.hilton.com/fr/hotels/lonlxwa-lxr-test/"),
    "https://www.hilton.com/en/hotels/lonlxwa-lxr-test"
  );
});

test("normalizeHiltonHotelUrl returns empty string for empty input", () => {
  assert.equal(normalizeHiltonHotelUrl(""), "");
  assert.equal(normalizeHiltonHotelUrl(null), "");
});

// ── buildHotelRecord ───────────────────────────────────────────────────────

const MOCK_EXTRACT_HOTEL = {
  ctyhocn: "LONLXWA",
  name: "LXR Test Hotel",
  address: {
    addressLine1: "1 Test Street",
    city: "London",
    stateName: "",
    countryName: "United Kingdom"
  },
  localization: {
    coordinate: { latitude: 51.5, longitude: -0.1 },
    currencyCode: "GBP"
  },
  facilityOverview: {
    homeUrlTemplate: "https://www.hilton.com/en/hotels/lonlxwa-lxr-test/"
  },
  leadRate: {
    lowest: { rateAmount: 300, rateAmountFmt: "£300" },
    hhonors: {
      lead: {
        dailyRmPointsRate: 40000,
        ratePlan: { ratePlanName: "Standard Room Reward" }
      }
    }
  }
};

test("buildHotelRecord sets required stage-1 fields", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.source, "hilton_brands");
  assert.equal(record.source_hotel_id, "lonlxwa");
  assert.equal(record.name, "LXR Test Hotel");
  assert.equal(record.chain, "Hilton");
  assert.equal(record.brand, "LXR Hotels & Resorts");
  assert.equal(record.plan, "");
  assert.equal(record.collected_at, "2026-04-06T00:00:00.000Z");
});

test("buildHotelRecord maps address and coordinates", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.address_raw, "1 Test Street");
  assert.equal(record.city, "London");
  assert.equal(record.country, "United Kingdom");
  assert.equal(record.latitude, "51.5");
  assert.equal(record.longitude, "-0.1");
});

test("buildHotelRecord maps cash price fields", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.lowest_cash_price, "300");
  assert.equal(record.lowest_cash_price_currency, "GBP");
  assert.equal(record.lowest_cash_price_display, "£300");
});

test("buildHotelRecord maps points price and reward type", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.lowest_points_price, "40000");
  assert.equal(record.points_reward_type, "Standard Room Reward");
  assert.equal(record.standard_lowest_points_price, "");
});

test("buildHotelRecord stores empty strings for missing price fields", () => {
  const record = buildHotelRecord({ ctyhocn: "TESTCI", name: "Test" }, "Conrad Hotels & Resorts", "2026-04-06T00:00:00.000Z");
  assert.equal(record.lowest_cash_price, "");
  assert.equal(record.lowest_points_price, "");
  assert.equal(record.points_reward_type, "");
  assert.equal(record.standard_lowest_points_price, "");
});

test("buildHotelRecord uses provided standardLowestPointsPrice", () => {
  const record = buildHotelRecord(MOCK_EXTRACT_HOTEL, "LXR Hotels & Resorts", "2026-04-06T00:00:00.000Z", "35000");
  assert.equal(record.standard_lowest_points_price, "35000");
});
