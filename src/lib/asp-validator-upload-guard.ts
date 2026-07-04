// Client-side guard for ASP Validator uploads.
// Lovable Cloud nao aceita file_size_limit / allowed_mime_types no bucket
// `asp-validator-uploads`, entao a validacao precisa viver aqui antes do
// supabase.storage.from(...).upload(...).

export const ASP_VALIDATOR_MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
export const ASP_VALIDATOR_ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;
export const ASP_VALIDATOR_ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "pdf"] as const;
export const ASP_VALIDATOR_ACCEPT_ATTR =
  ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";
export const ASP_VALIDATOR_UPLOAD_HINT = "PNG, JPG, WEBP ou PDF - ate 50 MB";

export type UploadGuardResult = { ok: true } | { ok: false; reason: string };

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

export function validateAspValidatorUpload(file: File): UploadGuardResult {
  if (!file) return { ok: false, reason: "Arquivo invalido." };

  if (file.size > ASP_VALIDATOR_MAX_UPLOAD_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return { ok: false, reason: `Arquivo "${file.name}" tem ${mb} MB. Limite: 50 MB.` };
  }

  const mime = (file.type || "").toLowerCase();
  if (mime) {
    if (!ASP_VALIDATOR_ALLOWED_MIME.includes(mime as (typeof ASP_VALIDATOR_ALLOWED_MIME)[number])) {
      return { ok: false, reason: `Formato nao suportado (${mime}). Use PNG, JPG, WEBP ou PDF.` };
    }
    return { ok: true };
  }

  // Fallback por extensao quando file.type vier vazio (comum em alguns browsers / paste).
  const ext = extensionOf(file.name);
  if (
    !ASP_VALIDATOR_ALLOWED_EXTENSIONS.includes(
      ext as (typeof ASP_VALIDATOR_ALLOWED_EXTENSIONS)[number],
    )
  ) {
    return {
      ok: false,
      reason: `Formato nao suportado (.${ext || "?"}). Use PNG, JPG, WEBP ou PDF.`,
    };
  }
  return { ok: true };
}

// Filtra uma lista de arquivos, emitindo o motivo via callback para cada rejeitado.
export function filterValidUploads(files: File[], onReject: (reason: string) => void): File[] {
  const accepted: File[] = [];
  for (const file of files) {
    const result = validateAspValidatorUpload(file);
    if (result.ok) accepted.push(file);
    else onReject(result.reason);
  }
  return accepted;
}
