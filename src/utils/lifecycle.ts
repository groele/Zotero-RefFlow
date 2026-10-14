/** Run every cleanup, recording failures without leaving later resources alive. */
export function cleanupSync(action: () => void): void {
  try { action(); }
  catch (error) { reportCleanupError(error); }
}

export async function cleanupAsync(action: () => unknown): Promise<void> {
  try { await action(); }
  catch (error) { reportCleanupError(error); }
}

function reportCleanupError(error: unknown): void {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
}
