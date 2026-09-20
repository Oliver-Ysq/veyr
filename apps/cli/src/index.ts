import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { deriveFindings, parseEvent, projectTask, type VeyrEvent } from '@veyr/core';
import { renderHtmlReport, type ReportLanguage } from '@veyr/report';
import { installHooks, normalizeCodexHook, previewInstall, probeCodex, uninstallHooks, writeSpoolItem } from '@veyr/codex-adapter';

const workspaceRoot = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const cliPath = fileURLToPath(import.meta.url);
const stateRoot = resolve(process.env.VEYR_HOME ?? join(homedir(), '.veyr'));
const dbPath = join(stateRoot, 'veyr.db');
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSyncType };

function usage(): void {
  console.log(`Veyr — local evidence reports for coding-agent events

Usage:
  veyr demo [--lang <lang>]  Import the included fixture and render a report (default: zh-CN)
  veyr import <events.jsonl> Import JSONL events into local SQLite
  veyr report [--lang <lang>] Render HTML and JSON from local SQLite (zh-CN or en)
  veyr install [--yes]       Install experimental user-level Codex collection
  veyr status                Show collection status and privacy scope
  veyr uninstall             Remove Veyr-owned Codex collection entries
  veyr doctor                Print detailed, read-only compatibility diagnostics
`);
}

async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }

async function doctor(): Promise<boolean> {
  const probe = await probeCodex(cliPath);
  console.log(`Veyr doctor — Codex\n\n${probe.version ? `✓ Codex CLI found: ${probe.version}` : '✗ Codex CLI was not found'}\n${probe.eligible ? '✓ Version meets stable hooks minimum: >= 0.124.0' : `✗ ${probe.reason}`}\n${probe.cliExists ? '✓ Veyr CLI build found' : '✗ Veyr CLI build is missing'}\n${probe.hookFileExists ? `• Existing user hooks: ${probe.hookPath}` : '• No user hooks.json yet'}\n• Codex home: ${probe.codexHome}\n\n${probe.eligible ? 'Ready for experimental user-level collection. Run: veyr install' : 'Live collection was not installed; offline import remains available.'}`);
  return probe.eligible;
}

function shortDiff(before: string, after: string): string {
  const beforeLines = new Set(before.split('\n')); return after.split('\n').filter((line) => line && !beforeLines.has(line)).map((line) => `+ ${line}`).join('\n');
}

async function install(assumeYes: boolean): Promise<void> {
  const runtimeCommand = `VEYR_HOME=${JSON.stringify(stateRoot)} ${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} shim`;
  const preview = await previewInstall(cliPath, undefined, runtimeCommand);
  if (!preview.manifest || !preview.hooksAfter || !preview.configAfter) throw new Error(preview.probe.reason ?? 'Codex environment is not ready.');
  console.log(`Veyr will enable experimental local Codex collection.\n\nCollected by default:\n  - event type, session/turn/call IDs, timestamps, tool name, outcome summaries\nNot collected by default:\n  - prompts, code, command arguments, full tool output, transcript paths\n\nFiles to change:\n  + ${preview.manifest.hookPath}\n  + ${preview.manifest.configPath}\n  + ${join(stateRoot, 'codex-install.json')}\n\nHook changes:\n${shortDiff(preview.hooksBefore, preview.hooksAfter)}\n\nTrust changes:\n${shortDiff(preview.configBefore, preview.configAfter)}`);
  if (!assumeYes) {
    if (!process.stdin.isTTY) throw new Error('Refusing non-interactive install. Re-run in a terminal or pass --yes after reviewing the preview.');
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question('\nContinue? [y/N] '); prompt.close();
    if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') { console.log('Installation cancelled.'); return; }
  }
  const manifest = await installHooks(cliPath, stateRoot);
  console.log(`Installed Veyr collection for ${manifest.codexHome}. Run \`veyr status\` after your next Codex task.`);
}

