import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Notice, type App, type TFile } from 'obsidian';
import {
  cleanName,
  draftExtension,
  formatBytes,
  imageFromFile,
  imageFromTransfer,
  isLossy,
  mayHoldImage,
  newImageDraft,
  saveImageDraft,
  type ImageDraft,
  type ImageFormat,
  type SourceImage,
} from '../lib/data/image-import';
import type { StoredValue } from '../lib/data/properties';
import { asArray, linkTo, parseLink } from '../lib/render/values';
import { Button, IconButton, Input, NumberInput, Segmented, slot, type Option } from './ui';
import { ReactModal } from '../obsidian/mount';
import { Icon } from './icon';
import { isImageFile, LinkSearch } from './link-search';
import { FilePicker, typedLink } from './links-editor';
import { FolderInput } from './folder-input';

const FORMATS: Option<ImageFormat>[] = [
  { value: 'original', label: 'Original' },
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
];

export interface ImageFieldProps {
  app: App;
  /** The file the image is linked from: shortest link text and the attachment folder. */
  sourcePath: string;
  /** The current image link (a wikilink or URL). */
  value: StoredValue | undefined;
  onChange: (value: StoredValue) => void;
  /** An image dropped / pasted / uploaded but not written yet; it wins over `value`. */
  draft: ImageDraft | null;
  onDraft: (draft: ImageDraft | null) => void;
  /** Where new images go unless changed; empty: the last folder used for `folderKey`, else the attachment folder. */
  defaultFolder?: string;
  /** Names this field (e.g. file#property), so each image field remembers its own last folder. */
  folderKey?: string;
  autoFocus?: boolean;
  /** Enter in a text box with nothing left to do: move on. */
  onEnter?: () => void;
  className?: string;
}

/**
 * An image value with a preview, whichever way it was chosen: search the vault,
 * browse, paste a URL, or drop / paste / upload a new image (then pick its
 * folder, name and format). New images are not written here — save the draft
 * with `saveImageDraft` and store its link.
 */
