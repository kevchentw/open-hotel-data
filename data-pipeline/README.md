# Data Pipeline

`data-pipeline/` is the long-term workflow for building hotel data in staged JSON
artifacts before exporting app-facing files.

This document now serves two jobs:

- define the intended logical pipeline
- document the current migration, because some folder names still reflect the older stage numbering

## Goals

- keep source collection, source-native enrichment, identity matching, canonicalization, and export separate
- preserve source-truth records before any cross-plan merging happens
- make reruns idempotent by backfilling missing enrichment unless force-refresh is enabled
- keep stage boundaries clear so each script reads prior artifacts and writes only its own outputs
- let README contracts drive implementation instead of implicit assumptions in scripts

## Logical Stage Flow

The intended logical order is:

1. `1-list`
2. `2-enrichment`
3. `3-tripadvisor`
4. `4-unique`
5. `5-price`
6. `6-geo`
7. `7-output`

Each stage owns one step:

- `1-list`: collect source-truth hotel rows from list pages and other source entrypoints
- `2-enrichment`: visit source-native detail pages and attach richer source-specific metadata
- `3-tripadvisor`: attach TripAdvisor matches and related identity metadata
- `4-unique`: build the canonical hotel registry keyed by `tripadvisor_id`
- `5-price`: attach price snapshots to canonical hotels
- `6-geo`: attach geo normalization and confidence metadata
- `7-output`: assemble final exports for pipeline and app consumers

## Current Repo Layout

The current repository still contains older directory names and partial stage docs:

- `1-list`
- `2-enrichment`
- `3-tripadvisor`
- `4-price`
- `5-geo`
- `5-unique`
- `6-output`

Interpret this as an in-progress migration, not as the final numbering scheme.

Practical reading rule:

- use the logical stage flow above for planning
- use the existing directory names when referring to files that already exist in the repo

## Why The New Stage 2 Exists

The new enrichment stage is meant to sit between raw list collection and
cross-source identity matching.

That stage should capture source-native detail such as:

- detail-page address cleanup
- amenity coverage
- lowest public price shown on the source site
- source-specific ratings or review counts
- special tags such as newly built
- extra geo hints or map coordinates from the source itself

Keeping this separate prevents TripAdvisor matching from becoming a catch-all
enrichment step and makes later matching more reliable.

## Directory Contract

- `data-pipeline/<stage>/README.md`: contract for that stage
- `data-pipeline/<stage>/*.mjs`: stage-local scripts
- `data-pipeline/<stage>/*.json`: stage artifacts, fixtures, or examples
- `data-pipeline/shared/`: shared normalization, matching, parsing, and serialization helpers

Expected ownership rules:

- one entry script per stage when possible
- stage scripts read only the required upstream artifacts plus approved external inputs
- stage scripts write only that stage's outputs
- stage-specific helpers stay inside the stage directory unless they are clearly reusable

## Data Model Rules

### Identity

- stage 1 preserves source identity with `source_hotel_id`
- stage 2 enriches the same source rows without canonicalizing them
- stage 3 discovers `tripadvisor_id`
- stage 4 and later use `tripadvisor_id` as the canonical hotel key when a reliable match exists
- hotels without a reliable TripAdvisor match remain in `unmatched`; v1 does not invent synthetic canonical IDs

### Idempotency

- stage 1 may refresh source-truth files on rerun because source pages change
- stages 2, 3, 5, and 6 should backfill missing enrichment by default
- force-refresh mode may intentionally overwrite existing enrichment and timestamps
- stage 4 should rebuild the canonical registry deterministically from upstream artifacts
- stage 7 should be a pure assembly and export step

### Output Philosophy

- intermediate stages should prefer JSON keyed by stable identifiers
- canonical outputs must remain traceable back to source rows
- app-facing exports are derived outputs, not the source of truth

## v1 Contracts

### Stage 1: List Collection

- Inputs: source collectors such as Amex FHR, Amex THC, Chase Edit, Hilton Aspire
- Outputs: one JSON file per source or plan keyed by `source_hotel_id`
- Required fields: `source`, `source_hotel_id`, `name`, `address_raw`, `city`, `state_region`, `country`, `url`, `plan`, `brand`, `chain`, `latitude`, `longitude`, `collected_at`
- Constraint: preserve source truth; do not dedupe here

### Stage 2: Source Enrichment

- Inputs: stage-1 per-plan JSON plus source-native detail pages or approved source files
- Outputs: one JSON file per source or plan keyed by `source_hotel_id`
- Typical fields: `amenities`, `source_rating`, `source_review_count`, `lowest_public_price`, `detail_address`, `detail_latitude`, `detail_longitude`, `tags`, `enriched_at`
- Constraint: add detail to source rows without cross-source identity decisions

### Stage 3: TripAdvisor Match

- Inputs: stage-1 hotel records plus stage-2 enrichment where helpful for search quality
- Outputs: one JSON file per source or plan keyed by `source_hotel_id`
- Required fields: `tripadvisor_id`, `tripadvisor_url`, `search_query`, `match_confidence`, `matched_at`
- Constraint: backfill missing TripAdvisor data unless force-refresh is enabled

### Stage 4: Unique Canonical Registry

- Inputs: stage-1 hotel records, stage-2 enrichment, and stage-3 TripAdvisor matches
- Outputs:
  - canonical `hotels` keyed by `tripadvisor_id`
  - `links` keyed by `source + source_hotel_id`
  - `unmatched` records for unresolved hotels
- Constraint: unresolved records remain unmatched; no silent synthetic canonical IDs in v1

### Stage 5: Price

- Inputs: canonical hotels from stage 4
- Outputs: one price-history JSON file per canonical hotel
- Required fields: `tripadvisor_id` in metadata plus date-keyed history entries containing `currency`, `fetched_at`, `source`, and `cost`
- Constraint: prices attach to canonical hotels, not raw plan-only rows

### Stage 6: Geo

- Inputs: canonical hotels from stage 4 and approved geo input files
- Outputs: geo enrichment keyed by `tripadvisor_id`
- Required fields: `latitude`, `longitude`, `formatted_address`, `geo_provider`, `geo_confidence`, `geo_status`, `updated_at`
- Constraint: backfill only missing geo by default

### Stage 7: Output

- Inputs: stages 4, 5, and 6
- Outputs:
  - canonical hotel JSON for pipeline consumers
  - app-facing JSON derived from canonical records
- Constraint: final output must merge identity, plan membership, TripAdvisor, price, geo, and source enrichment into a coherent export layer

## Suggested Run Flow

Example target workflow:

```bash
node data-pipeline/1-list/scripts/amex.mjs
# node data-pipeline/2-enrichment/<source>.mjs
# node data-pipeline/3-tripadvisor/search.mjs
# node data-pipeline/4-unique/build.mjs
# node data-pipeline/5-price/fetch.mjs
# node data-pipeline/6-geo/backfill.mjs
# node data-pipeline/7-output/export.mjs
```

The exact script names may change during migration, but the stage intent should remain stable.

## Completion Criteria

The pipeline is ready when:

- stage docs are sufficient to implement scripts without filling in missing product decisions
- outputs are deterministic and traceable
- reruns are safe and mostly backfill-only
- unresolved matches stay explicit
- the final output stage can reproduce app-facing exports from canonical artifacts
