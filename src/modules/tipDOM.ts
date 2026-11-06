import { config } from "../../package.json";
import Utils from "./utils";

export interface TipTag {
  source: string;
  text: string;
  color: string;
  tip?: string;
  url?: string;
  item?: Zotero.Item;
}

export interface TipOptionConfig {
  size: number;
  color: {
    active: string;
    default: string;
  };
}

export class TipDOM {
  public static async translateNode(event: any) {
    if (
      (
        (Zotero.isMac && event.metaKey && !event.ctrlKey) ||
        (!Zotero.isMac && event.ctrlKey)
      ) &&
      Zotero.Prefs.get(`${config.addonRef}.ctrlClickTranslate`)
    ) {
      const node = (event.currentTarget || event.target) as HTMLElement;
      if (!node) return;
      let sourceText = node.getAttribute("sourceText");
      let translatedText = node.getAttribute("translatedText")!;
      ztoolkit.log(sourceText, translatedText);
      if (!sourceText) {
        sourceText = node.innerText;
        node.setAttribute("sourceText", sourceText);
      }
      if (!translatedText) {
        const provider = (Zotero as typeof Zotero & {
          PDFTranslate?: { api: { translate(text: string): Promise<{ result?: string }> } };
        }).PDFTranslate;
        translatedText = (provider ? (await provider.api.translate(sourceText))?.result : undefined) || "";
        if (!translatedText) {
          if (typeof ztoolkit !== "undefined" && ztoolkit.ProgressWindow) {
            (new ztoolkit.ProgressWindow("Translate"))
              .createLine({ text: "未检测到已安装的翻译插件 (PDF Translate) 或翻译失败", type: "fail" })
              .show();
          }
          return;
        }
        node.setAttribute("translatedText", translatedText);
      }

      if (node.innerText === sourceText) {
        ztoolkit.log("-> translatedText");
        node.innerText = translatedText;
      } else if (node.innerText === translatedText) {
        node.innerText = sourceText;
        ztoolkit.log("-> sourceText");
      }
    }
  }

  public static buildContentNode(
    doc: Document,
    title: string,
    tags: TipTag[],
    descriptions: string[],
    content: string,
    isSelect: boolean,
    utils: Utils,
    win: Window,
    onClear: () => void
  ): HTMLDivElement {
    return ztoolkit.UI.createElement(
      doc,
      "div",
      {
        classList: [`${config.addonRef}-tip`],
        styles: {
          padding: "0px",
          width: "100%",
          display: isSelect ? "" : "none"
        },
        subElementOptions: [
          {
            tag: "span",
            classList: ["title"],
            styles: {
              display: "block",
              fontWeight: "bold",
              marginBottom: ".25em",
              fontSize: "1.2em",
              color: (Zotero.Prefs.get(`${config.addonRef}.tipTitleColor`) as string) || "var(--material-text-color, #1e293b)"
            },
            directAttributes: {
              innerText: title
            },
            listeners: [
              {
                type: "click",
                listener: (e: any) => this.translateNode(e)
              }
            ]
          },
          ...(tags && tags.length > 0 ? [{
            tag: "div",
            id: "tags",
            styles: {
              width: "100%",
            },
            subElementOptions: ((tagList) => {
              if (!tagList) return [];
              return tagList.map(tag => ({
                tag: "span",
                directAttributes: {
                  innerText: tag.text
                },
                styles: {
                  backgroundColor: tag.color,
                  borderRadius: "10px",
                  margin: "0.5em 1em 0.5em 0px",
                  display: "inline-block",
                  padding: "0 8px",
                  color: "white",
                  cursor: "pointer",
                  userSelect: "none"
                },
                listeners: [
                  {
                    type: "click",
                    listener: () => {
                      if (tag.url) {
                        (new ztoolkit.ProgressWindow("Launching URL"))
                          .createLine({ text: tag.url, type: "default" })
                          .show();
                        Zotero.launchURL(tag.url);
                      } else if (tag.item) {
                        onClear();
                        Zotero.ProgressWindowSet.closeAll();
                        (utils as any).selectItemInLibrary(tag.item, win);
                      } else {
                        utils.copyText(tag.text);
                      }
                    }
                  },
                  {
                    type: "mouseenter",
                    listener: () => {
                      if (!tag.tip) return;
                      Zotero.ProgressWindowSet.closeAll();
                      (new ztoolkit.ProgressWindow("Reference", { closeTime: -1 }))
                        .createLine({ text: tag.tip, type: "default" })
                        .show();
                    }
                  },
                  {
                    type: "mouseleave",
                    listener: () => {
                      if (!tag.tip) return;
                      Zotero.ProgressWindowSet.closeAll();
                    }
                  }
                ]
              }));
            })(tags) as any
          }] : []),
          ...(descriptions && descriptions.length > 0 ? [{
            tag: "div",
            id: "descriptions",
            styles: {
              marginBottom: "0.25em"
            },
            children: ((descList) => {
              if (!descList) return [];
              return descList.map(text => ({
                tag: "span",
                id: "content",
                styles: {
                  display: "block",
                  lineHeight: "1.5em",
                  opacity: "0.5",
                  cursor: "pointer",
                  userSelect: "none"
                },
                properties: {
                  innerText: text
                },
                listeners: [
                  {
                    type: "click",
                    listener: () => {
                      utils.copyText(text);
                    }
                  }
                ]
              }));
            })(descriptions) as any
          }] : []),
          {
            tag: "span",
            id: "content",
            properties: {
              innerText: content
            },
            styles: {
              display: "block",
              lineHeight: "1.5em",
              textAlign: "justify",
              opacity: "0.8",
              maxHeight: "300px",
              overflowY: "auto",
              marginTop: ".25em"
            },
            listeners: [
              {
                type: "click",
                listener: (e: any) => this.translateNode(e)
              }
            ]
          }
        ]
      }
    ) as HTMLDivElement;
  }

