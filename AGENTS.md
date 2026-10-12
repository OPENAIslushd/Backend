# Repository instructions

- Implement and edit files only. Do not run application code, tests, dependency installation, builds, or containers on the user's system. Read-only file inspection is allowed. Tests run on GitHub-hosted runners after the user opens a pull request. Report checks as unrun until CI evidence exists.
- Use Node.js (JavaScript ES modules) and SQLite. Do not introduce Python.
- Astra is external and owns routing, audits, retries, revisions, and reruns. Do not implement Astra or call another service from service code.
- Services are `memory`, `strategy`, `simulation`, and `outcome`, under `simulation_agents/`. Shared utilities belong in `simulation_agents/shared/`.
- Memory alone owns persistent storage. Outcome proposes records; Astra sends approved writes to memory. Strategy only receives self-contained tasks, never queries memory.
- Scope history by both business and product; return the last ten user-selected records. Keep predictions, selections, and actual observations distinct.
- Preserve versioned contracts, request/run/strategy identifiers and revisions. Idempotent retries must not duplicate memory records or overwrite conflicting revisions.
- Keep assumptions explicit, label synthetic fixtures and deterministic generation, prevent future-result leakage, and conserve campaign budget.
- Service code/documentation stay in their service folders; tests/fixtures in `simulation_agents/test/`; workflows in repository-root `.github/workflows/`.
- Keep the permanent README sufficient to operate and integrate the system without the implementation plan.
