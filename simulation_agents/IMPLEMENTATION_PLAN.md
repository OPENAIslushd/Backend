# Implementation plan

## Decisions

- Node.js 24, ES modules, the built-in HTTP server, Ajv JSON Schema validation, and built-in `node:sqlite` for memory. No Python or external AI provider dependency.
- Four independent container processes. Astra alone routes messages and approves writes.
- Deterministic generation of 100–200 candidates; repeated numerical scenarios with delayed observations and paired fixed controls.
- Versioned JSON contracts and immutable evaluation hashes; SQLite transactions, scoped idempotency keys, optimistic record revisions, and retained snapshots.

## Delivery status

- [x] Record architectural boundaries and implementation-only rules in root AGENTS.md.
- [x] Implement contracts, shared validation, authenticated HTTP boundary and error envelopes.
- [x] Implement strategy generation and explicit diversity/assumption labels.
- [x] Implement numerical simulation, delayed feedback, budget adaptation and paired controls.
- [x] Implement recommendation preparation, selection snapshots and observed-result comparisons.
- [x] Implement persistent, scoped memory with idempotent writes and retained revisions.
- [x] Add four Dockerfiles and Compose configuration with persistent memory volume.
- [x] Write contract, behavioral, HTTP, persistence and container-handoff tests.
- [x] Write GitHub Actions pull-request pipeline and permanent integration documentation.
- [ ] Execute hosted checks and review their results after the user opens a pull request.
- [ ] Review and commit the dependency lock emitted by the first hosted run; switch installs to `npm ci` once committed.

The checked boxes mean files were implemented, not that runtime checks passed. No application code, tests, installs, builds or containers were executed locally. Research, real/demo business data, calibration, deployment, UI implementation, and Astra's orchestration/audit/retry logic remain outside this repository's MVP scope.
