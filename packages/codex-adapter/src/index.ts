import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { EventStatus, VeyrEvent } from '@veyr/core';

export const MINIMUM_CODEX_VERSION = '0.124.0';
const liveEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'] as const;
type LiveEvent = (typeof liveEvents)[number];

export interface CodexProbe {
  version?: string;
  eligible: boolean;
  reason?: string;
  projectRoot: string;
  hookPath: string;
  hookFileExists: boolean;
  cliPath: string;
  cliExists: boolean;
}

type Handler = { type: 'command'; command: string; timeout: number; async?: boolean; statusMessage?: string };
type HookGroup = { matcher?: string; hooks: Handler[] };
type HooksFile = { description?: string; hooks: Partial<Record<LiveEvent, HookGroup[]>> };
export interface InstallManifest { version: 1; projectRoot: string; hookPath: string; command: string; entries: Array<{ event: LiveEvent; hash: string }>; installedAt: string; codexVersion: string; }

function parseVersion(input: string): [number, number, number] | undefined {
  const match = input.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

export function meetsMinimumVersion(input: string): boolean {
  const actual = parseVersion(input); const minimum = parseVersion(MINIMUM_CODEX_VERSION);
  if (!actual || !minimum || input.includes('-alpha') || input.includes('-nightly')) return false;
  return actual[0] > minimum[0] || (actual[0] === minimum[0] && (actual[1] > minimum[1] || (actual[1] === minimum[1] && actual[2] >= minimum[2])));
}

async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }

export function findCodexVersion(): string | undefined {
  try { return execFileSync('codex', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return undefined; }
}

export async function probeCodex(projectRoot: string, cliPath: string): Promise<CodexProbe> {
  const version = findCodexVersion(); const hookPath = join(projectRoot, '.codex', 'hooks.json'); const cliExists = await exists(cliPath);
  if (!version) return { eligible: false, reason: 'Codex CLI was not found.', projectRoot, hookPath, hookFileExists: await exists(hookPath), cliPath, cliExists };
  if (!meetsMinimumVersion(version)) return { version, eligible: false, reason: `Codex ${version} does not meet the stable hooks minimum (${MINIMUM_CODEX_VERSION}).`, projectRoot, hookPath, hookFileExists: await exists(hookPath), cliPath, cliExists };
  if (!cliExists) return { version, eligible: false, reason: 'The Veyr CLI build was not found. Run pnpm build first.', projectRoot, hookPath, hookFileExists: await exists(hookPath), cliPath, cliExists };
  return { version, eligible: true, projectRoot, hookPath, hookFileExists: await exists(hookPath), cliPath, cliExists };
}

function canonical(value: unknown): string { return JSON.stringify(value); }
function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }

