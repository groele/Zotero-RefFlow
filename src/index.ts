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
  addon.hooks.onStartup().catch(error => Zotero.logError(error || new Error("RefNexus startup failed without error details")));
}

function defineGlobal(name:string,getter:()=>any) {
  Object.defineProperty(_globalThis,name,{get:getter});
}
