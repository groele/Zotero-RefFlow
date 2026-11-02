import { requestTranslation } from "./tipProviders";
import { config } from "../../package.json";
import Utils from "./utils";
import { TipContentRenderer } from "./ui/tipContentRenderer";

export default class TipUI {
  private utils: Utils;
  private refRect!: Rect;
  private position!: string;
  public container!: HTMLDivElement;
  public shadeMillisecond!: number;
  public removeTipAfterMillisecond!: number;
  private option = {
    size: 8,
    color: {
      active: "#FF597B",
      default: "#F9B5D0"
    }
  }
  public tipTimer!: ReturnType<typeof globalThis.setTimeout>;
  private controller=new AbortController();
  get signal():AbortSignal{return this.controller.signal;}

  constructor(utils: Utils, private win: Window = window) {
    const rawShade = Zotero.Prefs.get(`${config.addonRef}.shadeMillisecond`);
    this.shadeMillisecond = rawShade ? parseInt(String(rawShade)) : 300;
    if (isNaN(this.shadeMillisecond)) this.shadeMillisecond = 300;

    const rawRemove = Zotero.Prefs.get(`${config.addonRef}.removeTipAfterMillisecond`);
    this.removeTipAfterMillisecond = rawRemove ? parseInt(String(rawRemove)) : 1000;
    if (isNaN(this.removeTipAfterMillisecond)) this.removeTipAfterMillisecond = 1000;
    this.utils = utils;
  }

  private get doc(): Document { return this.win.document; }

  public onInit(refRect: Rect, position:string) {
    this.refRect = refRect;
    this.position = position;
    // 初始化，先移除其它container
    this.clear()
    this.controller=new AbortController();
    this.buildContainer()
  }

  public clear() {
    this.controller.abort();
    this.doc.querySelectorAll(`.${config.addonRef}-tip-container`).forEach((e: any) => {
      e.style.opacity = "0"
      globalThis.setTimeout(() => {
        e.remove()
      }, this.shadeMillisecond);
    })
  }
  /**
   * 放置container到合适位置
   * 
   */
  private place() {
    `
		winRect = {
			bottom: 792
			height: 792
			left: 0
			right: 1536
			top: 0
			width: 1536
			x: 0
			y: 0
		}
		eleRect = {
			bottom: 188
			height: 16
			left: 1196
			right: 1507
			top: 172
			width: 310
			x: 1196
			y: 172
		}
		右上(x=0, y=0)
		`
    if (!this.container) return;
    let setStyles = (styles: {[key: string]: string}) => {
      for (let k in styles) {
        this.container.style[k as any] = styles[k]
      }
      return this.container.getBoundingClientRect() as Rect
    }
    const winRect: Rect = this.doc.documentElement.getBoundingClientRect()
    const maxWidth = winRect.width;
    const maxHeight = winRect.height;
    const refRect = this.refRect;

    // 左侧
    let styles: any
    if (this.position == "left") {
      styles = {
        // right: `${maxWidth - refRect.x + maxWidth * .014}px`,
        right: `${maxWidth - refRect.x}px`,

        bottom: "",
        top: `${refRect.y}px`,
        width: `${refRect.x * .7}px`
      }
    } else if (this.position == "top center") {
      let width = maxWidth * .7
      styles = {
        width: `${width}px`,
        left: `${refRect.x + refRect.width / 2 - width / 2}px`,
        bottom: `${maxHeight - refRect.y}px`,
        top: "",
      }
      this.container.style.flexDirection = "column-reverse"
    }
    let rect = setStyles(styles)
    // 判断是否超届
    if (rect.bottom > maxHeight) {
      setStyles({
        top: "",
        bottom: "0px",
      })
      this.container.style.flexDirection = "column-reverse"
    }
    if (rect.top < 0) {
      setStyles({
        bottom: "",
        top: "0px",
      })
    }
    if (rect.left < 30) {
      setStyles({
        right: "",
        left: "30px"
      })
    }
    if (maxWidth - rect.right < 30 ) {
      setStyles({
        left: "",
        right: "30px"
      })
    }
    this.container.style.opacity = "1";
    return
  }

  private buildContainer() {
    // 位置计算
    this.container = ztoolkit.UI.createElement(
      this.doc,
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
          // border: "2px solid transparent",
          padding: "1em",
          backgroundColor: (Zotero.Prefs.get(`${config.addonRef}.tipBackgroundColor`) as string) || "var(--material-background, #ffffff)",
          opacity: "0",
          transition: `opacity ${this.shadeMillisecond / 1000}s linear`,
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
                this.zoom(event);
              }
            }
          },
          {
            type: "DOMMouseScroll",
            listener: (event: any) => {
              if (event.ctrlKey) { this.zoom(event); }
            }
          },
          {
            type: "mouseenter",
            listener: () => {
              globalThis.clearTimeout(this.tipTimer);
            }
          },
          {
            type: "mouseleave",
            listener: () => {
              this.tipTimer = globalThis.setTimeout(() => {
                this.container.remove();
              }, this.removeTipAfterMillisecond);
            }
          }
        ],
        children: [
          {
            tag: "box",
            id: "option-container",
            styles: {
              width: "100%",
              height: `${this.option.size}px`,
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
    ) as unknown as HTMLDivElement
    this.doc.documentElement.appendChild(this.container)
  }

  /**
   * @param title 标题
   * @param tags 标签
   * @param descriptions 描述，一般是期刊，年份作者等
   * @param content 正文，一般是摘要
   * @returns 
   */
  public addTip(
    title: string,
    tags: { source: string; text: string, color: string, tip?: string, url?: string, item?: Zotero.Item }[],
    descriptions: string[],
    content: string,
    according: string,
    index: number,
    prefIndex?: number
  ) {
    return TipContentRenderer.render(this, title, tags, descriptions, content, according, index, prefIndex);
  }

  private reset() {
    this.container?.querySelector("#content-container")
      ?.childNodes
      ?.forEach((e: any) => {
        e.style.display = "none";
      });
    this.container?.querySelector("#option-container")
      ?.childNodes
      ?.forEach((e: any) => {
        e.style.backgroundColor = this.option.color.default;
      });
  }

  private zoom(event: any) {
    let _scale = this.container.style.transform.match(/scale\((.+)\)/)
    let scale = _scale ? parseFloat(_scale[1]) : 1
    let minScale = 1, maxScale = 1.7, step = 0.05
    if (this.container.style.bottom == "0px") {
      this.container.style.transformOrigin = "center bottom"
    } else {
      this.container.style.transformOrigin = "center center"
    }
    const delta = event.deltaY !== undefined ? event.deltaY : event.detail;
    if (delta > 0) {
      // 缩小
      scale = scale - step
      this.container.style.transform = `scale(${scale < minScale ? minScale : scale})`;
    } else {
      // 放大
      scale = scale + step
      this.container.style.transform = `scale(${scale > maxScale ? maxScale : scale})`;
    }
  }
}
