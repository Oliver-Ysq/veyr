export type EventStatus =
  | 'requested'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'denied'
  | 'cancelled'
  | 'unknown';

export interface VeyrEvent {
  id: string;
  host: 'codex' | 'traex' | 'fixture';
  sessionId: string;
  taskId?: string;
  agentId?: string;
  toolName?: string;
  callId?: string;
  status: EventStatus;
  occurredAt: string;
  durationMs?: number;
  contentBytes?: number;
  message?: string;
  source: string;
}

export type DurationSource = 'hook_envelope' | 'unavailable';

export interface ToolCall {
  id: string;
  sessionId: string;
  taskId?: string;
  toolName: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  durationSource: DurationSource;
  status: EventStatus;
  evidenceIds: string[];
  outcomeEvidence: 'native_exit_code' | 'native_error' | 'missing';
}

export interface McpSummary {
  server: string;
  tool: string;
  calls: number;
  knownSucceeded: number;
  knownFailed: number;
  unknown: number;
  totalEnvelopeMs: number;
}

export interface TaskSummary {
  sessionId: string;
  taskId?: string;
  observedEvents: number;
  calls: ToolCall[];
  totalEnvelopeMs: number;
  coverage: 'partial';
  suggestions: string[];
  mcp: McpSummary[];
  skillEvidence: string[];
}

export interface Finding {
  id: string;
  severity: 'info' | 'warning';
  title: string;
  summary: string;
  eventIds: string[];
}

const statuses = new Set<EventStatus>([
  'requested',
  'running',
  'succeeded',
  'failed',
  'denied',
  'cancelled',
  'unknown',
]);

export function parseEvent(value: unknown): VeyrEvent {
  if (!value || typeof value !== 'object') throw new Error('Event must be an object.');
  const event = value as Partial<VeyrEvent>;
  if (!event.id || !event.host || !event.sessionId || !event.occurredAt || !event.source) {
    throw new Error('Event is missing a required field.');
  }
  const status = statuses.has(event.status as EventStatus) ? (event.status as EventStatus) : 'unknown';
  return { ...event, status } as VeyrEvent;
}

export function deriveFindings(events: VeyrEvent[]): Finding[] {
  const findings: Finding[] = [];
  const failed = events.filter((event) => event.status === 'failed');
  if (failed.length > 0) {
    findings.push({
      id: 'failed-calls',
      severity: 'warning',
      title: 'Failed tool calls observed',
      summary: `${failed.length} call(s) ended in a reported failed state. Review host-specific outcome evidence before inferring root cause.`,
      eventIds: failed.map((event) => event.id),
    });
  }
  const unknown = events.filter((event) => event.status === 'unknown' && event.toolName !== undefined);
  if (unknown.length > 0) {
    findings.push({
      id: 'unknown-outcomes',
      severity: 'info',
      title: 'Incomplete outcome evidence',
      summary: `${unknown.length} event(s) lack a reliable normalized outcome and remain unknown.`,
      eventIds: unknown.map((event) => event.id),
    });
  }
  const large = events.filter((event) => (event.contentBytes ?? 0) >= 100_000);
  if (large.length > 0) {
    findings.push({
      id: 'large-observed-content',
      severity: 'info',
      title: 'Large observed content',
      summary: `${large.length} event(s) contain at least 100 KB of observed content. This is an observation, not proof of context pressure.`,
      eventIds: large.map((event) => event.id),
    });
  }
  return findings;
}

function milliseconds(earlier: string, later: string): number | undefined {
  const start = Date.parse(earlier); const end = Date.parse(later);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined;
}

function mcpName(toolName: string): { server: string; tool: string } | undefined {
  const match = /^mcp__([^_].*?)__(.+)$/.exec(toolName);
  return match ? { server: match[1]!, tool: match[2]! } : undefined;
}

export function projectTask(events: VeyrEvent[]): TaskSummary[] {
  const sessionTurn = new Map<string, string>();
  for (const event of events) if (event.taskId) sessionTurn.set(event.sessionId, event.taskId);
  const groups = new Map<string, VeyrEvent[]>();
  for (const event of events) {
    const effectiveTaskId = event.taskId ?? sessionTurn.get(event.sessionId);
    const key = `${event.sessionId}:${effectiveTaskId ?? 'session'}`;
    const group = groups.get(key) ?? []; group.push({ ...event, taskId: effectiveTaskId }); groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const ordered = [...group].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const sessionId = ordered[0]!.sessionId; const taskId = ordered[0]!.taskId;
    const calls = new Map<string, ToolCall>();
    for (const event of ordered) {
      if (!event.toolName || !event.callId) continue;
      const call = calls.get(event.callId) ?? { id: event.callId, sessionId, taskId, toolName: event.toolName, durationSource: 'unavailable', status: 'unknown', evidenceIds: [], outcomeEvidence: 'missing' };
      call.evidenceIds.push(event.id);
      if (event.source === 'PreToolUse') { call.startedAt = event.occurredAt; call.status = 'requested'; }
      if (event.source === 'PostToolUse') {
        call.completedAt = event.occurredAt;
        call.status = event.status;
        call.outcomeEvidence = event.status === 'unknown' ? 'missing' : event.status === 'failed' ? 'native_error' : 'native_exit_code';
        if (call.startedAt) { call.durationMs = milliseconds(call.startedAt, call.completedAt); call.durationSource = call.durationMs === undefined ? 'unavailable' : 'hook_envelope'; }
      }
      calls.set(event.callId, call);
    }
    const list = [...calls.values()]; const totalEnvelopeMs = list.reduce((sum, call) => sum + (call.durationMs ?? 0), 0);
    const buckets = new Map<string, McpSummary>();
    for (const call of list) {
      const parsed = mcpName(call.toolName); if (!parsed) continue;
      const key = `${parsed.server}:${parsed.tool}`; const summary = buckets.get(key) ?? { ...parsed, calls: 0, knownSucceeded: 0, knownFailed: 0, unknown: 0, totalEnvelopeMs: 0 };
      summary.calls += 1; summary.totalEnvelopeMs += call.durationMs ?? 0;
      if (call.status === 'succeeded') summary.knownSucceeded += 1; else if (call.status === 'failed') summary.knownFailed += 1; else summary.unknown += 1;
      buckets.set(key, summary);
    }
    const suggestions: string[] = [];
    const unknown = list.filter((call) => call.status === 'unknown');
    if (unknown.length) suggestions.push(`${unknown.length} 次工具调用缺少结构化结果；当前仅确认调用完成事件，建议继续采集并等待宿主提供结果字段。`);
    if (!list.length) suggestions.push('本次仅观察到生命周期事件，未观察到可关联的工具调用。');
    if (list.length && !totalEnvelopeMs) suggestions.push('未形成可测调用包络；缺少 PreToolUse 或 PostToolUse 配对证据。');
    return { sessionId, taskId, observedEvents: ordered.length, calls: list, totalEnvelopeMs, coverage: 'partial', suggestions, mcp: [...buckets.values()], skillEvidence: ['当前 hook-only 路径未观察到可确认的 Skill 请求；这不代表未使用 Skill。'] };
  });
}
