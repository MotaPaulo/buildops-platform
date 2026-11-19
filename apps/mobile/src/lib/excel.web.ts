// Browser Excel export with a pure-JS writer (write-excel-file + fflate, no native modules).
import type { SheetCell, SheetTable } from '@buildops/shared';
import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/universal';

export const EXPORT_WEB_ONLY = 'Exportação disponível no navegador.';

/** True where downloadXlsx works. */
export const canExportXlsx = true;

export type XlsxSheet = SheetTable & { name: string };

const DATE_FORMAT = 'dd/mm/yyyy hh:mm';

function toCell(value: SheetCell): Cell {
  if (value instanceof Date) return { type: Date, value, format: DATE_FORMAT };
  if (typeof value === 'number') return { type: Number, value };
  if (value === null || value === '') return null;
  return { type: String, value };
}

function toSheetData({ header, rows }: SheetTable): SheetData {
  return [
    header.map((h) => ({ type: String, value: h, fontWeight: 'bold' as const })),
    ...rows.map((r) => r.map(toCell)),
  ];
}

/** Column width from the longest header or value (in characters), capped. */
function columnWidths({ header, rows }: SheetTable) {
  return header.map((h, i) => {
    let max = h.length;
    for (const r of rows) {
      const v = r[i];
      const len = v instanceof Date ? 16 : v == null ? 0 : String(v).length;
      if (len > max) max = len;
    }
    return { width: Math.min(Math.max(max + 2, 8), 50) };
  });
}

/** Writes the sheets to an .xlsx file and makes the browser download it. */
export async function downloadXlsx(fileName: string, sheets: XlsxSheet[]): Promise<void> {
  const blob = await writeXlsxFile(
    sheets.map((s) => ({ data: toSheetData(s), sheet: s.name, columns: columnWidths(s), stickyRowsCount: 1 })),
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
