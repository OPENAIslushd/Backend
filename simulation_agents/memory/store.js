import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { assert, digest, sameScope } from '../shared/core.js';
import { checkRecord, compareObservation } from '../shared/records.js';

export class MemoryStore {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_version VALUES (1);
      CREATE TABLE IF NOT EXISTS selections (
        business_id TEXT NOT NULL, product_id TEXT NOT NULL, selection_id TEXT NOT NULL,
        run_id TEXT NOT NULL, strategy_id TEXT NOT NULL, strategy_revision INTEGER NOT NULL,
        selected_at_ms INTEGER NOT NULL, revision INTEGER NOT NULL, original_hash TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY (business_id, product_id, selection_id),
        UNIQUE (business_id, product_id, run_id, strategy_id, strategy_revision)
      );
      CREATE INDEX IF NOT EXISTS selections_history ON selections (business_id, product_id, selected_at_ms DESC, selection_id DESC);
      CREATE TABLE IF NOT EXISTS record_versions (
        business_id TEXT NOT NULL, product_id TEXT NOT NULL, selection_id TEXT NOT NULL,
        revision INTEGER NOT NULL, observation_id TEXT, body TEXT NOT NULL,
        PRIMARY KEY (business_id, product_id, selection_id, revision),
        UNIQUE (business_id, product_id, selection_id, observation_id),
        FOREIGN KEY (business_id, product_id, selection_id) REFERENCES selections (business_id, product_id, selection_id)
      );
      CREATE TABLE IF NOT EXISTS idempotency (
        business_id TEXT NOT NULL, product_id TEXT NOT NULL, action TEXT NOT NULL, key TEXT NOT NULL,
        request_hash TEXT NOT NULL, response TEXT NOT NULL,
        PRIMARY KEY (business_id, product_id, action, key)
      );
    `);
    assert(this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get().version === 1, 'Unsupported database schema version', 'SCHEMA_VERSION', 500);
  }
  close() { this.db.close(); }
  handle(request) {
    const p = request.payload;
    if (request.action === 'memory.retrieve') {
      if (p.selection_id) {
        const row = this.db.prepare('SELECT body FROM selections WHERE business_id = ? AND product_id = ? AND selection_id = ?').get(p.business_id, p.product_id, p.selection_id);
        return { business_id: p.business_id, product_id: p.product_id, records: row ? [JSON.parse(row.body)] : [], limit: 1 };
      }
      const records = this.db.prepare(`SELECT body FROM selections WHERE business_id = ? AND product_id = ?
        ORDER BY selected_at_ms DESC, selection_id DESC LIMIT 10`).all(p.business_id, p.product_id).map(row => JSON.parse(row.body));
      return { business_id: p.business_id, product_id: p.product_id, records, limit: 10 };
    }
    const s = p.record ?? p;
    const hash = digest({ run_id: request.run_id, action: request.action, payload: p });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT request_hash, response FROM idempotency WHERE business_id = ? AND product_id = ? AND action = ? AND key = ?')
        .get(s.business_id, s.product_id, request.action, p.idempotency_key);
      let result;
      if (previous) {
        assert(previous.request_hash === hash, 'Idempotency key was already used with different content', 'IDEMPOTENCY_CONFLICT', 409);
        result = JSON.parse(previous.response);
      } else {
        if (request.action === 'memory.save_selection') result = this.saveSelection(p.record, request.run_id);
        else if (request.action === 'memory.update_actual') result = this.updateActual(p, request.run_id);
        else assert(false, 'Unsupported memory action');
        this.db.prepare('INSERT INTO idempotency VALUES (?, ?, ?, ?, ?, ?)').run(s.business_id, s.product_id, request.action, p.idempotency_key, hash, JSON.stringify(result));
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  saveSelection(record, runId) {
    checkRecord(record);
    assert(record.run_id === runId, 'Selection run must match request');
    assert(record.record_revision === 1 && record.actual === null && record.comparison === null, 'New selections must start at revision 1 without observations');
    const key = [record.business_id, record.product_id, record.selection_id];
    const existing = this.db.prepare('SELECT original_hash FROM selections WHERE business_id = ? AND product_id = ? AND selection_id = ?').get(...key);
    const hash = digest(record);
    if (existing) {
      assert(existing.original_hash === hash, 'Selection identifier already refers to different content', 'SELECTION_CONFLICT', 409);
      const original = this.db.prepare('SELECT body FROM record_versions WHERE business_id = ? AND product_id = ? AND selection_id = ? AND revision = 1').get(...key);
      return { record: JSON.parse(original.body) };
    }
    const duplicate = this.db.prepare('SELECT selection_id FROM selections WHERE business_id = ? AND product_id = ? AND run_id = ? AND strategy_id = ? AND strategy_revision = ?')
      .get(record.business_id, record.product_id, record.run_id, record.strategy.strategy_id, record.strategy.revision);
    assert(!duplicate, 'This exact run/strategy/revision has already been selected; reuse its selection_id', 'SELECTION_CONFLICT', 409);
    const body = JSON.stringify(record);
    this.db.prepare('INSERT INTO selections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(...key, record.run_id, record.strategy.strategy_id, record.strategy.revision, Date.parse(record.selected_at), 1, hash, body);
    this.db.prepare('INSERT INTO record_versions VALUES (?, ?, ?, ?, ?, ?)').run(...key, 1, null, body);
    return { record };
  }
  updateActual(payload, runId) {
    const key = [payload.business_id, payload.product_id, payload.selection_id];
    const row = this.db.prepare('SELECT body FROM selections WHERE business_id = ? AND product_id = ? AND selection_id = ?').get(...key);
    assert(row, 'Selection not found in this business/product scope', 'NOT_FOUND', 404);
    const current = JSON.parse(row.body);
    assert(current.run_id === runId && sameScope(current, payload), 'Observed update must reference the original scope and run');
    const comparison = compareObservation(current, payload.actual);
    assert(digest(comparison) === digest(payload.comparison), 'Proposed comparison is inconsistent with saved prediction and actual results');
    const previous = this.db.prepare('SELECT body FROM record_versions WHERE business_id = ? AND product_id = ? AND selection_id = ? AND observation_id = ?').get(...key, payload.actual.observation_id);
    if (previous) {
      const snapshot = JSON.parse(previous.body);
      assert(digest(snapshot.actual) === digest(payload.actual), 'Observation identifier already refers to different content', 'OBSERVATION_CONFLICT', 409);
      return { record: snapshot };
    }
    assert(current.record_revision === payload.expected_revision, 'Record changed; retrieve it and prepare a new update', 'REVISION_CONFLICT', 409);
    if (current.actual) {
      assert(Date.parse(payload.actual.observed_at) >= Date.parse(current.actual.observed_at), 'Observation timestamp cannot move backwards');
      assert(payload.actual.attribution_end_day >= current.actual.attribution_end_day, 'Observation horizon cannot move backwards');
      assert(current.actual.status !== 'final' || payload.actual.status === 'final', 'A final observation cannot be replaced by a partial observation');
    }
    const updated = { ...current, record_revision: current.record_revision + 1, actual: payload.actual, comparison };
    checkRecord(updated);
    const body = JSON.stringify(updated);
    this.db.prepare('UPDATE selections SET revision = ?, body = ? WHERE business_id = ? AND product_id = ? AND selection_id = ?').run(updated.record_revision, body, ...key);
    this.db.prepare('INSERT INTO record_versions VALUES (?, ?, ?, ?, ?, ?)').run(...key, updated.record_revision, payload.actual.observation_id, body);
    return { record: updated };
  }
}
