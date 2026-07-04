export function buildStoragePath(
  userId: string,
  validatorId: string,
  uploadId: string,
  fileName: string,
): string {
  const cleanName =
    (fileName || "upload")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "upload";
  return `${userId}/${validatorId}/${uploadId}/${cleanName}`;
}
