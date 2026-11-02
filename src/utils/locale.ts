import { config } from "../../package.json";

export { initLocale, getString };

/**
 * Initialize locale data
 */
function initLocale() {
  try {
    const LocalizationClass =
      typeof Localization === "undefined"
        ? ztoolkit.getGlobal("Localization")
        : Localization;
    const l10n = new LocalizationClass([`${config.addonRef}-addon.ftl`], true);
    if (typeof (globalThis as any).addon !== "undefined") {
      (globalThis as any).addon.data = (globalThis as any).addon.data || {};
      (globalThis as any).addon.data.locale = {
        current: l10n,
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
 * @example
 * ```ftl
 * # addon.ftl
 * addon-static-example = This is default branch!
 *     .branch-example = This is a branch under addon-static-example!
 * addon-dynamic-example =
    { $count ->
        [one] I have { $count } apple
       *[other] I have { $count } apples
    }
 * ```
 * ```js
 * getString("addon-static-example"); // This is default branch!
 * getString("addon-static-example", { branch: "branch-example" }); // This is a branch under addon-static-example!
 * getString("addon-dynamic-example", { args: { count: 1 } }); // I have 1 apple
 * getString("addon-dynamic-example", { args: { count: 2 } }); // I have 2 apples
 * ```
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
};

function _getString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const { branch, args } = options;
  if (typeof (globalThis as any).addon === "undefined" || !(globalThis as any).addon?.data?.locale?.current) {
    initLocale();
  }
  const l10n = (globalThis as any).addon?.data?.locale?.current;
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
  return DEFAULT_STRINGS[localeString] || localStringWithPrefix;
}
