if (!/refflow-z10-release-/.test(Zotero.DataDirectory.dir)) throw new Error("Isolated profile required");

const { document, MouseEvent, KeyboardEvent } = window;
const report = { version: Zotero.version, tests: [] };
const delay = ms => Zotero.Promise.delay(ms);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const test = async (name, run) => {
  try { await run(); report.tests.push({ name, ok: true }); }
  catch (error) { report.tests.push({ name, ok: false, error: String(error) }); }
};
const views = Zotero.ZoteroRefFlow.views;
const refresh = views.refreshReferences;
const fetches = [];
views.refreshReferences = async (body, local, page, toggle, item, reader, cacheOnly) => {
  fetches.push({ body, id: item?.id, cacheOnly });
};
const click = target => target.dispatchEvent(new MouseEvent("click", {
  bubbles: true, composed: true, cancelable: true, button: 0, detail: 1
}));
Zotero.Prefs.set("refflow.autoRefresh", false);

try {
  const item = new Zotero.Item("journalArticle");
  item.setField("title", "RefFlow fold interaction fixture");
  await item.saveTx();
  await window.ZoteroPane.selectItem(item.id);
  const selector = 'item-pane-custom-section[data-pane$="-refflow-references"]';
  let body;
  for (let i = 0; i < 100; i++) {
    body = document.querySelector('#zotero-item-details ' + selector + ' [data-type="body"]');
    if (body?._cards && body.getAttribute("data-refflow-item-id") === String(item.id)) break;
    await delay(100);
  }
  check(body?._cards, "Native RefFlow body did not render");
  const section = body.closest(selector);
  const collapsible = body.closest("collapsible-section");
  const head = collapsible.querySelector(".head");
  const twisty = head.querySelector(".twisty");
  const railButton = document.querySelector('#zotero-view-item-sidenav .btn[data-pane$="-refflow-references"]');

  await test("selection respects the cache preference", async () => {
    await delay(100);
    check(fetches.length === 0, "Selection requested a refresh while local cache loading was disabled");
  });
  await test("clicking the visible native twisty toggles its state", async () => {
    head.scrollIntoView({ block: "center" });
    collapsible.open = false;
    await delay(300);
    const mouseClick = () => {
      const { x, y, width, height } = twisty.getBoundingClientRect();
      check(width > 0 && height > 0, "Twisty has no hit target");
      window.windowUtils.sendMouseEvent("mousedown", x + width / 2, y + height / 2, 0, 1, 0);
      window.windowUtils.sendMouseEvent("mouseup", x + width / 2, y + height / 2, 0, 1, 0);
    };
    mouseClick();
    await delay(250);
    check(collapsible.open, "Click did not expand the collapsed section");
    mouseClick();
    await delay(250);
    check(!collapsible.open, "Click did not collapse the expanded section");
  });
  await test("native arrow expands and collapses, fetching once on expansion", async () => {
    collapsible.open = false;
    fetches.length = 0;
    click(twisty);
    await delay(150);
    check(collapsible.open && head.getAttribute("aria-expanded") === "true", "Arrow did not expand");
    check(fetches.length === 1 && fetches[0].body === body && fetches[0].id === item.id && !fetches[0].cacheOnly, "Expansion should request one fetch for this item");
    click(twisty);
    await delay(150);
    check(!collapsible.open && head.getAttribute("aria-expanded") === "false", "Arrow did not collapse");
    check(fetches.length === 1, "Collapsing requested a fetch");
  });
  await test("native keyboard expansion and side navigation work independently", async () => {
    collapsible.open = false;
    fetches.length = 0;
    head.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await delay(150);
    check(collapsible.open && fetches.length === 1, "Keyboard expansion did not fetch once");
    collapsible.open = false;
    fetches.length = 0;
    check(railButton, "Native RefFlow side navigation button not found");
    click(railButton);
    await delay(150);
    check(collapsible.open && fetches.length === 1 && fetches[0].body.closest(selector) === section, "Side navigation did not open and fetch once");
  });
  await test("reader rail targets the PDF parent independently of the library selection", async () => {
    const parent = new Zotero.Item("journalArticle");
    parent.setField("title", "Reader parent for fold verification");
    await parent.saveTx();
    const attachment = await Zotero.Attachments.importFromFile({
      file: cfg.fixtures + "\\single.pdf", parentItemID: parent.id
    });
    const reader = await Zotero.Reader.open(attachment.id);
    try {
      document.getElementById("zotero-context-pane-inner").collapsed = false;
      const rail = document.getElementById("zotero-context-pane-sidenav");
      let button, readerBody;
      for (let i = 0; i < 100; i++) {
        button = rail.querySelector('.btn[data-pane$="-refflow-references"]:not([disabled])');
        const pane = button && rail.container?.getEnabledPane(button.dataset.pane);
        readerBody = pane?.querySelector('[data-type="body"]');
        if (readerBody?.getAttribute("data-refflow-item-id") === String(parent.id)) break;
        await delay(100);
      }
      check(readerBody && button, "Native reader section did not bind to PDF parent");
      const readerSection = readerBody.closest("collapsible-section");
      readerSection.open = false;
      fetches.length = 0;
      click(button);
      await delay(150);
      check(readerSection.open && fetches.length === 1 && fetches[0].body === readerBody && fetches[0].id === parent.id, "Reader action targeted the wrong panel or item");
    } finally {
      reader.close();
    }
  });
} finally {
  views.refreshReferences = refresh;
}
report.finished = new Date().toISOString();
report.passed = report.tests.filter(test => test.ok).length;
report.failed = report.tests.length - report.passed;
await Zotero.File.putContentsAsync(cfg.output, JSON.stringify(report, null, 2));
