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
skip additional xotelo fetching for that hotel in order to keep the stage light
unless force mode is enabled.

## Inputs

- canonical hotel registry from the unique stage
- approved pricing providers or scrapers
- stage-2 enrichment artifacts when a source exposes only a summary price

## Outputs

Write one JSON file per canonical hotel under `data-pipeline/5-price/prices/`.

The current implementation writes each hotel file as soon as that hotel becomes
complete for the current run. A partial run should therefore leave completed
hotel files on disk instead of waiting until the very end of the stage.

Recommended output paths:

- `data-pipeline/5-price/prices/g294013-d2154485.json`
- `data-pipeline/5-price/prices/g293736-d25054745.json`

Each file should contain:

- metadata about the generated artifact
- an optional `summary_price` value for the known lowest displayed price
- a `prices` object keyed by stay date
- a `sample_attempts` object keyed by stay date for no-data and retryable errors

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
    "2026-04-14": {
      "currency": "USD",
      "fetched_at": "2026-04-03T00:00:00.000Z",
      "source": "xotelo",
      "cost": "640.00"
    },
    "2026-05-12": {
      "currency": "USD",
      "fetched_at": "2026-04-03T00:00:00.000Z",
      "source": "xotelo",
      "cost": "910.00"
    }
  },
  "sample_attempts": {
    "2026-06-13": {
      "fetched_at": "2026-04-03T00:00:00.000Z",
      "source": "xotelo",
      "status": "no_data",
      "detail": "no_usable_rates",
      "http_status": ""
    }
  }
}
```

## Required Fields

- `metadata.tripadvisor_id`
- `metadata.generated_at`
- zero or more stay-date keys inside `prices`
- zero or more stay-date keys inside `sample_attempts`

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

Each `sample_attempts` entry must contain:

- `fetched_at`
- `source`
- `status`

Optional `sample_attempts` fields:

- `detail`
- `http_status`

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
- `sample_attempts` should only record sampled-date misses or retryable failures.

### Currency Transform Map

This stage should own an explicit currency transform map that always converts
source values into USD before persistence.

Recommended behavior:

- maintain a map keyed by source currency such as `AED`, `EUR`, `JPY`, or `USD`
- store the USD multiplier or conversion rule used for each supported currency
- fail loudly or skip the write when a currency has no approved transform rule
- keep the transform map versioned in code so reruns remain explainable
- allow force-refresh to recompute older converted prices if the transform map changes

## Representative Sampling

Default sampled pricing now uses representative dates instead of only one or two
hard-coded offsets.

Default behavior:

- sample the current calendar month plus the next `11` calendar months
- choose one deterministic workday sample and one deterministic weekend sample per month
- default workday anchor is the second Tuesday of each month
- default weekend anchor is the second Saturday of each month
- anchor the month set to the first day of the current UTC month, not the exact run day
- process work breadth-first across hotels so more hotels receive initial
  coverage before one hotel receives many sampled dates

If `STAGE5_XOTELO_STAY_DATES` is provided, that explicit list overrides the
representative schedule for that run.

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
- insert one successful entry per sampled stay date into `prices`
- write terminal no-data and retryable fetch errors into `sample_attempts`
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
- A sampled stay date with an existing `prices[stayDate]` value is treated as complete.
- A sampled stay date with a `sample_attempts[stayDate].status` of `no_data` is
  treated as complete and skipped on reruns.
- A sampled stay date with a `sample_attempts[stayDate].status` of `fetch_error`
  remains retryable on reruns.
- Force-refresh may intentionally replace existing sampled prices and timestamps.
- Partial provider coverage is acceptable as long as the canonical hotel remains
  traceable and the file stays internally consistent.

## Failure and Retry Expectations

- Partial failures must not erase previously stored prices unless replacement
  data has been written successfully.
- Failed lookups should be visible in logs or metadata so reruns can target them.
- Retryable fetch failures should remain visible in `sample_attempts` but should
  not block reruns for the same stay date.
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

Switch between representative and explicit sampling modes:

```bash
STAGE5_SAMPLE_MODE=representative npm run pipeline:stage5:price
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
- `STAGE5_SAMPLE_MODE`: `representative` by default, or `explicit` to require `STAGE5_XOTELO_STAY_DATES`
- `STAGE5_SAMPLE_MONTHS`: number of future months to sample in representative mode; default is `12`
- `STAGE5_SAMPLE_WEEKDAY`: weekday used for the monthly workday anchor (`0` = Sunday, `2` = Tuesday by default)
- `STAGE5_SAMPLE_WEEKEND`: weekday used for the monthly weekend anchor (`0` = Sunday, `6` = Saturday by default)
- `STAGE5_FORCE_REFRESH=true`: overwrite existing sampled prices and refresh summary data when available
- `STAGE5_FORCE_XOTELO=true`: allow xotelo fetches even when a usable summary price already exists
- `STAGE5_XOTELO_CONCURRENCY`: limit global parallel xotelo requests across the full run; default is `5`
- `STAGE5_STAY_NIGHTS`: number of nights used for xotelo sampling; default is `1`

### Logging

The script logs one line per hotel after the file is written.

Example:

```text
[stage5] starting price fetch for 2 hotels (sample mode: representative, stay dates: 2026-04-11, 2026-04-14, ...)
[stage5] g1016927-d2257403 aspire-upstream summary=63.99 stays=0 no_data=0 retryable_errors=0
[stage5] g1049626-d23428437 fhr-xotelo summary=none stays=2 no_data=1 retryable_errors=0 dates=2026-04-14,2026-05-12
[stage5] wrote 2 price artifacts to /Users/kuanyinchen/Repo/open-hotel-data/data-pipeline/5-price/prices/ (sample mode: representative, stay dates: 2026-04-11, 2026-04-14, ...)
```

## Script Notes

- Keep provider fetch logic separate from normalization and serialization.
- Read canonical inputs from the unique stage and write only stage-local price
  artifacts in this directory.
- If multiple providers are used, normalize them into this per-hotel contract
  before the output stage consumes them.
- Stage 6 currently ignores `sample_attempts`; they are stored for stage-5
  backfill and retry behavior rather than app display.
