# Hilton Brands Stage-1 Crawler Design

**Date:** 2026-04-06
**Status:** Approved

## Goal

Add a new hotel list source for selected Hilton brand pages (initially SLH and Waldorf Astoria, extensible to more brands). Unlike existing sources that are tied to a credit card plan (Aspire, Amex FHR, Chase Edit), these are brand-level lists. The crawler fetches both the hotel list and prices from the same list-page extract in a single stage-1 pass.

## Approach

Single stage-1 script that uses the `__NEXT_DATA__` technique from `data-pipeline/2-enrichment/hilton-resort.mjs`. Each brand's list page embeds a `hotelSummaryExtractUrl` inside `__NEXT_DATA__`, which resolves to a JSON blob containing hotel identity, address, coordinates, and pricing (cash and points). This makes a separate stage-2 enrichment pass redundant for these sources.

Price fields are appended to the stage-1 record as extended fields. The required stage-1 fields remain present; extra fields do not violate the contract.

## Files

| Path | Role |
|---|---|
| `data-pipeline/1-list/scripts/hilton-brands.mjs` | Crawler logic + `writeStageOneOutputs()` export |
| `data-pipeline/1-list/hilton-brands-hotel.json` | Stage-1 artifact (keyed by `source_hotel_id`) |
| `scripts/crawl-hilton-brands.mjs` | Top-level runner (mirrors `crawl-hilton-aspire-hotels.mjs`) |

## Brand Config

Defined as a top-level constant in `hilton-brands.mjs`, easy to extend:

```js
const BRAND_SLUGS = [
  { slug: "small-luxury-hotels-slh",  brand: "Small Luxury Hotels of the World" },
  { slug: "waldorf-astoria",          brand: "Waldorf Astoria Hotels & Resorts" },
  { slug: "lxr-hotels",              brand: "LXR Hotels & Resorts" },
  { slug: "conrad-hotels",           brand: "Conrad Hotels & Resorts" },
];
```

Adding a new brand = adding one entry to this array.

## Crawler Flow

For each brand slug:
1. `GET https://www.hilton.com/en/locations/<slug>/`
2. Extract `__NEXT_DATA__` JSON from the page HTML
3. Navigate to `props.pageProps.dehydratedState.queries[*].state.data.geocodePage.location.hotelSummaryExtractUrl`
4. `GET` the extract URL → receive a hotel map keyed by `ctyhocn`
5. For each hotel in the extract: build a record (see schema below)

Merge all brands into a single map keyed by `source_hotel_id` (ctyhocn). If the same hotel appears in multiple brand slugs, the later entry wins (log a warning).

Write the merged map to `hilton-brands-hotel.json`.

## Output Record Schema

```json
{
  "source": "hilton_brands",
  "source_hotel_id": "<ctyhocn-lowercase>",
  "name": "...",
  "address_raw": "...",
  "city": "...",
  "state_region": "...",
  "country": "...",
  "url": "https://www.hilton.com/en/hotels/<ctyhocn>/",
  "plan": "",
  "brand": "Small Luxury Hotels of the World",
  "chain": "Hilton",
  "latitude": "...",
  "longitude": "...",
  "lowest_cash_price": "450.00",
  "lowest_cash_price_currency": "USD",
  "lowest_cash_price_display": "US$450",
  "lowest_points_price": "35000",
  "points_reward_type": "Standard Room Reward",
  "collected_at": "2026-04-06T..."
}
```

`points_reward_type` is `"Standard Room Reward"`, `"Premium Room Rewards"`, or `""` if absent.
`lowest_cash_price`, `lowest_points_price` are empty strings when unavailable (not null).

## Key Field Mappings (from extract JSON)

| Output field | Extract path |
|---|---|
| `name` | `hotel.name` |
| `address_raw` | `hotel.address.addressLine1` |
| `city` | `hotel.address.city` |
| `state_region` | `hotel.address.stateName` |
| `country` | `hotel.address.countryName` |
| `url` | `hotel.facilityOverview.homeUrlTemplate` (normalized to `/en/`) |
| `latitude` | `hotel.localization.coordinate.latitude` |
| `longitude` | `hotel.localization.coordinate.longitude` |
| `lowest_cash_price` | `hotel.leadRate.lowest.rateAmount` |
| `lowest_cash_price_currency` | `hotel.localization.currencyCode` |
| `lowest_cash_price_display` | `hotel.leadRate.lowest.rateAmountFmt` |
| `lowest_points_price` | TBD — confirm field path from live extract |
| `points_reward_type` | TBD — confirm field path; map to "Standard Room Reward" / "Premium Room Rewards" |

The points field paths must be confirmed by inspecting the live extract JSON at implementation time. The implementation should log a warning if the expected fields are missing on the first hotel encountered.

## Output File Metadata

```json
{
  "metadata": {
    "stage": "1-list",
    "source": "hilton_brands",
    "generated_at": "...",
    "record_count": 123,
    "source_urls": [
      "https://www.hilton.com/en/locations/small-luxury-hotels-slh/",
      "https://www.hilton.com/en/locations/waldorf-astoria/",
      "https://www.hilton.com/en/locations/lxr-hotels/",
      "https://www.hilton.com/en/locations/conrad-hotels/"
    ]
  },
  "hotels": { ... }
}
```

## Error Handling

- If a brand page returns non-200: throw with the slug and status code.
- If `__NEXT_DATA__` is missing: throw with the slug.
- If `hotelSummaryExtractUrl` is not found: throw with the slug.
- If the extract fetch fails: throw with the extract URL and status.
- Missing price fields on individual hotels: store `""`, do not throw.

## Runner Script

`scripts/crawl-hilton-brands.mjs` — identical structure to `crawl-hilton-aspire-hotels.mjs`:

```js
import { writeStageOneOutputs } from "../data-pipeline/1-list/scripts/hilton-brands.mjs";

writeStageOneOutputs().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```
