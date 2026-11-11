import { config } from "../../package.json";

/**
 * Injects citation graph stylesheets into the given document with Dark Mode CSS variable support.
 */
export function addGraphStyles(doc: Document): void {
  const id = `${config.addonRef}-related-container`;
  ztoolkit.UI.appendElement({
    tag: "style",
    id: `${config.addonRef}-graph-style`,
    namespace: "html",
    properties: {
      innerHTML: `
        #${id} * {
          transition: background-color .1s linear;
        }
        #${id} .button, #${id} .item, #${id} .filter-button {
          height: 2em;
          line-height: 2em;
          cursor: pointer;
        }
        #${id} .button:hover, #${id} .item.hover {
          background-color: var(--material-mix-quinary, rgba(128, 128, 128, .12));
        }
        #${id} .item.selected {
          background-color: var(--color-accent-10, rgba(60, 120, 200, .18));
        }
        #${id} .filter-button {
          display: inline-block;
          width: 50%;
          border: 1px solid var(--material-border, rgb(238, 238, 238));
          text-align: center;
          color: var(--fill-primary, #005028);
        }
        #${id} .filter-button:hover {
          background-color: var(--material-mix-quaternary, #d9e5ec);
        }
        #${id} .filter-button.activate {
          color: #fff;
          background-color: var(--color-accent, #045384);
        }
        #${id} .item.highlight {
          background-color: color-mix(in srgb, var(--color-accent, #045384) 16%, transparent);
        }
        #${id} .item.highlight.hover {
          background-color: color-mix(in srgb, var(--color-accent, #045384) 24%, transparent);
        }
      `
      + (Zotero.isMac ? "" : `
      #${config.addonRef}-show-hide-graph-view .toolbarbutton-icon {
        width: 16px;
        height: 16px;
      }
      `)
    },
  }, doc.documentElement);
}
