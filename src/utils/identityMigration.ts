/** Copy only user-set RefNexus preferences, preserving every existing RefFlow value.
 * Old preferences remain intact so the previous plugin can be restored safely.
 * The service is supplied by bootstrap rather than importing host globals here.
 */
export function migrateRefNexusPreferences(service: any) {
  const oldBranch = service.getBranch("extensions.zotero.refnexus.");
  const newBranch = service.getBranch("extensions.zotero.refflow.");
  if (newBranch.getBoolPref("migratedRefNexus", false)) return;
  const keys = ["enable", "prioritySource", "autoRefresh", "notAutoRefreshItemTypes",
    "isShowTip", "ctrlClickTranslate", "showTipAfterMillisecond", "shadeMillisecond",
    "removeTipAfterMillisecond", "tipBackgroundColor", "tipTitleColor", "arXivInfoIndex",
    "DOIInfoIndex", "TitleInfoIndex", "savePDFReferences", "saveAPIReferences",
    "notInLibarayOpacity", "semanticScholarKey", "CNKI.username", "CNKI.password",
    "graphView.enable", "graphView.height", "sortBy", "type", "downloadOA", "openAlexKey"];
  for (const key of keys) {
    if (!oldBranch.prefHasUserValue(key) || newBranch.prefHasUserValue(key)) continue;
    switch (oldBranch.getPrefType(key)) {
      case 128: newBranch.setBoolPref(key, oldBranch.getBoolPref(key)); break;
      case 64: newBranch.setIntPref(key, oldBranch.getIntPref(key)); break;
      case 32: newBranch.setStringPref(key, oldBranch.getStringPref(key)); break;
    }
  }
  newBranch.setBoolPref("migratedRefNexus", true);
}
