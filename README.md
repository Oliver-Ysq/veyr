# Veyr

> Evidence-first observability for coding agents.

[English](README.md) | [简体中文](README.zh-CN.md)

Veyr is a local-first diagnostic tool for coding-agent runs. It turns structured
events into a local SQLite evidence store and human-readable HTML/JSON reports.
The initial MVP targets Codex and TraeX, but this repository currently ships an
**offline fixture-to-report vertical slice**. Live host integration is not yet
claimed as supported.

## Why Veyr

Veyr helps answer four practical questions without pretending to read a model's
private reasoning:

- Which tools failed, retried, were denied, or have incomplete evidence?
- Where did an observed task spend time?
- Which turns show unusually large observed content or native usage growth?
- Which claims lack supporting evidence or need user-directed verification?

Veyr's non-negotiable rules are simple: observation is not success; correlation
is not causation; missing data stays unknown.

## Status

This is pre-alpha software. The supported path is:

```text
JSONL fixture → normalized events → local SQLite → HTML + JSON report
```

No model API key is needed. Veyr does not proxy model traffic and does not upload
event data by default.

## Quick start

Requires Node.js 22.5+ and pnpm 10+.

```bash
pnpm install
pnpm build
pnpm veyr demo
```

The demo writes a local database and report under `.veyr/` in the current
directory. Open `.veyr/reports/latest.html` in a browser.

You can also import your own JSONL fixture:

```bash
pnpm veyr import fixtures/demo-events.jsonl
pnpm veyr report
```

## Repository layout

```text
apps/cli           The `veyr` command-line interface
packages/core      Event contracts, normalization, and diagnostic rules
packages/report    Static HTML and JSON report rendering
fixtures/          Versioned offline event samples
docs/              Architecture, privacy, and support-scope documentation
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md),
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) before
participating.

## License

[MIT](LICENSE)
