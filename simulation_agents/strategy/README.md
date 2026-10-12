# Strategy service

Answers `strategy.generate` using a complete Orchestrator-supplied `input`. It never retrieves memory or accepts raw history. Entry point: `node strategy/server.js`; required `SERVICE_TOKEN`, optional `PORT` (8080). See [contracts](../contracts/README.md).

The generator is explicitly deterministic (`deterministic-diversity-v1`), with a default population of 150 and supported range 100–200. It includes channel-heavy and nearly even anchors and seeded continuous allocation samples, always preserving a 10% initial exploration floor. Three creative approaches and different transfer/evidence thresholds produce additional modeled variation. This is not an LLM client or a claim of AI-generated strategy.

Creative labels: `proof` (evidence/testimonials), `discovery` (awareness-led discovery), `offer` (purchase offer). The simulator applies disclosed illustrative multipliers. Audience, region, fixed budget, purchase objective and days 1–30 come from the task. Prose `context` is preserved in input and influences deterministic task identity, but is not parsed into marketing instructions. Richer natural-language planning can replace this generator without changing the Orchestrator's ownership.

IDs hash run/input/seed/candidate index. Requested revisions preserve IDs for that same task and increase the explicit revision. Changing the task or seed produces different identities. Exact requests are reproducible, independent of request ID. Outputs return to the Orchestrator for audit before simulation.
