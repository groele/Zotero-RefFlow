import { ProgressWindowHelper } from "zotero-plugin-toolkit";
import { pollGraph } from "./graphTransport";

const GraphResponseStatuses = {
  BAD_ID: "BAD_ID",
  ERROR: "ERROR",
  NOT_IN_DB: "NOT_IN_DB",
  OLD_GRAPH: "OLD_GRAPH",
  FRESH_GRAPH: "FRESH_GRAPH",
  IN_PROGRESS: "IN_PROGRESS",
  QUEUED: "QUEUED",
  BAD_TOKEN: "BAD_TOKEN",
  BAD_REQUEST: "BAD_REQUEST",
  OUT_OF_REQUESTS: "OUT_OF_REQUESTS"
}

async function askUserAccessToken(update = false, signal?: AbortSignal) {
  if (signal?.aborted) return;
  const dialogData: { [key: string | number]: any } = {
    inputValue: "",
    loadCallback: () => {
    },
    unloadCallback: () => {
    },
  };
  const dialogHelper = new ztoolkit.Dialog(10, 2)
    .addCell(0, 0, {
      tag: "input",
      namespace: "html",
      id: "dialog-input",
      styles: {
        width: "300px",
      },
      attributes: {
        "data-bind": "inputValue",
        "data-prop": "value",
        type: "password",
      },
    }, true)
    .addButton(update ? "Update" : "Set", update ? "Update" : "Set")
    .setDialogData(dialogData)
    .open("Connected Papers API Key", {
      width: 300,
      centerscreen: true,
      alwaysRaised: true
    });
  addon.data.dialog = dialogHelper;
  const abort = () => dialogHelper.window?.close();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try { await dialogData.unloadLock.promise; }
  finally { signal?.removeEventListener("abort", abort); if (addon.data.dialog === dialogHelper) addon.data.dialog = undefined; }
  if (signal?.aborted) return;
  if (dialogData.inputValue) {
    Zotero.Prefs.set("ConnectedPapers.accessToken", dialogData.inputValue)
  }
  return dialogData.inputValue 
}

export default async function buildGraphData(id: string, popupWin: ProgressWindowHelper, keyRetry=0, signal?: AbortSignal): Promise<Graph |undefined> {
  if(!id || !id.split("+").every(part=>part.trim())){popupWin.changeLine({text:"Paper ID not found",type:"fail"});popupWin.startCloseTimer(3000);return;}
  // 读取密钥
  let accessToken = Zotero.Prefs.get("ConnectedPapers.accessToken") as string
  if (!accessToken) {
    accessToken = await askUserAccessToken(false, signal) as string
    if (!accessToken) { popupWin.close();return }
  }
  ztoolkit.log("id", id)
  if (id) {
    popupWin.changeLine({ text: "Building", type: "connectedpapers"})
  } else {
    popupWin.changeLine({ text: "Paper ID not Found", type: "fail" })
    popupWin.startCloseTimer(3000)
  }
  try {
  const temp = await pollGraph(id, accessToken, response => {
    popupWin.changeLine({ progress: Number(response.progress) || 0, text: response.status });
  }, signal);
    switch (temp.status) {
      case GraphResponseStatuses.QUEUED:
        popupWin.changeLine({ progress: 0, text: "0% Building" })
        break;
      case GraphResponseStatuses.IN_PROGRESS:
        popupWin.changeLine({ progress: temp.progress, text: `${temp.progress}% Building` })
        break;
      case GraphResponseStatuses.FRESH_GRAPH:
        popupWin.changeLine({ progress: 100, text: `100% Building` })
        break;
      case GraphResponseStatuses.OLD_GRAPH:
        popupWin.changeLine({ type: "connectedpapers", text: `Read Old Graph` })
        break;
      default:
        popupWin.changeLine({ text: temp.status, type: "fail" })
        const accessToken = keyRetry<1 && temp.status==="BAD_TOKEN" ? await askUserAccessToken(true, signal) as string : undefined;
        if (accessToken) {
          return await buildGraphData(id, popupWin,keyRetry+1,signal)
        }
        break
    }
  if (temp?.graph_json) {
    popupWin.changeLine({ progress: 100, text: "100% Building" })
    const graphData = temp.graph_json
    return graphData
  }
  } catch(error:any){if(error?.name!=="AbortError"){ztoolkit.log("Graph fetch failed",error);popupWin.changeLine({text:String(error),type:"fail"});}}
  finally{popupWin.startCloseTimer(4000);}
}
