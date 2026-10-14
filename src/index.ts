import Addon from "./addon";
import {config} from "../package.json";

const registry = Zotero as typeof Zotero & Record<string, Addon | undefined>;
if (!registry[config.addonInstance]) {
  defineGlobal("window", () => Zotero.getMainWindow());
  defineGlobal("document", () => Zotero.getMainWindow().document);
  defineGlobal("ZoteroPane", () => Zotero.getActiveZoteroPane());
  defineGlobal("Zotero_Tabs", () => (Zotero.getMainWindow() as any).Zotero_Tabs);
  _globalThis.addon = new Addon();
  defineGlobal("ztoolkit", () => _globalThis.addon.data.ztoolkit);
  registry[config.addonInstance] = addon;
  // The bootstrap awaits this promise so a failed startup releases its chrome
  // registration and partially initialized resources before being reported.
  _globalThis.startupPromise = addon.hooks.onStartup();
}

function defineGlobal(name:string,getter:()=>any) {
  Object.defineProperty(_globalThis,name,{get:getter});
}