  public static buildOptionDot(
    doc: Document,
    index: number,
    isSelect: boolean,
    tags: TipTag[],
    according: string,
    option: TipOptionConfig,
    onClick: () => void
  ): HTMLDivElement {
    let optionNode: HTMLDivElement;
    optionNode = ztoolkit.UI.createElement(
      doc,
      "div",
      {
        id: `option-${index}`,
        styles: {
          width: `${option.size}px`,
          height: `${option.size}px`,
          borderRadius: "50%",
          backgroundColor: isSelect ? option.color.active : option.color.default,
          marginLeft: `${option.size * 0.5}px`,
          marginRight: `${option.size * 0.5}px`,
          cursor: "pointer",
          transition: "background-color 0.23s linear"
        },
        listeners: [
          {
            type: "click",
            listener: onClick
          },
          {
            type: "mouseenter",
            listener: (event: any) => {
              const tag = tags.find(t => t.source);
              const source = (
                (tag && tag.source && according && `${tag.source} view according to ${according}`) ||
                "reference view"
              );
              const target = (optionNode || event?.currentTarget || doc.getElementById(`option-${index}`)) as HTMLElement;
              if (target) target.title = source;
            }
          },
          {
            type: "mouseleave",
            listener: () => {}
          }
        ]
      }
    ) as HTMLDivElement;
    return optionNode;
  }

  public static insertOptionNode(optionContainer: HTMLElement, optionNode: HTMLElement, index: number) {
    const optionNodes = [...optionContainer.querySelectorAll("[id^=option]")] as HTMLElement[];
    if (optionNodes.length === 0) {
      optionContainer.appendChild(optionNode);
    } else {
      const getIndex = (node: HTMLElement) => Number(node.id.split("-")[1]);
      for (let i = 0; i < optionNodes.length; i++) {
        if (index > getIndex(optionNodes[i])) {
          if (i + 1 < optionNodes.length) {
            if (index < getIndex(optionNodes[i + 1])) {
              optionContainer.insertBefore(optionNode, optionNodes[i + 1]);
              break;
            }
          } else {
            optionContainer.appendChild(optionNode);
            break;
          }
        } else {
          optionContainer.insertBefore(optionNode, optionNodes[i]);
          break;
        }
      }
    }
  }
}

export default TipDOM;
