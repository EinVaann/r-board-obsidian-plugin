import { TFolder, normalizePath, requestUrl, type App, type TFile } from 'obsidian';

/** An image's bytes, before it is written to the vault. */
export interface SourceImage {
  data: ArrayBuffer;
  mime: string;
  /** A suggested file name, without extension. */
  name: string;
  /** Where it came from (a URL or a file name), for display. */
  origin: string;
}

export type ImageFormat = 'original' | 'png' | 'jpeg' | 'webp';

/** What to write: the image, where, under what name and in which format. */
export interface ImageDraft {
  source: SourceImage;
  /** Vault folder; '' is the vault root. */
  folder: string;
  name: string;
  format: ImageFormat;
  /** 1–100, for jpeg / webp. */
  quality: number;
  /** Which field it's for (e.g. `Moodboard.table#cover`): the last folder used is remembered per key. */
  key?: string;
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};
const FORMAT_MIME: Record<Exclude<ImageFormat, 'original'>, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXT_MIME: Record<string, string> = { ...Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m])), jpeg: 'image/jpeg' };

export const extensionFor = (mime: string): string => MIME_EXT[mime] ?? 'png';
export const isLossy = (format: ImageFormat): boolean => format === 'jpeg' || format === 'webp';
/** The extension a draft will be saved with. */
export const draftExtension = (d: Pick<ImageDraft, 'format' | 'source'>): string =>
  d.format === 'original' ? extensionFor(d.source.mime) : extensionFor(FORMAT_MIME[d.format]);

/** The image type of some bytes, from their signature, or null. */
export function sniffMime(data: ArrayBuffer): string | null {
  const b = new Uint8Array(data.slice(0, 32));
  const ascii = (from: number, to: number): string => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 12) === 'ftypavif') return 'image/avif';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  const head = new TextDecoder().decode(data.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

/** Characters a file name can't have. */
const BAD_NAME = /[\\/:*?"<>|#^[\]]/g;
export const cleanName = (name: string): string => name.replace(BAD_NAME, ' ').replace(/\s+/g, ' ').trim();

const stamp = (d = new Date()): string => {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const fallbackName = (): string => `Pasted image ${stamp()}`;

/** A file name (without extension) from a URL's last path segment, or a dated default. */
export function nameFromUrl(url: string): string {
  if (/^data:/i.test(url)) return fallbackName();
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return cleanName(last.replace(/\.[a-z0-9]{2,5}$/i, '')) || fallbackName();
  } catch {
    return fallbackName();
  }
}

const decodeEntities = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * The image URL in dragged data: an `<img>`'s src first (a linked image's
 * uri-list is the link, not the picture), then the uri-list, then plain text.
 */
export function imageUrlFromTransfer(dt: Pick<DataTransfer, 'getData'>): string | null {
  const html = dt.getData('text/html');
  const src = html ? /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] : undefined;
  if (src) {
    const url = decodeEntities(src).trim();
    if (url.startsWith('//')) return `https:${url}`;
    if (/^(https?:|data:image\/)/i.test(url)) return url;
  }
  const uri = dt
    .getData('text/uri-list')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (uri && /^(https?:|data:image\/)/i.test(uri)) return uri;
  const text = dt.getData('text/plain').trim();
  return /^(https?:\/\/\S+|data:image\/\S+)$/i.test(text) ? text : null;
}

/** The first image file among dropped / pasted files. */
export function imageFileFrom(files: FileList | File[] | null | undefined): File | null {
  return Array.from(files ?? []).find((f) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name)) ?? null;
}

export async function imageFromFile(file: File): Promise<SourceImage> {
  const data = await file.arrayBuffer();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = sniffMime(data) ?? (file.type.startsWith('image/') ? file.type : EXT_MIME[ext]);
  if (!mime) throw new Error('not an image');
  const name = cleanName(file.name.replace(/\.[^.]+$/, ''));
  return { data, mime, name: name && name !== 'image' ? name : fallbackName(), origin: file.name };
}