export function ImageField({ app, sourcePath, value, onChange, draft, onDraft, defaultFolder, folderKey, autoFocus, onEnter, className }: ImageFieldProps) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const link = asArray(value)[0] ?? null;

  const load = async (get: () => Promise<SourceImage | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const source = await get();
      if (source) onDraft(await newImageDraft(app, source, sourcePath, defaultFolder, folderKey ?? sourcePath));
      else setError('No image found in what was dropped.');
    } catch (e) {
      setError(`Could not load the image — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const browse = (): void => new FilePicker(app, (file) => (onDraft(null), onChange(linkTo(app, file, sourcePath, false))), isImageFile).open();
  const upload = (): void => fileInput.current?.click();
  const clear = (): void => {
    setError(null);
    if (draft) onDraft(null);
    else onChange(null);
  };

  const drag = {
    onDragEnter: (e: DragEvent): void => {
      if (!mayHoldImage(e.dataTransfer)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: DragEvent): void => {
      if (!mayHoldImage(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (): void => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    },
    onDrop: (e: DragEvent): void => {
      depth.current = 0;
      setOver(false);
      if (!mayHoldImage(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      const dt = e.dataTransfer;
      void load(() => imageFromTransfer(dt));
    },
  };

  const state = over ? 'over' : busy ? 'busy' : draft ? 'draft' : link ? 'linked' : 'empty';

  return (
    <div
      {...slot('image-field')}
      data-state={state}
      className={className}
      {...drag}
      onPaste={(e) => {
        // Text boxes keep pasted text; anything with an image file becomes a draft.
        const dt = e.clipboardData;
        const typing = (e.target as HTMLElement).tagName === 'INPUT';
        if (typing && !Array.from(dt.files).length) return;
        e.preventDefault();
        void load(() => imageFromTransfer(dt));
      }}
    >
      {draft ? (
        <DraftPreview app={app} draft={draft} onDraft={onDraft} onEnter={onEnter} onClear={clear} />
      ) : link ? (
        <LinkedPreview app={app} link={link} sourcePath={sourcePath} onBrowse={browse} onUpload={upload} onClear={clear} />
      ) : (
        // Empty: one row — search the vault or paste a URL, browse, upload; drop anywhere on it.
        <div {...slot('image-field-empty')}>
          <span {...slot('image-field-glyph')}>
            <Icon name={busy ? 'loader' : over ? 'download' : 'image-plus'} />
          </span>
          {over || busy ? (
            <span {...slot('image-field-drop')}>{busy ? 'Loading image…' : 'Drop to add this image'}</span>
          ) : (
            <LinkSearch
              app={app}
              sourcePath={sourcePath}
              image
              autoFocus={autoFocus}
              placeholder="Search the vault, paste a URL, or drop an image"
              onPick={(l) => onChange(l)}
              onKey={(e, text, reset) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                e.stopPropagation();
                if (text.trim()) {
                  onChange(typedLink(text));
                  reset();
                } else onEnter?.();
              }}
            />
          )}
          <span {...slot('image-field-actions')}>
            <IconButton icon="folder-open" label="Pick from the vault" size="sm" onClick={browse} />
            <IconButton icon="upload" label="Upload from this computer" size="sm" onClick={upload} />
          </span>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void load(() => imageFromFile(file));
        }}
      />
      {state === 'over' && (draft || link) && <div {...slot('image-field-hint')}>Drop to replace</div>}
      {error && (
        <div {...slot('image-field-error')} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** Thumbnail, two lines of text, and actions: shared by the linked and draft states. `detail` gets the pixel size once loaded. */
function Preview({ src, title, detail, children }: { src: string | null; title: string; detail: (size: string | null) => ReactNode; children: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const [size, setSize] = useState<string | null>(null);
  useEffect(() => {
    setBroken(false);
    setSize(null);
  }, [src]);
  return (
    <div {...slot('image-field-preview')}>
      {src && !broken ? (
        <img src={src} alt="" onError={() => setBroken(true)} onLoad={(e) => setSize(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} />
      ) : (
        <span {...slot('image-field-missing')}>
          <Icon name="image-off" />
        </span>
      )}
      <div {...slot('image-field-meta')}>
        <span title={title}>{title}</span>
        <span>{detail(size)}</span>
      </div>
      <div {...slot('image-field-actions')}>{children}</div>
    </div>
  );
}

/** An image already in the vault (or a URL). */
function LinkedPreview({ app, link, sourcePath, onBrowse, onUpload, onClear }: { app: App; link: string; sourcePath: string; onBrowse: () => void; onUpload: () => void; onClear: () => void }) {
  const parsed = parseLink(link);
  const file = parsed && !parsed.url ? app.metadataCache.getFirstLinkpathDest(parsed.linkpath, sourcePath) : null;
  const src = parsed?.url ?? (file ? app.vault.getResourcePath(file) : null);
  const detail = (size: string | null): string =>
    parsed?.url
      ? ['Web image', size].filter(Boolean).join(' · ')
      : file
        ? [file.parent && file.parent.path !== '/' ? file.parent.path : 'Vault root', size, formatBytes(file.stat.size)].filter(Boolean).join(' · ')
        : 'Not found in the vault';
  return (
    <Preview src={src} title={file?.name ?? parsed?.text ?? link} detail={detail}>
      <IconButton icon="folder-open" label="Pick another image" size="sm" onClick={onBrowse} />
      <IconButton icon="upload" label="Upload an image" size="sm" onClick={onUpload} />
      <IconButton icon="x" label="Remove image" size="sm" tone="danger" onClick={onClear} />
    </Preview>
  );
}

/** A new image: preview, then folder / name / format. */
function DraftPreview({ app, draft, onDraft, onEnter, onClear }: { app: App; draft: ImageDraft; onDraft: (d: ImageDraft | null) => void; onEnter?: () => void; onClear: () => void }) {
  // Created in the effect, not a memo: StrictMode's mount → cleanup → mount would revoke a memoized URL.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([draft.source.data], { type: draft.source.mime }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.source]);
  const set = (patch: Partial<ImageDraft>): void => onDraft({ ...draft, ...patch });
  const enter = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || !onEnter) return;
    e.preventDefault();
    e.stopPropagation();
    onEnter();
  };
  const ext = draftExtension(draft);
  const folder = draft.folder.trim().replace(/^\/+|\/+$/g, '');
  const name = cleanName(draft.name) || draft.source.name;

  return (
    <div {...slot('image-field-draft')}>
      <Preview
        src={src}
        title={draft.source.origin}
        detail={(size) => [size, draft.source.mime.replace('image/', '').toUpperCase(), formatBytes(draft.source.data.byteLength), 'not saved yet'].filter(Boolean).join(' · ')}
      >
        <IconButton icon="x" label="Discard image" size="sm" tone="danger" onClick={onClear} />
      </Preview>
      <label {...slot('image-field-row')}>
        <span>Folder</span>
        <FolderInput app={app} size="sm" value={draft.folder} placeholder="Vault root" onChange={(f) => set({ folder: f })} onKeyDown={enter} />
      </label>
      <label {...slot('image-field-row')}>
        <span>Name</span>
        <span {...slot('image-field-name')}>
          <Input size="sm" value={draft.name} placeholder={draft.source.name} onChange={(e) => set({ name: e.target.value })} onKeyDown={enter} />
          <span {...slot('image-field-ext')}>.{ext}</span>
        </span>
      </label>
      <div {...slot('image-field-row')}>
        <span>Format</span>
        <Segmented<ImageFormat> size="sm" label="Format" value={draft.format} options={FORMATS} onChange={(format) => set({ format })} />
      </div>
      {isLossy(draft.format) && (
        <div {...slot('image-field-row')}>
          <span>Quality</span>
          <NumberInput size="sm" value={draft.quality} min={1} max={100} step={5} unit="%" onChange={(quality) => set({ quality })} />
        </div>
      )}
      <div {...slot('image-field-path')}>
        <Icon name="folder" />
        <span>
          {folder ? `${folder}/` : ''}
          {name}.{ext}
        </span>
      </div>
    </div>
  );
}

/** A modal around `ImageField` with a Save button; `onSaved` gets the image's link. */
export function openImageField(app: App, sourcePath: string, onSaved: (link: string, file: TFile | null) => void, opts: { title?: string; defaultFolder?: string } = {}): void {
  new ReactModal(app, (modal) => <ImageFieldDialog app={app} sourcePath={sourcePath} defaultFolder={opts.defaultFolder} onSaved={(l, f) => (modal.close(), onSaved(l, f))} />, {
    title: opts.title ?? 'Add image',
    cls: 'rb-settings-modal rb-image-field-modal',
  }).open();
}

function ImageFieldDialog({ app, sourcePath, defaultFolder, onSaved }: { app: App; sourcePath: string; defaultFolder?: string; onSaved: (link: string, file: TFile | null) => void }) {
  const [value, setValue] = useState<StoredValue>(null);
  const [draft, setDraft] = useState<ImageDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<void> => {
    if (saving) return;
    if (!draft) {
      const link = asArray(value)[0];
      if (link) onSaved(link, null);
      return;
    }
    setSaving(true);
    try {
      const file = await saveImageDraft(app, draft);
      onSaved(linkTo(app, file, sourcePath, false), file);
    } catch (e) {
      new Notice(`R Board: could not save the image — ${(e as Error).message}`);
      setSaving(false);
    }
  };
  return (
    <div className="rb-image-field-dialog">
      <ImageField app={app} sourcePath={sourcePath} value={value} onChange={setValue} draft={draft} onDraft={setDraft} defaultFolder={defaultFolder} autoFocus onEnter={() => void save()} />
      <div className="rb-record-actions">
        <Button variant="primary" icon="check" disabled={(!draft && !asArray(value).length) || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Done'}
        </Button>
      </div>
    </div>
  );
}
