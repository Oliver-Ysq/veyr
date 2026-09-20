import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { meetsMinimumVersion, normalizeCodexHook, planInstall, redactCodexPayload, writeSpoolItem } from './index.js';

describe('Codex compatibility', () => {
  it('accepts the stable hooks baseline and rejects older or alpha releases', () => {
    expect(meetsMinimumVersion('codex-cli 0.124.0')).toBe(true);
    expect(meetsMinimumVersion('0.123.9')).toBe(false);
    expect(meetsMinimumVersion('0.124.0-alpha.1')).toBe(false);
  });
});

describe('Codex hook configuration', () => {
  it('preserves existing hooks and plans idempotent Veyr entries', () => {
    const original = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command' as const, command: 'existing', timeout: 3 }] }] } };
    const first = planInstall(original, 'node /tmp/veyr shim');
    const second = planInstall(first.next, 'node /tmp/veyr shim');
    expect(first.next.hooks.PreToolUse).toHaveLength(2);
    expect(second.next.hooks.PreToolUse).toHaveLength(2);
    expect(second.entries).toHaveLength(6);
  });
});

describe('spool and normalization', () => {
  it('writes a bounded spool item and preserves unknown post-tool outcomes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'veyr-spool-'));
    await writeSpoolItem(directory, { session_id: 'session', hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    const names = await (await import('node:fs/promises')).readdir(directory);
    const item = JSON.parse(await readFile(join(directory, names[0]!), 'utf8'));
    const event = normalizeCodexHook(item, names[0]!);
    expect(event.status).toBe('unknown');
    expect(event.toolName).toBe('Bash');
  });

  it('never persists prompts, tool arguments, full responses, or transcript paths', () => {
    const redacted = redactCodexPayload({ session_id: 'session', hook_event_name: 'PostToolUse', prompt: 'secret prompt', tool_input: { command: 'cat .env' }, tool_response: { exit_code: 1, output: 'secret output' }, transcript_path: '/private/transcript.jsonl' });
    expect(redacted).toEqual({ session_id: 'session', hook_event_name: 'PostToolUse', tool_response: { exit_code: 1 } });
  });

  it('uses a native exit code when present', () => {
    const failed = normalizeCodexHook({ capturedAt: '2026-09-20T00:00:00Z', payload: { session_id: 's', hook_event_name: 'PostToolUse', tool_response: { exit_code: 1 } } }, 'failed');
    const succeeded = normalizeCodexHook({ capturedAt: '2026-09-20T00:00:00Z', payload: { session_id: 's', hook_event_name: 'PostToolUse', tool_response: { exit_code: 0 } } }, 'succeeded');
    expect(failed.status).toBe('failed');
    expect(succeeded.status).toBe('succeeded');
  });
});
