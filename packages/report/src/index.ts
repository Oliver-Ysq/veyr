import type { Finding, VeyrEvent } from '@veyr/core';

export interface ReportData {
  generatedAt: string;
  events: VeyrEvent[];
  findings: Finding[];
}

export type ReportLanguage = 'zh-CN' | 'en';

const copy = {
  'zh-CN': {
    title: 'Veyr 本地证据报告',
    generated: '生成时间',
    events: '条事件',
    findings: '条发现',
    findingsTitle: '诊断发现',
    noFindings: '没有规则发现',
    noFindingsDetail: '当前已实现的规则均未触发。',
    evidence: '证据',
    observedEvents: '观测事件',
    time: '时间', host: '宿主', tool: '工具', status: '状态', duration: '耗时（毫秒）', bytes: '观测内容字节数',
    boundaryTitle: '解释边界',
    boundary: '观察到不等于执行成功；相关不等于因果；数据缺失时保持未知。',
    failedTitle: '发现失败的工具调用',
    failedSummary: (count: number) => `有 ${count} 次调用以失败状态结束。请在推断根因前检查宿主专属的结果证据。`,
    unknownTitle: '结果证据不完整',
    unknownSummary: (count: number) => `有 ${count} 条事件缺少可靠的规范化结果，因此保持为未知状态。`,
    largeTitle: '观测到较大内容',
    largeSummary: (count: number) => `有 ${count} 条事件的观测内容至少为 100 KB。这是观测事实，不等于上下文压力的证明。`,
  },
  en: {
    title: 'Veyr local evidence report',
    generated: 'Generated', events: 'event(s)', findings: 'finding(s)',
    findingsTitle: 'Findings', noFindings: 'No rule findings', noFindingsDetail: 'No currently implemented rule was triggered.',
    evidence: 'Evidence', observedEvents: 'Observed events', time: 'Time', host: 'Host', tool: 'Tool', status: 'Status', duration: 'Duration (ms)', bytes: 'Observed bytes',
    boundaryTitle: 'Interpretation boundary', boundary: 'Observation is not success. Correlation is not causation. Missing data remains unknown.',
    failedTitle: 'Failed tool calls observed', failedSummary: (count: number) => `${count} call(s) ended in a reported failed state. Review host-specific outcome evidence before inferring root cause.`,
    unknownTitle: 'Incomplete outcome evidence', unknownSummary: (count: number) => `${count} event(s) lack a reliable normalized outcome and remain unknown.`,
    largeTitle: 'Large observed content', largeSummary: (count: number) => `${count} event(s) contain at least 100 KB of observed content. This is an observation, not proof of context pressure.`,
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function localizedFinding(finding: Finding, language: ReportLanguage): Pick<Finding, 'title' | 'summary'> {
  const text = copy[language];
  const count = finding.eventIds.length;
  if (finding.id === 'failed-calls') return { title: text.failedTitle, summary: text.failedSummary(count) };
  if (finding.id === 'unknown-outcomes') return { title: text.unknownTitle, summary: text.unknownSummary(count) };
  if (finding.id === 'large-observed-content') return { title: text.largeTitle, summary: text.largeSummary(count) };
  return finding;
}

export function renderHtmlReport(report: ReportData, language: ReportLanguage = 'zh-CN'): string {
  const text = copy[language];
  const findings = report.findings.length
    ? report.findings.map((finding) => {
      const localized = localizedFinding(finding, language);
      return `<li class="${finding.severity}"><strong>${escapeHtml(localized.title)}</strong><p>${escapeHtml(localized.summary)}</p><small>${text.evidence}: ${finding.eventIds.map(escapeHtml).join(', ')}</small></li>`;
    }).join('\n')
    : `<li class="info"><strong>${text.noFindings}</strong><p>${text.noFindingsDetail}</p></li>`;
  const rows = report.events.map((event) => `<tr><td>${escapeHtml(event.occurredAt)}</td><td>${escapeHtml(event.host)}</td><td>${escapeHtml(event.toolName ?? '—')}</td><td>${escapeHtml(event.status)}</td><td>${event.durationMs ?? '—'}</td><td>${event.contentBytes ?? '—'}</td></tr>`).join('\n');
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text.title}</title><style>body{font-family:ui-sans-serif,system-ui;max-width:1100px;margin:40px auto;padding:0 20px;background:#0b1020;color:#e5e7eb}h1{color:#a5b4fc}section{background:#131a2e;border:1px solid #26314f;border-radius:12px;padding:20px;margin:18px 0}li{margin:12px 0;padding:12px;border-radius:8px;list-style:none}.warning{background:#422006}.info{background:#172554}p{margin:.4rem 0;color:#cbd5e1}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;border-bottom:1px solid #26314f;padding:10px}th{color:#a5b4fc}small{color:#94a3b8}</style></head><body><h1>${text.title}</h1><p>${text.generated} ${escapeHtml(report.generatedAt)} · ${report.events.length} ${text.events} · ${report.findings.length} ${text.findings}</p><section><h2>${text.findingsTitle}</h2><ul>${findings}</ul></section><section><h2>${text.observedEvents}</h2><table><thead><tr><th>${text.time}</th><th>${text.host}</th><th>${text.tool}</th><th>${text.status}</th><th>${text.duration}</th><th>${text.bytes}</th></tr></thead><tbody>${rows}</tbody></table></section><section><h2>${text.boundaryTitle}</h2><p>${text.boundary}</p></section></body></html>`;
}
