if (!/refflow-z10-release-/.test(Zotero.DataDirectory.dir)) throw new Error("Isolated profile required");
const report = { version: Zotero.version, scope: "Zotero Connected Papers origin resolution and partial status", tests: [] };
const delay = ms => Zotero.Promise.delay(ms);
const check = (value, message) => { if (!value) throw new Error(message); };
const save = () => Zotero.File.putContentsAsync(cfg.output, JSON.stringify(report, null, 2));
const test = async (name, run) => {
  try { report.tests.push({ name, ok: true, detail: await run() }); }
  catch (error) { report.tests.push({ name, ok: false, error: String(error), stack: error?.stack }); }
  await save();
};

const views = Zotero.ZoteroRefFlow?.views;
await test("partial origin resolution requests only verified IDs and labels the graph", async () => {
  check(views, "RefFlow was not initialized");
  Zotero.Prefs.set("refflow.autoRefresh", false);
  const valid = new Zotero.Item("journalArticle");
  valid.setField("title", "Native Connected Papers valid origin");
  valid.setField("DOI", "10.1234/native-valid-origin");
  await valid.saveTx();
  const unresolved = new Zotero.Item("journalArticle");
  unresolved.setField("title", "Native Connected Papers unresolved origin");
  unresolved.setField("DOI", "10.1234/native-unresolved-origin");
  await unresolved.saveTx();

  const request = Zotero.HTTP.request;
  const previousToken = Zotero.Prefs.get("ConnectedPapers.accessToken");
  const graphKeys = [], resolvedCalls = [];
  Zotero.Prefs.set("ConnectedPapers.accessToken", "TEST_TOKEN");
  Zotero.HTTP.request = async (method, url, options) => {
    if (url.includes("api.semanticscholar.org/graph/v1/paper/DOI:")) {
      if (url.includes("native-valid-origin")) {
        resolvedCalls.push("valid");
        return { status: 200, response: { paperId: "s2-native-valid", title: "Valid origin", externalIds: { DOI: "10.1234/native-valid-origin" } } };
      }
      if (url.includes("native-unresolved-origin")) {
        resolvedCalls.push("unresolved");
        return { status: 404, response: { title: "No Semantic Scholar identity" } };
      }
    }
    if (url.includes("/papers-api/graph/1/")) {
      graphKeys.push(decodeURIComponent(url.split("/papers-api/graph/1/")[1]));
      check(options.headers["X-Api-Key"] === "TEST_TOKEN", "Connected Papers API key header missing");
      return { status: 200, response: { status: "FRESH_GRAPH", graph_json: {
        start_id: "s2-native-valid",
        nodes: { "s2-native-valid": { paperId: "s2-native-valid", title: "Native graph result", year: 2024, authors: [{ name: "Fixture Author" }], pos: [0, 0] } },
        edges: [], path_lengths: { "s2-native-valid": 0 }, common_references: [], common_citations: [], common_authors: []
      } } };
    }
    return request.call(Zotero.HTTP, method, url, options);
  };

  const graphToggle = window.document.getElementById("refflow-show-hide-graph-view");
  check(graphToggle, "Connected Papers toggle is missing");
  graphToggle.click();
  try {
    for (let i = 0; i < 100 && !window.document.querySelector("#add-origin"); i++) await delay(50);
    const add = window.document.querySelector("#add-origin");
    check(add, "Connected Papers origin control is missing");
    window.Zotero_Tabs.select("zotero-pane");
    await window.ZoteroPane.selectItem(valid.id);
    await delay(100);
    add.click();
    for (let i = 0; i < 100 && window.document.querySelectorAll(".origin-items .item").length < 1; i++) await delay(50);
    await window.ZoteroPane.selectItem(unresolved.id);
    await delay(100);
    add.click();
    for (let i = 0; i < 100 && window.document.querySelectorAll(".origin-items .item").length < 2; i++) await delay(50);
    check(window.document.querySelectorAll(".origin-items .item").length === 2, "Both selected origins were not retained");
    window.document.querySelector("#build-graph").click();
    const frame = window.document.querySelector("#graph-view iframe");
    for (let i = 0; i < 200; i++) {
      const status = frame?.contentDocument?.querySelector("#status")?.textContent || "";
      if (status.includes("unresolved origins 1") || status.includes("未解析起点 1")) break;
      await delay(50);
    }
    const status = frame?.contentDocument?.querySelector("#status")?.textContent || "";
    check(graphKeys.length === 1 && graphKeys[0] === "s2-native-valid", `Invalid graph request key: ${JSON.stringify(graphKeys)}`);
    check(resolvedCalls.includes("valid") && resolvedCalls.includes("unresolved"), "Semantic Scholar did not resolve both origins independently");
    check(status.includes("Connected Papers"), "Graph status omitted provider provenance");
    check(status.includes("unresolved origins 1") || status.includes("未解析起点 1"), `Graph status omitted partial origin count: ${status}`);
    return { graphKeys, resolvedCalls, status };
  } finally {
    Zotero.HTTP.request = request;
    Zotero.Prefs.set("ConnectedPapers.accessToken", previousToken || "");
    if (graphToggle.isConnected) graphToggle.click();
  }
});
report.finished = new Date().toISOString();
report.passed = report.tests.filter(row => row.ok).length;
report.failed = report.tests.filter(row => !row.ok).length;
await save();
