# Price Stage

## Stage

This is logical and filesystem stage `5-price`.

## Purpose

Attach price data to canonical hotels keyed by `tripadvisor_id`.

Prices belong to canonical hotels, not to raw plan-only rows. This stage should
combine:

- provider-sampled stay-date pricing when a hotel can be quoted directly
- source-native lowest-price fields already captured during stage-2 enrichment

If there is already a usable summary price from upstream enrichment, default to
skip additional xotelo fetching for that hotel in order to keep the stage light.

## Inputs

- canonical hotel registry from the unique stage
- approved pricing providers or scrapers
- stage-2 enrichment artifacts when a source exposes only a summary price

## Outputs

Write one JSON file per canonical hotel under `data-pipeline/5-price/prices/`.

The current implementation writes each hotel file immediately after that hotel
finishes processing. A partial run should therefore leave completed hotel files
on disk instead of waiting until the very end of the stage.

Recommended output paths:

- `data-pipeline/5-price/prices/g294013-d2154485.json`
- `data-pipeline/5-price/prices/g293736-d25054745.json`

Each file should contain:

- metadata about the generated artifact
- an optional `summary_price` value for the known lowest displayed price
- a `prices` object keyed by stay date

Target JSON shape:

```json
{
  "metadata": {
    "stage": "5-price",
    "generated_at": "2026-04-03T00:00:00.000Z",
    "tripadvisor_id": "g294013-d2154485"
  },
  "summary_price": {
    "currency": "USD",
    "source": "hilton",
    "cost": "640.00",
    "display": "$640",
    "fetched_at": "2026-04-03T00:00:00.000Z"
  },
  "prices": {
    "2026-04-05": {
      "currency": "USD",
      "fetched_at": "2026-04-03T00:00:00.000Z",
      "source": "xotelo",
      "cost": "640.00"
    },
    "2026-05-05": {
      "currency": "USD",
      "fetched_at": "2026-04-03T00:00:00.000Z",
      "source": "xotelo",
      "cost": "910.00"
    }
  }
}
```

## Required Fields

- `metadata.tripadvisor_id`
- `metadata.generated_at`
- zero or more stay-date keys inside `prices`

If `summary_price` is present, it should contain:

- `currency`
- `source`
- `cost`
- `fetched_at`

Each price entry must contain:

- `currency`
- `fetched_at`
- `source`
- `cost`

## Pricing Rules

- Normalize all stored prices to USD before writing stage output.
- Keep a currency transform map in code and treat it as the single approved
  conversion rule for this stage.
- Record only USD values in `summary_price` and sampled `prices`.
- If a source exposes a non-USD price, convert it to USD first and log enough
  metadata to trace the original source value during debugging.
- `summary_price` is the coarse "known lowest displayed price" from an upstream
  source page and does not represent a sampled stay-date quote.
- `prices` should only contain sampled stay-date quotes, not arbitrary summaries.

### Currency Transform Map

This stage should own an explicit currency transform map that always converts
source values into USD before persistence.

Recommended behavior:

- maintain a map keyed by source currency such as `AED`, `EUR`, `JPY`, or `USD`
- store the USD multiplier or conversion rule used for each supported currency
- fail loudly or skip the write when a currency has no approved transform rule
- keep the transform map versioned in code so reruns remain explainable
- allow force-refresh to recompute older converted prices if the transform map changes

## Source-Specific Rules

### Hilton Resort

Hilton resort enrichment may already expose fields such as:

```json
{
  "lowest_public_price": "125.26",
  "lowest_public_price_display": "AED 460",
  "price_currency": "AED"
}
```

For Hilton records that only expose a lowest public price and do not support
stay-date sampling yet:

- write the known low price into `summary_price`
- keep `prices` empty until sampled stay-date quotes are available
- convert the source value to USD using the stage currency transform map before
  writing the artifact
- the current implementation reads only stage-2 Hilton Aspire enrichment for
  these hotels and does not call xotelo unless force-refresh or force-xotelo is
  explicitly enabled

