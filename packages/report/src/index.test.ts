import { describe, expect, it } from 'vitest';
import { renderHtmlReport } from './index.js';

const report = {
  generatedAt: '2026-09-20T00:00:00.000Z',
  events: [],
  findings: [{ id: 'failed-calls', severity: 'warning' as const, title: 'ignored', summary: 'ignored', eventIds: ['event-1'] }],
  tasks: [],
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
      generatedAt: '2026-09-20T00:00:00.000Z', events: [], findings: [],
      tasks: [{ sessionId: 's1', taskId: 't1', observedEvents: 4, totalEnvelopeMs: 370, coverage: 'partial', suggestions: ['结果缺少结构化证据。'], skillEvidence: ['观察到显式 Skill 请求：$brainstorming。'], calls: [{ id: 'c1', sessionId: 's1', taskId: 't1', toolName: 'mcp__filesystem__read_file', startedAt: '2026-09-20T00:00:00.000Z', completedAt: '2026-09-20T00:00:00.370Z', durationMs: 370, durationSource: 'hook_envelope', status: 'succeeded', evidenceIds: ['pre', 'post'], outcomeEvidence: 'native_exit_code' }], mcp: [{ server: 'filesystem', tool: 'read_file', calls: 1, knownSucceeded: 1, knownFailed: 0, unknown: 0, totalEnvelopeMs: 370 }] }],
    });
    expect(html).toContain('370 ms');
    expect(html).toContain('filesystem');
    expect(html).toContain('$brainstorming');
    expect(html).toContain('工具调用时间线');
  });
});
