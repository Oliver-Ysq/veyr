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
  skillNames?: string[];
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
  /** Last hook timestamp observed for this turn. Used only for report ordering. */
  lastObservedAt: string;
  observedEvents: number;
  calls: ToolCall[];
  totalEnvelopeMs: number;
  observedElapsedMs?: number;
  terminalObserved: boolean;
  coverage: 'partial';
  suggestions: string[];
  mcp: McpSummary[];
  skillEvidence: string[];
}

/** A report-facing projection: one coding session containing one or more turns. */
export interface SessionSummary {
  sessionId: string;
  turns: TaskSummary[];
  observedEvents: number;
  calls: ToolCall[];
  totalEnvelopeMs: number;
  lastObservedAt: string;
  terminalObserved: boolean;
  mcp: McpSummary[];
  suggestions: string[];
}

export interface NativeTokenUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageSnapshot {
  occurredAt: string;
  turnId?: string;
  usage: NativeTokenUsage;
}

export interface CompactionEvent {
  occurredAt: string;
  windowNumber?: number;
  windowId?: string;
  previousWindowId?: string;
  source: 'native_rollout';
}

export type SessionFlowEvent = {
  occurredAt: string;
  kind: 'turn_started' | 'skill_injected' | 'tool_started' | 'tool_completed' | 'compacted' | 'turn_ended';
  label: string;
  source: 'hook' | 'native_rollout';
  turnId?: string;
  detail?: string;
};

export interface SessionTelemetry {
  sessionId: string;
  sessionTitle?: string;
  contextWindowTokens?: number;
  usageSnapshots: UsageSnapshot[];
  compactions: CompactionEvent[];
  flow: SessionFlowEvent[];
  inspectedRollout: boolean;
  /** Locally derived, bounded summaries of user-authored messages. */
  conversationTurns: ConversationTurn[];
}

export interface ConversationTurn {
  turnId?: string;
  occurredAt: string;
  title: string;
  promptPreview: string;
}

export interface SkillCatalogEntry {
  name: string;
  source: 'project' | 'user-agents' | 'user-codex';
  path: string;
  hash: string;
  bytes: number;
  listingEstimatedTokens: number;
  bodyEstimatedTokens: number;
}

export interface SkillDoctorEntry extends SkillCatalogEntry {
  explicitRequests: number;
  lastRequestedAt?: string;
  evidence: 'injected' | 'explicit_request' | 'unobserved';
  injectedCount: number;
  nativeTurnUsage?: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number };
  duplicateSources: string[];
}

export interface SkillDoctorSummary {
  skills: SkillDoctorEntry[];
  totalListingEstimatedTokens: number;
  totalBodyEstimatedTokens: number;
  unobservedCount: number;
  nativeUsageStatus: 'unavailable_for_skill_attribution';
  recommendations: string[];
}

export interface SkillRuntimeObservation {
  name: string;
  injectedAt: string;
  turnId?: string;
  bodyEstimatedTokens: number;
  nativeTurnUsage?: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number };
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
    const prompt = ordered.find((event) => event.source === 'UserPromptSubmit');
    const terminal = [...ordered].reverse().find((event) => event.source === 'Stop' || event.source === 'SessionEnd');
    const observedElapsedMs = prompt && terminal ? milliseconds(prompt.occurredAt, terminal.occurredAt) : undefined;
    const terminalObserved = terminal !== undefined;
    if (list.length && totalEnvelopeMs > 0) suggestions.push('当前仅有 1 次调用样本，尚不能判断耗时是否异常；继续采集同类任务后才可建立基线。');
    const skills = [...new Set(ordered.flatMap((event) => event.skillNames ?? []))];
    const skillEvidence = skills.length ? skills.map((name) => `观察到显式 Skill 请求：$${name}（仅表示请求，不等于 Skill 已注入或任务已成功）。`) : ['当前 hook-only 路径未观察到可确认的显式 Skill 请求；这不代表未使用 Skill。'];
    return { sessionId, taskId, lastObservedAt: ordered.at(-1)!.occurredAt, observedEvents: ordered.length, calls: list, totalEnvelopeMs, observedElapsedMs, terminalObserved, coverage: 'partial', suggestions, mcp: [...buckets.values()], skillEvidence };
  });
}

