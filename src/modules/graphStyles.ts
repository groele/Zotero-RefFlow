import { config } from "../../package.json";

/**
 * Injects citation graph stylesheets into the given document.
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
          background-color: #f5f5f5;
        }
        #${id} .item.selected {
          background-color: #ebebeb;
        }
        #${id} .filter-button {
          display: inline-block;
          width: 50%;
          border: 1px solid rgb(238, 238, 238);
          text-align: center;
          color: #005028;
        }
        #${id} .filter-button:hover {
          background-color: #d9e5ec;
        }
        #${id} .filter-button.activate {
          color: #fff;
          background-color: #045384;
        }
        #${id} .item.highlight {
          background-color: #d9f5f9;
        }
        #${id} .item.highlight.hover {
          background-color: #d0ecf0;
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