/** Download an image (Obsidian's request skips CORS) or decode a data URL. */
export async function imageFromUrl(url: string): Promise<SourceImage> {
  let data: ArrayBuffer;
  let type = '';
  const inline = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(url);
  if (inline) {
    type = inline[1];
    const body = decodeURIComponent(inline[3]);
    data = inline[2] ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0)).buffer : new TextEncoder().encode(body).buffer;
  } else {
    const res = await requestUrl({ url, method: 'GET' });
    data = res.arrayBuffer;
    type = (res.headers['content-type'] ?? res.headers['Content-Type'] ?? '').split(';')[0].trim();
  }
  const mime = sniffMime(data) ?? (type.startsWith('image/') ? type : null);
  if (!mime) throw new Error('the link is not an image');
  return { data, mime, name: nameFromUrl(url), origin: inline ? 'data URL' : url };
}

/** The image in a drop or paste: a file if there is one, else an image URL. */
export async function imageFromTransfer(dt: DataTransfer): Promise<SourceImage | null> {
  const file = imageFileFrom(dt.files);
  if (file) return imageFromFile(file);
  const url = imageUrlFromTransfer(dt);
  return url ? imageFromUrl(url) : null;
}

/** Whether a drag might carry an image (contents can't be read until the drop). */
export const mayHoldImage = (dt: DataTransfer | null): boolean =>
  !!dt && ['Files', 'text/uri-list', 'text/html'].some((t) => Array.from(dt.types).includes(t));

/** The bytes to write: the original, or redrawn on a canvas in the chosen format. */
export async function encodeImage(source: SourceImage, format: ImageFormat, quality: number): Promise<{ data: ArrayBuffer; ext: string }> {
  if (format === 'original' || FORMAT_MIME[format] === source.mime) return { data: source.data, ext: extensionFor(source.mime) };
  const mime = FORMAT_MIME[format];
  const url = URL.createObjectURL(new Blob([source.data], { type: source.mime }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('the image could not be read'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width || 1024;
    canvas.height = img.naturalHeight || img.height || 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas to convert with');
    // JPEG has no transparency: put it on white rather than black.
    if (format === 'jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, isLossy(format) ? quality / 100 : undefined));
    if (!blob) throw new Error(`could not convert to ${format.toUpperCase()}`);
    return { data: await blob.arrayBuffer(), ext: extensionFor(blob.type || mime) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** `folder/name.ext`, numbered (`name 1.ext`, …) when taken. */
export function freePath(app: App, folder: string, name: string, ext: string): string {
  const dir = normalizePath(folder || '/');
  const at = (n: string): string => normalizePath(dir === '/' ? `${n}.${ext}` : `${dir}/${n}.${ext}`);
  let path = at(name);
  for (let i = 1; app.vault.getAbstractFileByPath(path); i++) path = at(`${name} ${i}`);
  return path;
}

/** Write a draft into the vault, creating its folder if needed. */
export async function saveImageDraft(app: App, draft: ImageDraft): Promise<TFile> {
  const { data, ext } = await encodeImage(draft.source, draft.format, draft.quality);
  const folder = normalizePath(draft.folder.trim() || '/');
  if (folder !== '/' && !(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) await app.vault.createFolder(folder);
  const file = await app.vault.createBinary(freePath(app, folder, cleanName(draft.name) || fallbackName(), ext), data);
  remembered = { format: draft.format, quality: draft.quality };
  if (draft.key) lastFolder.set(draft.key, draft.folder);
  return file;
}

/** The last save's format and quality, offered again next time (this session). */
let remembered: Pick<ImageDraft, 'format' | 'quality'> | null = null;
/** The last folder saved to, per field key (this session). */
const lastFolder = new Map<string, string>();

/**
 * A draft for a freshly loaded image. Folder: `defaultFolder` if set, else the
 * last one used for this `key`, else the attachment folder. Format and quality: the last used.
 */
export async function newImageDraft(app: App, source: SourceImage, sourcePath: string, defaultFolder?: string, key?: string): Promise<ImageDraft> {
  const base = { source, name: source.name, key, format: remembered?.format ?? 'original', quality: remembered?.quality ?? 85 } as const;
  const preset = defaultFolder?.trim();
  if (preset) return { ...base, folder: preset };
  const last = key ? lastFolder.get(key) : undefined;
  if (last !== undefined) return { ...base, folder: last };
  let folder = '';
  try {
    const path = await app.fileManager.getAvailablePathForAttachment(`${source.name}.${extensionFor(source.mime)}`, sourcePath);
    folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  } catch {
    // Keep the vault root.
  }
  return { ...base, folder };
}

export const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
