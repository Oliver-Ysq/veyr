# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability, especially one
involving event data, local file access, installation, configuration mutation,
or secret redaction. Use GitHub's private security advisory flow for this
repository and include reproduction steps plus impact.

## Security posture

Veyr is local-first. Default collection stores metadata, sizes, necessary state,
and redacted error summaries. Retaining prompts, source code, or tool bodies must
remain an explicit opt-in feature.

