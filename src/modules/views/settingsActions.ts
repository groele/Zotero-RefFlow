import { getString } from "../../utils/locale";
import { importErrorText } from "../importErrors";
import { safeProviderAttempt } from "../referenceSourceDetails";
import type Views from "../views";

export async function executeSettingsAction(views: Views, action: string): Promise<string> {
  if ((views as any).disposed) throw new Error(getString("cards-context-changed"));
  const win = Zotero.getMainWindow();
  if (!win) throw new Error(getString("cards-settings-no-selection"));
  const reader = views.utils.getReader(win as unknown as Window);
  const attachment = reader?.itemID ? Zotero.Items.get(reader.itemID) : undefined;
  const selected = attachment ? [attachment] : (win.ZoteroPane?.getSelectedItems?.() || []);
  if (selected.length !== 1) throw new Error(getString("cards-settings-no-selection"));
  const item = selected[0].parentItem || selected[0];
  if (!item?.isRegularItem() || item.deleted) throw new Error(getString("cards-settings-no-selection"));

  const panes = (views as any).panes as Set<HTMLElement>;
  const findBody = () => {
    const context = (win as any).document?.getElementById("zotero-context-pane-inner");
    return [...panes].find(node => node.isConnected && node.ownerDocument.defaultView === (win as unknown as Window)
      && Number(node.getAttribute("data-refflow-item-id")) === item.id
      && (attachment ? Boolean(context?.contains(node)) : !context?.contains(node)));
  };

  let body = findBody();
  if (!body) {
    const context = (win as any).document.getElementById("zotero-context-pane-inner");
    if (attachment) {
      if (context) context.collapsed = false;
    } else {
      (win as any).Zotero_Tabs?.select("zotero-pane");
      await win.ZoteroPane.selectItem(item.id);
    }
    for (let i = 0; i < 100 && !body; i++) {
      const scope = attachment ? context : (win as any).document;
      const section = scope?.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] collapsible-section');
      if (section) (section as any).open = true;
      await Zotero.Promise.delay(30);
      body = findBody();
    }
  }

  if (!body || !(body as any)._cards) throw new Error(getString("cards-settings-open-pane"));

  const contextStillMatches = () => {
    if (!body!.isConnected || Number(body!.getAttribute("data-refflow-item-id")) !== item.id || item.deleted) return false;
    const activeReader = views.utils.getReader(win as unknown as Window);
    if (attachment) return activeReader?.itemID === attachment.id;
    const current = win.ZoteroPane?.getSelectedItems?.() || [];
    return !activeReader && current.length === 1 && (current[0].parentItem || current[0]).id === item.id;
  };

  if (!contextStillMatches()) throw new Error(getString("cards-context-changed"));

  if (action !== "rollback" && !((body as any).references?.length)) {
    await views.refreshReferences(body as any, true, false, false, item, reader);
    if (!contextStillMatches()) throw new Error(getString("cards-context-changed"));
    if (!((body as any).references?.length)) throw new Error(getString("cards-settings-no-results"));
  }

  if (!contextStillMatches()) throw new Error(getString("cards-context-changed"));
  const result = await (body as any)._cards.runSettingsAction(action);
  return getString("cards-settings-target-result", { args: { title: String(item.getField("title") || ""), result } });
}

export function formatSettingsError(error: unknown): string {
  return safeProviderAttempt(importErrorText(error));
}

export class SettingsActions {
  public static execute = executeSettingsAction;
  public static formatError = formatSettingsError;
}
