export interface ReferenceSourceEvidence {
  source: string;
  count: number;
  expected?: number;
  partial: boolean;
  retained?: boolean;
  attempts?: string[];
  status?: "success" | "partial" | "unavailable" | "empty";
  latestAttempt?: { source: string; count: number; expected?: number; partial: boolean };
}

export type SourceDetailString = (key: string, args?: Record<string, string | number>) => string;

/** Provider errors may contain request URLs or credentials; keep diagnostics useful without exposing either. */
export function safeProviderAttempt(value: string): string {
  return value
    .replace(/(["']?(?:api[-_ ]?key|authorization|access[-_ ]?token|token|secret|password)["']?\s*[:=]\s*)(["'])(.*?)\2/gi, "$1$2[redacted]$2")
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(/(?:[A-Z]:\\|\\\\)[^\r\n"'<>]+/gi, "[path hidden]")
    .replace(/https?:\/\/[^\s,)]+/gi, "[URL hidden]")
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[redacted]")
    .replace(/((?:api[-_ ]?key|authorization|access[-_ ]?token|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .slice(0, 240);
}

export function renderReferenceSourceDetails(
  details: HTMLDetailsElement,
  evidence: ReferenceSourceEvidence,
  getString: SourceDetailString,
) {
  const doc = details.ownerDocument;
  // Keep the native summary node connected so refresh does not drop keyboard focus.
  let summary = details.querySelector("summary");
  if (summary) {
    for (const child of Array.from(details.children)) {
      if (child !== summary) child.remove();
    }
  } else {
    details.replaceChildren();
    summary = doc.createElement("summary");
    details.append(summary);
  }
  details.className = "refflow-source-details";
  details.hidden = false;
  details.dataset.source = evidence.source;
  details.dataset.count = String(evidence.count);
  details.dataset.expected = evidence.expected === undefined ? "" : String(evidence.expected);
  details.dataset.partial = String(evidence.partial);
  details.dataset.retained = String(Boolean(evidence.retained));
  details.dataset.status = evidence.status || (evidence.partial ? "partial" : evidence.count ? "success" : "empty");
  const latestStatus = evidence.latestAttempt
    ? evidence.latestAttempt.count === 0
      ? evidence.latestAttempt.partial ? "unavailable" : "empty"
      : evidence.latestAttempt.partial ? "partial" : "success"
    : "";
  details.dataset.latestStatus = latestStatus;

  summary.textContent = getString("cards-source-details");

  const selected = doc.createElement("p");
  selected.textContent = getString("cards-source-selected", { source: evidence.source });
  details.append(selected);

  const completeness = doc.createElement("p");
  const expected = Number.isSafeInteger(evidence.expected) && evidence.expected! >= 0
    ? getString("cards-source-count-expected", { count: evidence.count, expected: evidence.expected! })
    : getString("cards-source-count", { count: evidence.count });
  const state = evidence.status === "unavailable"
    ? getString("cards-source-unavailable")
    : evidence.status === "empty"
      ? getString("cards-source-empty")
      : evidence.partial
        ? getString("cards-source-partial")
        : getString("cards-source-complete");
  completeness.textContent = `${expected} · ${state}${evidence.retained ? ` · ${getString("cards-source-retained")}` : ""}`;
  details.append(completeness);

  if (evidence.latestAttempt) {
    const latest = doc.createElement("p");
    const latestState = latestStatus === "unavailable"
      ? getString("cards-source-latest-unavailable")
      : latestStatus === "empty"
        ? getString("cards-source-latest-empty")
        : latestStatus === "partial"
          ? getString("cards-source-latest-partial")
          : getString("cards-source-latest-complete");
    const latestCount = Number.isSafeInteger(evidence.latestAttempt.expected)
      ? ` (${evidence.latestAttempt.count}/${evidence.latestAttempt.expected})`
      : ` (${evidence.latestAttempt.count})`;
    latest.textContent = `${getString("cards-source-latest", { source: evidence.latestAttempt.source })}${latestCount} · ${latestState}`;
    details.append(latest);
  }

  if (evidence.attempts?.length) {
    const heading = doc.createElement("p");
    heading.textContent = getString("cards-source-attempts");
    details.append(heading);
    const list = doc.createElement("ul");
    for (const attempt of evidence.attempts) {
      const row = doc.createElement("li");
      row.textContent = safeProviderAttempt(attempt);
      list.append(row);
    }
    details.append(list);
  }
}
