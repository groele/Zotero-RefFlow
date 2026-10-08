import {BasicTool, UITool, ClipboardHelper, ProgressWindowHelper, DialogHelper, makeHelperTool, unregister, DebugBridge} from "zotero-plugin-toolkit";
import {config} from "../../package.json";

// Construct only the helpers used by RefNexus. Native Zotero 10 managers own
// item panes and preferences; no ItemBox/Keyboard/legacy tab patches are loaded.
class RefNexusToolkit extends BasicTool {
  UI=new UITool(this);
  Clipboard=makeHelperTool(ClipboardHelper,this);
  ProgressWindow=makeHelperTool(ProgressWindowHelper,this);
  Dialog=makeHelperTool(DialogHelper,this);
  getDOMParser(): DOMParser {return new (this.getGlobal("window").DOMParser)();}
  unregisterAll(){unregister(this);if(__env__==="development")DebugBridge.unregister();}
}
export function createZToolkit() {
  const toolkit=new RefNexusToolkit();
  toolkit.basicOptions.log.prefix=`[${config.addonName}]`;
  toolkit.basicOptions.log.disableConsole=__env__==="production";
  toolkit.basicOptions.api.pluginID=config.addonID;
  if(__env__==="development")DebugBridge.register({disablePassword:false});
  toolkit.ProgressWindow.setIconURI("default",`chrome://${config.addonRef}/content/icons/favicon.png`);
  toolkit.ProgressWindow.setIconURI("connectedpapers",`chrome://${config.addonRef}/content/icons/connectedpapers.png`);
  return toolkit;
}
