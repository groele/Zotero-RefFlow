/**
 * Most of this code is from Zotero team's official Make It Red example[1]
 * or the Zotero 7 documentation[2].
 * [1] https://github.com/zotero/make-it-red
 * [2] https://www.zotero.org/support/dev/zotero_7_for_developers
 */

var chromeHandle;
var startupGeneration = 0;
var startupContext;

async function cleanup(action) {
  try { await action(); }
  catch (error) { Zotero.logError(error || new Error("RefFlow cleanup failed")); }
}

async function releaseChrome() {
  const handle = chromeHandle;
  chromeHandle = null;
  if (handle) await cleanup(() => handle.destruct());
  await cleanup(() => Components.classes["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService).flushBundles());
}

function install(data, reason) {}

async function startup({ id, version, rootURI }, reason) {
  const generation = ++startupGeneration;
  await Zotero.initializationPromise;
  if (generation !== startupGeneration) return;

  try {
    var aomStartup = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    var manifestURI = Services.io.newURI(rootURI + "manifest.json");
    chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "__addonRef__", rootURI + "chrome/content/"],
    ]);

    /**
     * Global variables for plugin code.
     * The `_globalThis` is the global root variable of the plugin sandbox environment
     * and all child variables assigned to it is globally accessible.
     * See `src/index.ts` for details.
     */
    const timers = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
    Components.utils.importGlobalProperties(["AbortController"]);
    const ctx = {
      rootURI,
      Zotero,
      PathUtils,
      prefService: Services.prefs,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      AbortController,
    };
    ctx._globalThis = ctx;
    startupContext = ctx;

    Services.scriptloader.loadSubScript(
      `${rootURI}chrome/content/scripts/__addonRef__.js`,
      ctx,
    );
    // loadSubScript is synchronous; startup hooks can still be waiting for the UI.
    await ctx.startupPromise;
  } catch (error) {
    if (generation !== startupGeneration) return;
    await cleanup(() => startupContext?.addon?.hooks.onShutdown());
    startupContext = null;
    await releaseChrome();
    throw error;
  }
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  ++startupGeneration;
  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports,
    ).wrappedJSObject;
  }
  const instance = startupContext?.addon || Zotero.__addonInstance__;
  if (instance) instance.data.alive = false;
  if (reason === APP_SHUTDOWN) {
    await cleanup(() => instance?.views?.storage?.dispose());
    return;
  }

  await cleanup(() => instance?.hooks.onShutdown());
  startupContext = null;
  await releaseChrome();
}

function uninstall(data, reason) {}
