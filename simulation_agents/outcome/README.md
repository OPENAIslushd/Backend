# Outcome service

Answers `outcome.prepare`, `outcome.select` and `outcome.observe`. Entry point: `node outcome/server.js`; required `SERVICE_TOKEN`, optional `PORT` (8080). It proposes writes and never accesses SQLite or calls memory. See [contracts](../contracts/README.md).

Preparation validates the immutable evaluation ID and ranks conservative, balanced and upside-focused recommendations using explicit profit/risk formulas. Every recommendation must allocate at least 15% of budget differently from every earlier choice. Fewer distinct candidates produce an honest incomplete status. UI output retains metrics, fixed counterparts, tradeoffs, definitions, assumptions and synthetic-data warnings. Risk labels are preferences, not safety guarantees or a promised ordering of realized risk/return.

Selection must identify an exact recommendation and revision in the supplied evaluation. The caller supplies a stable selection ID and UTC selection timestamp. Outcome proposes a revision-1 record preserving input, strategy, simulation identity/settings, assumptions and predictions, with unknown actuals/comparison set to null. The Orchestrator audits and sends the proposed payload to memory.

Observation takes a current selected record and a cumulative actual snapshot. It computes actual profit/ROI/acquisition cost and only compares predictions when actual results are final and use the same attribution horizon. Partial results preserve actual metrics but null comparison deltas. Zero denominators produce null ratios. The proposal includes the record's expected revision. Memory independently verifies the comparison and persistence conditions. No observation automatically tunes models or declares a campaign successful.
