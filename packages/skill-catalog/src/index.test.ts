import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanCodexSessionTelemetry, scanSkills } from './index.js';

describe('skill catalog', () => {
  it('catalogs a project Skill with a stable static token estimate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'veyr-skill-catalog-')); const skill = join(root, '.agents', 'skills', 'demo');
    await mkdir(skill, { recursive: true }); await writeFile(join(skill, 'SKILL.md'), '---\ndescription: demo skill\n---\n' + 'abcd'.repeat(100));
    const catalog = await scanSkills(root); const entry = catalog.find((item) => item.name === 'demo');
    expect(entry).toMatchObject({ source: 'project', bodyEstimatedTokens: 108, listingEstimatedTokens: 4 });
  });

  it('reads optional context telemetry while leaving hook-only sessions available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'veyr-rollout-')); const sessionId = 'session-telemetry';
    await writeFile(join(root, `rollout-${sessionId}.jsonl`), [
      JSON.stringify({ timestamp: '2026-09-20T00:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1', model_context_window: 128000 } }),
      JSON.stringify({ timestamp: '2026-09-20T00:00:01.000Z', type: 'event_msg', payload: { info: { model_context_window: 128000, last_token_usage: { input_tokens: 1000, cached_input_tokens: 800, cache_write_input_tokens: 10, output_tokens: 50, total_tokens: 1050 } } } }),
      JSON.stringify({ timestamp: '2026-09-20T00:00:02.000Z', type: 'compacted', payload: { window_number: 2, window_id: 'new-window', previous_window_id: 'old-window', replacement_history: 'must not be retained' } }),
      JSON.stringify({ timestamp: '2026-09-20T00:00:03.000Z', type: 'future_record', payload: { unknown: true } }),
    ].join('\n'));
    const [telemetry, hookOnly] = await scanCodexSessionTelemetry([sessionId, 'hook-only'], root);
    expect(telemetry).toMatchObject({ sessionId, contextWindowTokens: 128000, inspectedRollout: true, usageSnapshots: [{ usage: { inputTokens: 1000, cacheReadTokens: 800, outputTokens: 50 } }], compactions: [{ windowNumber: 2, windowId: 'new-window' }] });
    expect(JSON.stringify(telemetry)).not.toContain('replacement_history');
    expect(hookOnly).toMatchObject({ sessionId: 'hook-only', inspectedRollout: false, usageSnapshots: [], compactions: [], conversationTurns: [] });
  });

  it('keeps only bounded user-message summaries for conversation navigation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'veyr-conversation-')); const sessionId = 'session-conversation';
    await writeFile(join(root, `rollout-${sessionId}.jsonl`), [
      JSON.stringify({ timestamp: '2026-09-20T00:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', internal_chat_message_metadata_passthrough: { turn_id: 'turn-1', content_item_kinds: ['user.text'] }, content: [{ type: 'input_text', text: '请分析这个项目的工具调用链路，并给我一个简短标题。这里是不应完整保存的额外内容。' }] } }),
      JSON.stringify({ timestamp: '2026-09-20T00:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', internal_chat_message_metadata_passthrough: { turn_id: 'turn-2', content_item_kinds: ['environments.environment_context'] }, content: [{ type: 'input_text', text: '<environment_context>ignore</environment_context>' }] } }),
    ].join('\n'));
    const [telemetry] = await scanCodexSessionTelemetry([sessionId], root);
    expect(telemetry!.conversationTurns).toEqual([{ turnId: 'turn-1', occurredAt: '2026-09-20T00:00:00.000Z', title: '请分析这个项目的工具调用链路，并给我一个简短标题', promptPreview: '请分析这个项目的工具调用链路，并给我一个简短标题' }]);
  });

  it('extracts the last real user request from a Codex history wrapper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'veyr-history-wrapper-')); const sessionId = 'session-history';
    const wrapped = 'The following is the Codex agent history whose request action you are assessing.\n>>> TRANSCRIPT START\n[1] user: \n<in-app-browser-context source="ambient-ui-state">ignore</in-app-browser-context>\n[2] user: \n## My request:\n请优化报告的会话标题，不要展示 UUID。\n>>> TRANSCRIPT END';
    await writeFile(join(root, `rollout-${sessionId}.jsonl`), JSON.stringify({ timestamp: '2026-09-20T00:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', internal_chat_message_metadata_passthrough: { turn_id: 'turn-1', content_item_kinds: ['user.text'] }, content: [{ type: 'input_text', text: wrapped }] } }));
    const [telemetry] = await scanCodexSessionTelemetry([sessionId], root);
    expect(telemetry!.conversationTurns[0]).toMatchObject({ title: '请优化报告的会话标题，不要展示 UUID' });
  });
});
