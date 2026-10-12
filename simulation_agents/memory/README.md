# Memory service

Owns SQLite and answers the Orchestrator's `memory.retrieve`, `memory.save_selection`, and `memory.update_actual`. It does not call outcome or any other service. See the [permanent system README](../README.md) and [contracts](../contracts/README.md) for complete wire formats.

Run entry point: `node memory/server.js`. Required environment: `SERVICE_TOKEN` (at least 16 characters). Optional `PORT` defaults to 8080; `MEMORY_DB_PATH` defaults to `/data/memory.sqlite`. Docker prepares `/data` for the non-root Node user and Compose mounts `memory-data` there.

Retrieval requires business and product. With no selection ID it returns the ten latest **user-selected** records by selection timestamp; an optional `selection_id` fetches the current version of one older record. No match returns an empty list. Actual updates do not reorder history.

`selections` stores current linked records, `record_versions` preserves revision snapshots, `idempotency` stores scoped request hashes and responses, and `schema_version` identifies database version 1. Writes acquire `BEGIN IMMEDIATE`; selection/update, version snapshot and retry receipt commit together. A busy timeout of five seconds is used. Application SQL uses bound parameters.

New selections must be revision 1 and have no actuals/comparison. Exact selected run/strategy/revision duplicates are rejected even with another selection ID. A replay of original content returns its original snapshot. Observations need an existing selected record, matching currency/run/scope, a valid timestamp, a fresh revision, and a consistent proposed comparison. Reusing an observation ID with different content is a conflict. Corrected final snapshots use a new ID and remain final; previous snapshots are retained.

This is single-instance SQLite storage. Keep the Docker volume durable and back up consistently. There is no automatic pruning, schema migration beyond initial version 1, or public revision-list endpoint. SQLite failures become an internal-error response; retry decisions belong to the Orchestrator.
