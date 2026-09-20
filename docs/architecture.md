# Architecture

Veyr processes data locally through four deliberately separated stages:

```text
host event or fixture → ingest boundary → SQLite evidence store → report renderer
```

The current repository implements the fixture path. Future host adapters must
produce the same normalized event contract but may not assume identical lifecycle
or outcome semantics across hosts.

## Boundaries

- The ingest boundary validates, limits, and redacts before persistence.
- Storage is the source of truth for raw normalized evidence.
- Rules emit findings with evidence references and confidence boundaries.
- Reports distinguish facts, candidate explanations, and recommended validation.

