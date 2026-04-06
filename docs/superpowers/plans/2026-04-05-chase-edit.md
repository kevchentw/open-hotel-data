# Add Chase Edit Plan From Award Helper `csr-hotels`

## Summary

Implement `Chase Edit` as a new plan sourced from Award Helper’s Chase page, but scope v1 to only hotels where `chase_2026_credit=TRUE` on [awardhelper.com/csr-hotels](https://www.awardhelper.com/csr-hotels). That yields about 169 hotels today. Ship this as a fallback-first integration: stage 1 ingestion, stage 4/6 source support, and frontend visibility, without a new TripAdvisor matcher in v1.

## Key Changes

- Add a new stage-1 collector:
  - New source slug: `chase_edit`
  - New script: `data-pipeline/1-list/scripts/chase-edit.mjs`
  - New output: `data-pipeline/1-list/chase-edit-hotel.json`
  - Read the embedded hotel payload from the page HTML rather than scraping DOM rows.
  - Filter records to `chase_2026_credit === "TRUE"` only.
  - Use Award Helper `id` as `source_hotel_id`.
  - Build `url` as `https://travelsecure.chase.com/details/hotels/deeplink/<id>`.
  - Map fields as:
    - `name` from `name`
    - `address_raw` from `address`
    - `city` from `city`
    - `state_region` from `state`
    - `country` normalized from ISO-like codes to display names where possible
    - `brand` from `brand`
    - `latitude` / `longitude` from source payload
    - `plan` fixed to `Chase Edit`
    - `chain` inferred via the existing brand-chain helper
  - Keep extra source-native fields in stage 1 for future use and auditing:
    - `michelin_keys`
    - `chase_2026_credit`
    - `source_rating`
    - `added_date`

- Wire the new source into canonical assembly without adding stage 2 or stage 3:
  - Add `chase_edit` to `SOURCE_CONFIGS` in stage 4 with:
    - required stage-1 file
    - optional missing stage-2 file
    - optional missing stage-3 file
  - Treat Chase Edit like the other sources for unmatched fallback output.
  - Add `chase_url` as a first-class source URL field in stage 4 and stage 6 alongside `amex_url`, `hilton_url`, and `iprefer_url`.
  - Preserve `plans: ["chase_edit"]` for unmatched records and canonical records when future matching is added.

- Expose the plan in the frontend:
  - Add a new bucket in `src/main.js` for `edit` with label `Edit`, plans `["chase_edit"]`, and copy that makes clear this is the Chase Edit subset currently supported from the 2026 stack source.
  - Add `chase_edit: "Edit"` to `PLAN_LABELS`.
  - Add `chaseUrl` to normalized frontend hotel objects and render a `Chase` outbound button in the detail actions.
  - Update bucket selection and bucket-priority logic to recognize `chase_edit`.
  - Generalize the non-iPrefer price summary copy so it is no longer Hilton-specific, and hide that summary block when no summary price exists. Chase Edit should show as price-pending rather than a misleading Hilton price section.

- Add repo plumbing and docs:
  - Add `pipeline:stage1:chase-edit` to `package.json`.
  - Update root README and pipeline stage docs/examples to list `Chase Edit` as a supported stage-1 source and `chase_edit` as a plan/source slug.
  - Document that v1 uses Award Helper as the upstream source and currently includes only hotels flagged for the 2026 Chase stack.

## Public Interface Changes

- New plan/source slug: `chase_edit`
- New app-facing hotel field: `chase_url`
- New stage-1 artifact: `data-pipeline/1-list/chase-edit-hotel.json`
- New npm script: `pipeline:stage1:chase-edit`

## Test Plan

- Stage-1 collector test or fixture-based check:
  - Parses the embedded hotel payload from the page HTML.
  - Filters to only `chase_2026_credit=TRUE`.
  - Produces stable records keyed by Award Helper `id`.
  - Correctly builds Chase deep-link URLs.

- Pipeline integration checks:
  - Stage 4 succeeds when Chase Edit has no stage-2 or stage-3 file.
  - Chase Edit records appear in `fallback_hotels` after stage 6.
  - Exported app JSON includes `plans` containing `chase_edit` and includes `chase_url`.

- Frontend behavior checks:
  - New `Edit` bucket appears with counts.
  - Edit hotels can be searched, filtered, and opened in detail view.
  - Detail view shows the `Chase` outbound button.
  - No Hilton-specific price wording appears for Chase Edit hotels.
  - Hotels with no prices render cleanly as pending.

## Assumptions And Defaults

- `Chase Edit` in v1 means only the Award Helper records where `chase_2026_credit` is true, not the full 1400+ embedded Edit inventory.
- No stage-2 enrichment script is added in v1 because the source payload already includes address and coordinates sufficient for first display.
- No stage-3 TripAdvisor matcher is added in v1; Chase Edit hotels will mostly enter the app through fallback records first.
- Country values should be normalized to user-friendly names when the source gives short codes, to keep frontend filters and labels consistent with existing plans.
- The Award Helper hotel `id` is treated as the stable upstream identifier for `source_hotel_id` unless the source format changes.

