import { ColumnOptions } from "zotero-plugin-toolkit";
import { DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import type Views from "./modules/views";

class Addon {
  public data: {
    alive: boolean;
    // Env type, see build.js
    env: "development" | "production";
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
      default?: any;
    };
    prefs?: {
      window: Window;
      columns?: Array<ColumnOptions>;
      rows?: Array<{ [dataKey: string]: string }>;
    };
    dialog?: DialogHelper;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;
  public views?: Views;

  constructor() {
    this.data = {
      alive: true,
      env: __env__,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
