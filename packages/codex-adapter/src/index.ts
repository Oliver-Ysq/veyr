import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { EventStatus, VeyrEvent } from '@veyr/core';

export const MINIMUM_CODEX_VERSION = '0.124.0';
const liveEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'] as const;
type LiveEvent = (typeof liveEvents)[number];

export interface CodexProbe {
  version?: string;
  eligible: boolean;
  reason?: string;
  codexHome: string;
  hookPath: string;
  hookFileExists: boolean;
  cliPath: string;
  cliExists: boolean;
}

type Handler = { type: 'command'; command: string; timeout: number; async?: boolean; statusMessage?: string };
type HookGroup = { matcher?: string; hooks: Handler[] };
type HooksFile = { description?: string; hooks: Partial<Record<LiveEvent, HookGroup[]>> };
export interface InstallManifest { version: 2; codexHome: string; hookPath: string; configPath: string; command: string; entries: Array<{ event: LiveEvent; groupIndex: number; handlerIndex: number; stateKey: string; hash: string }>; installedAt: string; codexVersion: string; hooksBefore: string; hooksAfter: string; configBefore: string; configAfter: string; }

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

export function resolveCodexHome(): string { return process.env.CODEX_HOME ?? join(homedir(), '.codex'); }

export async function probeCodex(cliPath: string, codexHome = resolveCodexHome()): Promise<CodexProbe> {
  const version = findCodexVersion(); const hookPath = join(codexHome, 'hooks.json'); const cliExists = await exists(cliPath);
  if (!version) return { eligible: false, reason: 'Codex CLI was not found.', codexHome, hookPath, hookFileExists: await exists(hookPath), cliPath, cliExists };
  if (!meetsMinimumVersion(version)) return { version, eligible: false, reason: `Codex ${version} does not meet the stable hooks minimum (${MINIMUM_CODEX_VERSION}).`, codexHome, hookPath, hookFileExists: await exists(hookPath), cliPath, cliExists };
  if (!cliExists) return { version, eligible: false, reason: 'The Veyr CLI build was not found. Run pnpm build first.', codexHome, hookPath, hookFileExists: await exists(hookPath), cliPath, cliExists };
  return { version, eligible: true, codexHome, hookPath, hookFileExists: await exists(hookPath), cliPath, cliExists };
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

function eventKey(event: LiveEvent): string {
  return ({ SessionStart: 'session_start', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use', PostToolUse: 'post_tool_use', Stop: 'stop', SessionEnd: 'session_end' })[event];
}

function trustHash(event: LiveEvent, handler: Handler, matcher?: string): string {
  return `sha256:${hash({ event_name: eventKey(event), ...(matcher !== undefined ? { matcher } : {}), hooks: [{ type: 'command', command: handler.command, timeout: handler.timeout, async: handler.async ?? false, ...(handler.statusMessage ? { statusMessage: handler.statusMessage } : {}) }] })}`;
}

export function planInstall(file: HooksFile, command: string, hookPath = '/home/user/.codex/hooks.json'): { next: HooksFile; entries: InstallManifest['entries'] } {
  const next: HooksFile = structuredClone(file); const events: LiveEvent[] = [];
  for (const event of liveEvents) {
    const handler = veyrHandler(event, command); const groups = next.hooks[event] ?? [];
    const same = groups.some((group) => group.hooks.some((existing) => existing.command === command));
    if (!same) groups.push({ ...(event === 'PreToolUse' || event === 'PostToolUse' ? { matcher: '.*' } : {}), hooks: [handler] });
    next.hooks[event] = groups; events.push(event);
  }
  const resolved = events.map((event) => {
    const groups = next.hooks[event] ?? []; const groupIndex = groups.findIndex((group) => group.hooks.some((handler) => handler.command === command));
    const group = groups[groupIndex]!; const handlerIndex = group.hooks.findIndex((handler) => handler.command === command); const handler = group.hooks[handlerIndex]!;
    return { event, groupIndex, handlerIndex, stateKey: `${hookPath}:${eventKey(event)}:${groupIndex}:${handlerIndex}`, hash: trustHash(event, handler, group.matcher) };
  });
  return { next, entries: resolved };
}

async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temp, data, { mode: 0o600 }); await rename(temp, path);
}

function tomlTrust(entries: InstallManifest['entries']): string {
  return entries.map((entry) => `[hooks.state.${JSON.stringify(entry.stateKey)}]\ntrusted_hash = ${JSON.stringify(entry.hash)}\n`).join('\n');
}

function removeOwnedTrust(config: string, entries: InstallManifest['entries']): string {
  let next = config;
  for (const entry of entries) {
    const escaped = entry.stateKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(`(?:^|\\n)\\[hooks\\.state\\."${escaped}"\\]\\ntrusted_hash\\s*=\\s*"[^"]+"\\n?`, 'g'), '\n');
  }
  return next.replace(/\n{3,}/g, '\n\n').replace(/\n?# Veyr-owned Codex hook trust state\n?$/, '').trimEnd() + '\n';
}

export async function previewInstall(cliPath: string, codexHome = resolveCodexHome()): Promise<{ probe: CodexProbe; manifest?: InstallManifest; hooksBefore: string; hooksAfter?: string; configBefore: string; configAfter?: string }> {
  const probe = await probeCodex(cliPath, codexHome); const configPath = join(codexHome, 'config.toml'); const hooksBefore = (await exists(probe.hookPath)) ? await readFile(probe.hookPath, 'utf8') : ''; const configBefore = (await exists(configPath)) ? await readFile(configPath, 'utf8') : '';
  if (!probe.eligible || !probe.version) return { probe, hooksBefore, configBefore };
  const command = `node ${JSON.stringify(cliPath)} shim`; const plan = planInstall(await readHooksFile(probe.hookPath), command, probe.hookPath);
  const hooksAfter = `${JSON.stringify(plan.next, null, 2)}\n`; const configAfter = `${removeOwnedTrust(configBefore, plan.entries).trimEnd()}\n\n# Veyr-owned Codex hook trust state\n${tomlTrust(plan.entries)}`;
  const manifest: InstallManifest = { version: 2, codexHome, hookPath: probe.hookPath, configPath, command, entries: plan.entries, installedAt: new Date().toISOString(), codexVersion: probe.version, hooksBefore, hooksAfter, configBefore, configAfter };
  return { probe, manifest, hooksBefore, hooksAfter, configBefore, configAfter };
}

export async function installHooks(cliPath: string, veyrHome: string, codexHome = resolveCodexHome()): Promise<InstallManifest> {
  const preview = await previewInstall(cliPath, codexHome); if (!preview.manifest || !preview.hooksAfter || !preview.configAfter) throw new Error(preview.probe.reason ?? 'Codex environment is not ready.');
  const manifest = preview.manifest;
  await atomicWrite(manifest.hookPath, preview.hooksAfter);
  await atomicWrite(manifest.configPath, preview.configAfter);
  await atomicWrite(join(veyrHome, 'codex-install.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function uninstallHooks(veyrHome: string): Promise<void> {
  const manifestPath = join(veyrHome, 'codex-install.json'); if (!(await exists(manifestPath))) throw new Error('No Veyr Codex installation manifest was found.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as InstallManifest; const currentHooksRaw = await readFile(manifest.hookPath, 'utf8'); const currentConfigRaw = await readFile(manifest.configPath, 'utf8');
  if (currentHooksRaw !== manifest.hooksAfter || currentConfigRaw !== manifest.configAfter) throw new Error('Codex configuration changed after Veyr installation; refusing automatic uninstall to avoid overwriting user changes.');
  const current = await readHooksFile(manifest.hookPath);
  for (const entry of manifest.entries) {
    const groups = current.hooks[entry.event] ?? []; let found = false;
    for (const group of groups) for (const handler of group.hooks) if (handler.command === manifest.command) { found = true; if (trustHash(entry.event, handler, group.matcher) !== entry.hash) throw new Error(`Veyr hook ${entry.event} was modified; refusing to remove it automatically.`); }
    if (!found) throw new Error(`Veyr hook ${entry.event} is missing; refusing to rewrite a drifted configuration.`);
  }
  for (const event of liveEvents) {
    const groups = current.hooks[event] ?? []; const kept = groups.map((group) => ({ ...group, hooks: group.hooks.filter((handler) => handler.command !== manifest.command) })).filter((group) => group.hooks.length > 0);
    if (kept.length) current.hooks[event] = kept; else delete current.hooks[event];
  }
  const config = currentConfigRaw;
  for (const entry of manifest.entries) if (!config.includes(entry.hash)) throw new Error(`Veyr trust state for ${entry.event} is missing or modified; refusing to rewrite configuration.`);
  await atomicWrite(manifest.hookPath, manifest.hooksBefore); await atomicWrite(manifest.configPath, manifest.configBefore); await rm(manifestPath);
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
