import { config } from "../../package.json";

export { initLocale, getString };

let moduleL10n: any = null;

function getAddonInstance(): any {
  if (typeof (globalThis as any).addon !== "undefined") return (globalThis as any).addon;
  if (typeof (globalThis as any)._globalThis !== "undefined" && (globalThis as any)._globalThis.addon) return (globalThis as any)._globalThis.addon;
  if (typeof (Zotero as any)?.[config.addonInstance] !== "undefined") return (Zotero as any)[config.addonInstance];
  return undefined;
}

/**
 * Initialize locale data
 */
function initLocale() {
  try {
    const LocalizationClass =
      typeof Localization === "undefined"
        ? (typeof ztoolkit !== "undefined" ? ztoolkit.getGlobal("Localization") : undefined) ||
          (typeof globalThis !== "undefined" ? (globalThis as any).Localization : undefined)
        : Localization;
    if (LocalizationClass) {
      moduleL10n = new LocalizationClass([`${config.addonRef}-addon.ftl`], true);
    }
    const addonObj = getAddonInstance();
    if (addonObj) {
      addonObj.data = addonObj.data || {};
      addonObj.data.locale = {
        current: moduleL10n,
      };
    }
    try {
      (Zotero as any).ftl?.addResourceIds?.([`${config.addonRef}-addon.ftl`]);
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

/**
 * Get locale string, see https://firefox-source-docs.mozilla.org/l10n/fluent/tutorial.html#fluent-translation-list-ftl
 * @param localString ftl key
 * @param options.branch branch name
 * @param options.args args
 */
function getString(localString: string): string;
function getString(localString: string, branch: string): string;
function getString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> },
): string;
function getString(...inputs: any[]) {
  if (inputs.length === 1) {
    return _getString(inputs[0]);
  } else if (inputs.length === 2) {
    if (typeof inputs[1] === "string") {
      return _getString(inputs[0], { branch: inputs[1] });
    } else {
      return _getString(inputs[0], inputs[1]);
    }
  } else {
    throw new Error("Invalid arguments");
  }
}

const DEFAULT_STRINGS: Record<string, string> = {
  "relatedbox-search-placeholder": "搜索",
  "cards-source-details": "参考文献数据源与证据",
  "relatedbox-number-label": "条参考文献：",
  "relatedbox-fetch-label": "获取参考文献",
  "relatedbox-loading": "正在获取参考文献…",
  "relatedbox-cancelled": "已取消获取",
  "relatedbox-empty": "未找到参考文献，请检查文本层或换用另一来源",
  "relatedbox-timeout": "获取超时，请重试或换用另一来源",
  "relatedbox-fetch-error": "获取失败，请重试",
  "cards-list-name": "参考文献",
  "cards-copy-text": "复制参考文献文本",
  "cards-copy-doi": "复制 DOI",
  "cards-copy-url": "复制链接",
  "cards-open": "在 Zotero 或浏览器中打开",
  "cards-import-selected": "按 DOI 添加选中文献",
  "cards-import-all": "按 DOI 添加全部文献",
  "cards-cached-offline": "网络不可用，显示缓存",
  "cards-kept-results": "保留上次结果",
  "cards-no-search-results": "没有匹配的参考文献，按 Esc 清除搜索",
  "cards-context-changed": "上下文已改变",
  "cards-refresh-empty-kept": "刷新无结果，保留上次结果",
  "cards-in-library": "在 Zotero 文库中",
  "cards-cited": "被引",
  "cards-show-library": "在文库中显示",
  "cards-import": "按 DOI 添加到 Zotero",
};

function _getString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const { branch, args } = options;
  let l10n = moduleL10n;
  if (!l10n) {
    const addonObj = getAddonInstance();
    l10n = addonObj?.data?.locale?.current;
  }
  if (!l10n) {
    initLocale();
    l10n = moduleL10n;
  }
  if (l10n) {
    try {
      const pattern = l10n.formatMessagesSync([
        { id: localStringWithPrefix, args },
      ])?.[0];
      if (pattern) {
        if (branch) {
          if (Array.isArray(pattern.attributes)) {
            const attr = pattern.attributes.find((a: any) => a.name === branch);
            if (attr?.value) return attr.value;
          } else if (pattern.attributes?.[branch]) {
            return pattern.attributes[branch];
          }
        }
        if (pattern.value) return pattern.value;
        if (Array.isArray(pattern.attributes)) {
          const attr = pattern.attributes.find((a: any) => a.name === "label");
          if (attr?.value) return attr.value;
        }
      }
      if (typeof l10n.formatValueSync === "function") {
        const val = l10n.formatValueSync(localStringWithPrefix, args);
        if (val && val !== localStringWithPrefix) return val;
      }
    } catch {
      // ignore
    }
  }
  try {
    const ftlVal = (Zotero as any)?.ftl?.formatValueSync?.(localStringWithPrefix, args);
    if (ftlVal && ftlVal !== localStringWithPrefix) return ftlVal;
  } catch {
    // ignore
  }
  return DEFAULT_STRINGS[localeString] || localStringWithPrefix;
}
