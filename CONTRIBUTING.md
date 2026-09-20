# Contributing to Veyr

Thanks for contributing. Veyr prioritizes evidence quality, privacy, and
host-specific correctness over feature count.

## Development workflow

1. Use Node.js 22.5+ and pnpm 10+.
2. Install dependencies with `pnpm install`.
3. Create a focused branch and keep pull requests small.
4. Run `pnpm check` before opening a pull request.
5. Add or update fixtures and tests whenever behavior changes.

## Design expectations

- Never infer success from event names alone.
- Treat unknown data as unknown; do not synthesize precision.
- Do not introduce network egress or prompt/body retention by default.
- Keep Codex and TraeX semantics separate until both are proven equivalent.
- Document user-visible changes under `docs/` when they alter privacy, support,
  or diagnostic meaning.

## Commit and pull request guidance

Use concise imperative commit subjects. Pull requests should state the problem,
the evidence used, tests run, and any changes to privacy or host compatibility.

