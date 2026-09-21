# Context telemetry and session diagnostics

## Goal

Extend `veyr report` from a hook event viewer into a session diagnostic report. The
report must explain the full observed session flow first, then provide focused
analysis of context, compaction, tools, MCP, and Skills.

## Compatibility contract

Veyr supports Codex `>= 0.124.0` because that is the stable hooks baseline.
Every supported version must retain the following hook-derived capabilities:

- session, turn, and tool-call grouping;
- tool and canonical MCP call timeline;
- hook-envelope duration and bounded outcome evidence;
- static Skill catalog and explicit Skill-request evidence.

Context telemetry is an optional, read-only rollout capability. It is detected
from the records produced by the current session, not inferred from a Codex
version number. A missing field produces an explicit unavailable state; it does
not block the base report and Veyr never estimates or invents a value.

| Capability | Accepted native evidence | When absent |
| --- | --- | --- |
| Context-window limit | `event_msg.model_context_window` | “This session did not expose a context-window limit.” |
| Per-request token usage | `event_msg.info.last_token_usage` or `token_usage_record.usage` | “This session did not expose native token usage.” |
| Context compaction | `compacted` record | “No compaction was observed.” (not “no compaction occurred”) |
| Compaction position | `compacted.timestamp`, plus `window_number` / window IDs when present | Show timestamp only if IDs are absent. |
| Skill injection | rollout `<skill>` metadata | Retain existing hook/catalog-only evidence. |

`session_meta.context_window` is used only to identify a native context-window
lineage. It is not treated as the numeric token limit.

## Privacy boundary

The parser may read local rollout files in memory but persists only allowlisted
metadata:

- timestamps, record type, turn/session/window IDs;
- numeric context-window limits and numeric usage counters;
- compaction count and timing;
- already-supported Skill name/path metadata.
- an existing Codex `thread_name` when provided by the local session index, or
  otherwise a locally derived first-sentence title capped at 56 characters.

It does not persist full prompt text, source code, model reasoning, tool input,
tool-output bodies, compaction summaries, or `replacement_history` contents.

## Data model

The new `SessionTelemetry` projection is keyed by session ID. It contains:

- numeric `contextWindowTokens` when observed;
- chronologically ordered native usage snapshots;
- compaction events with timestamp and optional window identity;
- normalized flow events: turn start, Skill injection, tool call start/end,
  compaction, and turn terminal.

The rollout reader must accept known equivalent field locations and ignore
unknown record types. It must not reject a session merely because a newer Codex
version adds fields.

## Report layout

For the latest session, the report shows one default-expanded session summary:

1. context limit, latest/peak native usage when available, and compaction count;
2. a chronological session flow, with visible evidence source per node;
3. conclusions and next actions.

The session's focused sections follow below:

- Context and compression — native usage snapshots and compaction timing;
- Tool analysis — grouped calls, outcomes, timing, and repeat patterns;
- MCP analysis — grouped server/tool calls and timing;
- Skill Doctor — existing injected/requested versus unobserved split.

Historical sessions stay collapsed. They use the same projection and degrade
independently according to the telemetry available in each session.

## Interpretation rules

- Native input/output/cache usage belongs to a model request or turn; it is not
  attributed to one Skill, tool, MCP server, or compaction operation.
- Hook envelope time includes local hook scheduling and is not server execution
  time.
- “No compaction observed” means no native `compacted` record was found in the
  inspected rollout. It is not proof that compaction never happened.
- A numeric context limit is reported exactly as the native record supplies it;
  Veyr does not substitute model marketing limits or configuration guesses.

## Verification

Add fixtures and tests for both compatibility modes:

- a hook-only / old-compatible session with no rollout telemetry, proving the
  report remains useful and explicitly marks optional fields unavailable;
- a native-telemetry session containing a context limit, usage snapshots, one
  compaction event, Skill injection, tool calls, and MCP calls;
- unknown extra rollout fields, proving forward compatibility;
- privacy checks ensuring no disallowed rollout body is persisted in report JSON.
