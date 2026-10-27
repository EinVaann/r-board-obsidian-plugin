/** Browser stand-in for `obsidian`, used only by the dev harness. */

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.setText = function (this: HTMLElement, t: string) {
  this.textContent = t;
};
proto.addClass = function (this: HTMLElement, ...c: string[]) {
  this.classList.add(...c);
};
proto.removeClass = function (this: HTMLElement, ...c: string[]) {
  this.classList.remove(...c);
};
proto.toggleClass = function (this: HTMLElement, c: string, v: boolean) {
  this.classList.toggle(c, v);
};
proto.empty = function (this: HTMLElement) {
  this.replaceChildren();
};
proto.createEl = function (this: HTMLElement, tag: string, o: { cls?: string; text?: string } = {}) {
  const el = document.createElement(tag);
  if (o.cls) el.className = o.cls;
  if (o.text) el.textContent = o.text;
  this.appendChild(el);
  return el;
};
proto.createDiv = function (this: HTMLElement, o?: { cls?: string; text?: string }) {
  return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl('div', o);
};
proto.createSpan = function (this: HTMLElement, o?: { cls?: string; text?: string }) {
  return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl('span', o);
};

const mobile = new URLSearchParams(location.search).has('mobile');
export const Platform = { isMobile: mobile, isPhone: mobile, isDesktop: !mobile };

export class Notice {
  constructor(message: string) {
    console.info('[Notice]', message);
  }
}

const ICONS: Record<string, string> = {
  plus: '+', x: '×', search: '⌕', filter: '⧩', 'arrow-up-down': '⇅', 'arrow-up': '↑', 'arrow-down': '↓', 'rows-3': '☰',
  'columns-3': '▥', 'sliders-horizontal': '⚙', settings: '⚙', table: '▦', 'layout-grid': '▦', 'layout-dashboard': '▦', utensils: '🍴',
  'bar-chart-3': '▮', type: 'T', hash: '#', 'circle-dot': '◉', tags: '⌗', 'check-square': '☑', calendar: '▦',
  globe: '🌐', link: '🔗', image: '🖼', sigma: 'Σ', 'chevron-up': '▴', 'chevron-down': '▾', 'chevron-right': '›', 'chevron-left': '‹',
  'trash-2': '🗑', trash: '🗑', 'file-plus': '+', 'more-horizontal': '⋯', 'file-text': '📄', eye: '◉', 'eye-off': '◌', pencil: '✎',
  'maximize-2': '⤢', copy: '⎘', 'grip-vertical': '⋮', list: '☰',
};

export function setIcon(el: HTMLElement, name: string): void {
  el.textContent = ICONS[name] ?? '•';
}

export function debounce<T extends (...a: never[]) => unknown>(fn: T, ms: number): T {
  let t: number | undefined;
  return ((...a: never[]) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  }) as T;
}

interface Entry {
  title: string;
  checked?: boolean;
  disabled?: boolean;
  warning?: boolean;
  click?: (e: MouseEvent) => void;
  sub?: Menu;
}

export class Menu {
  private items: Entry[] = [];
  addItem(cb: (item: Record<string, (...a: unknown[]) => unknown>) => void): this {
    const entry: Entry = { title: '' };
    const item: Record<string, (...a: unknown[]) => unknown> = {};
    item.setTitle = (t) => ((entry.title = t as string), item);
    item.setIcon = () => item;
    item.setChecked = (c) => ((entry.checked = c as boolean), item);
    item.setDisabled = (d) => ((entry.disabled = d as boolean), item);
    item.setWarning = (w) => ((entry.warning = w as boolean), item);
    item.setSection = () => item;
    item.onClick = (fn) => ((entry.click = fn as Entry['click']), item);
    item.setSubmenu = () => (entry.sub = new Menu());
    cb(item);
    this.items.push(entry);
    return this;
  }
  addSeparator(): this {
    this.items.push({ title: '---' });
    return this;
  }
  showAtMouseEvent(e: MouseEvent): void {
    this.showAtPosition({ x: e.clientX, y: e.clientY });
  }
  showAtPosition(p: { x: number; y: number }): void {
    document.querySelectorAll('.dev-menu').forEach((m) => m.remove());
    const el = document.createElement('div');
    el.className = 'dev-menu menu';
    el.style.cssText = `position:fixed;left:${p.x}px;top:${p.y}px;z-index:100;background:#fff;border:1px solid #ccc;border-radius:6px;padding:4px;box-shadow:0 4px 16px rgba(0,0,0,.15);font:13px system-ui;max-height:80vh;overflow:auto`;
    for (const it of this.items) {
      if (it.title === '---') {
        el.appendChild(Object.assign(document.createElement('hr'), { style: 'margin:4px 0' }));
        continue;
      }
      const row = document.createElement('div');
      row.className = 'menu-item';
      row.textContent = `${it.checked ? '✓ ' : ''}${it.title}${it.sub ? ' ▸' : ''}`;
      row.style.cssText = `padding:4px 10px;cursor:pointer;${it.disabled ? 'opacity:.4;' : ''}${it.warning ? 'color:#c00;' : ''}`;
      row.onclick = (ev) => {
        if (it.sub) {
          it.sub.showAtPosition({ x: ev.clientX + 20, y: ev.clientY });
          return;
        }
        el.remove();
        if (!it.disabled) it.click?.(ev);
      };
      el.appendChild(row);
    }
    document.body.appendChild(el);
    setTimeout(() =>
      document.addEventListener(
        'pointerdown',
        (ev) => !(ev.target as Element).closest('.dev-menu') && document.querySelectorAll('.dev-menu').forEach((m) => m.remove()),
        { once: true },
      ),
    );
  }
}

export class Modal {
  app: unknown;
  modalEl = document.createElement('div');
  titleEl = document.createElement('h3');
  contentEl = document.createElement('div');
  containerEl = document.createElement('div');
  private bg = this.containerEl;
  constructor(app: unknown) {
    this.app = app;
    this.bg.className = 'dev-modal-bg';
    this.modalEl.className = 'modal dev-modal';
    this.modalEl.append(this.titleEl, this.contentEl);
  }
  open(): void {
    this.bg.appendChild(this.modalEl);
    document.body.appendChild(this.bg);
    this.bg.onclick = (e) => e.target === this.bg && this.close();
    void this.onOpen();
  }
  close(): void {
    this.onClose();
    this.bg.remove();
  }
  onOpen(): void | Promise<void> {}
  onClose(): void {}
}

export class Component {
  load(): void {}
  unload(): void {}
  registerEvent(): void {}
  addChild<T>(c: T): T {
    return c;
  }
}
export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super();
  }
}
export const MarkdownRenderer = {
  render: async (_app: unknown, md: string, el: HTMLElement) => {
    el.appendChild(Object.assign(document.createElement('p'), { textContent: md }));
  },
};
export class TFile {
  stat = { mtime: 0, ctime: 0, size: 0 };
  constructor(public path: string) {}
  get basename() {
    return this.path.split('/').pop()!.replace(/\.[^.]+$/, '');
  }
  get extension() {
    return this.path.split('.').pop()!;
  }
}
/** Keyboard scope (Quick Add hotkeys): a no-op in the harness. */
export class Scope {
  register(): object {
    return {};
  }
  unregister(): void {}
}
export class TFolder {}
export class ItemView {}
export class TextFileView {}
export class WorkspaceLeaf {}
export class WorkspaceSplit {}
export class Plugin {}
export const normalizePath = (p: string) => p;
export const getAllTags = (cache: { frontmatter?: { tags?: string[] } }) => (cache?.frontmatter?.tags ?? []).map((t) => `#${t}`);
