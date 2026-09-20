import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CompactionEvent, NativeTokenUsage, SessionTelemetry, SkillCatalogEntry, SkillRuntimeObservation } from '@veyr/core';

type Root = { source: SkillCatalogEntry['source']; path: string };

async function isDirectory(path: string): Promise<boolean> { try { return (await (await import('node:fs/promises')).stat(path)).isDirectory(); } catch { return false; } }

export async function scanSkills(projectRoot: string): Promise<SkillCatalogEntry[]> {
  const roots: Root[] = [
    { source: 'project', path: join(projectRoot, '.agents', 'skills') },
    { source: 'user-agents', path: join(homedir(), '.agents', 'skills') },
    { source: 'user-codex', path: join(homedir(), '.codex', 'skills') },
  ];
  const entries: SkillCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!(await isDirectory(root.path))) continue;
    for (const child of await readdir(root.path, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const path = join(root.path, child.name, 'SKILL.md');
      try {
        const content = await readFile(path); const key = `${root.source}:${path}`; if (seen.has(key)) continue; seen.add(key);
        const text = content.toString('utf8');
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
        const description = /^description:\s*[>|]?\s*(.+)$/m.exec(frontmatter)?.[1] ?? '';
        const listingBytes = Buffer.byteLength(`${child.name}\n${description}`);
        entries.push({ name: child.name, source: root.source, path, hash: createHash('sha256').update(content).digest('hex'), bytes: content.byteLength, listingEstimatedTokens: Math.ceil(listingBytes / 4), bodyEstimatedTokens: Math.ceil(content.byteLength / 4) });
      } catch { /* A missing or unreadable Skill is not cataloged. */ }
    }
  }
  return entries;
}

type RolloutLine = { timestamp?: string; type?: string; payload?: Record<string, unknown> };

function asNumber(value: unknown): number { return typeof value === 'number' ? value : 0; }
function optionalNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function usage(value: unknown): NativeTokenUsage | undefined {
  const item = object(value); if (!item) return undefined;
  const inputTokens = optionalNumber(item.input_tokens); const outputTokens = optionalNumber(item.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens: inputTokens ?? 0, cacheReadTokens: asNumber(item.cached_input_tokens), cacheWriteTokens: asNumber(item.cache_write_input_tokens), outputTokens: outputTokens ?? 0, totalTokens: optionalNumber(item.total_tokens) ?? (inputTokens ?? 0) + (outputTokens ?? 0) };
}

export async function scanCodexSessionTelemetry(sessionIds: string[], rolloutRoot = join(homedir(), '.codex', 'sessions')): Promise<SessionTelemetry[]> {
  const bySession = new Map<string, SessionTelemetry>(sessionIds.map((sessionId) => [sessionId, { sessionId, usageSnapshots: [], compactions: [], flow: [], inspectedRollout: false }]));
  async function visit(directory: string): Promise<void> {
    let children; try { children = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const child of children) {
      const path = join(directory, child.name);
      if (child.isDirectory()) { await visit(path); continue; }
      const sessionId = sessionIds.find((id) => child.name.includes(id));
      if (!sessionId || !child.name.endsWith('.jsonl')) continue;
      const telemetry = bySession.get(sessionId)!; telemetry.inspectedRollout = true;
      for (const line of (await readFile(path, 'utf8')).split('\n').filter(Boolean)) {
        let record: RolloutLine; try { record = JSON.parse(line) as RolloutLine; } catch { continue; }
        const payload = record.payload ?? {}; const occurredAt = record.timestamp ?? '';
        if (record.type === 'event_msg') {
          const limit = optionalNumber(payload.model_context_window) ?? optionalNumber(object(payload.info)?.model_context_window);
          if (limit !== undefined) telemetry.contextWindowTokens = limit;
          const snapshot = usage(object(payload.info)?.last_token_usage) ?? usage(payload.usage);
          if (snapshot && occurredAt) telemetry.usageSnapshots.push({ occurredAt, turnId: typeof payload.turn_id === 'string' ? payload.turn_id : undefined, usage: snapshot });
          if (payload.type === 'task_started' && occurredAt) telemetry.flow.push({ occurredAt, kind: 'turn_started', label: 'Turn started', source: 'native_rollout', turnId: typeof payload.turn_id === 'string' ? payload.turn_id : undefined });
        }
        if (record.type === 'token_usage_record') {
          const snapshot = usage(payload.usage); if (snapshot && occurredAt) telemetry.usageSnapshots.push({ occurredAt, turnId: typeof payload.turn_id === 'string' ? payload.turn_id : undefined, usage: snapshot });
        }
        if (record.type === 'compacted' && occurredAt) {
          const event: CompactionEvent = { occurredAt, windowNumber: optionalNumber(payload.window_number), windowId: typeof payload.window_id === 'string' ? payload.window_id : undefined, previousWindowId: typeof payload.previous_window_id === 'string' ? payload.previous_window_id : undefined, source: 'native_rollout' };
          telemetry.compactions.push(event);
          telemetry.flow.push({ occurredAt, kind: 'compacted', label: 'Context compacted', source: 'native_rollout', detail: event.windowNumber === undefined ? undefined : `Window ${event.windowNumber}` });
        }
      }
    }
  }
  await visit(rolloutRoot);
  return [...bySession.values()].map((telemetry) => ({ ...telemetry, usageSnapshots: telemetry.usageSnapshots.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)), compactions: telemetry.compactions.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)), flow: telemetry.flow.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)) }));
}

