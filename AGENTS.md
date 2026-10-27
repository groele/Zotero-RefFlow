# RefFlow development rules

## Data sources and interfaces

- Semantic Scholar is a required, first-class data source. Preserve its official Academic Graph API (`https://api.semanticscholar.org/graph/v1/`) for DOI metadata, title search, references, and citations. Do not remove or disable this data source as part of modernization, cleanup, or refactoring unless the user explicitly requests it.
- When retiring an obsolete Semantic Scholar website-internal endpoint, replace the capability with the official Academic Graph endpoint and validate the replacement. Removing an obsolete endpoint does not authorize removing the provider or its fallback role.
- Follow [the dataflow and API specification](docs/DATAFLOW-AND-API-SPEC.md). Propagate cancellation, preserve reference/citation direction, label truncated results, and keep provider provenance.
- Keep Crossref, OpenAlex, Semantic Scholar, publisher/snapshot, and local PDF roles distinct. Do not silently concatenate independently ordered bibliographies or treat similarity edges as citations.
- Confirm Zotero APIs against the installed host and official developer notes. Retired host APIs must not remain in executable source or newly generated bundles. Record any unavoidable dependency on current internal APIs honestly.

## Validation and delivery

- Use an isolated Zotero profile and independent library for write tests. Never substitute a build or mock response for native runtime verification.
- Preserve existing changes. This checkout contains work predating the current task and may track the upstream repository rather than the derivative release repository.
- Use `REFFLOW_NO_PROMOTE=1` (the legacy `REFNEXUS_NO_PROMOTE=1` alias also works) for evaluation builds. Do not promote packages or update online release metadata without a release task.

## Version changes

- User policy (2026-10-27): every work session that changes source, tests, documentation or build configuration must increment the add-on version, at least a patch; apply SemVer for feature or incompatible changes. Read-only audits do not require a bump. Use one target version for the fixes and validation iterations of the same session. Synchronize authoritative metadata before committing; distinguish version preparation from publication and installation.
