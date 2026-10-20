<div align="center">

# Zotero RefFlow

**Discover references, citing works, and related research.**

[English](README.md) · [简体中文](README.zh-CN.md)

![Version](https://img.shields.io/badge/version-12.0.1-blue) ![Zotero](https://img.shields.io/badge/Zotero-10.0.6%E2%80%9311.*-green) ![License](https://img.shields.io/badge/license-AGPL-3.0-or-later-lightgrey)

[Download](https://github.com/groele/Zotero-RefFlow/releases/tag/v12.0.1) · [Report an Issue](https://github.com/groele/Zotero-RefFlow/issues) · [Releases](https://github.com/groele/Zotero-RefFlow/releases)

**Zotero Flow Series**

</div>

---

## Overview

Zotero RefFlow is an independently maintained Zotero add-on that discover references, citing works, and related research. It is designed for research workflows that need practical functionality within the Zotero desktop application.

## Key Features

- Retrieve reference lists from local PDFs, saved webpages, online indexes and publisher resources.
- Explore references, citing publications and related works in a Zotero side pane.
- Search, sort, copy and import results with duplicate-aware matching.
- Preserve useful cached results and report partial retrieval when sources fail.

## Screenshots

For interface examples and implementation details, see the [project documentation](https://github.com/groele/Zotero-RefFlow/tree/main/docs) where available. Screenshots will be added only after they are verified against the current interface.

## Compatibility

| Item | Details |
| --- | --- |
| Add-on version | `12.0.1` |
| Add-on ID | `refflow@groele.github.io` |
| Declared Zotero range | `10.0.6–11.*` |
| Verification | Windows Zotero 10.0.6 and Zotero 11.0-dev.5 were tested in the documented environments; future Zotero 11 releases are not thereby guaranteed. |

The declared compatibility range is not a guarantee that every Zotero version has been tested.

## Installation

1. [Download the XPI](https://github.com/groele/Zotero-RefFlow/releases/tag/v12.0.1) for the current release (`zotero-refflow.xpi`).
2. Open Zotero → **Tools → Plugins** (or the add-on manager in your version).
3. Choose **Install Add-on From File**, select the XPI, and restart Zotero if requested.

Update feed: [update.json](https://github.com/groele/Zotero-RefFlow/blob/main/update.json).

## Quick Start

1. Download the XPI from the linked Release and install it in Zotero.
2. Select an item, then open its References pane and refresh the list.
3. Switch among references, citing works and related works; review matches before importing.

## Configuration & Notes

**10.1.0 repairs, 2026-10-15:** fixes the ten reproducible V10 audit defects and adds a source-built graph renderer, bounded reference-card rendering and shared request admission. See the [repair and validation report](docs/REPAIRS-2026-10-15.md). Legacy imported items without an edit baseline are retained during rollback rather than deleted on uncertain ownership.

Auto selects retrieval sources; automatic refresh is a separate setting and is off by default.

Online retrieval depends on external services and their rate limits. Scanned PDFs without a text layer may require OCR. Optional OpenAlex API credentials can be configured in Zotero settings.

## Development & Testing

Run the following commands from the repository root. Follow project-specific test prerequisites before running native desktop validation.

```powershell
npm ci
npm run tsc
npm test
npm run build-prod
```

These commands describe available project tasks, not a claim that every environment or integration test passes.

## Documentation & Support

[Audit](AUDIT.md) · [Release notes](docs/RELEASE-NOTES.md)

[Open an issue](https://github.com/groele/Zotero-RefFlow/issues) · [Browse source](https://github.com/groele/Zotero-RefFlow)

## Acknowledgements & Attribution

Zotero RefFlow was originally developed as a derivative of [MuiseDestiny/zotero-reference](https://github.com/MuiseDestiny/zotero-reference) by MuiseDestiny (Polygon). We acknowledge the original author and contributors for their foundational work. This Zotero Flow Series edition is independently maintained, is not an official release of the upstream project, and is not endorsed by Zotero. Original copyright and applicable third-party notices remain in force.

## License

Distributed under **AGPL-3.0-or-later**. See [LICENSE](LICENSE) and any applicable third-party notices for details.

Zotero and associated trademarks belong to their respective owners.
