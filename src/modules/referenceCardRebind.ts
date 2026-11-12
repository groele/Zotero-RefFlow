import { actionIcon } from "./cardActionIcon";
import { config } from "../../package.json";
import { getString } from "../utils/locale";

/** Update an existing virtual-list card in place; returns whether the bound reference changed. */
export function rebindReferenceCardRow(
  row: HTMLElement,
  ref: ItemBaseInfo,
  number: number,
  posInSet: number,
  setSize: number,
  selected: boolean,
  parent: Zotero.Item | undefined,
): boolean {
  const previous = (row as any).reference as ItemBaseInfo | undefined;
  const sameRef = previous === ref;
  (row as any).reference = ref;
  row.setAttribute("aria-posinset", String(posInSet));
  row.setAttribute("aria-setsize", String(setSize));
  row.classList.toggle("selected", selected);
  row.setAttribute("aria-selected", String(selected));
  row.dataset.referenceNumber = String(number);

  const numberNode = row.querySelector<HTMLElement>(".reference-number");
  if (numberNode) {
    numberNode.textContent = `${number}.`;
    numberNode.title = ref.page
      ? getString("cards-locate-in-pdf", { args: { page: ref.page } })
      : `${getString("cards-number-label")} ${number}`;
    numberNode.style.cursor = ref.page ? "pointer" : "";
  }

  const title = row.querySelector<HTMLElement>(".reference-title");
  const text = row.querySelector<HTMLElement>(".reference-text");
  const about = row.querySelector<HTMLElement>(".reference-about");
  const metadata = row.querySelector<HTMLElement>(".reference-metadata");
  const headingLabel = ref.title || ref.text || "";
  if (title) {
    title.textContent = headingLabel;
    title.title = headingLabel;
  }
  if (text) {
    text.textContent = ref.text || ref.title || "";
    text.title = text.textContent || "";
  }
  row.setAttribute("aria-label", `${numberNode?.title || number}: ${headingLabel}`);

  const mentions = ref.mentionCount
    ? getString("cards-mentions-badge", { args: { count: ref.mentionCount } })
    : "";
  const aboutText = [
    (ref.authors || []).slice(0, 3).join(" / "),
    ref.year,
    ref.publicationVenue,
    (ref as any).citationCount !== undefined ? `${getString("cards-cited")} ${(ref as any).citationCount}` : "",
    mentions,
  ]
    .filter(Boolean)
    .join(" · ");
  if (about) {
    about.textContent = aboutText;
    about.title = aboutText;
  }
  if (metadata) metadata.hidden = !aboutText;

  const description = row.querySelector(".reference-description");
  let warning = row.querySelector<HTMLElement>(".reference-retracted");
  if (ref.retraction?.isRetracted) {
    if (!warning && description) {
      warning = row.ownerDocument.createElement("span");
      warning.className = "reference-retracted";
      description.prepend(warning);
    }
    if (warning) {
      warning.textContent = getString("relatedbox-retracted-badge");
      warning.title = ref.retraction.reason || "";
    }
  } else warning?.remove();

  const editable = Boolean(
    parent &&
      !parent.deleted &&
      (typeof parent.isEditable !== "function" || parent.isEditable()) &&
      (Zotero as any).Libraries.get(parent.libraryID)?.editable !== false,
  );
  const action = row.querySelector<HTMLButtonElement>(".reference-action");
  if (action && !action.hasAttribute("aria-busy")) {
    actionIcon(
      action,
      ref._item ? "open" : "add",
      getString(ref._item ? "cards-show-library" : editable ? "cards-import" : "cards-library-readonly"),
    );
    action.disabled = Boolean(!ref._item && !editable);
    action.setAttribute("aria-label", action.title);
  }

  const dot = row.querySelector<HTMLElement>(".reference-state");
  if (dot) {
    const age = Math.max(0, new Date().getFullYear() - Number(ref.year || 2000));
    dot.style.backgroundColor = ref._item
      ? "var(--color-accent, #3678b5)"
      : `hsl(210 30% ${Math.min(85, 40 + age * 2)}%)`;
    dot.title = ref._item ? getString("cards-in-library") : String(ref.year || "");
  }
  row.style.opacity = ref._item
    ? "1"
    : String(Zotero.Prefs.get(`${config.addonRef}.notInLibarayOpacity`) || "1");

  return !sameRef;
}
