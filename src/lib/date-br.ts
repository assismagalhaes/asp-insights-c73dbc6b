// Parser e formatador de datas brasileiras (DD/MM/YYYY)
// Nunca usa Date.parse para evitar interpretação americana.

import * as XLSX from "xlsx";

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Parse data em formatos:
 * - DD/MM/YYYY ou D/M/YYYY
 * - DD-MM-YYYY ou D-M-YYYY
 * - YYYY-MM-DD (ISO)
 * - Serial Excel (number)
 * Retorna sempre YYYY-MM-DD ou null.
 */
export function parseBrazilianDate(input: unknown): string | null {
  if (input == null || input === "") return null;

  // Serial Excel
  if (typeof input === "number") {
    if (input < 60) return null; // antes de 1900-03-01 não confiável
    const d = XLSX.SSF.parse_date_code(input);
    if (!d || !valid(d.y, d.m, d.d)) return null;
    return iso(d.y, d.m, d.d);
  }

  if (input instanceof Date) {
    const y = input.getUTCFullYear();
    const m = input.getUTCMonth() + 1;
    const d = input.getUTCDate();
    return valid(y, m, d) ? iso(y, m, d) : null;
  }

  const s = String(input).trim();
  if (!s) return null;

  // ISO YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const y = +isoMatch[1], m = +isoMatch[2], d = +isoMatch[3];
    return valid(y, m, d) ? iso(y, m, d) : null;
  }

  // DD/MM/YYYY ou DD-MM-YYYY (sempre interpretado como brasileiro)
  const br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (br) {
    const d = +br[1], m = +br[2];
    let y = +br[3];
    if (y < 100) y += 2000;
    return valid(y, m, d) ? iso(y, m, d) : null;
  }

  return null;
}

/** Formata YYYY-MM-DD para DD/MM/YYYY. */
export function formatBR(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : isoDate;
}

/** Formata HH:MM:SS para HH:MM. */
export function formatHora(h: string | null | undefined): string {
  if (!h) return "";
  return h.slice(0, 5);
}
