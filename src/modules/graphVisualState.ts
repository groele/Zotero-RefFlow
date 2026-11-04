export interface GraphVisualStateContext {
  relatedContainer?: HTMLElement;
  frame?: HTMLIFrameElement;
  getSelectedID: () => string;
  setSelectedID: (id: string) => void;
  setZoteroColor: (color: boolean) => void;
}

/**
 * Synchronizes selection and hover visual states between the graph iframe and the item list.
 */
export function setGraphNodeState(
  arg: { state: "selected" | "hover"; paperID: string },
  ctx: GraphVisualStateContext
): void {
  const container = ctx.relatedContainer;
  const frameWindow = ctx.frame?.contentWindow as any;

  if (arg.state === "selected") {
    let selectedItemNode: HTMLElement | undefined;
    if (container) {
      container.querySelectorAll(".items-container .item").forEach((node) => {
        const itemNode = node as HTMLElement & { _ref?: any };
        if (itemNode._ref?.identifiers?.paperID === arg.paperID) {
          itemNode.classList.add("selected");
          selectedItemNode = itemNode;
        } else {
          itemNode.classList.remove("selected");
        }
      });
    }

    let zoteroColor = true;
    if (selectedItemNode) {
      const parent = selectedItemNode.parentElement;
      if (parent?.classList.contains("prior-items") || parent?.classList.contains("deriv-items")) {
        zoteroColor = false;
      }
    }
    ctx.setZoteroColor(zoteroColor);
    ctx.setSelectedID(arg.paperID);

    frameWindow?.RefFlowGraph?.setState({ selected: arg.paperID });

    if (container) {
      // Highlight matching prior and derivative works
      const sideItems = container.querySelectorAll(".prior-items .item, .deriv-items .item");
      sideItems.forEach((node) => {
        const local = node.getAttribute("local");
        if (local && local.indexOf(arg.paperID) >= 0) {
          node.classList.add("highlight");
        } else {
          node.classList.remove("highlight");
        }
      });

      // Highlight normal items when a prior/deriv item is selected
      if (selectedItemNode) {
        const local = (selectedItemNode as HTMLElement).getAttribute("local");
        container.querySelectorAll(".normal-items .item").forEach((node) => {
          const itemNode = node as HTMLElement & { _ref?: any };
          const pID = itemNode._ref?.identifiers?.paperID;
          if (local && pID && local.indexOf(pID) >= 0) {
            itemNode.classList.add("highlight");
          } else {
            itemNode.classList.remove("highlight");
          }
        });
      }
    }
  } else if (arg.state === "hover") {
    frameWindow?.RefFlowGraph?.setState({ hover: arg.paperID });
    if (container) {
      const selectedID = ctx.getSelectedID();
      container.querySelectorAll(".item").forEach((node) => {
        const itemNode = node as HTMLElement & { _ref?: any };
        if (selectedID && selectedID === itemNode._ref?.identifiers?.paperID) {
          return;
        }
        if (itemNode._ref?.identifiers?.paperID === arg.paperID) {
          itemNode.classList.add("hover");
        } else {
          itemNode.classList.remove("hover");
        }
      });
    }
  }
}
