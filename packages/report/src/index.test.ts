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
});
