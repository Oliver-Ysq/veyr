import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { deriveFindings, parseEvent, type VeyrEvent } from '@veyr/core';
import { renderHtmlReport } from '@veyr/report';

const workspaceRoot = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const stateRoot = resolve(process.env.VEYR_HOME ?? join(process.cwd(), '.veyr'));
const dbPath = join(stateRoot, 'veyr.db');
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSyncType };

function usage(): void {
  console.log(`Veyr — local evidence reports for coding-agent events

Usage:
  veyr demo                  Import the included offline fixture and render a report
  veyr import <events.jsonl> Import JSONL events into local SQLite
  veyr report                Render HTML and JSON from local SQLite
  veyr doctor                Print local runtime and storage status
`);
}

async function openDatabase(): Promise<DatabaseSyncType> {
  await mkdir(stateRoot, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, host TEXT NOT NULL, session_id TEXT NOT NULL, task_id TEXT,
    agent_id TEXT, tool_name TEXT, status TEXT NOT NULL, occurred_at TEXT NOT NULL,
    duration_ms INTEGER, content_bytes INTEGER, message TEXT, source TEXT NOT NULL
  ) STRICT;`);
  return db;
}

async function importFixture(file: string): Promise<void> {
  const raw = await readFile(file, 'utf8');
  const events = raw.split('\n').filter(Boolean).map((line) => parseEvent(JSON.parse(line)));
  const db = await openDatabase();
  const insert = db.prepare(`INSERT OR REPLACE INTO events
    (id, host, session_id, task_id, agent_id, tool_name, status, occurred_at, duration_ms, content_bytes, message, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  try {
    for (const event of events) insert.run(event.id, event.host, event.sessionId, event.taskId ?? null, event.agentId ?? null, event.toolName ?? null, event.status, event.occurredAt, event.durationMs ?? null, event.contentBytes ?? null, event.message ?? null, event.source);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
  console.log(`Imported ${events.length} event(s) from ${basename(file)} into ${dbPath}`);
}

function readEvents(db: DatabaseSyncType): VeyrEvent[] {
  return db.prepare('SELECT * FROM events ORDER BY occurred_at ASC').all().map((row) => ({
    id: String(row.id), host: row.host as VeyrEvent['host'], sessionId: String(row.session_id),
    taskId: row.task_id ? String(row.task_id) : undefined, agentId: row.agent_id ? String(row.agent_id) : undefined,
    toolName: row.tool_name ? String(row.tool_name) : undefined, status: row.status as VeyrEvent['status'],
    occurredAt: String(row.occurred_at), durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : undefined,
    contentBytes: typeof row.content_bytes === 'number' ? row.content_bytes : undefined,
    message: row.message ? String(row.message) : undefined, source: String(row.source),
  }));
}

async function renderReport(): Promise<void> {
  const db = await openDatabase();
  const events = readEvents(db);
  db.close();
  const report = { generatedAt: new Date().toISOString(), events, findings: deriveFindings(events) };
  const reportDirectory = join(stateRoot, 'reports');
  await mkdir(reportDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(reportDirectory, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(reportDirectory, 'latest.html'), renderHtmlReport(report)),
  ]);
  console.log(`Wrote ${join(reportDirectory, 'latest.html')} and latest.json`);
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  switch (command) {
    case 'demo': await importFixture(join(workspaceRoot, 'fixtures', 'demo-events.jsonl')); await renderReport(); break;
    case 'import': if (!argument) throw new Error('Provide a JSONL path: veyr import <events.jsonl>'); await importFixture(resolve(argument)); break;
    case 'report': await renderReport(); break;
    case 'doctor': console.log(JSON.stringify({ node: process.version, stateRoot, database: dbPath, mode: 'offline-fixture-only' }, null, 2)); break;
    case '--help': case '-h': case undefined: usage(); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