export function projectSessions(tasks: TaskSummary[]): SessionSummary[] {
  const grouped = new Map<string, TaskSummary[]>();
  for (const task of tasks) {
    const turns = grouped.get(task.sessionId) ?? [];
    turns.push(task);
    grouped.set(task.sessionId, turns);
  }
  return [...grouped.entries()].map(([sessionId, turns]) => {
    const orderedTurns = [...turns].sort((left, right) => right.lastObservedAt.localeCompare(left.lastObservedAt));
    const calls = orderedTurns.flatMap((turn) => turn.calls);
    const mcpByName = new Map<string, McpSummary>();
    for (const turn of orderedTurns) for (const entry of turn.mcp) {
      const key = `${entry.server}:${entry.tool}`;
      const current = mcpByName.get(key) ?? { ...entry, calls: 0, knownSucceeded: 0, knownFailed: 0, unknown: 0, totalEnvelopeMs: 0 };
      current.calls += entry.calls; current.knownSucceeded += entry.knownSucceeded; current.knownFailed += entry.knownFailed; current.unknown += entry.unknown; current.totalEnvelopeMs += entry.totalEnvelopeMs;
      mcpByName.set(key, current);
    }
    return {
      sessionId,
      turns: orderedTurns,
      observedEvents: orderedTurns.reduce((sum, turn) => sum + turn.observedEvents, 0),
      calls,
      totalEnvelopeMs: calls.reduce((sum, call) => sum + (call.durationMs ?? 0), 0),
      lastObservedAt: orderedTurns[0]!.lastObservedAt,
      terminalObserved: orderedTurns.some((turn) => turn.terminalObserved),
      mcp: [...mcpByName.values()],
      suggestions: [...new Set(orderedTurns.flatMap((turn) => turn.suggestions))],
    };
  }).sort((left, right) => right.lastObservedAt.localeCompare(left.lastObservedAt));
}

export function buildSkillDoctor(catalog: SkillCatalogEntry[], events: VeyrEvent[], runtime: SkillRuntimeObservation[] = []): SkillDoctorSummary {
  const requests = new Map<string, { count: number; last?: string }>();
  for (const event of events) for (const skill of event.skillNames ?? []) {
    const current = requests.get(skill) ?? { count: 0 }; current.count += 1;
    if (!current.last || event.occurredAt > current.last) current.last = event.occurredAt;
    requests.set(skill, current);
  }
  const byName = new Map<string, SkillCatalogEntry[]>();
  for (const skill of catalog) { const entries = byName.get(skill.name) ?? []; entries.push(skill); byName.set(skill.name, entries); }
  const skills = catalog.map((skill) => {
    const usage = requests.get(skill.name); const peers = byName.get(skill.name) ?? [];
    const injections = runtime.filter((item) => item.name === skill.name);
    const last = injections.at(-1);
    return { ...skill, explicitRequests: usage?.count ?? 0, lastRequestedAt: last?.injectedAt ?? usage?.last, injectedCount: injections.length, nativeTurnUsage: last?.nativeTurnUsage, evidence: injections.length ? 'injected' as const : usage ? 'explicit_request' as const : 'unobserved' as const, duplicateSources: peers.filter((peer) => peer.path !== skill.path).map((peer) => peer.source) };
  }).sort((a, b) => b.listingEstimatedTokens - a.listingEstimatedTokens || a.name.localeCompare(b.name));
  const unused = skills.filter((skill) => skill.evidence === 'unobserved');
  const recommendations: string[] = [];
  if (unused.length) recommendations.push(`${unused.length} 个可见 Skill 在当前报告窗口未观察到请求或注入；优先检查 listing 成本最高的项是否应缩短 description、设为 name-only 或关闭。`);
  if (skills.some((skill) => skill.duplicateSources.length)) recommendations.push('发现同名 Skill 来自多个根；请检查优先级和阴影关系，避免实际调用的版本与预期不一致。');
  recommendations.push('已注入 Skill 的原生 usage 是整个 turn 的 usage，不等于该 Skill 独占 token。只有受控 A/B 才能估计边际 token 成本。');
  return { skills, totalListingEstimatedTokens: skills.reduce((sum, skill) => sum + skill.listingEstimatedTokens, 0), totalBodyEstimatedTokens: skills.reduce((sum, skill) => sum + skill.bodyEstimatedTokens, 0), unobservedCount: unused.length, nativeUsageStatus: 'unavailable_for_skill_attribution', recommendations };
}
