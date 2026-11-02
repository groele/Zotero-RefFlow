import { requestTranslation } from "../tipProviders";
import { config } from "../../../package.json";
import type TipUI from "../tip";

export class TipContentRenderer {
  public static render(
    tipUI: TipUI,
    title: string,
    tags: { source: string; text: string, color: string, tip?: string, url?: string, item?: Zotero.Item }[],
    descriptions: string[],
    content: string,
    according: string,
    index: number,
    prefIndex?: number
  ) {
    const container = tipUI.container;
    const doc = (tipUI as any).doc as Document;
    const utils = (tipUI as any).utils;
    const win = (tipUI as any).win;
    const option = (tipUI as any).option;

    if (!container || (!container.isConnected && !doc.documentElement.contains(container))) {
      return;
    }
    const optionContainer = container.querySelector("#option-container") as HTMLElement;
    const contentContainer = container.querySelector("#content-container") as HTMLElement;
    if (!optionContainer || !contentContainer) return;

    const translate = requestTranslation;
    const translateNode = async function (this: HTMLElement, event: any) {
      if (
        (
          (Zotero.isMac && event.metaKey && !event.ctrlKey) ||
          (!Zotero.isMac && event.ctrlKey)
        ) &&
        Zotero.Prefs.get(`${config.addonRef}.ctrlClickTranslate`)
      ) {
        const node = this;
        let sourceText = node.getAttribute("sourceText");
        let translatedText = node.getAttribute("translatedText")!;
        ztoolkit.log(sourceText, translatedText);
        if (!sourceText) {
          sourceText = node.innerText;
          node.setAttribute("sourceText", sourceText);
        }
        if (!translatedText) {
          translatedText = (await translate(sourceText)) || "";
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

        if (node.innerText == sourceText) {
          ztoolkit.log("-> translatedText");
          node.innerText = translatedText;
        } else if (node.innerText == translatedText) {
          node.innerText = sourceText;
          ztoolkit.log("-> sourceText");
        }
      }
    };

    const isSelect = (
      (index !== undefined && prefIndex !== undefined && index == prefIndex) ||
      optionContainer.childNodes.length == 0
    );
    if (isSelect) { (tipUI as any).reset(); }

    const contentNode = ztoolkit.UI.createElement(
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
                listener: translateNode
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
              if (!tagList) { return []; }
              const arr = [];
              for (const tag of tagList) {
                arr.push({
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
                          tipUI.clear();
                          Zotero.ProgressWindowSet.closeAll();
                          utils.selectItemInLibrary(tag.item, win);
                        } else {
                          utils.copyText(tag.text);
                        }
                      }
                    },
                    {
                      type: "mouseenter",
                      listener: () => {
                        if (!tag.tip) { return; }
                        Zotero.ProgressWindowSet.closeAll();
                        (new ztoolkit.ProgressWindow("Reference", { closeTime: -1 }))
                          .createLine({ text: tag.tip, type: "default" })
                          .show();
                      }
                    },
                    {
                      type: "mouseleave",
                      listener: () => {
                        if (!tag.tip) { return; }
                        Zotero.ProgressWindowSet.closeAll();
                      }
                    }
                  ]
                });
              }
              return arr;
            })(tags) as any
          }] : []),
          ...(descriptions && descriptions.length > 0 ? [{
            tag: "div",
            id: "descriptions",
            styles: {
              marginBottom: "0.25em"
            },
            children: ((descList) => {
              if (!descList) { return []; }
              const arr = [];
              for (const text of descList) {
                arr.push({
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
                });
              }
              return arr;
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
                listener: translateNode
              }
            ]
          }
        ]
      }
    ) as HTMLDivElement;

    const optionNode = ztoolkit.UI.createElement(
      doc,
      "div",
      {
        id: `option-${index}`,
        styles: {
          width: `${option.size}px`,
          height: `${option.size}px`,
          borderRadius: "50%",
          backgroundColor: isSelect ? option.color.active : option.color.default,
          marginLeft: `${option.size * .5}px`,
          marginRight: `${option.size * .5}px`,
          cursor: "pointer",
          transition: "background-color 0.23s linear"
        },
        listeners: [
          {
            type: "click",
            listener: () => {
              (tipUI as any).reset();
              optionNode.style.backgroundColor = option.color.active;
              contentNode.style.display = "";
              Zotero.Prefs.set(`${config.addonRef}.${according}InfoIndex`, index!);
              (tipUI as any).place();
            },
          },
          {
            type: "mouseenter",
            listener: () => {
              const tag = tags.find(t => t.source);
              const source = (
                (tag && tag.source && according && `${tag.source} view according to ${according}`) ||
                "reference view"
              );
              optionNode.title = source;
            }
          },
          {
            type: "mouseleave",
            listener: () => { }
          }
        ]
      }
    ) as HTMLDivElement;

    const optionNodes = [...optionContainer.querySelectorAll("[id^=option]")] as HTMLElement[];
    if (optionNodes.length == 0) {
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
    contentContainer.appendChild(contentNode);
    (tipUI as any).place();
  }
}
