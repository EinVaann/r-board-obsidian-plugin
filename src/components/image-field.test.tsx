// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TFile, type App } from 'obsidian';
import { ImageField } from './image-field';
import type { ImageDraft } from '../lib/data/image-import';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cover = new (TFile as unknown as new (path: string) => TFile)('Assets/cover.png');
(cover as unknown as { parent: { path: string } }).parent = { path: 'Assets' };
const app = {
  vault: { getResourcePath: (f: TFile) => `app://local/${f.path}`, getFiles: () => [cover], getAllLoadedFiles: () => [] },
  metadataCache: { getFirstLinkpathDest: (lp: string) => (lp === 'Assets/cover.png' ? cover : null), fileToLinktext: (f: TFile) => f.path },
} as unknown as App;

let root: Root | null = null;
let host: HTMLElement;
const render = (el: React.ReactElement): void => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
};
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});
const noop = (): void => {};
const field = () => host.querySelector('[data-slot="image-field"]')!;

describe('ImageField', () => {
  it('empty: one row with the search, browse and upload', () => {
    render(<ImageField app={app} sourcePath="x.table" value={null} onChange={noop} draft={null} onDraft={noop} />);
    expect(field().getAttribute('data-state')).toBe('empty');
    expect(host.querySelector('[data-slot="image-field-empty"] input')).not.toBeNull();
    expect(host.querySelector('[aria-label="Pick from the vault"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Upload from this computer"]')).not.toBeNull();
  });

  it('a picked vault image shows its preview, folder and actions', () => {
    let value: unknown = '[[Assets/cover.png]]';
    render(<ImageField app={app} sourcePath="x.table" value="[[Assets/cover.png]]" onChange={(v) => (value = v)} draft={null} onDraft={noop} />);
    expect(field().getAttribute('data-state')).toBe('linked');
    expect(host.querySelector('[data-slot="image-field-preview"] img')?.getAttribute('src')).toBe('app://local/Assets/cover.png');
    expect(host.querySelector('[data-slot="image-field-meta"]')?.textContent).toContain('cover.png');
    expect(host.querySelector('[data-slot="image-field-meta"]')?.textContent).toContain('Assets');
    act(() => (host.querySelector('[aria-label="Remove image"]') as HTMLButtonElement).click());
    expect(value).toBeNull();
  });

  it('a missing link says so instead of a broken image', () => {
    render(<ImageField app={app} sourcePath="x.table" value="[[gone.png]]" onChange={noop} draft={null} onDraft={noop} />);
    expect(host.querySelector('[data-slot="image-field-missing"]')).not.toBeNull();
    expect(host.textContent).toContain('Not found in the vault');
  });

  it('a draft shows folder, name with the format extension, and the target path', () => {
    const draft: ImageDraft = {
      source: { data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, mime: 'image/png', name: 'cat', origin: 'https://x.org/cat.png' },
      folder: 'Assets/Covers',
      name: 'cat',
      format: 'jpeg',
      quality: 80,
    };
    render(<ImageField app={app} sourcePath="x.table" value="[[Assets/cover.png]]" onChange={noop} draft={draft} onDraft={noop} />);
    expect(field().getAttribute('data-state')).toBe('draft');
    expect(host.querySelector('[data-slot="image-field-ext"]')?.textContent).toBe('.jpg');
    expect(host.querySelector('[data-slot="image-field-path"]')?.textContent).toBe('Assets/Covers/cat.jpg');
    expect(host.textContent).toContain('Quality');
  });
});
