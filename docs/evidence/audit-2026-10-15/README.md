# V10 audit evidence — 2026-10-15

These records cover the existing 10.0.0 runtime and XPI, not a fixed release. Runtime source contents were compared with repository main at `9845777b333ca752a704ddda51fa229f51b6f8c5`: all 65 audited runtime files matched after newline normalization. The existing XPI also matched the audited published-package SHA-256.

- `unit.log`: 244 passing unit tests.
- `build.log` / `package-verification.json`: evaluation-only build and 28 archive members verified.
- `native-dataflow.json`, `native-structure.json`, `native-architecture.json`, `native-pipeline.json`, `native-major.json`: 53 passing / 1 failing regression checks. The failure is a stale hardcoded version assertion.
- `native-audit.json`: 11 completed diagnostic probes, including 10 reproduced defects and 1 passing stale-response invariant. A completed probe is not a correctness pass.
- `startup-without-plugin.json`: independent no-RefFlow startup control.
- `interface-audit.json`: specified retired-interface scan, not an assertion that every API is public or stable.
- `npm-audit.json`: no known dependency vulnerabilities reported at audit time.
- `verification.json`: original runtime/source digests and aggregate results.

Native host: Windows / Zotero 10.0.6. SQLite, SDT, cache writes and native UI were real; external provider responses were controlled. No new Zotero 11 or authenticated third-party account acceptance is claimed.

Machine-specific account, isolated-profile and checkout paths were replaced with placeholders. JSON URL schemes, observed results, errors and counters were preserved. Fault-server process IDs and transient logs are excluded. The source digests in verification.json refer to the original audited source bytes, not the sanitized evidence bytes.

The diagnostic driver is `scripts/native-audit-20261015.js`. Run it with the repository's isolated-native runner; never use a primary Zotero profile. See the full audit for commands and limitations.