export async function scanCodexSkillRuntime(sessionIds: string[]): Promise<SkillRuntimeObservation[]> {
  const home = join(homedir(), '.codex', 'sessions');
  const observations: Array<SkillRuntimeObservation & { turnId?: string }> = [];
  const turnUsage = new Map<string, SkillRuntimeObservation['nativeTurnUsage']>();
  async function visit(directory: string): Promise<void> {
    let children; try { children = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const child of children) {
      const path = join(directory, child.name);
      if (child.isDirectory()) { await visit(path); continue; }
      if (!child.name.endsWith('.jsonl') || !sessionIds.some((id) => child.name.includes(id))) continue;
      const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
      for (const line of lines) {
        let record: RolloutLine; try { record = JSON.parse(line) as RolloutLine; } catch { continue; }
        const payload = record.payload ?? {};
        if (record.type === 'token_usage_record') {
          const usage = payload.usage as Record<string, unknown> | undefined; const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : undefined;
          if (usage && turnId) turnUsage.set(turnId, { inputTokens: asNumber(usage.input_tokens), cacheReadTokens: asNumber(usage.cached_input_tokens), cacheWriteTokens: asNumber(usage.cache_write_input_tokens), outputTokens: asNumber(usage.output_tokens) });
        }
        if (record.type !== 'response_item') continue;
        const message = payload.type === 'message' ? payload : undefined; const content = message?.content as Array<Record<string, unknown>> | undefined;
        const turnId = typeof message?.internal_chat_message_metadata_passthrough === 'object' && message.internal_chat_message_metadata_passthrough ? (message.internal_chat_message_metadata_passthrough as Record<string, unknown>).turn_id : undefined;
        for (const item of content ?? []) {
          if (item.type !== 'input_text' || typeof item.text !== 'string') continue;
          const match = /<skill>\s*<name>([^<]+)<\/name>[\s\S]*?<path>([^<]+\/SKILL\.md)<\/path>[\s\S]*?<\/skill>/.exec(item.text);
          if (!match) continue;
          observations.push({ name: match[1]!.trim(), injectedAt: record.timestamp ?? '', turnId: typeof turnId === 'string' ? turnId : undefined, bodyEstimatedTokens: Math.ceil(Buffer.byteLength(item.text) / 4) });
        }
      }
    }
  }
  await visit(home);
  return observations.map((item) => ({ ...item, nativeTurnUsage: item.turnId ? turnUsage.get(item.turnId) : undefined }));
}
