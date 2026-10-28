// Zotero loads this script before inserting the preferences fragment.
// Its child load/unload events do not bubble, so listen in the capture phase.
(() => {
  const rootID = "zotero-prefpane-__addonRef__";
  const owner = Zotero.__addonInstance__;
  if (!owner?.data.alive) return;
  let root;
  let disposed = false;

  function onClick(event) {
    if (disposed || !owner.data.alive || event.defaultPrevented || event.button !== 0) return;
    const button = event.target?.closest?.("button[data-refflow-action]");
    if (button?.dataset?.refflowAction && root?.contains(button)) {
      const status=root.querySelector("#__addonRef__-actions-status");
      if(status)status.textContent=root.querySelector("#__addonRef__-actions-working")?.textContent||"";
      root.querySelectorAll("button[data-refflow-action]").forEach(node=>node.disabled=true);
      Promise.resolve().then(()=>owner.views.runSettingsAction(button.dataset.refflowAction)).then(message=>{if(status)status.textContent=message;}).catch(error=>{if(status)status.textContent=owner.views?.settingsError(error)||String(error?.message||error);}).finally(()=>root?.querySelectorAll("button[data-refflow-action]").forEach(node=>node.disabled=false));
      return;
    }
    const link = event.target?.closest?.("a[href]");
    if (!link || !root?.contains(link)) return;
    event.preventDefault();
    try { Zotero.launchURL(link.href); }
    catch (error) { Zotero.logError(error); }
  }

  function onChange(event) {
    if(event.target?.id==="__addonRef__-show-source-details") {
      Zotero.Prefs.set("__addonRef__.showSourceDetails",Boolean(event.target.checked));
      owner.views?.updateSourceDetailsVisibility();
    }
  }
  function init() {
    if (disposed || !owner.data.alive) return;
    const next = document.getElementById(rootID);
    if (!next || next === root) return;
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("command", onChange);
    root = next;
    root.addEventListener("click", onClick);
    root.addEventListener("command", onChange);
    Promise.resolve().then(() => {
      if (!disposed && owner.data.alive) return owner.hooks.onPrefsEvent("load", { window });
    }).catch(error => Zotero.logError(error));
  }

  function onLoad(event) {
    if (event.target?.id === rootID) init();
  }

  function onUnload(event) {
    if (event.target === root || event.target === document || event.target === window) dispose();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("command", onChange);
    document.removeEventListener("load", onLoad, true);
    document.removeEventListener("unload", onUnload, true);
    window.removeEventListener("unload", dispose);
    owner.data.preferenceCleanups.delete(dispose);
    if (owner.data.prefs?.window === window) delete owner.data.prefs;
    root = undefined;
  }

  owner.data.preferenceCleanups.add(dispose);
  document.addEventListener("load", onLoad, true);
  document.addEventListener("unload", onUnload, true);
  window.addEventListener("unload", dispose);
  init();
})();
