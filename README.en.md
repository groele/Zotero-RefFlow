> **12.8.2** further enlarges the RefFlow feather artwork while preserving the icon canvas dimensions. [Release notes](docs/releases/v12.8.2.md).




# Zotero RefFlow


**Zotero Flow Series · Discovery**

*让研究的每一步衔接起来。 / Connect each step of research.*

Discover references, citing works, and related research.

[简体中文](README.md) · [English](README.en.md)

[![Release](https://img.shields.io/badge/version-12.8.2-245ac7?style=flat-square)](https://github.com/groele/Zotero-RefFlow/releases/tag/v12.8.2) · [Download XPI](https://github.com/groele/Zotero-RefFlow/releases/download/v12.8.2/zotero-refflow.xpi) · [Report an issue](https://github.com/groele/Zotero-RefFlow/issues)

[Overview](#overview) · [Installation and updates](#installation) · [Quick start](#quick-start) · [Key features](#features) · [Settings](#settings) · [Data, sync, and services](#data) · [Compatibility and validation](#compatibility) · [Troubleshooting](#troubleshooting) · [Development and documentation](#development) · [The Flow series](#series) · [Origin and license](#license)

<a id="overview"></a>

## Overview

For researchers following a paper’s sources and extending a reading list: retrieve literature relationships from local documents and online sources, then review and import candidates in Zotero.

Install this add-on independently and combine it with other Flow products as needed.

<a id="installation"></a>

## Installation and updates

1. Download [zotero-refflow.xpi](https://github.com/groele/Zotero-RefFlow/releases/download/v12.8.2/zotero-refflow.xpi) (add-on version **12.8.2**), not the Source code ZIP.
2. In Zotero, open **Tools → Plugins/Add-ons**, then choose **Install Add-on From File** from the gear menu.
3. Select the XPI, complete installation, and restart if requested.

Use the add-on manager to check for later updates. Automatic checking/installation depends on Zotero, per-add-on update settings, and compatibility. Back up important data before upgrades or migration.

Update feed: [update.json](https://github.com/groele/Zotero-RefFlow/blob/main/update.json) · Add-on ID: `refflow@groele.github.io`.

<a id="quick-start"></a>

## Quick start

1. Select an item with a usable identifier or attachment and open its references pane.
2. Refresh as needed and switch among references, citing works, and related works.
3. Review sources and matches before importing selected items.

<a id="features"></a>

## Key features

| Differentiator | What it does | Boundary |
|---|---|---|
| Provenance-preserving multi-source discovery | Draws usable relationship leads from local PDFs, saved pages, publishers, Crossref, OpenAlex, and Semantic Scholar while retaining each provider’s role. | Coverage, ordering, rate limits, and fields are provider-dependent; scanned PDFs need a usable text layer or OCR. |
| Direction-aware relationship browsing | Separates references, citing works, and related works in lists and graphs to extend a paper’s reading path. | Similarity or co-occurrence is not a citation fact and must not be conflated with reference/citation direction. |
| DOI-first local import | Normalizes a candidate DOI, checks duplicates, and uses Zotero’s DOI/translator path to create a local item. | A clear fallback is used without a DOI; users should still review target library/collection, matches, and missing fields. |
| Cancellable network and partial-result handling | Applies timeout, cancellation, considered retry, and provider-level error/partial-result signals instead of rendering a failure as an empty result. | No external service or network can guarantee a complete graph; “not retrieved” does not establish that a relation is absent. |
| Cache, batches, and recovery clues | Reuses cached results and retains batch-import commit information to support an informed decision after interruption. | A cache never replaces the original source; recovery requires review of visible state and item matches. |

<a id="settings"></a>

## Settings

Open the add-on preference page in **Zotero → Settings → Zotero RefFlow**.

Configure service credentials, refresh behavior, tips, and saving in Zotero settings. Auto source selection and automatic refresh are separate settings.

Seven sidebar quick-action switches control copy, open, import and rollback entries. Turning an entry off does not change library data or past imports; turning it on restores it. Run actions from the sidebar menu.

<a id="data"></a>

## Data, sync, and services

- Online sources include Crossref, OpenAlex, and Semantic Scholar; coverage, rate limits, and ordering depend on each provider.
- Snapshots and cache are not guarantees of a complete original bibliography. Scanned PDFs may need OCR. Import creates Zotero items.

<a id="compatibility"></a>

## Compatibility and validation

| Item | Scope |
|---|---|
| Current add-on version | 12.8.2 |
| Declared Zotero range | `10.0.6` through `11.*` |
| Evidence boundary | 332 unit tests passed; targeted native checks passed 10/10. The broader isolated native suite had 13 passes and 2 failures, both reproduced on the 12.8.0 baseline. Dark-theme visuals, main-profile installation, automatic-update installation, Zotero 11 and other systems were not verified. |

Add-on and Zotero versions are separate. Declared compatibility does not establish testing on every host, operating system or service. This patch validates the targeted behaviors listed above, not all plugin workflows or main-profile installation.

<a id="troubleshooting"></a>

## Troubleshooting

For incomplete results, inspect source, partial-result notices, DOI, and attachment text. No retrieved result does not prove no relationship. Provider order is not necessarily original reference numbering.

For an issue, include add-on/Zotero versions, OS, steps, expected/actual results, and sanitized errors.

<a id="development"></a>

## Development and documentation

Normal installation needs no development environment. Existing developer entry points follow; use an isolated profile for native tests.

```powershell
npm ci
npm run tsc
npm test
# Evaluation build: do not promote the installer or update feed
$env:REFFLOW_NO_PROMOTE = "1"
npm run build-prod
```

- [数据源与接口规范 / Dataflow and API](docs/DATAFLOW-AND-API-SPEC.md)
- [修复记录 / Repair record](docs/REPAIRS-2026-10-15.md)
- [版本说明 / Release notes](docs/releases/v12.8.2.md)
- [产品简介 / Product profile](docs/brand/PRODUCT.md)
- [品牌规范 / Brand guide](docs/brand/BRAND.md)
- [README 模板 / README template](docs/brand/README-TEMPLATE.md)
- [后续提升清单 / Improvement priorities](docs/brand/IMPROVEMENTS.md)
- [Previous detailed guide · README.md](docs/reference/README.md)
- [Previous detailed guide · README.zh-CN.md](docs/reference/README.zh-CN.md)

Previous detailed guides retain feature detail, shortcuts, historical evidence, and full attribution. Their versions and test results belong to the recorded stage.

<a id="series"></a>

## The Flow series

| Product | Role |
|---|---|
| [Zotero RefFlow](https://github.com/groele/Zotero-RefFlow) | Discovery · Discover references, citing works, and related research. |
| [Zotero MetaFlow](https://github.com/groele/Zotero-MetaFlow) | Metadata · Validate, normalize, and enrich reference metadata. |
| [Zotero ViewFlow](https://github.com/groele/Zotero-ViewFlow) | Preview · Preview and copy formatted references in Zotero’s item pane. |
| [Zotero MindFlow](https://github.com/groele/Zotero-MindFlow) | Knowledge · Organize papers, annotations, and ideas into editable maps. |
| [Zotero TaskFlow](https://github.com/groele/Zotero-TaskFlow) | Tasks · Turn literature reading into trackable tasks and plans. |
| [Zotero CiteFlow](https://github.com/groele/Zotero-CiteFlow) | Citation · Track Word citations and connect them to Zotero items. |
| [Zotero PaperFlow](https://github.com/groele/Zotero-PaperFlow) | Publication · Manage manuscripts, submission rounds, and review responses. |

Each add-on installs and updates separately. A shared brand does not imply a shared database or automatic integration of every workflow.

<a id="license"></a>

## Origin and license

**Derivative notice:** Zotero RefFlow is an independently maintained derivative of MuiseDestiny (Polygon)’s open-source [zotero-reference / Ethereal Reference](https://github.com/MuiseDestiny/zotero-reference). Upstream copyright, AGPL obligations, and applicable third-party notices remain in force; this project is neither an upstream nor an official Zotero release.

License: [AGPL-3.0-or-later](LICENSE).

This series is independently maintained and is not an official Zotero product. Zotero and third-party names, trademarks, and materials belong to their respective rights holders.

[Release/tag policy](docs/release-tag-policy.md)
