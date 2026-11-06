import { config } from "../../package.json";
import TipDOM, { TipTag, TipOptionConfig } from "./tipDOM";
export { TipTag, TipOptionConfig };

export class TipView {
  public static place(container: HTMLDivElement, refRect: Rect, position: string, doc: Document) {
    if (!container) return;
    const setStyles = (styles: { [key: string]: string }) => {
      for (const k in styles) {
        container.style[k as any] = styles[k];
      }
      return container.getBoundingClientRect() as Rect;
    };
    const winRect: Rect = doc.documentElement.getBoundingClientRect();
    const maxWidth = winRect.width;
    const maxHeight = winRect.height;

    let styles: any;
    if (position === "left") {
      styles = {
        right: `${maxWidth - refRect.x}px`,
        bottom: "",
        top: `${refRect.y}px`,
        width: `${refRect.x * 0.7}px`
      };
    } else if (position === "top center") {
      const width = maxWidth * 0.7;
      styles = {
        width: `${width}px`,
        left: `${refRect.x + refRect.width / 2 - width / 2}px`,
        bottom: `${maxHeight - refRect.y}px`,
        top: "",
      };
      container.style.flexDirection = "column-reverse";
    }
    const rect = setStyles(styles);
    if (rect.bottom > maxHeight) {
      setStyles({
        top: "",
        bottom: "0px",
      });
      container.style.flexDirection = "column-reverse";
    }
    if (rect.top < 0) {
      setStyles({
        bottom: "",
        top: "0px",
      });
    }
    if (rect.left < 30) {
      setStyles({
        right: "",
        left: "30px"
      });
    }
    if (maxWidth - rect.right < 30) {
      setStyles({
        left: "",
        right: "30px"
      });
    }
    container.style.opacity = "1";
  }

  public static buildContainer(
    doc: Document,
    shadeMillisecond: number,
    removeTipAfterMillisecond: number,
    optionSize: number,
    handlers: {
      onZoom: (event: any) => void;
      onMouseEnter: () => void;
      onMouseLeave: () => void;
    }
  ): HTMLDivElement {
    const container = ztoolkit.UI.createElement(
      doc,
      "div",
      {
        namespace: "html",
        classList: [`${config.addonRef}-tip-container`],
        styles: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          position: "fixed",
          maxWidth: "calc(100vw - 60px)",
          maxHeight: "calc(100vh - 40px)",
          overflowY: "auto",
          zIndex: "999",
          padding: "1em",
          backgroundColor: (Zotero.Prefs.get(`${config.addonRef}.tipBackgroundColor`) as string) || "var(--material-background, #ffffff)",
          opacity: "0",
          transition: `opacity ${shadeMillisecond / 1000}s linear`,
          "-moz-user-select": "text",
          boxShadow: "0 4px 24px rgb(0 0 0 / 20%)",
          borderRadius: "8px",
        } as any,
        listeners: [
          {
            type: "wheel",
            listener: (event: any) => {
              if (event.ctrlKey) {
                event.preventDefault();
                handlers.onZoom(event);
              }
            }
          },
          {
            type: "DOMMouseScroll",
            listener: (event: any) => {
              if (event.ctrlKey) { handlers.onZoom(event); }
            }
          },
          {
            type: "mouseenter",
            listener: () => { handlers.onMouseEnter(); }
          },
          {
            type: "mouseleave",
            listener: () => { handlers.onMouseLeave(); }
          }
        ],
        children: [
          {
            tag: "box",
            id: "option-container",
            styles: {
              width: "100%",
              height: `${optionSize}px`,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: ".25em",
              marginTop: ".25em"
            },
          },
          {
            tag: "box",
            id: "content-container",
            styles: {
              width: "100%"
            }
          }
        ]
      }
    ) as unknown as HTMLDivElement;
    doc.documentElement.appendChild(container);
    return container;
  }

  public static reset(container: HTMLDivElement, defaultColor: string) {
    container?.querySelector("#content-container")
      ?.childNodes
      ?.forEach((e: any) => {
        e.style.display = "none";
      });
    container?.querySelector("#option-container")
      ?.childNodes
      ?.forEach((e: any) => {
        e.style.backgroundColor = defaultColor;
      });
  }

  public static zoom(container: HTMLDivElement, event: any) {
    const _scale = container.style.transform.match(/scale\((.+)\)/);
    let scale = _scale ? parseFloat(_scale[1]) : 1;
    const minScale = 1, maxScale = 1.7, step = 0.05;
    if (container.style.bottom === "0px") {
      container.style.transformOrigin = "center bottom";
    } else {
      container.style.transformOrigin = "center center";
    }
    const delta = event.deltaY !== undefined ? event.deltaY : event.detail;
    if (delta > 0) {
      scale = scale - step;
      container.style.transform = `scale(${scale < minScale ? minScale : scale})`;
    } else {
      scale = scale + step;
      container.style.transform = `scale(${scale > maxScale ? maxScale : scale})`;
    }
  }
}

export default TipView;