export async function readHooksFile(path: string): Promise<HooksFile> {
  if (!(await exists(path))) return { description: 'Veyr project lifecycle hooks', hooks: {} };
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Cannot safely modify ${path}: expected a JSON object.`);
  const parsed = value as Partial<HooksFile>;
  if (parsed.hooks !== undefined && (!parsed.hooks || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks))) throw new Error(`Cannot safely modify ${path}: expected a hooks object.`);
  return { description: parsed.description, hooks: parsed.hooks ?? {} };
}

function veyrHandler(event: LiveEvent, command: string): Handler {
  return { type: 'command', command, timeout: 2, ...(event !== 'SessionEnd' ? { async: true } : {}), statusMessage: 'Veyr is recording local evidence' };
}

export function planInstall(file: HooksFile, command: string): { next: HooksFile; entries: InstallManifest['entries'] } {
  const next: HooksFile = structuredClone(file); const entries: InstallManifest['entries'] = [];
  for (const event of liveEvents) {
    const handler = veyrHandler(event, command); const groups = next.hooks[event] ?? [];
    const same = groups.some((group) => group.hooks.some((existing) => existing.command === command));
    if (!same) groups.push({ ...(event === 'PreToolUse' || event === 'PostToolUse' ? { matcher: '.*' } : {}), hooks: [handler] });
    next.hooks[event] = groups; entries.push({ event, hash: hash(handler) });
  }
  return { next, entries };
}

async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temp, data, { mode: 0o600 }); await rename(temp, path);
}

export async function installHooks(projectRoot: string, cliPath: string, veyrHome: string): Promise<InstallManifest> {
  const probe = await probeCodex(projectRoot, cliPath); if (!probe.eligible || !probe.version) throw new Error(probe.reason ?? 'Codex environment is not ready.');
  const command = `node ${JSON.stringify(cliPath)} shim`; const current = await readHooksFile(probe.hookPath); const plan = planInstall(current, command);
  const manifest: InstallManifest = { version: 1, projectRoot, hookPath: probe.hookPath, command, entries: plan.entries, installedAt: new Date().toISOString(), codexVersion: probe.version };
  await atomicWrite(probe.hookPath, `${JSON.stringify(plan.next, null, 2)}\n`);
  await atomicWrite(join(veyrHome, 'codex-install.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function uninstallHooks(veyrHome: string): Promise<void> {
  const manifestPath = join(veyrHome, 'codex-install.json'); if (!(await exists(manifestPath))) throw new Error('No Veyr Codex installation manifest was found.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as InstallManifest; const current = await readHooksFile(manifest.hookPath);
  for (const entry of manifest.entries) {
    const groups = current.hooks[entry.event] ?? []; let found = false;
    for (const group of groups) for (const handler of group.hooks) if (handler.command === manifest.command) { found = true; if (hash(handler) !== entry.hash) throw new Error(`Veyr hook ${entry.event} was modified; refusing to remove it automatically.`); }
    if (!found) throw new Error(`Veyr hook ${entry.event} is missing; refusing to rewrite a drifted configuration.`);
  }
  for (const event of liveEvents) {
    const groups = current.hooks[event] ?? []; const kept = groups.map((group) => ({ ...group, hooks: group.hooks.filter((handler) => handler.command !== manifest.command) })).filter((group) => group.hooks.length > 0);
    if (kept.length) current.hooks[event] = kept; else delete current.hooks[event];
  }
  await atomicWrite(manifest.hookPath, `${JSON.stringify(current, null, 2)}\n`); await rm(manifestPath);
}

export interface SpoolItem { capturedAt: string; payload: Record<string, unknown>; }
function safeToolResponse(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>; const safe: Record<string, unknown> = {};
  for (const key of ['exit_code', 'exitCode', 'is_error', 'error']) {
    const item = raw[key];
    if (typeof item === 'string') safe[key] = item.slice(0, 512);
    else if (typeof item === 'number' || typeof item === 'boolean') safe[key] = item;
  }
  return Object.keys(safe).length ? safe : undefined;
}

export function redactCodexPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of ['session_id', 'turn_id', 'hook_event_name', 'tool_name', 'tool_use_id', 'permission_mode', 'model']) {
    if (typeof payload[key] === 'string') safe[key] = payload[key];
  }
  const response = safeToolResponse(payload.tool_response);
  if (response) safe.tool_response = response;
  return safe;
}
export async function writeSpoolItem(directory: string, payload: Record<string, unknown>): Promise<void> {
  const encoded = JSON.stringify(payload); if (Buffer.byteLength(encoded) > 256_000) throw new Error('Hook payload exceeds the 256 KB local safety limit.');
  await atomicWrite(join(directory, `${Date.now()}-${Math.random().toString(16).slice(2)}.json`), JSON.stringify({ capturedAt: new Date().toISOString(), payload: redactCodexPayload(payload) }));
}

function text(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
export function normalizeCodexHook(item: SpoolItem, sourceId: string): VeyrEvent {
  const payload = item.payload; const hook = text(payload.hook_event_name) ?? 'UnknownHook'; const tool = text(payload.tool_name); const response = payload.tool_response;
  let status: EventStatus = 'unknown';
  if (hook === 'PreToolUse') status = 'requested';
  if (hook === 'PostToolUse' && response && typeof response === 'object') {
    const object = response as Record<string, unknown>; const exitCode = object.exit_code ?? object.exitCode;
    if (exitCode === 0) status = 'succeeded'; else if (typeof exitCode === 'number') status = 'failed';
    if (object.error !== undefined || object.is_error === true) status = 'failed';
  }
  return { id: `codex-${sourceId}`, host: 'codex', sessionId: text(payload.session_id) ?? 'unknown', taskId: text(payload.turn_id), agentId: undefined, toolName: tool, status, occurredAt: item.capturedAt, contentBytes: Buffer.byteLength(JSON.stringify(payload)), source: hook };
}
