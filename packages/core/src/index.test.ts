import { describe, expect, it } from 'vitest';
import { deriveFindings, parseEvent } from './index.js';

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
      parseEvent({ id: 'e2', host: 'fixture', sessionId: 's1', status: 'unknown', occurredAt: '2026-09-20T00:00:01.000Z', source: 'test' }),
    ];
    expect(deriveFindings(events).map((finding) => finding.id)).toEqual(['failed-calls', 'unknown-outcomes']);
  });
});