### Other Providers

For providers that support sampled room-rate collection:

- use the canonical hotel record as the lookup target
- insert one entry per sampled stay date into `prices`
- default to skip sampled fetching when a trustworthy `summary_price` already
  exists, unless force-refresh or a targeted backfill requests sampled coverage

### Current Source Routing

The current script uses separate handlers by source:

- `hilton_aspire_resort_credit`: build `summary_price` from stage-2 upstream enrichment
- `amex_fhr`: fetch sampled stay-date prices from xotelo
- hotels matched to both sources: prefer existing or upstream summary pricing by default and skip xotelo unless `STAGE5_FORCE_XOTELO=true` or `STAGE5_FORCE_REFRESH=true`

## Behavior Rules

- Only canonical hotels are eligible for this stage.
- Default behavior is backfill-only for hotels or stay dates that do not yet
  exist in the price files.
- A hotel with an existing `summary_price` may be considered complete enough to
  skip xotelo by default.
- Force-refresh may intentionally replace existing sampled prices and timestamps.
- Partial provider coverage is acceptable as long as the canonical hotel remains
  traceable and the file stays internally consistent.

## Failure and Retry Expectations

- Partial failures must not erase previously stored prices unless replacement
  data has been written successfully.
- Failed lookups should be visible in logs or metadata so reruns can target them.
- Rerunning any subset of canonical hotels should be safe.

## How To Run

Run the stage with:

```bash
npm run pipeline:stage5:price
```

The script reads:

- `data-pipeline/4-unique/hotel.json`
- `data-pipeline/2-enrichment/hilton-aspire-hotel.json`

The script writes:

- `data-pipeline/5-price/prices/<tripadvisor_id>.json`

Recommended workflow:

```bash
npm run pipeline:stage4:unique
npm run pipeline:stage5:price
npm run pipeline:stage6:output
```

### Targeted Runs

Limit the stage to specific canonical hotels:

```bash
STAGE5_HOTEL_IDS='g1016927-d2257403,g1049626-d23428437' npm run pipeline:stage5:price
```

Override the sampled stay dates used for xotelo:

```bash
STAGE5_XOTELO_STAY_DATES='2026-05-10,2026-07-09' npm run pipeline:stage5:price
```

Force a refresh of existing files and sampled dates:

```bash
STAGE5_FORCE_REFRESH=true npm run pipeline:stage5:price
```

Force xotelo even when a summary price already exists:

```bash
STAGE5_FORCE_XOTELO=true npm run pipeline:stage5:price
```

### Environment Variables

- `STAGE5_HOTEL_IDS`: comma-separated list of canonical `tripadvisor_id` values to process
- `STAGE5_XOTELO_STAY_DATES`: comma-separated stay dates in `YYYY-MM-DD` format
- `STAGE5_FORCE_REFRESH=true`: overwrite existing sampled prices and refresh summary data when available
- `STAGE5_FORCE_XOTELO=true`: allow xotelo fetches even when a usable summary price already exists
- `STAGE5_XOTELO_CONCURRENCY`: limit parallel xotelo requests per hotel
- `STAGE5_STAY_NIGHTS`: number of nights used for xotelo sampling; default is `1`

### Logging

The script logs one line per hotel after the file is written.

Example:

```text
[stage5] starting price fetch for 2 hotels (sample stay dates: 2026-05-10)
[stage5] g1016927-d2257403 aspire-upstream summary=63.99 stays=0
[stage5] g1049626-d23428437 fhr-xotelo summary=none stays=1 dates=2026-05-10
[stage5] wrote 2 price artifacts to /Users/kuanyinchen/Repo/open-hotel-data/data-pipeline/5-price/prices/ (sample stay dates: 2026-05-10)
```

## Script Notes

- Keep provider fetch logic separate from normalization and serialization.
- Read canonical inputs from the unique stage and write only stage-local price
  artifacts in this directory.
- If multiple providers are used, normalize them into this per-hotel contract
  before the output stage consumes them.
