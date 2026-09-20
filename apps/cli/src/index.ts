import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { deriveFindings, parseEvent, type VeyrEvent } from '@veyr/core';
import { renderHtmlReport, type ReportLanguage } from '@veyr/report';
import { installHooks, normalizeCodexHook, probeCodex, uninstallHooks, writeSpoolItem } from '@veyr/codex-adapter';

const workspaceRoot = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const cliPath = fileURLToPath(import.meta.url);
const stateRoot = resolve(process.env.VEYR_HOME ?? join(process.cwd(), '.veyr'));
const dbPath = join(stateRoot, 'veyr.db');
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSyncType };

function usage(): void {
  console.log(`Veyr — local evidence reports for coding-agent events

Usage:
  veyr demo [--lang <lang>]  Import the included fixture and render a report (default: zh-CN)
  veyr import <events.jsonl> Import JSONL events into local SQLite
  veyr report [--lang <lang>] Render HTML and JSON from local SQLite (zh-CN or en)
  veyr doctor                Print local runtime and storage status
  veyr install               Install experimental Codex hooks for this project
  veyr uninstall             Remove Veyr hooks from this project
`);
}

async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }

async function doctor(project = process.cwd()): Promise<boolean> {
  const probe = await probeCodex(project, cliPath);
  console.log(`Veyr doctor — Codex\n\n${probe.version ? `✓ Codex CLI found: ${probe.version}` : '✗ Codex CLI was not found'}\n${probe.eligible ? '✓ Version meets stable hooks minimum: >= 0.124.0' : `✗ ${probe.reason}`}\n${probe.cliExists ? '✓ Veyr CLI build found' : '✗ Veyr CLI build is missing'}\n${probe.hookFileExists ? `• Existing project hooks: ${probe.hookPath}` : '• No project hooks.json yet'}\n\n${probe.eligible ? 'Ready for experimental project-level collection. Run: veyr install' : 'Live collection was not installed; offline import remains available.'}`);
  return probe.eligible;
}

async function install(project = process.cwd()): Promise<void> {
  const manifest = await installHooks(project, cliPath, stateRoot);
  console.log(`Installed Veyr hooks in ${manifest.hookPath}. Open /hooks in Codex and explicitly trust the new Veyr definitions before they run.`);
}

async function uninstall(project = process.cwd()): Promise<void> {
  void project; await uninstallHooks(stateRoot); console.log('Removed Veyr hook entries from the installed project configuration.');
}

async function shim(): Promise<void> {
  const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks); if (raw.length > 256_000) return;
  const payload: unknown = JSON.parse(raw.toString('utf8')); if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Hook payload must be an object.');
  await writeSpoolItem(join(stateRoot, 'spool'), payload as Record<string, unknown>);
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

function parseLanguage(arguments_: string[]): ReportLanguage {
  const languageIndex = arguments_.indexOf('--lang');
  const language = languageIndex === -1 ? 'zh-CN' : arguments_[languageIndex + 1];
  if (language !== 'zh-CN' && language !== 'en') throw new Error('Unsupported language. Use --lang zh-CN or --lang en.');
  return language;
}

async function renderReport(language: ReportLanguage = 'zh-CN'): Promise<void> {
  const spool = join(stateRoot, 'spool');
  if (await exists(spool)) {
    for (const name of await readdir(spool)) {
      const item = JSON.parse(await readFile(join(spool, name), 'utf8')) as { capturedAt: string; payload: Record<string, unknown> };
      const event = normalizeCodexHook(item, name);
      const db = await openDatabase(); db.prepare('INSERT OR REPLACE INTO events (id,host,session_id,task_id,agent_id,tool_name,status,occurred_at,duration_ms,content_bytes,message,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(event.id,event.host,event.sessionId,event.taskId ?? null,null,event.toolName ?? null,event.status,event.occurredAt,null,event.contentBytes ?? null,null,event.source); db.close();
      await rm(join(spool, name));
    }
  }
  const db = await openDatabase();
  const events = readEvents(db);
  db.close();
  const report = { generatedAt: new Date().toISOString(), events, findings: deriveFindings(events) };
  const reportDirectory = join(stateRoot, 'reports');
  await mkdir(reportDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(reportDirectory, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(reportDirectory, 'latest.html'), renderHtmlReport(report, language)),
  ]);
  console.log(`Wrote ${join(reportDirectory, 'latest.html')} and latest.json (${language})`);
}

async function main(): Promise<void> {
  const [command, argument, ...options] = process.argv.slice(2);
  switch (command) {
    case 'demo': await importFixture(join(workspaceRoot, 'fixtures', 'demo-events.jsonl')); await renderReport(parseLanguage([argument, ...options].filter((value): value is string => Boolean(value)))); break;
    case 'import': if (!argument) throw new Error('Provide a JSONL path: veyr import <events.jsonl>'); await importFixture(resolve(argument)); break;
    case 'report': await renderReport(parseLanguage([argument, ...options].filter((value): value is string => Boolean(value)))); break;
    case 'doctor': await doctor(); break;
    case 'install': await install(); break;
    case 'uninstall': await uninstall(); break;
    case 'shim': await shim(); break;
    case '--help': case '-h': case undefined: usage(); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
