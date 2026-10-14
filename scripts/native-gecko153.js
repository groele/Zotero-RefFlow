if (!/refflow-z10-release-/.test(Zotero.DataDirectory.dir)) throw new Error('Isolated profile required');
const report = { version: Zotero.version, platformMajorVersion: Zotero.platformMajorVersion, at: new Date().toISOString(), tests: [] };
const save = () => Zotero.File.putContentsAsync(cfg.output, JSON.stringify(report, null, 2));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const delay = ms => Zotero.Promise.delay(ms);
const test = async (name, run) => {
  try { report.tests.push({ name, ok: true, detail: await run() }); }
  catch (error) { report.tests.push({ name, ok: false, error: String(error), stack: error?.stack }); }
  await save();
};
const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const expected = JSON.parse(await Zotero.File.getContentsAsync(cfg.workspace + '\\package.json')).version;
if (Zotero.Prefs.get('refflow.validationRestartVersion') === expected) {
  cfg.output = cfg.output.replace(/\.json$/, '-restart.json');
  await test('persistently installed XPI loads after an actual process restart', async () => {
    const installed = await AddonManager.getAddonByID('refflow@groele.github.io');
    check(installed?.isActive && installed.version === expected, 'Restarted candidate is not active');
    check(Zotero.ZoteroRefFlow?.views?.referenceTasks, 'Restarted runtime not ready');
    return { addonVersion: installed.version, platform: Zotero.platformMajorVersion, active: true };
  });
  await test('preferences initialize again after restart and dispose on close', async () => {
    const owner = Zotero.ZoteroRefFlow, pref = Zotero.Utilities.Internal.openPreferences('refflow-preferences');
    try {
      for (let i = 0; i < 150 && owner.data.prefs?.window !== pref; i++) await delay(100);
      check(owner.data.prefs?.window === pref, 'Restarted preferences not initialized');
      check(owner.data.preferenceCleanups.size === 1, 'Restarted preferences duplicated listeners');
      return { initialized: true };
    } finally { pref.close();await delay(200);check(owner.data.preferenceCleanups.size === 0, 'Restarted preferences retain listeners'); }
  });
  Zotero.Prefs.clear('refflow.validationRestartVersion');
  report.errors = Zotero.getErrors(true).map(String);
  report.finished = new Date().toISOString();report.passed = report.tests.filter(test => test.ok).length;
  report.failed = report.tests.filter(test => !test.ok).length;await save();return;
}
await test('RefFlow identity, update authority, compatibility and legacy preference migration', async () => {
  const installed = await AddonManager.getAddonByID('refflow@groele.github.io');
  check(installed?.name === 'Zotero RefFlow' && installed.isActive, 'RefFlow identity is not active');
  check(installed.homepageURL === 'https://github.com/groele/Zotero-RefFlow', 'Wrong project URL');
  check(installed.updateURL === 'https://raw.githubusercontent.com/groele/Zotero-RefFlow/main/update.json', 'Wrong update authority');
  const zip = Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);
  let manifest;
  zip.open(Zotero.File.pathToFile(cfg.profile + '\\extensions\\refflow@groele.github.io.xpi'));
  try {
    const stream = Cc['@mozilla.org/scriptableinputstream;1'].createInstance(Ci.nsIScriptableInputStream);
    stream.init(zip.getInputStream('manifest.json'));
    try { manifest = JSON.parse(stream.read(stream.available())); } finally { stream.close(); }
  } finally { zip.close(); }
  check(manifest.applications.zotero.strict_min_version === '10.0.6' && manifest.applications.zotero.strict_max_version === '11.*', 'Wrong compatibility range');
  check(!await AddonManager.getAddonByID('refnexus@polygon.org'), 'Legacy plugin unexpectedly installed');
  check(Zotero.Prefs.get('refflow.migratedRefNexus') === true, 'Migration did not complete');
  if (Zotero.Prefs.get('refnexus.showTipAfterMillisecond') === 345) {
    check(Zotero.Prefs.get('refflow.showTipAfterMillisecond') === 345, 'Legacy integer setting lost');
    check(Zotero.Prefs.get('refflow.sortBy') === 'Original', 'New user setting overwritten');
    check(Zotero.Prefs.get('refnexus.sortBy') === 'Title', 'Old setting changed');
  }
  return { id: installed.id, name: installed.name, compatibility: manifest.applications.zotero, migration: true };
});
await test('cold startup loads the candidate XPI in the actual host', async () => {
  const installed = await AddonManager.getAddonByID('refflow@groele.github.io');
  check(installed?.isActive && installed.version === expected, 'Candidate not active');
  check(Zotero.ZoteroRefFlow?.views?.referenceTasks, 'Runtime not ready');
  return { version: installed.version, platform: Zotero.platformMajorVersion, env: Zotero.ZoteroRefFlow.data.env };
});
Zotero.Prefs.set('refflow.autoRefresh', false);
const parent = new Zotero.Item('journalArticle');parent.setField('title', 'Gecko 153 menu fixture');await parent.saveTx();
await window.ZoteroPane.selectItem(parent.id);await delay(250);
const body = () => window.document.querySelector('item-pane-custom-section[data-pane$="-refflow-references"] [data-type="body"]');
await test('source, sort, OA and literature menus retain true and false checked states', async () => {
  const panel = body();check(panel, 'Missing native sidebar');panel.setAttribute('source', 'API');panel.setAttribute('data-refflow-type', 'References');
  Zotero.Prefs.set('refflow.sortBy', 'Original');Zotero.Prefs.set('refflow.downloadOA', false);
  panel._cards.menu();
  const menu = window.document.querySelector('menupopup[data-refflow-menu=references]');
  const entries = [...menu.children].filter(entry => entry.getAttribute('type') === 'checkbox');
  check(entries.length === 8, 'Wrong checkbox menu count');
  check(entries.filter(entry => entry.checked).length === 2, 'False entries are marked checked');
  check(entries.filter(entry => !entry.checked).every(entry => !entry.hasAttribute('checked')), 'False checked attribute remains');
  menu.hidePopup();
  Zotero.ZoteroRefFlow.views.typeMenu(panel, parent);
  const radioMenu = window.document.querySelector('menupopup[data-refflow-menu=literature]');
  const radios = [...radioMenu.children];
  check(radios.length === 3 && radios.filter(entry => entry.checked).length === 1, 'Wrong literature selection');
  check(radios.filter(entry => !entry.checked).every(entry => !entry.hasAttribute('checked')), 'False radio attribute remains');
  radioMenu.hidePopup();return { checkboxes: 8, checked: 2, radioOptions: 3, radioSelected: 1 };
});
await test('preference fragment external events, checkbox saving, pane switching and reopening', async () => {
  const owner = Zotero.ZoteroRefFlow;
  const previous = Zotero.Prefs.get('refflow.autoRefresh');
  let pref = Zotero.Utilities.Internal.openPreferences('refflow-preferences');
  const waitRoot = async win => {
    for (let i = 0; i < 150; i++) {
      const root = win.document.getElementById('zotero-prefpane-refflow');
      if (root && owner.data.prefs?.window === win) return root;
      await delay(100);
    }
    throw new Error('External preferences initialization failed');
  };
  try {
    const root = await waitRoot(pref);
    check(!root.hasAttribute('onload') && !root.querySelector('[onclick],[oncommand]'), 'Inline handlers remain');
    const checkbox = pref.document.getElementById('refflow-auto-refresh');
    checkbox.checked = true;checkbox.dispatchEvent(new pref.Event('command', { bubbles: true }));await delay(100);
    check(Zotero.Prefs.get('refflow.autoRefresh') === true, 'Checkbox command did not save');
    checkbox.checked = false;checkbox.dispatchEvent(new pref.Event('command', { bubbles: true }));await delay(100);
    check(Zotero.Prefs.get('refflow.autoRefresh') === false, 'Checkbox cannot be unchecked');
    const count = owner.data.preferenceCleanups.size;check(count === 1, 'Duplicate preference listener controller');
    await pref.Zotero_Preferences.navigateToPane('zotero-prefpane-general');
    await pref.Zotero_Preferences.navigateToPane('refflow-preferences');
    check(owner.data.preferenceCleanups.size === count, 'Pane switching duplicated listeners');
    const launch = Zotero.launchURL;let url;
    try { Zotero.launchURL = value => { url = value; };pref.document.getElementById('refflow-project-link').click();
      check(url === 'https://github.com/groele/Zotero-RefFlow', 'External project link handler failed');
    } finally { Zotero.launchURL = launch; }
    pref.close();await delay(250);check(owner.data.preferenceCleanups.size === 0, 'Closed preferences retained listeners');
    pref = Zotero.Utilities.Internal.openPreferences('refflow-preferences');await waitRoot(pref);
    check(owner.data.preferenceCleanups.size === 1, 'Reopened preferences not initialized exactly once');
    return { externalEvents: true, savedCheckedAndUnchecked: true, switched: true, reopened: true };
  } finally { Zotero.Prefs.set('refflow.autoRefresh', previous);pref.close();await delay(250); }
});
await test('real menu command copies text that can be pasted into a native text field', async () => {
  const views = Zotero.ZoteroRefFlow.views, panel = body();
  const refs = [{ title: 'Clipboard fixture', text: 'RefFlow native clipboard 中文 153', identifiers: {} }];
  panel.references = refs;await panel._cards.render(refs, () => true);
  const clipboard = Cc['@mozilla.org/widget/clipboard;1'].getService(Ci.nsIClipboard);
  const transferable = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);
  transferable.init(null);transferable.addDataFlavor('text/plain');
  const saved = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);saved.init(null);
  let savedFlavors = 0;
  for (const flavor of ['text/plain', 'text/unicode', 'text/html', 'image/png', 'image/jpeg', 'application/x-moz-nativeimage', 'text/x-moz-url', 'application/x-moz-file']) {
    if (!clipboard.hasDataMatchingFlavors([flavor], clipboard.kGlobalClipboard)) continue;
    const snapshot = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);snapshot.init(null);snapshot.addDataFlavor(flavor);
    clipboard.getData(snapshot, clipboard.kGlobalClipboard);
    const data = {};snapshot.getTransferData(flavor, data);saved.addDataFlavor(flavor);saved.setTransferData(flavor, data.value);savedFlavors++;
  }
  const input = window.document.createElementNS('http://www.w3.org/1999/xhtml', 'textarea');
  window.document.documentElement.append(input);
  try {
    panel._cards.menu();const popup = window.document.querySelector('menupopup[data-refflow-menu=references]');
    popup.children[0].dispatchEvent(new window.Event('command'));await delay(100);popup.hidePopup();
    clipboard.getData(transferable, clipboard.kGlobalClipboard);
    const copied = {};transferable.getTransferData('text/plain', copied);
    check(copied.value.QueryInterface(Ci.nsISupportsString).data === refs[0].text, 'Real clipboard text mismatch');
    input.focus();window.document.commandDispatcher.getControllerForCommand('cmd_paste').doCommand('cmd_paste');await delay(100);
    check(input.value === refs[0].text, 'Native paste did not produce copied text');
    return { realClipboard: true, nativePaste: true, unicodeText: true, format: 'text/plain' };
  } finally {
    input.remove();
    if (savedFlavors) clipboard.setData(saved, null, clipboard.kGlobalClipboard);
    else clipboard.emptyClipboard(clipboard.kGlobalClipboard);
  }
});
for (const name of ['native-regression', 'native-stress', 'native-publishers', 'native-numbering', 'native-usability', 'native-structure', 'native-architecture']) {
  await test(name, async () => {
    const output = cfg.output.replace(/\.json$/, '-' + name + '.json');
    const code = await Zotero.File.getContentsAsync(cfg.workspace + '\\scripts\\' + name + '.js');
    await Object.getPrototypeOf(async function () {}).constructor('Zotero', 'window', 'cfg', code)(Zotero, window, { ...cfg, output });
    const result = JSON.parse(await Zotero.File.getContentsAsync(output));
    check(result.failed === 0, `${result.failed} native scenarios failed`);
    return { passed: result.passed, failed: result.failed };
  });
}
await test('two disable and re-enable cycles release resources and register each pane once', async () => {
  const installed = await AddonManager.getAddonByID('refflow@groele.github.io');
  for (let cycle = 0; cycle < 2; cycle++) {
    const owner = Zotero.ZoteroRefFlow;
    const panel = body();panel._cards.menu();
    const staleCommand = window.document.querySelector('menupopup[data-refflow-menu=references]').children[0];
    let staleCopy = 0;const copy = owner.views.utils.copyText;owner.views.utils.copyText = () => { staleCopy++; };
    await installed.disable();await delay(200);
    check(!Zotero.ZoteroRefFlow, 'Disabled registry remains');
    check(owner.data.preferenceCleanups.size === 0, 'Disabled preference listeners remain');
    check(!window.document.getElementById('refflow-style') && !window.document.getElementById('refflow-graph-style'), 'Styles retained');
    check(!window.document.querySelector('menupopup[data-refflow-menu]'), 'Disabled popups retained');
    staleCommand.dispatchEvent(new window.Event('command'));await delay(50);check(staleCopy === 0, 'Disposed menu command remains active');
    owner.views.utils.copyText = copy;
    await installed.enable();
    for (let i = 0; i < 150 && !Zotero.ZoteroRefFlow?.views?.referenceTasks; i++) await delay(100);
    check(Zotero.ZoteroRefFlow?.views?.referenceTasks, 'Re-enable failed');
    await window.ZoteroPane.selectItem(parent.id);await delay(250);
    const sections = [...window.document.querySelectorAll('item-pane-custom-section[data-pane$="-refflow-references"]')];
    const contexts = new Set();
    for (const section of sections) { const context = section.closest('item-details') || section.parentElement;check(!contexts.has(context), 'Duplicate section');contexts.add(context); }
    check(sections.length > 0, 'Section missing after re-enable');
    check(Zotero.PreferencePanes.pluginPanes.filter(pane => pane.pluginID === 'refflow@groele.github.io').length === 1, 'Duplicate preference registration');
  }
  return { cycles: 2 };
});
report.errors = Zotero.getErrors(true);
await test('runtime log has no plugin script, Fluent parse or manifest version errors', async () => {
  const pluginErrors = report.errors.filter(error => /refflow\.js|Parser error:.*refflow-|Warning processing version/.test(error));
  check(pluginErrors.length === 0, JSON.stringify(pluginErrors));
  return { pluginErrors: 0, otherHostMessages: report.errors.length };
});
report.finished = new Date().toISOString();
report.passed = report.tests.filter(test => test.ok).length;
report.failed = report.tests.filter(test => !test.ok).length;
report.scenariosPassed = report.tests.reduce((count, test) => count + (test.ok ? test.detail?.passed || 1 : 0), 0);
if (report.failed === 0) Zotero.Prefs.set('refflow.validationRestartVersion', expected);
await save();
