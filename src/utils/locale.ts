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
  return localStringWithPrefix;
}
