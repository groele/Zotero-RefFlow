# Zotero RefFlow

**Zotero Flow Series · Discovery**

*让研究的每一步衔接起来。 / Connect each step of research.*

Discover references, citing works, and related research.

[简体中文](README.md) · [English](README.en.md)

[![Release](https://img.shields.io/badge/version-12.3.4-245ac7?style=flat-square)](https://github.com/groele/Zotero-RefFlow/releases/tag/v12.3.4) · [Download XPI](https://github.com/groele/Zotero-RefFlow/releases/download/v12.3.4/zotero-refflow.xpi) · [Report an issue](https://github.com/groele/Zotero-RefFlow/issues)

[Overview](#overview) · [Installation and updates](#installation) · [Quick start](#quick-start) · [Key features](#features) · [Settings](#settings) · [Data, sync, and services](#data) · [Compatibility and validation](#compatibility) · [Troubleshooting](#troubleshooting) · [Development and documentation](#development) · [The Flow series](#series) · [Origin and license](#license)

<a id="overview"></a>

## Overview

For researchers following a paper’s sources and extending a reading list: retrieve literature relationships from local documents and online sources, then review and import candidates in Zotero.

Install this add-on independently and combine it with other Flow products as needed.

<a id="installation"></a>

## Installation and updates

1. Download [zotero-refflow.xpi](https://github.com/groele/Zotero-RefFlow/releases/download/v12.3.4/zotero-refflow.xpi) (add-on version **12.3.4**), not the Source code ZIP.
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

| Feature | Scope |
|---|---|
| Multiple sources | Retrieve available references from PDFs, saved webpages, publishers, and online indexes. |
| Relationship browsing | Browse lists and graphs while distinguishing references, citing works, and related works. |
| Result handling | Search, sort, copy, and import results; review matches and duplicates before import. |
| Provenance and cache | Retain source information, cache, and partial-result notices; similarity does not establish a citation. |

<a id="settings"></a>

## Settings

Open the add-on preference page in **Zotero → Settings → Zotero RefFlow**.

Configure service credentials, refresh behavior, tips, and saving in Zotero settings. Auto source selection and automatic refresh are separate settings.

<a id="data"></a>

## Data, sync, and services

- Online sources include Crossref, OpenAlex, and Semantic Scholar; coverage, rate limits, and ordering depend on each provider.
- Snapshots and cache are not guarantees of a complete original bibliography. Scanned PDFs may need OCR. Import creates Zotero items.

<a id="compatibility"></a>

## Compatibility and validation

| Item | Scope |
|---|---|
| Current add-on version | 12.3.4 |
| Declared Zotero range | `10.0.6` through `11.*` |
| Evidence boundary | The 12.3.4 settings pane was checked in Windows Zotero 10.0.6, including sequential navigation and MetaFlow card palette comparison; external services and all graph/import scenarios were not rerun in this update. |

Add-on and Zotero versions are separate. Manifest compatibility does not establish testing on every host, operating system, or service. This branding/documentation update does not rerun business workflow tests.

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
- [版本说明 / Release notes](docs/RELEASE-NOTES.md)
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

Independently maintained derivative of MuiseDestiny (Polygon)’s zotero-reference / Ethereal Reference; upstream copyright and third-party notices remain in force.

License: [AGPL-3.0-or-later](LICENSE).

This series is independently maintained and is not an official Zotero product. Zotero and third-party names, trademarks, and materials belong to their respective rights holders.
