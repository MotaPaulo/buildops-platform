// Native stub: the Excel export only runs in the browser (see excel.web.ts). No native modules.
import type { SheetTable } from '@buildops/shared';

export const EXPORT_WEB_ONLY = 'Exportação disponível no navegador.';

/** True where downloadXlsx works. */
export const canExportXlsx = false;

export type XlsxSheet = SheetTable & { name: string };

export async function downloadXlsx(_fileName: string, _sheets: XlsxSheet[]): Promise<void> {
  throw new Error(EXPORT_WEB_ONLY);
}
