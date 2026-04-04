# Open Hotel Data

Open Hotel Data is a static hotel dataset and pipeline for collecting, enriching,
matching, and publishing hotel records across multiple travel programs.

The short version:

- collect source-truth hotel lists from programs such as Amex and Hilton
- enrich those source records with more detail before cross-source matching
- attach a shared identity layer such as TripAdvisor
- publish app-facing data files under `public/data/`

## Published data model

The frontend currently reads flat files from `public/data/`:

- `public/data/hotels.csv`: one row per canonical hotel
- `public/data/plans/<plan>.csv`: one row per hotel within a specific source or plan
- `public/data/hotel_plan_links.csv`: join table linking canonical hotels to source-specific rows
- `public/data/prices/<hotel_id>.csv`: one file per hotel price history
- `public/data/user_reports.csv`: imported user-submitted updates

Linking strategy:

- `hotels.csv.id` is the stable canonical hotel key
- every plan CSV includes `hotel_id`, which points back to `hotels.csv.id`
- every plan CSV keeps its own `source_hotel_id`, so source-specific IDs do not collide
- `hotel_plan_links.csv` makes cross-source joins easy without loading the full plan files
- geo fields can live directly on canonical and plan rows: `latitude`, `longitude`, `formatted_address`, and related `geo_*` metadata when available

## Pipeline direction

The long-term workflow lives under `data-pipeline/` and is moving toward a clearer staged model.

Planned logical flow:

1. `1-list`: collect source-truth hotel lists
2. `2-enrichment`: enrich source rows from first-party detail pages and similar source-specific pages
3. `3-tripadvisor`: attach TripAdvisor identity and review metadata where possible
4. `4-unique`: build the canonical hotel registry across sources
5. `5-price`: attach price history
6. `6-output`: export app-facing files

The important change is the new enrichment stage between raw list collection and
TripAdvisor matching. That stage is where source-native detail should live, such as:

- amenity coverage
- special property tags such as newly built
- first-party geo and address cleanup
- normalized coordinates and formatted addresses when the source exposes them
- lowest public price seen on a source page
- source-native ratings, review counts, or partner metadata when available

Some directory names and older docs still reflect the earlier numbering model, so
`data-pipeline/README.md` should be treated as the source of truth for the migration plan.

## Local scripts

```bash
npm install
npm run pipeline:stage1:amex
npm run pipeline:stage1:aspire
npm run sync:hotels
npm run sync:prices
npm run sync:google-sheet
npm run dev
```

## Stage 1 collectors

Source-specific collection logic is moving into `data-pipeline/1-list/scripts/`.

Current examples:

- `amex.mjs`
- `aspire-hotel.mjs`

Shared stage-1 helpers live under `data-pipeline/1-list/scripts/shared/`:

- `amex-live.mjs`
- `normalize.mjs`

### Amex crawler notes

`data-pipeline/1-list/scripts/amex.mjs` scrapes live American Express Travel
property result pages with Playwright. GPS coordinates can be pulled from the
list page's map state, so the crawler does not need to open every detail page.

Useful environment variables:

- `AMEX_HOTELS_ROUTE_IDS=1,2,3` to limit which result pages are scraped
- `AMEX_HOTELS_HEADLESS=true` to run without opening Chrome
- `AMEX_HOTELS_FETCH_GPS=false` to skip map-based coordinate extraction
- `AMEX_HOTELS_USER_DATA_DIR=/path/to/profile` to reuse a browser profile if Amex presents an anti-bot challenge

## Current export path

The existing sync flow still writes CSVs for the app layer:

- `public/data/hotels.csv`
- `public/data/hotel_plan_links.csv`
- `public/data/plans/amex_fhr_hotels.csv`
- `public/data/plans/amex_thc_hotels.csv`
- `public/data/plans/chase_edit_hotels.csv`
- `public/data/plans/hilton_aspire_resort_credit_hotels.csv`
