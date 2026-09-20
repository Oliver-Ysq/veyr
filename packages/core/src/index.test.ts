import { describe, expect, it } from 'vitest';
import { deriveFindings, parseEvent, projectTask } from './index.js';

describe('core event model', () => {
  it('downgrades an unknown status instead of inventing success', () => {
    const event = parseEvent({
      id: 'e1', host: 'fixture', sessionId: 's1', status: 'unmapped',
      occurredAt: '2026-09-20T00:00:00.000Z', source: 'test',
    });
    expect(event.status).toBe('unknown');
  });

  it('produces bounded evidence findings', () => {
    const events = [
      parseEvent({ id: 'e1', host: 'fixture', sessionId: 's1', status: 'failed', occurredAt: '2026-09-20T00:00:00.000Z', source: 'test' }),
      parseEvent({ id: 'e2', host: 'fixture', sessionId: 's1', toolName: 'Bash', status: 'unknown', occurredAt: '2026-09-20T00:00:01.000Z', source: 'test' }),
    ];
    expect(deriveFindings(events).map((finding) => finding.id)).toEqual(['failed-calls', 'unknown-outcomes']);
  });

  it('does not treat lifecycle events as missing tool outcomes', () => {
    const events = [parseEvent({ id: 'e1', host: 'codex', sessionId: 's1', status: 'unknown', occurredAt: '2026-09-20T00:00:00.000Z', source: 'SessionStart' })];
    expect(deriveFindings(events)).toEqual([]);
  });

  it('projects Pre/Post evidence into one measured tool-call envelope', () => {
    const summary = projectTask([
      parseEvent({ id: 'pre', host: 'codex', sessionId: 's1', taskId: 't1', toolName: 'Bash', callId: 'call-1', status: 'requested', occurredAt: '2026-09-20T00:00:00.000Z', source: 'PreToolUse' }),
      parseEvent({ id: 'post', host: 'codex', sessionId: 's1', taskId: 't1', toolName: 'Bash', callId: 'call-1', status: 'unknown', occurredAt: '2026-09-20T00:00:00.370Z', source: 'PostToolUse' }),
    ])[0]!;
    expect(summary.calls).toHaveLength(1);
    expect(summary.calls[0]).toMatchObject({ durationMs: 370, durationSource: 'hook_envelope', status: 'unknown' });
    expect(summary.suggestions[0]).toContain('缺少结构化结果');
  });

  it('groups observed MCP calls without claiming unobserved servers', () => {
    const summary = projectTask([
      parseEvent({ id: 'pre', host: 'codex', sessionId: 's1', toolName: 'mcp__filesystem__read_file', callId: 'call-1', status: 'requested', occurredAt: '2026-09-20T00:00:00.000Z', source: 'PreToolUse' }),
      parseEvent({ id: 'post', host: 'codex', sessionId: 's1', toolName: 'mcp__filesystem__read_file', callId: 'call-1', status: 'succeeded', occurredAt: '2026-09-20T00:00:00.100Z', source: 'PostToolUse' }),
    ])[0]!;
    expect(summary.mcp).toEqual([{ server: 'filesystem', tool: 'read_file', calls: 1, knownSucceeded: 1, knownFailed: 0, unknown: 0, totalEnvelopeMs: 100 }]);
  });

  it('attaches session lifecycle events to the observed turn when one exists', () => {
    const summaries = projectTask([
      parseEvent({ id: 'start', host: 'codex', sessionId: 's1', status: 'unknown', occurredAt: '2026-09-20T00:00:00.000Z', source: 'SessionStart' }),
      parseEvent({ id: 'pre', host: 'codex', sessionId: 's1', taskId: 't1', toolName: 'Bash', callId: 'call-1', status: 'requested', occurredAt: '2026-09-20T00:00:01.000Z', source: 'PreToolUse' }),
    ]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.observedEvents).toBe(2);
  });

  it('presents explicit skill requests as bounded evidence', () => {
    const summary = projectTask([parseEvent({ id: 'skill', host: 'codex', sessionId: 's1', taskId: 't1', skillNames: ['brainstorming'], status: 'unknown', occurredAt: '2026-09-20T00:00:00.000Z', source: 'UserPromptSubmit' })])[0]!;
    expect(summary.skillEvidence[0]).toContain('$brainstorming');
  });
});
