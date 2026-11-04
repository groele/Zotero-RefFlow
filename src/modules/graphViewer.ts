import { config } from "../../package.json";

export interface GraphViewerResult {
  graphContainer: HTMLDivElement;
  frame: HTMLIFrameElement;
  cleanup: () => void;
}

/**
 * Initializes the embedded graph viewer iframe container and vertical resize splitter.
 */
export function createGraphViewer(
  doc: Document,
  getBoxAfter: () => HTMLElement | undefined
): GraphViewerResult | undefined {
  const mainNode = doc.querySelector("#item-tree-main-default");
  if (!mainNode) return undefined;

  const minHeight = 200;
  const initialHeight = (Zotero.Prefs.get(`${config.addonRef}.graphView.height`) as string) || "400px";

  const graphContainer = ztoolkit.UI.createElement(doc, "div", {
    id: "graph-view",
    styles: {
      width: "100%",
      minHeight: `${minHeight}px`,
      height: initialHeight,
      display: "none",
    }
  }) as HTMLDivElement;

  const frame = ztoolkit.UI.createElement(doc, "iframe", { namespace: "html" }) as HTMLIFrameElement;
  frame.style.border = "none";
  frame.style.outline = "none";
  frame.style.width = "100%";
  frame.style.height = graphContainer.style.height;
  frame.style.overflow = "hidden";
  frame.style.backgroundColor = "transparent";
  graphContainer.append(frame);
  mainNode.append(graphContainer);

  const resizer = ztoolkit.UI.createElement(doc, "div", {
    styles: {
      height: "1px",
      width: "100%",
      backgroundColor: "#cecece",
      cursor: "ns-resize",
    },
  });
  graphContainer.insertBefore(resizer, frame);

  let y = 0;
  let h = 0;

  const mouseMoveHandler = (e: MouseEvent) => {
    const dy = e.clientY - y;
    const hh = h - dy;
    const height = `${hh <= minHeight ? minHeight : hh}px`;
    graphContainer.style.height = height;
    frame.style.height = height;
    const boxAfter = getBoxAfter();
    if (boxAfter) boxAfter.style.height = height;
    Zotero.Prefs.set(`${config.addonRef}.graphView.height`, height);
  };

  const mouseUpHandler = () => {
    frame.style.display = "";
    doc.removeEventListener("mousemove", mouseMoveHandler);
    doc.removeEventListener("mouseup", mouseUpHandler);
  };

  const mouseDownHandler = (e: MouseEvent) => {
    frame.style.display = "none";
    y = e.clientY;
    const rect = graphContainer.getBoundingClientRect();
    h = rect.height;
    doc.addEventListener("mousemove", mouseMoveHandler);
    doc.addEventListener("mouseup", mouseUpHandler);
  };

  resizer.addEventListener("mousedown", mouseDownHandler);

  const cleanup = () => {
    resizer.removeEventListener("mousedown", mouseDownHandler);
    doc.removeEventListener("mousemove", mouseMoveHandler);
    doc.removeEventListener("mouseup", mouseUpHandler);
    graphContainer.remove();
  };

  return { graphContainer, frame, cleanup };
}
