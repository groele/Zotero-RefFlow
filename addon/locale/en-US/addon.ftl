prefs-label = Zotero RefFlow
pane-title =
    .label = { $count ->
        [0] References
       *[other] { $count } references
    }
    .tooltiptext = References
relatedbox-download-oa = Download open-access PDFs
relatedbox-force-label = Fetch again
relatedbox-copy-label = Copy list
relatedbox-cancel-label = Cancel
relatedbox-cancelled = Fetch cancelled
relatedbox-loading = Fetching references…
relatedbox-pages-label = pages
relatedbox-empty = No references found. Check the PDF text layer or try another source
relatedbox-timeout = Fetch timed out. Retry or try another source
relatedbox-scan-limited = Scan limit reached. Check list completeness
relatedbox-fetch-label = Get references
relatedbox-source-label = Reference source
relatedbox-select-item = Select a reference item first
relatedbox-fetch-error = Fetch failed. Please try again.
tabpanel-reader-tab-label = RefFlow Citations
relatedbox-number-label = references:
relatedbox-refresh-label = Refresh
relatedbox-search-placeholder = Search References
relatedbox-batch-import = ⚡ Batch Import
relatedbox-rollback = ↩️ Rollback
relatedbox-copy-all-tooltip = Double-click title to copy all references
relatedbox-copy-success = References list copied to clipboard
relatedbox-retracted-badge = 🚨 Retracted
relatedbox-retracted-reason = This paper has been retracted by publisher or institution
relatedbox-no-importable = No importable references detected
relatedbox-rollback-success = Successfully rolled back { $count } imported items
relatedbox-no-rollback-batch = No rollback batch record found
relatedbox-source-tooltip = Current source: { $source } (Click to toggle source, Long-press to force refresh)

pane-refresh =
    .tooltiptext = Parse / Fetch again

pane-type =
    .tooltiptext = Literature type

pane-more =
    .tooltiptext = More actions

cards-in-library = In Zotero library

cards-cited = Cited

cards-show-library = Show in Zotero

cards-import = Add to Zotero by DOI

cards-copy-text = Copy reference text

cards-copy-doi = Copy DOI

cards-copy-url = Copy URL

cards-open = Open in Zotero or browser

cards-import-selected = Add selected literature by DOI

cards-import-all = Add all literature by DOI

cards-source-pdf = Source: PDF

cards-source-online = Source: Online

cards-sort-original = Sort: Original order

cards-sort-recency = Sort: Publication year

cards-sort-cited = Sort: Citation count

cards-type-references = References

cards-type-citations = Citing literature

cards-type-related = Related literature

cards-work-not-found = Could not identify the DOI; add a DOI and try again

cards-cached-offline = Offline cached snapshot

cards-partial = partial list
cards-source-auto = Automatic (recommended)
cards-source-web = Publisher HTML / XML
cards-auto-empty = No usable list; check PDF text, DOI or connection
cards-number-label = Source list number
cards-no-search-results = No matching references. Press Esc to clear the search.

graph-pane-title =
    .label = Citation graph
graph-pane-sidenav =
    .tooltiptext = Citation graph

pane-sidenav =
    .tooltiptext = References

cards-kept-results = Previous results retained
cards-refresh-empty-kept = No new list available; previous results retained
cards-resolving-doi = Resolving the paper DOI…
cards-context-changed = The item or document changed. Refresh to retrieve its references.

cards-list-name = Reference list
cards-rollback-retained = Kept { $count } imported items because they were reused or modified.
cards-rollback-summary = Batch rollback complete: { $count } items moved to Trash. Reused or modified content is kept.
cards-rollback-failed = Rollback failed. Check library permissions and the batch journal, then retry.

cards-latest-attempt = Latest attempt

graph-origins-changed = Origins changed. Build the graph to load current results.

cards-importing-doi = Looking up DOI in Zotero…
cards-import-cancelled = Import cancelled; completed items remain in Zotero
cards-import-failed = DOI import failed; retry
cards-import-summary = Added: { $added }; existing: { $existing }; failed: { $failed }
cards-import-complete = DOI import complete
cards-import-downloading = Downloading open-access PDFs…
cards-import-download-summary = PDFs downloaded: { $downloaded }; download failures: { $failed }
cards-import-error-no-doi = No valid DOI is available; no item was created. Verify the DOI and use Add Item by Identifier in Zotero's toolbar.
cards-import-error-translator = No DOI translator is available. Update Zotero translators and retry.
cards-import-error-identity = No work with the requested DOI was returned; no item was created. Verify the DOI and retry.
cards-import-error-metadata = The DOI lookup returned an empty title; no item was created. Retry later.
cards-import-error-timeout = The DOI lookup timed out; no item was created. Check the connection and retry.
cards-import-error-destination = The target library, collection or origin item is unavailable. Select an available destination and retry.
cards-import-error-lookup = Zotero DOI lookup failed; no item was created. Check the connection and translators, then retry.
