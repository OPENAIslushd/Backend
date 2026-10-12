# Simulation service

Answers `simulation.evaluate` and returns an immutable evaluation containing per-candidate adaptive and fixed metrics. Entry point: `node simulation/server.js`; required `SERVICE_TOKEN`, optional `PORT` (8080). See [contracts](../contracts/README.md).

Default: 100 scenarios with seed 42. Accepted range: 20–500 scenarios and 1–200 approved strategies. The evaluator enforces matching scope, run, budget, currency, audience/region and allocation totals, and rejects duplicate strategy ID/revision pairs.

The day-by-day model uses channel cost/conversion uncertainty, shared market uncertainty, diminishing returns, creative fatigue and delayed purchase attribution. Purchases use a bounded normal approximation to binomial counts. These are explicit MVP assumptions, not a calibrated forecasting model. The permanent README describes all formulas and limitations; the evaluation repeats the assumptions for downstream users.

At every eligible checkpoint, the adaptive policy only sees accumulated spend/clicks and purchases whose delays have elapsed. It requires minimum evidence in every channel, moves at most the configured fraction of remaining budget, and preserves a channel exploration reserve. Scenario arrays are exogenous; the policy never reads future entries or pending conversions. Late outcomes are tallied after all spending decisions.

Fixed and adaptive counterparts use the same scenario conditions and random purchase shocks. Seeds depend on scenario/channel/day, not candidate order or branch decisions. The fixed counterpart disables transfers. Budget is spent in full by day 30; final purchases include the attribution delay. Output includes mean and tail profits, purchase counts, ROI, acquisition cost, loss frequency and paired profit deltas.

Internal `simulatePath(..., true)` trace support is for tests and exposes observed checkpoint evidence; the public API returns compact summaries. Evaluation IDs hash the full immutable body and bind predictions to input, scenario settings, model version and exact strategy revisions. They are content checksums, not cryptographic attestations of business truth.
