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
      tasks: [{ sessionId: 's1', taskId: 't1', observedEvents: 4, totalEnvelopeMs: 370, observedElapsedMs: 800, terminalObserved: true, coverage: 'partial', suggestions: ['结果缺少结构化证据。'], skillEvidence: ['观察到显式 Skill 请求：$brainstorming。'], calls: [{ id: 'c1', sessionId: 's1', taskId: 't1', toolName: 'mcp__filesystem__read_file', startedAt: '2026-09-20T00:00:00.000Z', completedAt: '2026-09-20T00:00:00.370Z', durationMs: 370, durationSource: 'hook_envelope', status: 'succeeded', evidenceIds: ['pre', 'post'], outcomeEvidence: 'native_exit_code' }], mcp: [{ server: 'filesystem', tool: 'read_file', calls: 1, knownSucceeded: 1, knownFailed: 0, unknown: 0, totalEnvelopeMs: 370 }] }],
    });
    expect(html).toContain('370 ms');
    expect(html).toContain('filesystem');
    expect(html).toContain('brainstorming');
    expect(html).toContain('工具调用时间线');
  });

  it('renders Skill Doctor static cost and unobserved candidates in the main report', () => {
    const html = renderHtmlReport({ generatedAt: '2026-09-20T00:00:00.000Z', events: [], findings: [], tasks: [], skillDoctor: { totalListingEstimatedTokens: 90, totalBodyEstimatedTokens: 900, unobservedCount: 1, nativeUsageStatus: 'unavailable_for_skill_attribution', recommendations: ['1 个可见 Skill 在当前报告窗口未观察到明确请求。'], skills: [{ name: 'unused-skill', source: 'user-codex', path: '/skills/unused/SKILL.md', hash: 'a', bytes: 3600, listingEstimatedTokens: 90, bodyEstimatedTokens: 900, explicitRequests: 0, injectedCount: 0, evidence: 'unobserved', duplicateSources: [] }] } });
    expect(html).toContain('Skill Doctor');
    expect(html).toContain('unused-skill');
    expect(html).toContain('90 est.');
  });
});
