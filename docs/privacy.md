# Privacy

Veyr is designed for local-first operation. The initial vertical slice stores
only the data supplied in the imported fixture. It performs no network requests
and needs no model API key.

Future live collection must default to metadata, content sizes, required outcome
state, and redacted error summaries. Any retention of prompts, code, parameters,
or tool output requires explicit opt-in and a clear retention policy.

