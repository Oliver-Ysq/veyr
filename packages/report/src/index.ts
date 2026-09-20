import type { Finding, VeyrEvent } from '@veyr/core';

export interface ReportData {
  generatedAt: string;
  events: VeyrEvent[];
  findings: Finding[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export function renderHtmlReport(report: ReportData): string {
  const findings = report.findings.length
    ? report.findings.map((finding) => `<li class="${finding.severity}"><strong>${escapeHtml(finding.title)}</strong><p>${escapeHtml(finding.summary)}</p><small>Evidence: ${finding.eventIds.map(escapeHtml).join(', ')}</small></li>`).join('\n')
    : '<li class="info"><strong>No rule findings</strong><p>No currently implemented rule was triggered.</p></li>';
  const rows = report.events.map((event) => `<tr><td>${escapeHtml(event.occurredAt)}</td><td>${escapeHtml(event.host)}</td><td>${escapeHtml(event.toolName ?? '—')}</td><td>${escapeHtml(event.status)}</td><td>${event.durationMs ?? '—'}</td><td>${event.contentBytes ?? '—'}</td></tr>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Veyr report</title><style>body{font-family:ui-sans-serif,system-ui;max-width:1100px;margin:40px auto;padding:0 20px;background:#0b1020;color:#e5e7eb}h1{color:#a5b4fc}section{background:#131a2e;border:1px solid #26314f;border-radius:12px;padding:20px;margin:18px 0}li{margin:12px 0;padding:12px;border-radius:8px;list-style:none}.warning{background:#422006}.info{background:#172554}p{margin:.4rem 0;color:#cbd5e1}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;border-bottom:1px solid #26314f;padding:10px}th{color:#a5b4fc}small{color:#94a3b8}</style></head><body><h1>Veyr local evidence report</h1><p>Generated ${escapeHtml(report.generatedAt)} · ${report.events.length} event(s) · ${report.findings.length} finding(s)</p><section><h2>Findings</h2><ul>${findings}</ul></section><section><h2>Observed events</h2><table><thead><tr><th>Time</th><th>Host</th><th>Tool</th><th>Status</th><th>Duration (ms)</th><th>Observed bytes</th></tr></thead><tbody>${rows}</tbody></table></section><section><h2>Interpretation boundary</h2><p>Observation is not success. Correlation is not causation. Missing data remains unknown.</p></section></body></html>`;
}

