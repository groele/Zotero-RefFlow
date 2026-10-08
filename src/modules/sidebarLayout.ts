/** Remove the exact host mutation left by RefNexus <= 10.3.1 after a hot upgrade. */
export function restoreLegacySidebarLayout(doc: Document): boolean {
  const host = doc.getElementById("zotero-item-pane");
  const content = doc.getElementById("zotero-item-pane-content");
  const rail = doc.getElementById("zotero-view-item-sidenav");
  if (!host || host.localName !== "item-pane" || content?.parentElement !== host || rail?.parentElement !== host) return false;
  const legacy = doc.getElementById("connected-papers-relatedsplit-after");
  if ([...host.children].some(child => child !== content && child !== rail && child !== legacy)) return false;
  if (legacy?.parentElement === host) legacy.remove();
  if (host.getAttribute("orient") !== "vertical") return false;
  host.removeAttribute("orient");
  return true;
}
