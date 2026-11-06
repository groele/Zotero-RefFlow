import { config } from "../../package.json";
import Utils from "./utils";
import TipView from "./tipView";
import TipDOM, { TipTag } from "./tipDOM";

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
  };
  public tipTimer!: ReturnType<typeof globalThis.setTimeout>;
  private controller = new AbortController();
  get signal(): AbortSignal { return this.controller.signal; }

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

  public onInit(refRect: Rect, position: string) {
    this.refRect = refRect;
    this.position = position;
    this.clear();
    this.controller = new AbortController();
    this.buildContainer();
  }

  public clear() {
    this.controller.abort();
    this.doc.querySelectorAll(`.${config.addonRef}-tip-container`).forEach((e: any) => {
      e.style.opacity = "0";
      globalThis.setTimeout(() => {
        e.remove();
      }, this.shadeMillisecond);
    });
  }

  private place() {
    TipView.place(this.container, this.refRect, this.position, this.doc);
  }

  private buildContainer() {
    this.container = TipView.buildContainer(
      this.doc,
      this.shadeMillisecond,
      this.removeTipAfterMillisecond,
      this.option.size,
      {
        onZoom: (event) => this.zoom(event),
        onMouseEnter: () => globalThis.clearTimeout(this.tipTimer),
        onMouseLeave: () => {
          this.tipTimer = globalThis.setTimeout(() => {
            this.container?.remove();
          }, this.removeTipAfterMillisecond);
        }
      }
    );
  }

  public addTip(
    title: string,
    tags: TipTag[],
    descriptions: string[],
    content: string,
    according: string,
    index: number,
    prefIndex?: number
  ) {
    if (!this.container || (!this.container.isConnected && !this.doc.documentElement.contains(this.container))) {
      return;
    }
    const optionContainer = this.container.querySelector("#option-container") as HTMLElement;
    const contentContainer = this.container.querySelector("#content-container") as HTMLElement;
    if (!optionContainer || !contentContainer) return;

    const isSelect = (
      (index !== undefined && prefIndex !== undefined && index == prefIndex) ||
      optionContainer.childNodes.length === 0
    );
    if (isSelect) { this.reset(); }

    const contentNode = TipDOM.buildContentNode(
      this.doc,
      title,
      tags,
      descriptions,
      content,
      isSelect,
      this.utils,
      this.win,
      () => this.clear()
    );

    const optionNode = TipDOM.buildOptionDot(
      this.doc,
      index,
      isSelect,
      tags,
      according,
      this.option,
      () => {
        this.reset();
        optionNode.style.backgroundColor = this.option.color.active;
        contentNode.style.display = "";
        Zotero.Prefs.set(`${config.addonRef}.${according}InfoIndex`, index!);
        this.place();
      }
    );

    TipDOM.insertOptionNode(optionContainer, optionNode, index);
    contentContainer.appendChild(contentNode);
    this.place();
  }

  private reset() {
    TipView.reset(this.container, this.option.color.default);
  }

  private zoom(event: any) {
    TipView.zoom(this.container, event);
  }
}
