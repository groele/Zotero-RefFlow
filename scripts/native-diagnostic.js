const document=window.document;
const data={version:Zotero.version,alive:Zotero.ZoteroRefFlow?.data.alive,paneID:Zotero.ZoteroRefFlow?.views?.paneID,
  paneManagerKeys:Object.keys(Zotero.ItemPaneManager),
  l10n:{add:typeof document.l10n?.addResourceIds,resources:document.l10n?.resourceIds},
  sections:[...document.querySelectorAll('item-pane-custom-section')].map(e=>({pane:e.getAttribute('data-pane'),html:e.outerHTML.slice(0,2000)})),
  errors:Zotero.getErrors?.(true)?.slice(-15)};
await Zotero.File.putContentsAsync(cfg.output,JSON.stringify(data,null,2));
