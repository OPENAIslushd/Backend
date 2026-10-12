# Contract integration reference

Share these **two files together** with Astra and UI developers:

1. `astra-request.schema.json`: every accepted service action plus reusable input, strategy, evaluation, record, actual and comparison definitions.
2. `ui-response.schema.json`: the `data` field returned by `outcome.prepare`. It references definitions in the first schema.

Both use JSON Schema draft-07, contract version `1.0`, and stable logical `$id` values. The `simulation-agents.local` URLs are schema identifiers, not network endpoints. Load/register both documents in the validator; do not fetch those URLs. Ajv in `shared/contracts.js` is the reference integration. Unknown properties are rejected. Optional means omitted; `null` is allowed only where explicitly declared. Defaults are applied in service code, not by mutating incoming requests.

## Required request envelope

| Field | Meaning |
| --- | --- |
| `contract_version` | Exactly `1.0` |
| `request_id` | Caller-chosen ID for one HTTP attempt; echoed back |
| `run_id` | Campaign generation/evaluation run; preserved through selection and actual updates |
| `action` | One of the eight versioned action names |
| `payload` | Action-specific object; see the schema and permanent README action table |

All IDs are 1–120 characters, start with an alphanumeric, and otherwise contain alphanumerics, `_`, `.`, `:`, or `-`. Use different run IDs for different campaigns. Business/product IDs are mandatory even when there is only one demo product. Revisions are positive integers. Timestamps are actual UTC dates with seconds and optional three-digit milliseconds, such as `2026-10-01T12:00:00Z`. Nonexistent dates are rejected semantically.

## Input and strategy fields

Every `input` field is required except `context`. A complete valid request is [the synthetic fixture](../test/fixtures/generate-request.json).

| Fields | Units and interpretation |
| --- | --- |
| `business_id`, `product_id`, `product_label` | Explicit scope and product display label |
| `audience`, `region` | Caller-supplied text; not inferred business facts |
| `objective`, `duration_days` | Exactly `purchases` and 30 in this MVP |
| `budget`, `currency` | 1–1,000,000,000 currency units; uppercase three-letter currency code |
| `unit_contribution` | Contribution per purchase after variable costs, before advertising; same currency |
| `data_provenance` | `synthetic`, `user_supplied`, or `measured`; a caller assertion retained in outputs |
| `assumptions` | Required nonempty list of explicit assumptions |
| `context` | Optional curated text, at most 10,000 characters; deterministic generator does not interpret prose as executable instructions |
| `channels` | Required `paid_social`, `paid_search`, `influencer` assumption objects |

Each channel requires cost per click in currency/click, a baseline conversion probability per click (0–1, greater than zero), a positive daily saturation spend in currency/day, nonnegative fatigue per elapsed day, an integer conversion delay of 0–7 days, and nonnegative relative standard deviations for scenario-level cost and conversion rates. Unknown inputs cannot be represented as null; Astra must supply explicit assumptions instead of implying missing numbers are known facts.

Generated strategy objects carry scope, run, stable strategy ID, revision, name, generator label, budget/currency/objective, audience/region, days 1–30, initial channel fractions summing to one, creative approach, assumption list and an adaptation object. Adaptation requires `enabled`, checkpoint period exactly 3 days, a maximum transfer fraction from 0 to 0.2, minimum clicks and matured purchases per channel, and a per-channel exploration floor from 0.05 to 0.2. Initial allocations must meet that floor. Default generated thresholds are 30 or 60 clicks and 3 matured purchases, with floor 0.1. `astra_supplied` candidates are accepted by simulation under the same invariants.

`strategy.generate` optional fields: `candidate_count` defaults to 150 (100–200), `seed` to 42, `revision` to 1. Seeds are integers from 0 to 2,147,483,647. The same task/seed/revision/run yields the same candidates. Candidate IDs remain stable across requested revisions of the same task/seed/run; changed input gets new IDs.

`simulation.evaluate` requires input and 1–200 approved candidates. Optional `scenario_count` defaults to 100 (20–500), seed to 42. Its response data matches `#/definitions/evaluation`. Evaluation IDs hash the entire evaluation content other than the ID itself. Outcome verifies this hash against accidental mutation; it is **not a signature or an authorization mechanism**. Model version is currently `numerical-mvp-1.0.0`.

## Metrics and UI

UI consumers render the outcome data object directly; do not present the transport wrapper as recommendation data. The UI schema requires scope, run, evaluation/model IDs, currency/provenance, status, one to three recommendations, warnings, definitions and assumptions. Recommendation strategy objects retain exact selection identifiers and revisions.

Each recommendation includes `metrics` for the submitted adaptive policy, `fixed_metrics` for its no-adaptation counterpart, paired profit differences, reasons and tradeoffs. If the submitted policy disables adaptation both metrics are identical. `expected_purchases` is an average and may be fractional. Spend, profit, standard deviation and profit percentiles use currency units. ROI is a ratio (0.25 means 25%). Acquisition cost is currency/purchase. Loss probability is a fraction from 0–1. Profit deltas are adaptive minus fixed under paired scenarios.

`acquisition_cost` is null when expected purchases are zero; any ratio with a zero denominator is null. A zero value is a measured/modelled zero, not missing information. UI status `insufficient_distinct_candidates` means fewer than three distinct options were returned. Never invent absent choices. The static [UI example](examples/ui-insufficient.json) illustrates this valid fallback and uses invented round numbers solely to explain the format; it is not a simulator run or business evidence.

## Selection and observation writes

`memory.retrieve` returns the last ten selected records for the required business/product scope. Its optional `selection_id` requests one exact current record instead, so Astra can prepare observation updates for older campaigns. A scoped miss returns an empty `records` array; a supplied ID never bypasses business/product filtering.

Selection requires the complete immutable evaluation and exact strategy ID/revision **from its recommendation set**, plus caller-assigned `selection_id` and `selected_at`. The returned proposed record starts at `record_revision: 1`, `selection_kind: user_selected`, `actual: null` and `comparison: null`. Only Astra's subsequent `memory.save_selection` writes it.

An actual snapshot requires all of: unique `observation_id`, `observed_at`, textual source, status (`partial` or `final`), attribution end day (integer day relative to campaign start), cumulative spend, cumulative integer purchases, observed contribution per purchase and currency. Observations can exceed planned budget; they describe what happened. Currency must match the saved input. An observation cannot precede selection or move an existing observation's timestamp/horizon backwards. Final cannot be downgraded to partial. Corrections use a new observation ID; historical snapshots are retained.

Outcome returns a proposed `memory.update_actual` payload with business/product/selection identity, an idempotency key, the supplied record's `expected_revision`, actuals and computed comparison. Astra passes it through after audit. Memory checks current revision, recalculates the comparison and commits atomically. HTTP 409 requires Astra to resolve a conflict; these services do not implement retry policy.

Comparisons include `comparable`, a reason, actual contribution profit/ROI/acquisition cost, observed-minus-predicted purchases/profit/ROI, and purchases/profit relative errors. Differences are null unless results are final and attribution horizons match. Relative error is `(actual − prediction) / abs(prediction)` and is null when prediction is zero. Actual metrics remain available even when forecast comparison is inappropriate.

## Concrete end-to-end examples

[The container client test](../test/container/handoffs.test.js) shows every complete payload assembled from real prior service responses. [Contract tests](../test/contracts.test.js) construct and validate all eight action envelopes; [helpers](../test/helpers.js) provide full synthetic selection and observation examples. These are client examples only; neither service-to-service routing nor Astra's audits are implemented.
