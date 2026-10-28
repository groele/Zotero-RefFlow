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

cards-batch-results = Import results
cards-batch-copy-doi = Copy failed DOIs
cards-batch-retry = Retry failed references
cards-batch-no-doi = No DOI available
cards-batch-copied = Failed DOIs copied
cards-batch-retry-hint = Only failed reference imports are retried. Saved references are kept; stopped, unattempted references are not included.
cards-batch-pdf-hint = PDF download failures are separate. This action does not retry PDFs for references already saved.
cards-batch-more = Show more failures ({ $remaining } remaining)

cards-batch-storage-error = Could not migrate import history
cards-batch-storage-preserved = Original Extra was preserved. Check that the Zotero data directory is writable and retry after restarting.

cards-journal-inspect = Inspect local batch journal
cards-journal-committed = Items were saved, but the local journal still needs finalization. Retry saving the journal rather than importing again.
cards-journal-unknown = The local journal needs inspection. Preserve it and its backup; there is insufficient commit evidence for automatic recovery.
cards-journal-ready = The local batch journal is ready.
cards-journal-backup = A previous journal snapshot is preserved. Pair it with a backup of the same library when recovering.
cards-journal-copy = Copy sanitized diagnostics
cards-journal-retry = Finish saving journal
cards-batch-attempt = Attempt { $number }
cards-source-details = Sources and completeness
cards-source-selected = Selected source: { $source }
cards-source-count = Entries returned: { $count }
cards-source-count-expected = Entries returned: { $count}; expected from source: { $expected }
cards-source-partial = Partial or incomplete list
cards-source-complete = Source reports a complete list
cards-source-retained = Kept a more complete earlier result
cards-source-attempts = Provider attempts
cards-source-unavailable = Source temporarily unavailable
cards-source-empty = Source returned no entries
cards-source-latest = Latest attempt: { $source }
cards-source-latest-unavailable = No source was available
cards-source-latest-empty = The source returned no entries
cards-source-latest-partial = This attempt was incomplete
cards-source-latest-complete = This source reported a complete result

cards-settings-no-context = Select one item and load its references in the RefFlow sidebar.
cards-settings-done = Action completed.
