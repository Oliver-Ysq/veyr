import { describe, expect, it } from 'vitest';
import { renderHtmlReport } from './index.js';

const report = {
  generatedAt: '2026-09-20T00:00:00.000Z',
  events: [],
  findings: [{ id: 'failed-calls', severity: 'warning' as const, title: 'ignored', summary: 'ignored', eventIds: ['event-1'] }],
  tasks: [],
  skillDoctor: { skills: [], totalListingEstimatedTokens: 0, totalBodyEstimatedTokens: 0, unobservedCount: 0, nativeUsageStatus: 'unavailable_for_skill_attribution' as const, recommendations: [] },
};

describe('HTML report languages', () => {
  it('renders Chinese by default', () => {
    const html = renderHtmlReport(report);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('Veyr 本地证据报告');
    expect(html).toContain('本次摘要');
  });

  it('renders English when requested', () => {
    const html = renderHtmlReport(report, 'en');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Veyr local evidence report');
    expect(html).toContain('Run summary');
  });

  it('renders a task summary, call envelope, MCP view, and skill evidence', () => {
    const html = renderHtmlReport({
      generatedAt: '2026-09-20T00:00:00.000Z', events: [], findings: [], skillDoctor: { skills: [{ name: 'brainstorming', source: 'user-codex', path: '/skills/brainstorming/SKILL.md', hash: 'a', bytes: 200, listingEstimatedTokens: 20, bodyEstimatedTokens: 50, explicitRequests: 1, injectedCount: 1, evidence: 'injected', nativeTurnUsage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 }, duplicateSources: [] }], totalListingEstimatedTokens: 20, totalBodyEstimatedTokens: 50, unobservedCount: 0, nativeUsageStatus: 'unavailable_for_skill_attribution' as const, recommendations: [] },
      tasks: [{ sessionId: 's1', taskId: 't1', lastObservedAt: '2026-09-20T00:00:00.370Z', observedEvents: 4, totalEnvelopeMs: 370, observedElapsedMs: 800, terminalObserved: true, coverage: 'partial', suggestions: ['结果缺少结构化证据。'], skillEvidence: ['观察到显式 Skill 请求：$brainstorming。'], calls: [{ id: 'c1', sessionId: 's1', taskId: 't1', toolName: 'mcp__filesystem__read_file', startedAt: '2026-09-20T00:00:00.000Z', completedAt: '2026-09-20T00:00:00.370Z', durationMs: 370, durationSource: 'hook_envelope', status: 'succeeded', evidenceIds: ['pre', 'post'], outcomeEvidence: 'native_exit_code' }], mcp: [{ server: 'filesystem', tool: 'read_file', calls: 1, knownSucceeded: 1, knownFailed: 0, unknown: 0, totalEnvelopeMs: 370 }] }],
    });
    expect(html).toContain('370 ms');
    expect(html).toContain('filesystem');
    expect(html).toContain('brainstorming');
    expect(html).toContain('Tool 分析');
    expect(html).toContain('class="pixi-flow-canvas"');
    expect(html).toContain('assets/pixi.min.js');
  });

  it('renders a selectable session sidebar and defaults to the newest session', () => {
    const task = (sessionId: string, taskId: string, lastObservedAt: string) => ({ sessionId, taskId, lastObservedAt, observedEvents: 1, totalEnvelopeMs: 0, terminalObserved: false, coverage: 'partial' as const, suggestions: [], skillEvidence: [], calls: [], mcp: [] });
    const html = renderHtmlReport({ ...report, tasks: [task('older', 't1', '2026-09-20T00:00:00.000Z'), task('newer', 't1', '2026-09-20T00:00:02.000Z'), task('newer', 't2', '2026-09-20T00:00:01.000Z')] });
    expect(html).toContain('会话（2）');
    expect(html).toContain('data-session-target="session-0"');
    expect(html).toContain('data-session-target="session-1"');
    expect(html).toContain('id="session-0" class="session-panel" data-session-panel >');
    expect(html).toContain('id="session-1" class="session-panel" data-session-panel hidden>');
    expect(html.indexOf('newer')).toBeLessThan(html.indexOf('older'));
  });

  it('renders context telemetry and explicitly degrades when native fields are unavailable', () => {
    const task = { sessionId: 's1', taskId: 't1', lastObservedAt: '2026-09-20T00:00:02.000Z', observedEvents: 1, totalEnvelopeMs: 0, terminalObserved: false, coverage: 'partial' as const, suggestions: [], skillEvidence: [], calls: [], mcp: [] };
    const full = renderHtmlReport({ ...report, tasks: [task], telemetry: [{ sessionId: 's1', contextWindowTokens: 128000, inspectedRollout: true, usageSnapshots: [{ occurredAt: '2026-09-20T00:00:01.000Z', usage: { inputTokens: 1000, cacheReadTokens: 800, cacheWriteTokens: 10, outputTokens: 50, totalTokens: 1050 } }], compactions: [{ occurredAt: '2026-09-20T00:00:02.000Z', windowNumber: 2, source: 'native_rollout' }], flow: [{ occurredAt: '2026-09-20T00:00:02.000Z', kind: 'compacted', label: 'Context compacted', source: 'native_rollout' }], conversationTurns: [] }] });
    expect(full).toContain('128,000 tokens');
    expect(full).toContain('压缩：1 次');
    expect(full).toContain('查看压缩记录与原生 token 明细');
    const degraded = renderHtmlReport({ ...report, tasks: [task], telemetry: [{ sessionId: 's1', inspectedRollout: false, usageSnapshots: [], compactions: [], flow: [], conversationTurns: [] }] });
    expect(degraded).toContain('本次会话未提供原生上下文窗口上限。');
    expect(degraded).toContain('未观察到原生 compaction 记录；这不证明没有发生压缩。');
  });

  it('renders Skill Doctor static cost and unobserved candidates in the main report', () => {
    const html = renderHtmlReport({ generatedAt: '2026-09-20T00:00:00.000Z', events: [], findings: [], tasks: [], skillDoctor: { totalListingEstimatedTokens: 90, totalBodyEstimatedTokens: 900, unobservedCount: 1, nativeUsageStatus: 'unavailable_for_skill_attribution', recommendations: ['1 个可见 Skill 在当前报告窗口未观察到明确请求。'], skills: [{ name: 'unused-skill', source: 'user-codex', path: '/skills/unused/SKILL.md', hash: 'a', bytes: 3600, listingEstimatedTokens: 90, bodyEstimatedTokens: 900, explicitRequests: 0, injectedCount: 0, evidence: 'unobserved', duplicateSources: [] }] } });
    expect(html).toContain('Skill Doctor');
    expect(html).toContain('unused-skill');
    expect(html).toContain('约 90 tokens');
  });
});
