import {getString} from '../utils/locale';

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
  return failure.code ? importText(`cards-import-error-${failure.code}`, failure.reason || 'DOI import failed; retry') :
    failure.reason || importText('cards-import-failed', 'DOI import failed; retry');
}
export function importErrorText(error:unknown):string {
  if(error instanceof ImportError)return importFailureText({code:error.code,reason:error.message});
  return error instanceof Error?error.message:String(error);
}
