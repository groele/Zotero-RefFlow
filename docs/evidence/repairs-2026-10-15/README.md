# RefFlow 10.1.0 repair evidence

All final acceptance reports listed in `verification.json` used the exact promoted XPI. Its SHA-256 was checked against ten isolated installed copies; all 28 member payloads also match a clean source build after line-ending normalization. `package-verification.json` records the promoted artifact.

- Zotero 10 comprehensive: 109 scenarios (16 wrappers); repair groups: 15, 10, 8.
- Zotero 11 development comprehensive: 99 scenarios (14 wrappers); rollback protection: 15; actual process restart: 2.
- Dataflow: 13; request/persistence pipeline: 15; structure: 8; architecture: 6.
- Unit tests: 255; TypeScript and production build passed.

Reports overlap. Do not sum them into a unique-coverage grand total. Native data writes used independent profiles/SQLite libraries; provider responses were controlled. `stage3-accepted-native.png` is a controlled native graph screenshot.

`startup-no-runtime.json` is a diagnostic control with a no-op plugin bootstrap, not the release candidate. It retains the unlocated startup exception. Host/loader errors remain visible in the other reports. Local account and checkout paths were replaced with placeholders; URL schemes and errors were preserved.

See [repair report](../../REPAIRS-2026-10-15.md) for implementation, compatibility and cancellation limits. The [original audit evidence](../audit-2026-10-15/README.md) describes V10 defects before these repairs.
