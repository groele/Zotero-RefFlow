import { config } from "../../package.json";

/**
 * Injects reference item pane and card styling into the target document.
 */
export function addReferencePaneStyles(doc: Document = document): void {
  const styles = ztoolkit.UI.createElement(doc, "style", {
    id: `${config.addonRef}-style`,
    properties: {
      innerHTML: `
        .refflow-card-search {box-sizing:border-box;width:100%;margin:4px 0 6px;padding:5px 8px;border:1px solid var(--material-border,#ccc);border-radius:4px;background:var(--material-background,#fff);color:inherit;}
        .refflow-status {font-size:.85em;opacity:.75;border:0!important;padding:0!important;min-height:18px;}
        .zotero-editpane-related[data-refflow-item-id] .reference-item {box-sizing:border-box;contain:paint layout style;display:flex;flex-direction:column;gap:4px;padding:6px 4px;border-radius:4px;cursor:default;min-width:0;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-journal-status {padding:8px;margin-block:8px;border:1px solid currentColor;border-radius:7px;overflow-wrap:anywhere;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-source-details {box-sizing:border-box;width:100%;margin-block:4px;padding:6px 8px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:6px;background:color-mix(in srgb,currentColor 2%,transparent);color:inherit;overflow-wrap:anywhere;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-source-details summary {cursor:pointer;font-weight:600;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-source-details p {margin-block:5px;font-size:.95em;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-source-details ul {margin-block:4px;padding-inline-start:2em;max-height:12em;overflow:auto;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-source-details li {margin-block:3px;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-source-details :focus-visible {outline:2px solid var(--color-accent,#3678b5);outline-offset:2px;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-journal-status button {font:inherit;margin:3px;max-width:100%;white-space:normal;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-batch-results {margin-block:8px;padding:8px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:7px;background:color-mix(in srgb,currentColor 2%,transparent);font:inherit;overflow-wrap:anywhere;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-batch-results summary {cursor:pointer;font-weight:600;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-batch-results p {margin-block:6px;font-size:.95em;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-batch-failures {max-height:16em;overflow:auto;padding-inline-start:2.5em;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-batch-failures li {margin-block:8px;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-batch-actions {display:flex;flex-wrap:wrap;gap:6px;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-batch-actions button {font:inherit;max-width:100%;white-space:normal;}
        .zotero-editpane-related[data-refflow-item-id] .refflow-batch-results :focus-visible {outline:2px solid var(--color-accent,#3678b5);outline-offset:2px;}
        .zotero-editpane-related[data-refflow-item-id] .reference-item[hidden] {display:none!important;}
        .zotero-editpane-related[data-refflow-item-id] .reference-item:hover {background:var(--material-mix-quinary,rgba(128,128,128,.08));}
        .zotero-editpane-related[data-refflow-item-id] .reference-item.selected {background:var(--color-accent-10,rgba(60,120,200,.16));}
        .zotero-editpane-related[data-refflow-item-id] .reference-item:focus-visible {outline:1px solid var(--color-accent,#3678b5);outline-offset:-1px;}
        .zotero-editpane-related[data-refflow-item-id] .reference-citation {display:grid;grid-template-columns:var(--refflow-number-width,3ch) minmax(0,1fr);column-gap:6px;align-items:start;}
        .zotero-editpane-related[data-refflow-item-id] .reference-marker {min-width:0;text-align:end;font-size:.9em;line-height:1.35;}
        .zotero-editpane-related[data-refflow-item-id] .reference-number {font-variant-numeric:tabular-nums;font-weight:600;font-size:inherit;line-height:1.35;color:inherit;white-space:nowrap;}
        .zotero-editpane-related[data-refflow-item-id] .reference-description {display:flex;flex-direction:column;gap:3px;min-width:0;overflow-wrap:anywhere;}
        .zotero-editpane-related[data-refflow-item-id] .reference-heading {display:grid;grid-template-columns:var(--refflow-number-width,3ch) minmax(0,1fr) max(24px,1.75em);column-gap:6px;align-items:start;}
        .zotero-editpane-related[data-refflow-item-id] .reference-state {width:max(8px,.55em);height:max(8px,.55em);border-radius:50%;justify-self:center;margin-block-start:calc((1.5em - max(8px,.55em))/2);}
        .zotero-editpane-related[data-refflow-item-id] .reference-text {font-size:.9em;line-height:1.35;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere;}
        .zotero-editpane-related[data-refflow-item-id] .reference-title {font-size:1em;line-height:1.5;min-width:0;}
        .zotero-editpane-related[data-refflow-item-id] .reference-metadata {margin-inline-start:calc(var(--refflow-number-width,3ch) + 6px);}
        .zotero-editpane-related[data-refflow-item-id] .reference-about {font-size:.85em;opacity:.6;}
        .zotero-editpane-related[data-refflow-item-id] .reference-retracted {color:var(--color-red,#b42318);margin-inline-start:calc(var(--refflow-number-width,3ch) + 6px);}
        .zotero-editpane-related[data-refflow-item-id] .reference-action {appearance:none;box-sizing:border-box;display:grid;place-items:center;margin:0;margin-block-start:calc((1.5em - max(24px,1.75em))/2);padding:0;border:1px solid transparent;background:transparent;color:inherit;border-radius:5px;inline-size:max(24px,1.75em);block-size:max(24px,1.75em);cursor:pointer;font:inherit;line-height:1;}
        .zotero-editpane-related[data-refflow-item-id] .reference-action svg {display:block;width:1.1em;height:1.1em;pointer-events:none;}
        .zotero-editpane-related[data-refflow-item-id] .reference-action:hover {background:var(--material-mix-quaternary,rgba(128,128,128,.15));}
        .zotero-editpane-related[data-refflow-item-id] .reference-action:focus-visible {outline:2px solid var(--color-accent,#3678b5);outline-offset:1px;}
        .zotero-editpane-related[data-refflow-item-id] .reference-action:disabled {cursor:progress;}
        .reference-search-box .icon {
          display: flex;
          justify-content: center;
          align-items: center;
          opacity: 0.8;
        }
        .reference-search-box .icon:hover {
          opacity: 1;
        }
        .zotero-editpane-related .header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 6px;
          border-bottom: 1px solid var(--material-border, #e0e0e0);
        }
        .zotero-editpane-related[data-refflow-item-id] .refflow-source-details .header {
          padding: 4px 0;
          margin-block: 4px;
          border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        }
        .zotero-editpane-related .header label#reference-num {
          flex-grow: 1;
          font-weight: 500;
        }
        .zotero-editpane-related[data-refflow-item-id] .refflow-source-details .header label#reference-num {
          font-size: 0.95em;
        }
        .zotero-editpane-related .header button {
          padding: 2px 8px;
          font-size: 12px;
          cursor: pointer;
          border-radius: 4px;
          border: 1px solid var(--material-border, #ccc);
          background: var(--material-button-background, #f5f5f5);
        }
        .zotero-editpane-related .header button:hover {
          background: var(--material-button-background-hover, #e8e8e8);
        }
      `
    },
  });
  doc.documentElement.appendChild(styles);
}
