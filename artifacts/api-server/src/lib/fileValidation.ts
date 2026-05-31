import path from "path";

const ALLOWED = new Map<string, string[]>([
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["image/png", [".png"]],
  ["image/webp", [".webp"]],
  ["image/heic", [".heic"]],
  ["image/heif", [".heif"]],
]);

export interface FileValidationResult {
  ok: boolean;
  error?: string;
  ext: string;
}

/** Detect image type from magic bytes. Returns a MIME or null if unrecognized. */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "image/png";
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  // HEIC/HEIF: ftyp box with heic/heif/mif1 brands
  const ftyp = buf.toString("ascii", 4, 8);
  if (ftyp === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (["heic", "heix", "heif", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

/**
 * Validate an uploaded image by sniffing magic bytes and confirming the
 * declared MIME and extension are allow-listed and consistent. This prevents
 * uploading active content (HTML/SVG/scripts) disguised as images.
 */
export function validateImageUpload(file: {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}): FileValidationResult {
  const declaredExt = (path.extname(file.originalname) || "").toLowerCase();
  const sniffed = sniffImageMime(file.buffer);

  if (!sniffed) {
    return { ok: false, error: "Nepodporovaný typ souboru. Povoleny jsou pouze obrázky (JPG, PNG, WEBP, HEIC).", ext: "" };
  }

  const allowedExts = ALLOWED.get(sniffed);
  if (!allowedExts) {
    return { ok: false, error: "Nepodporovaný typ obrázku.", ext: "" };
  }

  // Trust the sniffed type for the canonical extension; ignore a spoofed declared one.
  const canonicalExt = allowedExts[0];
  const ext = allowedExts.includes(declaredExt) ? declaredExt : canonicalExt;

  return { ok: true, ext };
}
