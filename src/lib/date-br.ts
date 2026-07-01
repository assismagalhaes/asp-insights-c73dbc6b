// Helpers de data no fuso America/Sao_Paulo (UTC-3)
// Uso em módulos client + server (não importa react-query nem supabase).

export function todayBR(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function nowBRParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// yyyyMMddHHmmss no fuso BR
export function nowBRCompact(date: Date = new Date()): string {
  const p = nowBRParts(date);
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

// Converte "YYYY-MM-DD" (ou ISO string) para "dd/MM/yyyy" no fuso America/Sao_Paulo.
// Aceita null/undefined/empty -> "".
export function formatBR(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  // Se string curta "YYYY-MM-DD", trate como data local BR (evita shift UTC).
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Aceita "dd/MM/yyyy" (ou "dd-MM-yyyy") e devolve "YYYY-MM-DD". Retorna null se inválido.
export function parseBrazilianDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = String(text).trim();
  const m = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) {
    // fallback: talvez já esteja ISO
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return null;
  }
  let [, dd, mm, yyyy] = m;
  if (yyyy.length === 2) yyyy = `20${yyyy}`;
  const d = Number(dd);
  const mo = Number(mm);
  const y = Number(yyyy);
  if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Formata hora "HH:mm[:ss]" -> "HH:mm". Aceita ISO ou Date e devolve HH:mm no fuso BR.
export function formatHora(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      return new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(asDate);
    }
    return value;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

// A "linha" só deve aparecer quando não estiver embutida no texto do pick.
export function shouldShowLinha(pick: string | null | undefined, linha: string | null | undefined): boolean {
  if (linha === null || linha === undefined) return false;
  const linhaStr = String(linha).trim();
  if (!linhaStr) return false;
  if (!pick) return true;
  const pickNorm = String(pick).toLowerCase().replace(/\s+/g, " ");
  const linhaNorm = linhaStr.toLowerCase();
  return !pickNorm.includes(linhaNorm);
}
