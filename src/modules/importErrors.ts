import {JournalCommitPendingError,JournalUnavailableError} from './batchJournal';
import {getString} from '../utils/locale';
import {safeProviderAttempt} from './referenceSourceDetails';

export type ImportErrorCode = 'no-doi' | 'translator' | 'identity' | 'metadata' | 'timeout' | 'destination' | 'lookup';
export class ImportError extends Error {
  constructor(public readonly code: ImportErrorCode, message: string) { super(message); this.name = 'ImportError'; }
}

/** Keep diagnostic reasons in journals/results; present actionable localized text. */
export function importText(key: string, fallback: string, args?: Record<string, unknown>): string {
  try {
    const value = getString(key, {args});
    return value && !value.startsWith('refflow-') ? value : fallback;
  } catch { return fallback; }
}
export function importFailureText(failure?: {code?: string; reason?: string}): string {
  if (!failure) return importText('cards-import-failed', 'DOI import failed; retry');
  return safeProviderAttempt(failure.code ? importText(`cards-import-error-${failure.code}`, failure.reason || 'DOI import failed; retry') :
    failure.reason || importText('cards-import-failed', 'DOI import failed; retry'));
}
export function importErrorText(error:unknown):string {
  if(error instanceof JournalCommitPendingError)return importText('cards-journal-committed','Items were saved; finish saving the local journal before importing again.');
  if(error instanceof JournalUnavailableError)return importText('cards-journal-unknown','The local journal needs inspection. Preserve it and its backup; automatic recovery is unavailable.');
  if(error instanceof ImportError)return importFailureText({code:error.code,reason:error.message});
  return safeProviderAttempt(error instanceof Error?error.message:String(error));
}
export function importSummaryText(result:{importedCount:number;existingCount:number;failedCount:number;downloadCount?:number;downloadFailedCount?:number}):string {
  const summary=importText('cards-import-summary',`New: ${result.importedCount}; existing: ${result.existingCount}; failed: ${result.failedCount}`,
    {added:result.importedCount,existing:result.existingCount,failed:result.failedCount});
  const downloaded=result.downloadCount||0,failed=result.downloadFailedCount||0;
  return downloaded||failed?summary+' · '+importText('cards-import-download-summary',`PDF downloaded: ${downloaded}; failed: ${failed}`,{downloaded,failed}):summary;
}
