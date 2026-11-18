# Upstream provenance and third-party review

Zotero RefFlow is described by the project README as a derivative of [MuiseDestiny/zotero-reference (Ethereal Reference)](https://github.com/MuiseDestiny/zotero-reference), originally by MuiseDestiny / Polygon.

- Upstream and this project: **GNU AGPL-3.0-or-later** as declared.
- This project's governing text: [LICENSE](LICENSE).
- Keep applicable original copyright notices, file headers, and information on modification; renaming and refactoring do not extinguish upstream rights.
- Direct runtime dependencies in package.json at the time of this review (2026-11-14): `d3 ^7.8.2` and `zotero-plugin-toolkit 6.0.0`. Confirm exact license texts and bundled copies against the lockfile and final XPI.
- Build-time dependencies have their own licenses; verify whether any code, assets or headers enter distributed outputs.
- External metadata services and retrieved bibliographic data are not automatically relicensed by this repository's AGPL.

## Outstanding release verification
- [ ] Compare the exact upstream revision to modified code and maintain file-level provenance.
- [ ] Inventory XPI assets and copyright notices, including graph components, bundled JavaScript, images and data.
- [ ] Confirm the corresponding source archive and build instructions match each distributed XPI.
- [ ] Include notices required by bundled dependencies.

This is a preliminary documentation record, not a full license or copyright audit.
