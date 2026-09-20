import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installHooks, meetsMinimumVersion, normalizeCodexHook, planInstall, redactCodexPayload, uninstallHooks, writeSpoolItem } from './index.js';

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

  it('installs trust state and restores both files byte-for-byte', async () => {
    const root = await mkdtemp(join(tmpdir(), 'veyr-codex-install-'));
    const codexHome = join(root, 'codex'); const veyrHome = join(root, 'veyr'); const hookPath = join(codexHome, 'hooks.json'); const configPath = join(codexHome, 'config.toml');
    const cliPath = join(root, 'veyr-cli.mjs'); await (await import('node:fs/promises')).mkdir(codexHome, { recursive: true }); await writeFile(cliPath, '');
    const hooksBefore = '{"hooks":{}}\n'; const configBefore = '[model]\nname = "test"\n';
    await writeFile(hookPath, hooksBefore); await writeFile(configPath, configBefore);
    const manifest = await installHooks(cliPath, veyrHome, codexHome, async () => undefined);
    expect(await readFile(hookPath, 'utf8')).toBe(manifest.hooksAfter);
    expect(await readFile(configPath, 'utf8')).toBe(manifest.configAfter);
    expect(manifest.command).toContain('VEYR_HOME=');
    expect(manifest.entries).toHaveLength(6);
    await uninstallHooks(veyrHome);
    expect(await readFile(hookPath, 'utf8')).toBe(hooksBefore);
    expect(await readFile(configPath, 'utf8')).toBe(configBefore);
  });

  it('refuses uninstall after a user changes installed configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'veyr-codex-drift-'));
    const codexHome = join(root, 'codex'); const veyrHome = join(root, 'veyr'); const hookPath = join(codexHome, 'hooks.json'); const configPath = join(codexHome, 'config.toml');
    const cliPath = join(root, 'veyr-cli.mjs'); await (await import('node:fs/promises')).mkdir(codexHome, { recursive: true }); await writeFile(cliPath, '');
    await writeFile(hookPath, '{"hooks":{}}\n'); await writeFile(configPath, '');
    await installHooks(cliPath, veyrHome, codexHome);
    await writeFile(hookPath, `${await readFile(hookPath, 'utf8')}\n`);
    await expect(uninstallHooks(veyrHome)).rejects.toThrow('changed after Veyr installation');
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

  it('keeps explicit skill names without retaining the prompt', () => {
    const redacted = redactCodexPayload({ session_id: 'session', hook_event_name: 'UserPromptSubmit', prompt: 'Use $brainstorming and $test-runner; do not retain this sentence.' });
    expect(redacted).toEqual({ session_id: 'session', hook_event_name: 'UserPromptSubmit', skill_names: ['brainstorming', 'test-runner'] });
  });

  it('uses a native exit code when present', () => {
    const failed = normalizeCodexHook({ capturedAt: '2026-09-20T00:00:00Z', payload: { session_id: 's', hook_event_name: 'PostToolUse', tool_response: { exit_code: 1 } } }, 'failed');
    const succeeded = normalizeCodexHook({ capturedAt: '2026-09-20T00:00:00Z', payload: { session_id: 's', hook_event_name: 'PostToolUse', tool_response: { exit_code: 0 } } }, 'succeeded');
    expect(failed.status).toBe('failed');
    expect(succeeded.status).toBe('succeeded');
  });
});