async function status(): Promise<void> {
  const manifestPath = join(stateRoot, 'codex-install.json');
  if (!(await exists(manifestPath))) { console.log('Veyr collection is not installed. Run `veyr install` to enable experimental local Codex collection.'); return; }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { codexHome: string; codexVersion: string; hookPath: string; entries: unknown[] };
  const reportPath = join(stateRoot, 'reports', 'latest.json');
  const report = (await exists(reportPath)) ? JSON.parse(await readFile(reportPath, 'utf8')) as { tasks?: Array<{ calls?: unknown[] }>; events?: unknown[]; generatedAt?: string } : undefined;
  const spoolPath = join(stateRoot, 'spool');
  const pending = (await exists(spoolPath)) ? (await readdir(spoolPath)).length : 0;
  const collection = report ? `Latest report: ${report.generatedAt ?? 'unknown'}\nObserved: ${report.tasks?.length ?? 0} turn(s), ${report.events?.length ?? 0} event(s), ${report.tasks?.reduce((total, task) => total + (task.calls?.length ?? 0), 0) ?? 0} correlated call(s)\nReport: ${join(stateRoot, 'reports', 'latest.html')}` : 'No report yet. Use Codex normally, then run `veyr report`.';
  console.log(`Veyr collection: installed (experimental)\nCodex: ${manifest.codexVersion}\nCodex home: ${manifest.codexHome}\nHooks: ${manifest.entries.length} Veyr-owned handlers\nPending spool events: ${pending}\n${collection}\n\nDefault privacy: metadata and limited outcome summaries only.\nNot retained: prompts, code, command arguments, full tool output, transcript paths.`);
}

async function uninstall(): Promise<void> {
  await uninstallHooks(stateRoot); console.log('Removed Veyr-owned Codex hooks and trust entries. Local report data was retained.');
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
    agent_id TEXT, tool_name TEXT, call_id TEXT, skill_json TEXT, status TEXT NOT NULL, occurred_at TEXT NOT NULL,
    duration_ms INTEGER, content_bytes INTEGER, message TEXT, source TEXT NOT NULL
  ) STRICT;`);
  try { db.exec('ALTER TABLE events ADD COLUMN call_id TEXT'); } catch { /* Existing database already has the column. */ }
  try { db.exec('ALTER TABLE events ADD COLUMN skill_json TEXT'); } catch { /* Existing database already has the column. */ }
  return db;
}

async function importFixture(file: string): Promise<void> {
  const raw = await readFile(file, 'utf8');
  const events = raw.split('\n').filter(Boolean).map((line) => parseEvent(JSON.parse(line)));
  const db = await openDatabase();
  const insert = db.prepare(`INSERT OR REPLACE INTO events
    (id, host, session_id, task_id, agent_id, tool_name, call_id, skill_json, status, occurred_at, duration_ms, content_bytes, message, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  try {
    for (const event of events) insert.run(event.id, event.host, event.sessionId, event.taskId ?? null, event.agentId ?? null, event.toolName ?? null, event.callId ?? null, event.skillNames ? JSON.stringify(event.skillNames) : null, event.status, event.occurredAt, event.durationMs ?? null, event.contentBytes ?? null, event.message ?? null, event.source);
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
    toolName: row.tool_name ? String(row.tool_name) : undefined, callId: row.call_id ? String(row.call_id) : undefined, skillNames: row.skill_json ? JSON.parse(String(row.skill_json)) as string[] : undefined, status: row.status as VeyrEvent['status'],
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
      const db = await openDatabase(); db.prepare('INSERT OR REPLACE INTO events (id,host,session_id,task_id,agent_id,tool_name,call_id,skill_json,status,occurred_at,duration_ms,content_bytes,message,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(event.id,event.host,event.sessionId,event.taskId ?? null,null,event.toolName ?? null,event.callId ?? null,event.skillNames ? JSON.stringify(event.skillNames) : null,event.status,event.occurredAt,null,event.contentBytes ?? null,null,event.source); db.close();
      await rm(join(spool, name));
    }
  }
  const db = await openDatabase();
  const events = readEvents(db);
  db.close();
  const report = { generatedAt: new Date().toISOString(), events, findings: deriveFindings(events), tasks: projectTask(events) };
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
    case 'install': await install([argument, ...options].includes('--yes')); break;
    case 'status': await status(); break;
    case 'uninstall': await uninstall(); break;
    case 'shim': await shim(); break;
    case '--help': case '-h': case undefined: usage(); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
