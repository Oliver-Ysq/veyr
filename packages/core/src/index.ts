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
  status: EventStatus;
  occurredAt: string;
  durationMs?: number;
  contentBytes?: number;
  message?: string;
  source: string;
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
