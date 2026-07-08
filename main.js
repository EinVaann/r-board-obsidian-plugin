var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => RBoardPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian13 = require("obsidian");

// src/BoardView.ts
var import_obsidian11 = require("obsidian");

// src/ui/NoteEditModal.ts
var import_obsidian = require("obsidian");
var NoteEditModal = class extends import_obsidian.Modal {
  constructor(app, file, noteTitle, onDone) {
    super(app);
    this.file = file;
    this.noteTitle = noteTitle;
    this.onDone = onDone;
    this.leaf = null;
    this.fallback = null;
  }
  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("rb-edit-modal");
    const header = contentEl.createDiv({ cls: "rb-edit-header" });
    header.createEl("h2", { cls: "rb-edit-title", text: this.noteTitle });
    const open = header.createEl("button", { cls: "mod-cta rb-edit-open", text: "Open note" });
    open.onclick = () => {
      this.close();
      void this.app.workspace.getLeaf(false).openFile(this.file);
    };
    const close = header.createEl("button", { cls: "rb-edit-close", text: "\u2715", attr: { "aria-label": "Close" } });
    close.onclick = () => this.close();
    const embed = contentEl.createDiv({ cls: "rb-edit-embed" });
    await this.embedEditor(embed);
  }
  /** Mount a real editor leaf for the file; fall back to a rendered preview. */
  async embedEditor(parent) {
    try {
      const LeafCtor = import_obsidian.WorkspaceLeaf;
      const leaf = new LeafCtor(this.app);
      this.leaf = leaf;
      await leaf.openFile(this.file, { active: false, state: { mode: "source", source: false } });
      parent.appendChild(leaf.containerEl);
      window.setTimeout(() => leaf.view?.onResize?.(), 0);
    } catch (e) {
      console.error("[r-board] could not embed editor, falling back to preview", e);
      this.leaf?.detach();
      this.leaf = null;
      await this.renderPreview(parent);
    }
  }
  /** Read-only fallback if the editor leaf can't be embedded. */
  async renderPreview(parent) {
    parent.addClass("rb-edit-preview");
    const comp = new import_obsidian.Component();
    comp.load();
    this.fallback = comp;
    const content = await this.app.vault.cachedRead(this.file);
    await import_obsidian.MarkdownRenderer.render(this.app, content, parent, this.file.path, comp);
  }
  onClose() {
    this.leaf?.detach();
    this.leaf = null;
    this.fallback?.unload();
    this.fallback = null;
    this.contentEl.empty();
    this.onDone();
  }
};

// src/config.ts
var PROPERTY_TYPES = /* @__PURE__ */ new Set(["image", "text", "multi", "number", "checkbox", "links"]);
var VIEW_TYPES = /* @__PURE__ */ new Set(["gallery", "kanban", "table"]);
var CARD_SIZES = /* @__PURE__ */ new Set(["small", "medium", "large"]);
var LIMITS = /* @__PURE__ */ new Set([10, 50, 100, "none"]);
var FILTER_OPS = /* @__PURE__ */ new Set([
  "eq",
  "ne",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "empty",
  "notempty"
]);
function normalizeTag(tag) {
  return tag.replace(/^#/, "").trim().toLowerCase();
}
function parseProperty(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const f = raw;
  if (typeof f.name !== "string") return null;
  const type = typeof f.type === "string" && PROPERTY_TYPES.has(f.type) ? f.type : "text";
  return {
    name: f.name,
    type,
    render: typeof f.render === "string" ? f.render : void 0,
    max: typeof f.max === "number" ? f.max : void 0,
    label: typeof f.label === "string" ? f.label : void 0,
    searchable: typeof f.searchable === "boolean" ? f.searchable : void 0,
    prefix: typeof f.prefix === "string" && f.prefix !== "" ? f.prefix : void 0,
    suffix: typeof f.suffix === "string" && f.suffix !== "" ? f.suffix : void 0
  };
}
function parseFilterRule(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw;
  if (typeof r.property !== "string") return null;
  if (typeof r.op !== "string" || !FILTER_OPS.has(r.op)) return null;
  return { property: r.property, op: r.op, value: r.value };
}
function parseFilterNode(raw) {
  if (typeof raw === "object" && raw !== null && Array.isArray(raw.conditions)) {
    return parseFilterGroup(raw) ?? null;
  }
  return parseFilterRule(raw);
}
function parseFilterGroup(raw) {
  if (Array.isArray(raw)) {
    const conditions2 = raw.map(parseFilterNode).filter((n) => n !== null);
    return conditions2.length ? { conjunction: "and", conditions: conditions2 } : void 0;
  }
  if (typeof raw !== "object" || raw === null) return void 0;
  const g = raw;
  if (!Array.isArray(g.conditions)) return void 0;
  const conjunction = g.conjunction === "or" ? "or" : "and";
  const conditions = g.conditions.map(parseFilterNode).filter((n) => n !== null);
  return { conjunction, conditions };
}
function parseSort(raw) {
  if (typeof raw !== "object" || raw === null) return void 0;
  const s = raw;
  if (typeof s.property !== "string") return void 0;
  return { property: s.property, dir: s.dir === "desc" ? "desc" : "asc" };
}
function parseGroupConfig(raw) {
  if (typeof raw !== "object" || raw === null) return void 0;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "object" || value === null) continue;
    const c = value;
    const entry = {};
    if (typeof c.label === "string" && c.label.trim() !== "") entry.label = c.label;
    if (typeof c.color === "string" && c.color.trim() !== "") entry.color = c.color;
    if (c.hidden === true) entry.hidden = true;
    if (Object.keys(entry).length > 0) out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : void 0;
}
function parseView(raw, index) {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw;
  const type = typeof v.type === "string" && VIEW_TYPES.has(v.type) ? v.type : "gallery";
  const limit = LIMITS.has(v.limit) ? v.limit : 50;
  return {
    name: typeof v.name === "string" && v.name.trim() !== "" ? v.name : `View ${index + 1}`,
    type,
    properties: Array.isArray(v.properties) ? v.properties.filter((p) => typeof p === "string") : void 0,
    limit,
    filter: parseFilterGroup(v.filter),
    group: typeof v.group === "string" && v.group.trim() !== "" ? v.group : void 0,
    columns: Array.isArray(v.columns) ? v.columns.filter((c) => typeof c === "string") : void 0,
    groupConfig: parseGroupConfig(v.groupConfig),
    sort: parseSort(v.sort),
    cardSize: CARD_SIZES.has(v.cardSize) ? v.cardSize : void 0,
    showContent: typeof v.showContent === "boolean" ? v.showContent : void 0,
    layout: v.layout === "grid" ? "grid" : v.layout === "masonry" ? "masonry" : void 0
  };
}
function parseDatabaseConfig(raw) {
  let data;
  try {
    data = JSON.parse(raw || "{}");
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}` };
  }
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "Database config must be a JSON object." };
  }
  const obj = data;
  if (typeof obj.sourceTag !== "string" || obj.sourceTag.trim() === "") {
    return { ok: false, error: 'Database config requires a non-empty "sourceTag".' };
  }
  const properties = Array.isArray(obj.properties) ? obj.properties.map(parseProperty).filter((p) => p !== null) : [];
  const views = Array.isArray(obj.views) ? obj.views.map(parseView).filter((v) => v !== null) : [];
  const defaultView = typeof obj.defaultView === "string" && views.some((v) => v.name === obj.defaultView) ? obj.defaultView : views[0]?.name;
  return {
    ok: true,
    config: {
      name: typeof obj.name === "string" ? obj.name : void 0,
      sourceTag: normalizeTag(obj.sourceTag),
      properties,
      views,
      defaultView,
      newNoteFolder: typeof obj.newNoteFolder === "string" && obj.newNoteFolder.trim() !== "" ? obj.newNoteFolder.trim() : void 0
    }
  };
}
function propertyLabel(prop) {
  return prop.label ?? prop.name;
}
var TITLE_SORT_KEY = "$title";
function effectiveSort(view) {
  return view.sort ?? { property: TITLE_SORT_KEY, dir: "asc" };
}
function serializeDatabase(config) {
  const out = {};
  if (config.name) out.name = config.name;
  out.sourceTag = config.sourceTag;
  out.properties = config.properties;
  out.views = config.views.map((v) => {
    const view = { name: v.name, type: v.type };
    if (v.properties && v.properties.length) view.properties = v.properties;
    if (v.limit !== void 0) view.limit = v.limit;
    if (v.filter && v.filter.conditions.length) view.filter = v.filter;
    if (v.group) view.group = v.group;
    if (v.columns && v.columns.length) view.columns = v.columns;
    if (v.groupConfig && Object.keys(v.groupConfig).length) view.groupConfig = v.groupConfig;
    if (v.sort) view.sort = v.sort;
    if (v.cardSize) view.cardSize = v.cardSize;
    if (v.showContent) view.showContent = v.showContent;
    if (v.layout) view.layout = v.layout;
    return view;
  });
  if (config.defaultView) out.defaultView = config.defaultView;
  if (config.newNoteFolder) out.newNoteFolder = config.newNoteFolder;
  return JSON.stringify(out, null, 2);
}
function makeDefaultView(type, existing) {
  const baseName = type === "gallery" ? "Gallery" : type === "kanban" ? "Board" : "Table";
  let name = baseName;
  let n = 2;
  while (existing.some((v) => v.name === name)) name = `${baseName} ${n++}`;
  const view = { name, type, limit: 50 };
  if (type === "gallery") {
    view.layout = "masonry";
    view.cardSize = "medium";
  } else if (type === "kanban") {
    view.cardSize = "medium";
  }
  return view;
}
function visibleProperties(config, view) {
  if (!view.properties || view.properties.length === 0) return config.properties;
  const byName = new Map(config.properties.map((p) => [p.name, p]));
  return view.properties.map((name) => byName.get(name)).filter((p) => p !== void 0);
}

// src/data/query.ts
var import_obsidian2 = require("obsidian");
var TEMPLATE_BASENAME = "_template";
function tagsForFile(app, file) {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];
  const all = (0, import_obsidian2.getAllTags)(cache) ?? [];
  return all.map(normalizeTag);
}
function titleForFile(file, frontmatter) {
  const t = frontmatter.title;
  return typeof t === "string" && t.trim() !== "" ? t : file.basename;
}
function queryItems(app, config) {
  const source = normalizeTag(config.sourceTag);
  const items = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (file.basename === TEMPLATE_BASENAME) continue;
    const tags = tagsForFile(app, file);
    if (!tags.includes(source)) continue;
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter ?? {};
    items.push({
      file,
      title: titleForFile(file, frontmatter),
      frontmatter,
      tags
    });
  }
  return items;
}

// src/types.ts
function isFilterGroup(node) {
  return node.conditions !== void 0;
}

// src/render/values.ts
function fieldValue(item, prop) {
  return item.frontmatter[prop.name];
}
function asNumber(value) {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}
function asBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "on", "\u2713"].includes(s)) return true;
    if (["false", "no", "n", "0", "off", ""].includes(s)) return false;
  }
  return null;
}
function asArray(value) {
  const raw = Array.isArray(value) ? value : value === void 0 || value === null || value === "" ? [] : [value];
  return raw.filter((v) => v !== null && v !== void 0 && String(v).trim() !== "").map((v) => String(v));
}
function parseLink(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) {
    return { text: raw.replace(/^https?:\/\//i, ""), url: raw, linkpath: raw };
  }
  const inner = raw.replace(/^!?\[\[/, "").replace(/\]\]$/, "");
  const [target, alias] = inner.split("|");
  const linkpath = target.split("#")[0].trim();
  return { text: (alias ?? linkpath).trim(), url: null, linkpath };
}
function resolveImageSrc(app, sourceFile, value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const inner = raw.replace(/^!?\[\[/, "").replace(/\]\]$/, "");
  const linkPath = inner.split("|")[0].split("#")[0].trim();
  const dest = app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path);
  if (dest) return app.vault.getResourcePath(dest);
  return null;
}
function fieldSearchText(item, prop) {
  const v = fieldValue(item, prop);
  if (v === void 0 || v === null) return "";
  if (Array.isArray(v)) return v.join(" ").toLowerCase();
  return String(v).toLowerCase();
}

// src/data/filter.ts
function isEmpty(value) {
  if (value === void 0 || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
function matches(item, rule, prop) {
  const raw = item.frontmatter[rule.property];
  switch (rule.op) {
    case "empty":
      return isEmpty(raw);
    case "notempty":
      return !isEmpty(raw);
    case "contains": {
      const hay = Array.isArray(raw) ? asArray(raw).join("\n") : String(raw ?? "");
      return hay.toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    }
    case "eq":
    case "ne": {
      const want = String(rule.value ?? "").toLowerCase();
      const hit = Array.isArray(raw) ? asArray(raw).some((v) => v.toLowerCase() === want) : String(raw ?? "").toLowerCase() === want;
      return rule.op === "eq" ? hit : !hit;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asNumber(raw);
      const b = asNumber(rule.value);
      if (a === null || b === null) return false;
      if (rule.op === "gt") return a > b;
      if (rule.op === "gte") return a >= b;
      if (rule.op === "lt") return a < b;
      return a <= b;
    }
    default:
      return true;
  }
}
function matchesNode(item, node, byName) {
  if (isFilterGroup(node)) return matchesGroup(item, node, byName);
  return matches(item, node, byName.get(node.property));
}
function matchesGroup(item, group, byName) {
  if (group.conditions.length === 0) return true;
  const results = group.conditions.map((c) => matchesNode(item, c, byName));
  return group.conjunction === "or" ? results.some(Boolean) : results.every(Boolean);
}
function applyFilter(items, filter, properties) {
  if (!filter || filter.conditions.length === 0) return items;
  const byName = new Map(properties.map((p) => [p.name, p]));
  return items.filter((item) => matchesGroup(item, filter, byName));
}
function countFilterRules(group) {
  if (!group) return 0;
  return group.conditions.reduce(
    (n, c) => n + (isFilterGroup(c) ? countFilterRules(c) : 1),
    0
  );
}

// src/render/common.ts
var import_obsidian3 = require("obsidian");
function openNote(app, item, newLeaf) {
  void app.workspace.openLinkText(item.file.path, item.file.path, newLeaf);
}
function createTitleLink(ctx, parent, item, cls = "rb-title") {
  const link = parent.createEl("a", { cls, text: item.title, href: "#" });
  link.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) openNote(ctx.app, item, true);
    else ctx.editFile(item.file, item.title);
  };
  return link;
}
function applyGroupColor(el, color) {
  if (!color) return;
  el.addClass("rb-group-pill");
  el.style.setProperty("--gc", color);
}
function renderSectionHeader(ctx, section, label, count, color) {
  const collapsed = ctx.ui.collapsed.has(label);
  const header = section.createDiv({ cls: "rb-section-header" });
  const caret = header.createSpan({ cls: "rb-section-caret" });
  (0, import_obsidian3.setIcon)(caret, collapsed ? "chevron-right" : "chevron-down");
  const title = header.createSpan({ cls: "rb-section-title", text: label });
  applyGroupColor(title, color);
  header.createSpan({ cls: "rb-section-count", text: String(count) });
  header.onclick = () => {
    if (collapsed) ctx.ui.collapsed.delete(label);
    else ctx.ui.collapsed.add(label);
    ctx.refresh();
  };
  return collapsed;
}
function cardSizeClass(view) {
  return `rb-size-${view.cardSize ?? "medium"}`;
}
function coverProperty(properties) {
  return properties.find((p) => p.type === "image");
}
function bodyProperties(properties) {
  return properties.filter((p) => p.type !== "image" && p.name !== "title");
}
function filterBySearch(items, properties, query) {
  const q = query.trim().toLowerCase();
  if (q === "") return items;
  const explicit = properties.filter((p) => p.searchable);
  const searchProps = explicit.length > 0 ? explicit : properties.filter((p) => p.type === "text" || p.type === "multi" || p.type === "links");
  return items.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return searchProps.some((p) => fieldSearchText(item, p).includes(q));
  });
}

// src/render/sort.ts
function applySort(items, sort, properties) {
  const prop = sort.property === TITLE_SORT_KEY ? void 0 : properties.find((p) => p.name === sort.property);
  const factor = sort.dir === "desc" ? -1 : 1;
  const out = [...items];
  out.sort((a, b) => {
    let av;
    let bv;
    if (!prop) {
      av = a.title.toLowerCase();
      bv = b.title.toLowerCase();
    } else if (prop.type === "number") {
      av = asNumber(fieldValue(a, prop)) ?? Number.NEGATIVE_INFINITY;
      bv = asNumber(fieldValue(b, prop)) ?? Number.NEGATIVE_INFINITY;
    } else if (prop.type === "checkbox") {
      av = asBoolean(fieldValue(a, prop)) ? 1 : 0;
      bv = asBoolean(fieldValue(b, prop)) ? 1 : 0;
    } else {
      av = String(fieldValue(a, prop) ?? "").toLowerCase();
      bv = String(fieldValue(b, prop) ?? "").toLowerCase();
    }
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
  return out;
}

// src/ui/ImageModal.ts
var import_obsidian4 = require("obsidian");
var ImageModal = class extends import_obsidian4.Modal {
  constructor(app, src) {
    super(app);
    this.src = src;
  }
  onOpen() {
    this.modalEl.addClass("rb-image-modal");
    this.contentEl.empty();
    const img = this.contentEl.createEl("img", {
      cls: "rb-image-modal-img",
      attr: { src: this.src }
    });
    img.onclick = () => this.close();
    this.contentEl.onclick = () => this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
function openImageModal(app, src) {
  new ImageModal(app, src).open();
}

// src/render/fields.ts
function renderField(ctx, parent, item, field) {
  switch (field.type) {
    case "image":
      return renderImage(ctx.app, parent, item, field);
    case "multi":
      return renderMulti(parent, item, field);
    case "number":
      return renderNumber(parent, item, field);
    case "checkbox":
      return renderCheckbox(parent, item, field);
    case "links":
      return renderLinks(ctx, parent, item, field);
    case "text":
    default:
      return renderText(parent, item, field);
  }
}
function renderImage(app, parent, item, field) {
  const url = resolveImageSrc(app, item.file, fieldValue(item, field));
  if (!url) return false;
  const mode = field.render === "fit" ? "fit" : "fill";
  const wrap = parent.createDiv({ cls: `rb-img rb-img-${mode}` });
  const img = wrap.createEl("img", { attr: { src: url, loading: "lazy" } });
  img.onclick = (e) => {
    e.stopPropagation();
    openImageModal(app, url);
  };
  return true;
}
function affix(field, value) {
  return `${field.prefix ?? ""}${value}${field.suffix ?? ""}`;
}
function addAffixSpans(parent, field, draw) {
  if (field.prefix) parent.createSpan({ cls: "rb-affix", text: field.prefix });
  draw();
  if (field.suffix) parent.createSpan({ cls: "rb-affix", text: field.suffix });
}
function renderText(parent, item, field) {
  const v = fieldValue(item, field);
  if (v === void 0 || v === null || v === "") return false;
  const text = affix(field, String(v));
  const render = field.render ?? "plain";
  if (render === "badge") {
    parent.createSpan({ cls: "rb-badge", text });
  } else if (render === "pill") {
    parent.createSpan({ cls: "rb-pill", text });
  } else {
    parent.createSpan({ cls: "rb-text", text });
  }
  return true;
}
var PILL_HUES = [0, 25, 45, 95, 150, 190, 215, 260, 290, 330];
function pillHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 31) + s.charCodeAt(i) >>> 0;
  return PILL_HUES[h % PILL_HUES.length];
}
function renderMulti(parent, item, field) {
  const arr = asArray(fieldValue(item, field));
  if (arr.length === 0) return false;
  const asTags = field.render === "tags";
  const wrap = parent.createDiv({ cls: "rb-multi" });
  addAffixSpans(wrap, field, () => {
    for (const entry of arr) {
      const el = wrap.createSpan({
        cls: asTags ? "rb-tag" : "rb-pill",
        text: asTags ? `#${entry}` : entry
      });
      el.style.setProperty("--pc", String(pillHue(entry)));
    }
  });
  return true;
}
function renderNumber(parent, item, field) {
  const n = asNumber(fieldValue(item, field));
  if (n === null) return false;
  const render = field.render ?? "text";
  const max = field.max ?? 100;
  switch (render) {
    case "stars":
      addAffixSpans(parent, field, () => renderStars(parent, n, field.max ?? 5));
      return true;
    case "bar":
      addAffixSpans(parent, field, () => renderBar(parent, n, max));
      return true;
    case "circle":
      addAffixSpans(parent, field, () => renderCircle(parent, n, max));
      return true;
    case "text":
    default:
      parent.createSpan({ cls: "rb-text rb-number", text: affix(field, String(n)) });
      return true;
  }
}
function renderLinks(ctx, parent, item, field) {
  const links = asArray(fieldValue(item, field)).map(parseLink).filter((l) => l !== null);
  if (links.length === 0) return false;
  const asPills = field.render === "pills";
  const wrap = parent.createDiv({ cls: "rb-links" });
  addAffixSpans(wrap, field, () => {
    for (const link of links) {
      const a = wrap.createEl("a", {
        cls: asPills ? "rb-link rb-link-pill" : "rb-link",
        text: link.text,
        href: link.url ?? "#"
      });
      if (link.url) {
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener");
        a.onclick = (e) => e.stopPropagation();
      } else {
        const dest = ctx.app.metadataCache.getFirstLinkpathDest(link.linkpath, item.file.path);
        a.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dest && !(e.ctrlKey || e.metaKey)) ctx.editFile(dest);
          else void ctx.app.workspace.openLinkText(link.linkpath, item.file.path, e.ctrlKey || e.metaKey);
        };
      }
    }
  });
  return true;
}
function renderCheckbox(parent, item, field) {
  const b = asBoolean(fieldValue(item, field)) ?? false;
  const render = field.render ?? "check";
  addAffixSpans(parent, field, () => {
    if (render === "toggle") {
      const wrap = parent.createDiv({
        cls: `rb-toggle ${b ? "rb-toggle-on" : "rb-toggle-off"}`,
        attr: { "aria-label": b ? "true" : "false" }
      });
      wrap.createDiv({ cls: "rb-toggle-knob" });
      return;
    }
    const glyph = render === "box" ? b ? "\u2611" : "\u2610" : b ? "\u2713" : "\u2715";
    parent.createSpan({
      cls: `rb-check ${b ? "rb-check-on" : "rb-check-off"}`,
      text: glyph,
      attr: { "aria-label": b ? "true" : "false" }
    });
  });
  return true;
}
function renderStars(parent, value, max) {
  const wrap = parent.createDiv({ cls: "rb-stars", attr: { "aria-label": `${value} / ${max}` } });
  for (let i = 1; i <= max; i++) {
    const fill = Math.max(0, Math.min(1, value - (i - 1)));
    const star = wrap.createSpan({ cls: "rb-star", text: "\u2605" });
    if (fill > 0) {
      const on = star.createSpan({ cls: "rb-star-on", text: "\u2605" });
      on.style.width = `${fill * 100}%`;
    }
  }
}
function renderBar(parent, value, max) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0)) * 100;
  const wrap = parent.createDiv({ cls: "rb-bar", attr: { "aria-label": `${value} / ${max}` } });
  wrap.createDiv({ cls: "rb-bar-fill" }).style.width = `${pct}%`;
  wrap.createSpan({ cls: "rb-bar-label", text: String(value) });
}
function renderCircle(parent, value, max) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const size = 44;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  const wrap = parent.createDiv({ cls: "rb-circle", attr: { "aria-label": `${value} / ${max}` } });
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  const mkCircle = (cls) => {
    const c = document.createElementNS(svgNs, "circle");
    c.setAttribute("cx", String(size / 2));
    c.setAttribute("cy", String(size / 2));
    c.setAttribute("r", String(r));
    c.setAttribute("fill", "none");
    c.setAttribute("stroke-width", String(stroke));
    c.setAttribute("class", cls);
    return c;
  };
  svg.appendChild(mkCircle("rb-circle-track"));
  const prog = mkCircle("rb-circle-prog");
  prog.setAttribute("stroke-dasharray", String(circ));
  prog.setAttribute("stroke-dashoffset", String(offset));
  prog.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
  svg.appendChild(prog);
  wrap.appendChild(svg);
  wrap.createSpan({ cls: "rb-circle-label", text: String(Math.round(value)) });
}

// src/render/paginate.ts
function renderPaged(host, items, limit, drawItem, page) {
  if (limit === "none") {
    for (const item of items) drawItem(item, host);
    return;
  }
  const pageSize = limit;
  let shown = 0;
  let moreBtn = null;
  const reveal = (target) => {
    const end = Math.min(target, items.length);
    for (let i = shown; i < end; i++) drawItem(items[i], host);
    shown = end;
    if (page) page.store[page.key] = shown;
    if (moreBtn) {
      moreBtn.remove();
      moreBtn = null;
    }
    if (shown < items.length) {
      moreBtn = host.createEl("button", {
        cls: "rb-view-more",
        text: `View More (${items.length - shown})`
      });
      moreBtn.onclick = () => reveal(shown + pageSize);
    }
  };
  const remembered = page ? page.store[page.key] : void 0;
  reveal(Math.max(pageSize, remembered ?? pageSize));
}

// src/render/content.ts
var import_obsidian5 = require("obsidian");

// src/render/contentType.ts
var RECIPE = {
  id: "recipe",
  label: "Recipe",
  // A fenced ```recipe block anywhere in the body (any fence length, optional
  // leading whitespace).
  matches: (body) => /^\s*`{3,}\s*recipe\b/m.test(body)
};
var CONTENT_TYPES = [RECIPE];
function detectContentType(body) {
  return CONTENT_TYPES.find((t) => t.matches(body)) ?? null;
}

// src/render/content.ts
function stripFrontmatter(raw) {
  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end !== -1) {
      const after = raw.indexOf("\n", end + 1);
      return after !== -1 ? raw.slice(after + 1) : "";
    }
  }
  return raw;
}
async function renderNoteExcerpt(app, el, file, component, maxChars = 320) {
  try {
    const raw = await app.vault.cachedRead(file);
    const body = stripFrontmatter(raw).trim();
    if (!body) return;
    const type = detectContentType(body);
    if (type) {
      el.createSpan({
        cls: `rb-content-type rb-content-type-${type.id}`,
        text: type.label
      });
    }
    const excerpt = body.length > maxChars ? `${body.slice(0, maxChars).trimEnd()}\u2026` : body;
    await import_obsidian5.MarkdownRenderer.render(app, excerpt, el, file.path, component);
  } catch {
  }
}

// src/data/group.ts
var UNCATEGORIZED_LABEL = "Uncategorized";
function groupValueOf(item, prop) {
  const raw = item.frontmatter[prop.name];
  if (raw === void 0 || raw === null || raw === "") return null;
  if (Array.isArray(raw)) {
    const arr = asArray(raw);
    return arr.length > 0 ? arr[0] : null;
  }
  return String(raw);
}
function groupItems(items, prop, order, groupConfig) {
  const buckets = /* @__PURE__ */ new Map();
  const uncategorized = [];
  for (const item of items) {
    const value = groupValueOf(item, prop);
    if (value === null) {
      uncategorized.push(item);
      continue;
    }
    const list = buckets.get(value);
    if (list) list.push(item);
    else buckets.set(value, [item]);
  }
  const colLabel = (key) => groupConfig?.[key]?.label ?? key;
  const isHidden = (key) => groupConfig?.[key]?.hidden === true;
  const groups = [];
  const seen = /* @__PURE__ */ new Set();
  if (order) {
    for (const value of order) {
      seen.add(value);
      if (isHidden(value)) continue;
      groups.push({ key: value, label: colLabel(value), items: buckets.get(value) ?? [] });
    }
  }
  const rest = [...buckets.keys()].filter((k) => !seen.has(k)).sort((a, b) => a.localeCompare(b));
  for (const value of rest) {
    if (isHidden(value)) continue;
    groups.push({ key: value, label: colLabel(value), items: buckets.get(value) ?? [] });
  }
  if (uncategorized.length > 0) {
    groups.push({ key: null, label: UNCATEGORIZED_LABEL, items: uncategorized });
  }
  return groups;
}

// src/views/gallery.ts
function renderGallery(host, items, ctx) {
  host.empty();
  if (items.length === 0) {
    host.createDiv({ cls: "rb-empty", text: "No notes match this view." });
    return;
  }
  const groupProp = ctx.view.group ? ctx.properties.find((p) => p.name === ctx.view.group) : void 0;
  if (groupProp) {
    for (const group of groupItems(items, groupProp, ctx.view.columns, ctx.view.groupConfig)) {
      const section = host.createDiv({ cls: "rb-section" });
      const color = group.key != null ? ctx.view.groupConfig?.[group.key]?.color : void 0;
      const collapsed = renderSectionHeader(ctx, section, group.label, group.items.length, color);
      if (!collapsed) renderGrid(section, group.items, ctx, `g:${group.label}`);
    }
    return;
  }
  renderGrid(host, items, ctx, "g");
}
function renderGrid(parent, items, ctx, pageKey) {
  const cover = coverProperty(ctx.properties);
  const fields = bodyProperties(ctx.properties);
  const layout = ctx.view.layout ?? "masonry";
  const grid = parent.createDiv({
    cls: `rb-gallery rb-gallery-${layout} ${cardSizeClass(ctx.view)}`
  });
  renderPaged(grid, items, ctx.view.limit ?? 50, (item, host) => {
    const card = host.createDiv({ cls: "rb-card rb-gallery-card" });
    if (cover) renderField(ctx, card, item, cover);
    const body = card.createDiv({ cls: "rb-card-body" });
    createTitleLink(ctx, body, item);
    for (const prop of fields) {
      const row = body.createDiv({ cls: "rb-field" });
      if (!renderField(ctx, row, item, prop)) row.remove();
    }
    if (ctx.view.showContent) {
      const content = body.createDiv({ cls: "rb-card-content" });
      void renderNoteExcerpt(ctx.app, content, item.file, ctx.component);
    }
  }, { key: pageKey, store: ctx.ui.pages });
}

// src/views/kanban.ts
var import_obsidian6 = require("obsidian");

// src/data/properties.ts
async function setProperty(app, file, prop, value) {
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (value === null) {
      delete fm[prop.name];
      return;
    }
    if (prop.type === "number") {
      const n = Number(value);
      fm[prop.name] = Number.isNaN(n) ? value : n;
    } else if (prop.type === "checkbox") {
      const s = value.trim().toLowerCase();
      fm[prop.name] = ["true", "yes", "y", "1", "on"].includes(s);
    } else {
      fm[prop.name] = value;
    }
  });
}

// src/views/kanban.ts
var COLUMN_MIME = "application/x-rb-column";
var MLOG = "[R Board move]";
function renderKanban(host, items, ctx) {
  host.empty();
  const groupProp = ctx.view.group ? ctx.config.properties.find((p) => p.name === ctx.view.group) : void 0;
  if (!groupProp) {
    host.createDiv({
      cls: "rb-empty",
      text: 'This kanban view needs a "group" property to use as columns. Open view settings to set one.'
    });
    return;
  }
  const wrap = host.createDiv({ cls: "rb-kanban-wrap" });
  const topbar = wrap.createDiv({ cls: "rb-kanban-scrolltop" });
  const topInner = topbar.createDiv({ cls: "rb-kanban-scrolltop-inner" });
  const board = wrap.createDiv({ cls: `rb-kanban ${cardSizeClass(ctx.view)}` });
  const columns = groupItems(items, groupProp, ctx.view.columns, ctx.view.groupConfig);
  const realKeys = columns.filter((c) => c.key !== null).map((c) => c.key);
  const targets = columns.map((c) => ({ key: c.key, label: c.label }));
  const reorder = (draggedKey, beforeKey) => {
    const order = realKeys.filter((k) => k !== draggedKey);
    if (beforeKey === null) order.push(draggedKey);
    else {
      const to = order.indexOf(beforeKey);
      order.splice(to === -1 ? order.length : to, 0, draggedKey);
    }
    ctx.view.columns = order;
    ctx.commit();
  };
  for (const column of columns) renderColumn(board, column, groupProp, ctx, reorder, targets);
  renderAddGroup(board, realKeys, ctx);
  wireTopScrollbar(topbar, topInner, board, ctx);
}
function wireTopScrollbar(topbar, topInner, board, ctx) {
  const sync = () => {
    topInner.style.width = `${board.scrollWidth}px`;
    topbar.toggleClass("rb-hidden", board.scrollWidth <= board.clientWidth + 1);
    const saved = ctx.ui.kanbanScroll ?? 0;
    if (saved) {
      board.scrollLeft = saved;
      topbar.scrollLeft = saved;
    }
  };
  window.requestAnimationFrame(sync);
  let lock = false;
  topbar.addEventListener("scroll", () => {
    ctx.ui.kanbanScroll = topbar.scrollLeft;
    if (lock) return;
    lock = true;
    board.scrollLeft = topbar.scrollLeft;
    lock = false;
  });
  board.addEventListener("scroll", () => {
    ctx.ui.kanbanScroll = board.scrollLeft;
    if (lock) return;
    lock = true;
    topbar.scrollLeft = board.scrollLeft;
    lock = false;
  });
}
function renderColumn(board, column, groupProp, ctx, reorder, targets) {
  const collapsed = ctx.ui.collapsed.has(column.label);
  const colEl = board.createDiv({ cls: "rb-kanban-col" });
  if (collapsed) colEl.addClass("rb-collapsed");
  if (!import_obsidian6.Platform.isMobile) {
    colEl.addEventListener("dragover", (e) => {
      if (!hasType(e, COLUMN_MIME)) return;
      e.preventDefault();
      colEl.addClass("rb-col-drop");
    });
    colEl.addEventListener("dragleave", () => colEl.removeClass("rb-col-drop"));
    colEl.addEventListener("drop", (e) => {
      if (!hasType(e, COLUMN_MIME)) return;
      e.preventDefault();
      colEl.removeClass("rb-col-drop");
      const dragged = e.dataTransfer?.getData(COLUMN_MIME);
      if (dragged && dragged !== column.key) reorder(dragged, column.key);
    });
  }
  const header = colEl.createDiv({ cls: "rb-kanban-header" });
  const caret = header.createSpan({ cls: "rb-kanban-caret" });
  (0, import_obsidian6.setIcon)(caret, collapsed ? "chevron-right" : "chevron-down");
  const titleSpan = header.createSpan({ cls: "rb-kanban-title", text: column.label });
  const colCfg = column.key !== null ? ctx.view.groupConfig?.[column.key] : void 0;
  applyGroupColor(titleSpan, colCfg?.color);
  header.createSpan({ cls: "rb-kanban-count", text: String(column.items.length) });
  header.onclick = () => {
    if (collapsed) ctx.ui.collapsed.delete(column.label);
    else ctx.ui.collapsed.add(column.label);
    ctx.refresh();
  };
  if (!import_obsidian6.Platform.isMobile && column.key !== null) {
    header.addClass("rb-draggable");
    header.setAttr("draggable", "true");
    header.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(COLUMN_MIME, column.key);
      e.dataTransfer.effectAllowed = "move";
      colEl.addClass("rb-col-dragging");
    });
    header.addEventListener("dragend", () => colEl.removeClass("rb-col-dragging"));
  }
  const list = colEl.createDiv({ cls: "rb-kanban-list" });
  if (collapsed) return;
  const scrollKey = column.label;
  list.addEventListener("scroll", () => {
    ctx.ui.listScroll[scrollKey] = list.scrollTop;
  });
  if (column.items.length === 0) {
    list.createDiv({ cls: "rb-kanban-empty-drop", text: "Drop cards here" });
  } else {
    renderPaged(
      list,
      column.items,
      ctx.view.limit ?? 50,
      (item, host) => renderCard(host, item, ctx, groupProp, targets),
      { key: `k:${column.label}`, store: ctx.ui.pages }
    );
  }
  const savedTop = ctx.ui.listScroll[scrollKey];
  if (savedTop) window.requestAnimationFrame(() => {
    list.scrollTop = savedTop;
  });
  if (!import_obsidian6.Platform.isMobile) {
    list.addEventListener("dragover", (e) => {
      if (hasType(e, COLUMN_MIME)) return;
      e.preventDefault();
      list.addClass("rb-drop-active");
    });
    list.addEventListener("dragleave", () => list.removeClass("rb-drop-active"));
    list.addEventListener("drop", (e) => {
      list.removeClass("rb-drop-active");
      if (hasType(e, COLUMN_MIME)) return;
      e.preventDefault();
      const path = e.dataTransfer?.getData("text/plain");
      if (path) void handleDrop(path, column, groupProp, ctx);
    });
  }
}
function renderAddGroup(board, realKeys, ctx) {
  const col = board.createDiv({ cls: "rb-kanban-col rb-kanban-add" });
  const btn = col.createDiv({ cls: "rb-kanban-add-btn" });
  (0, import_obsidian6.setIcon)(btn.createSpan({ cls: "rb-kanban-add-icon" }), "plus");
  btn.createSpan({ text: "Add group" });
  btn.onclick = () => {
    col.empty();
    const input = col.createEl("input", {
      cls: "rb-kanban-add-input",
      attr: { type: "text", placeholder: "Group name\u2026" }
    });
    input.focus();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && !realKeys.includes(name)) {
        const cols = ctx.view.columns ? [...ctx.view.columns] : [...realKeys];
        if (!cols.includes(name)) cols.push(name);
        ctx.view.columns = cols;
        ctx.commit();
      } else {
        ctx.refresh();
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  };
}
function renderCard(list, item, ctx, groupProp, targets) {
  const cover = coverProperty(ctx.properties);
  const fields = bodyProperties(ctx.properties);
  const card = list.createDiv({ cls: "rb-card rb-kanban-card" });
  if (!import_obsidian6.Platform.isMobile) card.setAttr("draggable", "true");
  card.dataset.path = item.file.path;
  card.oncontextmenu = (e) => {
    e.preventDefault();
    openCardMenu(e, item, groupProp, targets, ctx);
  };
  const menuBtn = card.createEl("button", { cls: "rb-card-menu", attr: { "aria-label": "Card actions" } });
  (0, import_obsidian6.setIcon)(menuBtn, "more-horizontal");
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    openCardMenu(e, item, groupProp, targets, ctx);
  };
  if (!import_obsidian6.Platform.isMobile) {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", item.file.path);
      e.dataTransfer.effectAllowed = "move";
      const ghost = card.cloneNode(true);
      ghost.addClass("rb-drag-ghost");
      ghost.style.width = `${card.offsetWidth}px`;
      document.body.appendChild(ghost);
      e.dataTransfer?.setDragImage(ghost, e.offsetX, e.offsetY);
      window.setTimeout(() => ghost.remove(), 0);
      card.addClass("rb-dragging");
    });
    card.addEventListener("dragend", () => card.removeClass("rb-dragging"));
  }
  if (cover) renderField(ctx, card, item, cover);
  const body = card.createDiv({ cls: "rb-card-body" });
  createTitleLink(ctx, body, item);
  for (const prop of fields) {
    const row = body.createDiv({ cls: "rb-field" });
    if (!renderField(ctx, row, item, prop)) row.remove();
  }
  if (ctx.view.showContent) {
    const content = body.createDiv({ cls: "rb-card-content" });
    void renderNoteExcerpt(ctx.app, content, item.file, ctx.component);
  }
}
function openCardMenu(e, item, groupProp, targets, ctx) {
  const current = groupValueOf(item, groupProp);
  const menu = new import_obsidian6.Menu();
  menu.addItem((it) => {
    it.setTitle("Move to group").setIcon("arrow-right-circle");
    const sub = it.setSubmenu();
    for (const t of targets) {
      sub.addItem((si) => {
        si.setTitle(t.label);
        if ((t.key ?? null) === (current ?? null)) si.setChecked(true);
        si.onClick(() => void moveCardToGroup(item, t.key, groupProp, ctx));
      });
    }
  });
  menu.addSeparator();
  menu.addItem(
    (it) => it.setTitle("Open note").setIcon("file-text").onClick(() => openNote(ctx.app, item, false))
  );
  menu.showAtMouseEvent(e);
}
async function moveCardToGroup(item, targetKey, groupProp, ctx) {
  await moveItemToGroup(item.file, targetKey, groupProp, ctx);
}
async function moveItemToGroup(file, targetKey, groupProp, ctx) {
  const key = groupProp.name;
  const before = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
  console.log(
    `${MLOG} move: "${file.path}" \u2192 ${targetKey === null ? "(Uncategorized)" : `"${targetKey}"`} | prop="${key}" type=${groupProp.type} | before=${JSON.stringify(before)}`
  );
  try {
    await setProperty(ctx.app, file, groupProp, targetKey);
    const afterWrite = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
    console.log(`${MLOG} wrote frontmatter; cache value right after write = ${JSON.stringify(afterWrite)}`);
    await waitForFrontmatter(ctx, file, key, targetKey);
  } catch (e) {
    console.error(`${MLOG} FAILED for "${file.path}":`, e);
    new import_obsidian6.Notice(`R Board: could not move note \u2014 ${e.message}`);
    return;
  }
  const after = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
  const computed = groupValueOf({ file, frontmatter: ctx.app.metadataCache.getFileCache(file)?.frontmatter ?? {} }, groupProp);
  const inView = ctx.config.properties.some((p) => p.name === ctx.view.group);
  console.log(
    `${MLOG} done: "${file.basename}" final value=${JSON.stringify(after)} | groupValueOf="${computed}" expected="${targetKey}" | view.group="${ctx.view.group}" groupPropInConfig=${inView} matches=${(computed ?? null) === (targetKey ?? null)}`
  );
  ctx.refresh();
  window.requestAnimationFrame(() => {
    const cards = Array.from(document.querySelectorAll(".rb-kanban-card"));
    const el = cards.find((c) => c.dataset.path === file.path);
    const col = el?.closest(".rb-kanban-col")?.querySelector(".rb-kanban-title")?.textContent;
    console.log(`${MLOG} after re-render: card ${el ? `in column "${col}"` : "NOT FOUND in DOM (filtered out / not visible?)"}`);
  });
}
function waitForFrontmatter(ctx, file, key, expected) {
  const matches2 = () => {
    const v = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
    if (expected === null) return v === void 0 || v === null || v === "";
    if (Array.isArray(v)) return v.map(String).includes(String(expected));
    return String(v) === String(expected);
  };
  return new Promise((resolve2) => {
    if (matches2()) {
      console.log(`${MLOG} waitForFrontmatter: matched immediately`);
      return resolve2();
    }
    const ref = ctx.app.metadataCache.on("changed", (f) => {
      if (f.path === file.path && matches2()) {
        console.log(`${MLOG} waitForFrontmatter: matched via 'changed' event`);
        ctx.app.metadataCache.offref(ref);
        window.clearInterval(timer);
        resolve2();
      }
    });
    let tries = 0;
    const timer = window.setInterval(() => {
      if (matches2()) {
        console.log(`${MLOG} waitForFrontmatter: matched via poll after ${tries * 50}ms`);
        ctx.app.metadataCache.offref(ref);
        window.clearInterval(timer);
        resolve2();
      } else if (++tries > 30) {
        const v = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
        console.warn(`${MLOG} waitForFrontmatter: TIMED OUT after 1.5s; cache value=${JSON.stringify(v)}, expected=${JSON.stringify(expected)}`);
        ctx.app.metadataCache.offref(ref);
        window.clearInterval(timer);
        resolve2();
      }
    }, 50);
  });
}
function hasType(e, type) {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(type);
}
async function handleDrop(path, column, groupProp, ctx) {
  const file = ctx.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof import_obsidian6.TFile)) return;
  await moveItemToGroup(file, column.key, groupProp, ctx);
}

// src/views/table.ts
var import_obsidian7 = require("obsidian");
var COLUMN_MIME2 = "application/x-rb-table-column";
function renderTable(host, items, ctx) {
  host.empty();
  if (items.length === 0) {
    host.createDiv({ cls: "rb-empty", text: "No notes match this view." });
    return;
  }
  const props = ctx.properties;
  const groupProp = ctx.view.group ? props.find((p) => p.name === ctx.view.group) : void 0;
  if (groupProp) {
    for (const group of groupItems(items, groupProp, ctx.view.columns, ctx.view.groupConfig)) {
      const section = host.createDiv({ cls: "rb-section" });
      const color = group.key != null ? ctx.view.groupConfig?.[group.key]?.color : void 0;
      const collapsed = renderSectionHeader(ctx, section, group.label, group.items.length, color);
      if (!collapsed) renderTableEl(section, group.items, props, ctx, `t:${group.label}`);
    }
    return;
  }
  renderTableEl(host, items, props, ctx, "t");
}
function renderTableEl(parent, items, props, ctx, pageKey) {
  const table = parent.createEl("table", { cls: "rb-table" });
  const headRow = table.createEl("thead").createEl("tr");
  const reorderColumns = (dragged, before) => {
    const order = props.map((p) => p.name);
    const from = order.indexOf(dragged);
    if (from === -1) return;
    order.splice(from, 1);
    const to = order.indexOf(before);
    order.splice(to === -1 ? order.length : to, 0, dragged);
    ctx.view.properties = order;
    ctx.commit();
  };
  const makeHeader = (label, key, draggable = false) => {
    const th = headRow.createEl("th", { cls: "rb-th" });
    th.createSpan({ text: label });
    if (ctx.sort.property === key) {
      th.createSpan({ cls: "rb-sort-ind", text: ctx.sort.dir === "asc" ? " \u25B2" : " \u25BC" });
    }
    th.onclick = () => {
      const dir = ctx.sort.property === key && ctx.sort.dir === "asc" ? "desc" : "asc";
      ctx.setSort({ property: key, dir });
    };
    if (draggable && !import_obsidian7.Platform.isMobile) {
      th.addClass("rb-th-draggable");
      th.setAttr("draggable", "true");
      th.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData(COLUMN_MIME2, key);
        e.dataTransfer.effectAllowed = "move";
        th.addClass("rb-th-dragging");
      });
      th.addEventListener("dragend", () => th.removeClass("rb-th-dragging"));
      th.addEventListener("dragover", (e) => {
        if (!e.dataTransfer?.types.includes(COLUMN_MIME2)) return;
        e.preventDefault();
        th.addClass("rb-th-drop");
      });
      th.addEventListener("dragleave", () => th.removeClass("rb-th-drop"));
      th.addEventListener("drop", (e) => {
        if (!e.dataTransfer?.types.includes(COLUMN_MIME2)) return;
        e.preventDefault();
        th.removeClass("rb-th-drop");
        const dragged = e.dataTransfer.getData(COLUMN_MIME2);
        if (dragged && dragged !== key) reorderColumns(dragged, key);
      });
    }
  };
  makeHeader("Title", TITLE_SORT_KEY);
  props.forEach((p) => makeHeader(propertyLabel(p), p.name, true));
  const tbody = table.createEl("tbody");
  renderPaged(tbody, items, ctx.view.limit ?? 50, (item) => {
    const tr = tbody.createEl("tr", { cls: "rb-tr" });
    createTitleLink(ctx, tr.createEl("td", { cls: "rb-td" }), item);
    for (const prop of props) {
      renderField(ctx, tr.createEl("td", { cls: "rb-td" }), item, prop);
    }
  }, { key: pageKey, store: ctx.ui.pages });
}

// src/ui/WizardModal.ts
var import_obsidian8 = require("obsidian");

// src/ui/PropertyEditor.ts
var RENDER_OPTIONS = {
  image: ["fill", "fit"],
  text: ["plain", "badge", "pill"],
  multi: ["pills", "tags"],
  number: ["text", "stars", "bar", "circle"],
  checkbox: ["check", "box", "toggle"],
  links: ["list", "pills"]
};
function needsMax(prop) {
  return prop.type === "number" && ["stars", "bar", "circle"].includes(prop.render ?? "");
}
function makeSelect(parent, options, value) {
  const sel = parent.createEl("select", { cls: "rb-prop-select" });
  for (const opt of options) {
    const o = sel.createEl("option", { text: opt });
    o.value = opt;
  }
  sel.value = value;
  return sel;
}
function renderPropertyEditor(container, properties, onChange) {
  const rerender = () => {
    renderPropertyEditor(container, properties, onChange);
    onChange();
  };
  container.empty();
  properties.forEach((prop, i) => {
    const card = container.createDiv({ cls: "rb-prop-card" });
    const head = card.createDiv({ cls: "rb-prop-head" });
    const name = head.createEl("input", {
      cls: "rb-prop-name",
      attr: { type: "text", placeholder: "field name" }
    });
    name.value = prop.name;
    name.oninput = () => {
      prop.name = name.value;
      onChange();
    };
    const remove = head.createEl("button", { cls: "rb-prop-remove", text: "Remove" });
    remove.onclick = () => {
      properties.splice(i, 1);
      rerender();
    };
    card.createDiv({ cls: "rb-prop-config-label", text: "CONFIG" });
    const typeSel = makeSelect(card, ["image", "text", "multi", "number", "checkbox", "links"], prop.type);
    typeSel.onchange = () => {
      prop.type = typeSel.value;
      prop.render = RENDER_OPTIONS[prop.type][0];
      rerender();
    };
    const renderSel = makeSelect(card, RENDER_OPTIONS[prop.type], prop.render ?? RENDER_OPTIONS[prop.type][0]);
    renderSel.onchange = () => {
      prop.render = renderSel.value;
      rerender();
    };
    if (needsMax(prop)) {
      const max = card.createEl("input", {
        cls: "rb-prop-input",
        attr: { type: "number", placeholder: "max" }
      });
      max.value = prop.max != null ? String(prop.max) : "";
      max.oninput = () => {
        const n = Number(max.value);
        prop.max = Number.isNaN(n) ? void 0 : n;
        onChange();
      };
    }
    if (prop.type !== "image") {
      card.createDiv({ cls: "rb-prop-affix-label", text: "Prefix / Suffix" });
      const affixRow = card.createDiv({ cls: "rb-prop-affix" });
      const prefix = affixRow.createEl("input", {
        cls: "rb-prop-input",
        attr: { type: "text", placeholder: 'prefix (e.g. "Score: ")' }
      });
      prefix.value = prop.prefix ?? "";
      prefix.oninput = () => {
        prop.prefix = prefix.value || void 0;
        onChange();
      };
      const suffix = affixRow.createEl("input", {
        cls: "rb-prop-input",
        attr: { type: "text", placeholder: 'suffix (e.g. "%")' }
      });
      suffix.value = prop.suffix ?? "";
      suffix.oninput = () => {
        prop.suffix = suffix.value || void 0;
        onChange();
      };
    }
  });
  const add = container.createEl("button", { cls: "rb-prop-add", text: "+ Add property" });
  add.onclick = () => {
    properties.push({ name: "", type: "text", render: "plain" });
    rerender();
  };
}

// src/ui/WizardModal.ts
var WizardModal = class extends import_obsidian8.Modal {
  constructor(app, seed, heading, onComplete) {
    super(app);
    this.name = seed.name ?? "";
    this.sourceTag = seed.sourceTag ?? "";
    this.properties = (seed.properties ?? []).map((p) => ({ ...p }));
    this.heading = heading;
    this.onComplete = onComplete;
  }
  onOpen() {
    this.titleEl.setText(this.heading);
    const { contentEl } = this;
    contentEl.addClass("rb-wizard");
    new import_obsidian8.Setting(contentEl).setName("Name").setDesc("Shown in the board title.").addText((t) => t.setValue(this.name).onChange((v) => this.name = v));
    new import_obsidian8.Setting(contentEl).setName("Base tag").setDesc("Notes carrying this tag become rows (without the leading #).").addText(
      (t) => t.setPlaceholder("backlog").setValue(this.sourceTag).onChange((v) => this.sourceTag = v)
    );
    contentEl.createEl("h4", { text: "Properties" });
    contentEl.createEl("p", {
      cls: "rb-wizard-hint",
      text: "Frontmatter keys to show on cards and in tables."
    });
    const propsEl = contentEl.createDiv();
    renderPropertyEditor(propsEl, this.properties, () => {
    });
    new import_obsidian8.Setting(contentEl).addButton(
      (b) => b.setButtonText("Create").setCta().onClick(() => this.submit())
    ).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }
  submit() {
    const tag = normalizeTag(this.sourceTag);
    if (!tag) {
      new import_obsidian8.Notice("R Board: a base tag is required.");
      return;
    }
    this.onComplete({
      name: this.name.trim() || void 0,
      sourceTag: tag,
      properties: this.properties.filter((p) => p.name.trim() !== ""),
      views: []
    });
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/FilterModal.ts
var import_obsidian9 = require("obsidian");
var OP_LABELS = {
  eq: "Is",
  ne: "Is not",
  contains: "Contains",
  gt: "Greater than",
  gte: "Greater or equal",
  lt: "Less than",
  lte: "Less or equal",
  empty: "Is empty",
  notempty: "Is not empty"
};
var VALUELESS = ["empty", "notempty"];
function clone(v) {
  return JSON.parse(JSON.stringify(v));
}
var FilterModal = class extends import_obsidian9.Modal {
  constructor(app, group, properties, onSave) {
    super(app);
    this.root = group ? clone(group) : { conjunction: "and", conditions: [] };
    this.properties = properties;
    this.onSave = onSave;
  }
  onOpen() {
    this.titleEl.setText("Filters");
    this.contentEl.addClass("rb-wizard", "rb-filter-builder");
    this.render();
  }
  onClose() {
    this.contentEl.empty();
  }
  /** Push the current tree to the caller (undefined when empty). */
  commit() {
    this.onSave(this.root.conditions.length ? clone(this.root) : void 0);
  }
  newRule() {
    return { property: this.properties[0]?.name ?? "", op: "contains", value: "" };
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    if (this.root.conditions.length === 0) {
      contentEl.createDiv({ cls: "rb-filter-empty", text: "No filters yet." });
    }
    this.renderGroup(contentEl.createDiv({ cls: "rb-filter-root" }), this.root);
    const footer = contentEl.createDiv({ cls: "rb-filter-footer" });
    const del = footer.createEl("button", { cls: "rb-filter-delete" });
    (0, import_obsidian9.setIcon)(del.createSpan({ cls: "rb-filter-delete-icon" }), "trash");
    del.createSpan({ text: "Delete filter" });
    del.onclick = () => {
      this.root = { conjunction: "and", conditions: [] };
      this.commit();
      this.close();
    };
  }
  /** Render a group's conditions plus its "Add filter rule" control. */
  renderGroup(container, group) {
    group.conditions.forEach((cond, i) => {
      const line = container.createDiv({ cls: "rb-filter-line" });
      const prefix = line.createDiv({ cls: "rb-filter-prefix" });
      if (i === 0) {
        prefix.createSpan({ cls: "rb-filter-where", text: "Where" });
      } else if (i === 1) {
        const sel = prefix.createEl("select", { cls: "rb-filter-select rb-filter-conj" });
        for (const c of ["and", "or"]) {
          const o = sel.createEl("option", { text: c === "and" ? "And" : "Or" });
          o.value = c;
        }
        sel.value = group.conjunction;
        sel.onchange = () => {
          group.conjunction = sel.value;
          this.commit();
          this.render();
        };
      } else {
        prefix.createSpan({
          cls: "rb-filter-conj-static",
          text: group.conjunction === "or" ? "Or" : "And"
        });
      }
      const remove = () => {
        group.conditions.splice(i, 1);
        this.commit();
        this.render();
      };
      if (isFilterGroup(cond)) {
        const box = line.createDiv({ cls: "rb-filter-group-box" });
        this.renderGroup(box, cond);
        this.rowMenu(line, remove);
      } else {
        this.renderRule(line, cond);
        this.rowMenu(line, remove);
      }
    });
    const add = container.createEl("button", { cls: "rb-filter-add" });
    (0, import_obsidian9.setIcon)(add.createSpan({ cls: "rb-filter-add-icon" }), "plus");
    add.createSpan({ text: "Add filter rule" });
    (0, import_obsidian9.setIcon)(add.createSpan({ cls: "rb-filter-add-caret" }), "chevron-down");
    add.onclick = (e) => {
      const menu = new import_obsidian9.Menu();
      menu.addItem(
        (it) => it.setTitle("Add rule").setIcon("plus").onClick(() => {
          group.conditions.push(this.newRule());
          this.commit();
          this.render();
        })
      );
      menu.addItem(
        (it) => it.setTitle("Add filter group").setIcon("folder-plus").onClick(() => {
          group.conditions.push({ conjunction: "and", conditions: [this.newRule()] });
          this.commit();
          this.render();
        })
      );
      menu.showAtMouseEvent(e);
    };
  }
  /** A single rule row: property + operator + value. */
  renderRule(line, rule) {
    const body = line.createDiv({ cls: "rb-filter-rule" });
    const propSel = body.createEl("select", { cls: "rb-filter-select" });
    for (const p of this.properties) {
      const o = propSel.createEl("option", { text: p.label ?? p.name });
      o.value = p.name;
    }
    if (!this.properties.some((p) => p.name === rule.property) && rule.property) {
      const o = propSel.createEl("option", { text: rule.property });
      o.value = rule.property;
    }
    propSel.value = rule.property || this.properties[0]?.name || "";
    rule.property = propSel.value;
    propSel.onchange = () => {
      rule.property = propSel.value;
      this.commit();
    };
    const opSel = body.createEl("select", { cls: "rb-filter-select" });
    Object.keys(OP_LABELS).forEach((op) => {
      const o = opSel.createEl("option", { text: OP_LABELS[op] });
      o.value = op;
    });
    opSel.value = rule.op;
    opSel.onchange = () => {
      rule.op = opSel.value;
      this.commit();
      this.render();
    };
    if (!VALUELESS.includes(rule.op)) {
      const value = body.createEl("input", {
        cls: "rb-filter-value",
        attr: { type: "text", placeholder: "Value" }
      });
      value.value = rule.value != null ? String(rule.value) : "";
      value.oninput = () => {
        rule.value = value.value;
        this.commit();
      };
    }
  }
  /** The "⋯" row menu (delete). */
  rowMenu(line, onDelete) {
    const btn = line.createEl("button", { cls: "rb-filter-row-menu", attr: { "aria-label": "More" } });
    (0, import_obsidian9.setIcon)(btn, "more-horizontal");
    btn.onclick = (e) => {
      const menu = new import_obsidian9.Menu();
      menu.addItem((it) => it.setTitle("Delete").setIcon("trash").onClick(onDelete));
      menu.showAtMouseEvent(e);
    };
  }
};

// src/ui/SettingsForms.ts
var import_obsidian10 = require("obsidian");
function renderViewSettings(app, container, config, view, hooks, onDelete) {
  container.empty();
  new import_obsidian10.Setting(container).setName("Name").addText(
    (t) => t.setValue(view.name).onChange((v) => {
      view.name = v;
      hooks.onChange();
    })
  );
  new import_obsidian10.Setting(container).setName("Type").addDropdown((d) => {
    d.addOptions({ gallery: "Gallery", kanban: "Kanban", table: "Table" });
    d.setValue(view.type);
    d.onChange((v) => {
      view.type = v;
      hooks.onStructureChange();
    });
  });
  new import_obsidian10.Setting(container).setName("Load limit").addDropdown((d) => {
    d.addOptions({ "10": "10", "50": "50", "100": "100", none: "No limit" });
    d.setValue(String(view.limit ?? 50));
    d.onChange((v) => {
      view.limit = v === "none" ? "none" : Number(v);
      hooks.onChange();
    });
  });
  const sort = view.sort ?? { property: TITLE_SORT_KEY, dir: "asc" };
  new import_obsidian10.Setting(container).setName("Sort by").addDropdown((d) => {
    d.addOption(TITLE_SORT_KEY, "Title");
    for (const p of config.properties) d.addOption(p.name, propertyLabel(p));
    d.setValue(sort.property);
    d.onChange((v) => {
      view.sort = { property: v, dir: (view.sort ?? sort).dir };
      hooks.onChange();
    });
  }).addDropdown((d) => {
    d.addOptions({ asc: "Ascending", desc: "Descending" });
    d.setValue(sort.dir);
    d.onChange((v) => {
      view.sort = { property: (view.sort ?? sort).property, dir: v };
      hooks.onChange();
    });
  });
  const groupProps = view.type === "kanban" ? config.properties.filter((p) => p.type === "text") : config.properties;
  new import_obsidian10.Setting(container).setName("Group by").setDesc(view.type === "kanban" ? "Required: a text property defines the columns." : "Optional: section headers.").addDropdown((d) => {
    d.addOption("", view.type === "kanban" ? "(choose a text property)" : "None");
    for (const p of groupProps) d.addOption(p.name, propertyLabel(p));
    d.setValue(view.group ?? "");
    d.onChange((v) => {
      view.group = v || void 0;
      hooks.onChange();
    });
  });
  if (view.type === "kanban") {
    renderColumnConfig(container, view, hooks);
  }
  if (view.type === "gallery" || view.type === "kanban") {
    new import_obsidian10.Setting(container).setName("Card size").addDropdown((d) => {
      d.addOptions({ small: "Small", medium: "Medium", large: "Large" });
      d.setValue(view.cardSize ?? "medium");
      d.onChange((v) => {
        view.cardSize = v;
        hooks.onChange();
      });
    });
    new import_obsidian10.Setting(container).setName("Show note content").setDesc("Render an excerpt of each note on the card.").addToggle(
      (t) => t.setValue(!!view.showContent).onChange((on) => {
        view.showContent = on;
        hooks.onChange();
      })
    );
  }
  if (view.type === "gallery") {
    new import_obsidian10.Setting(container).setName("Gallery layout").addDropdown((d) => {
      d.addOptions({ masonry: "Masonry", grid: "Grid" });
      d.setValue(view.layout ?? "masonry");
      d.onChange((v) => {
        view.layout = v;
        hooks.onChange();
      });
    });
  }
  new import_obsidian10.Setting(container).setName("Filters").setDesc(`${countFilterRules(view.filter)} active`).addButton(
    (b) => b.setButtonText("Edit filters\u2026").onClick(() => {
      new FilterModal(app, view.filter, config.properties, (group) => {
        view.filter = group;
        hooks.onStructureChange();
      }).open();
    })
  );
  container.createEl("h4", { text: "Visible properties" });
  const visible = new Set(view.properties ?? config.properties.map((p) => p.name));
  for (const p of config.properties) {
    new import_obsidian10.Setting(container).setName(propertyLabel(p)).setDesc(p.type).addToggle(
      (t) => t.setValue(visible.has(p.name)).onChange((on) => {
        if (on) visible.add(p.name);
        else visible.delete(p.name);
        view.properties = config.properties.map((q) => q.name).filter((n) => visible.has(n));
        hooks.onChange();
      })
    );
  }
  new import_obsidian10.Setting(container).addButton(
    (b) => b.setButtonText("Delete view").setWarning().onClick(onDelete)
  );
}
function renderColumnConfig(container, view, hooks) {
  container.createEl("h4", { text: "Column settings" });
  const cols = view.columns ?? [];
  const cfg = () => view.groupConfig ??= {};
  const debouncedChange = (0, import_obsidian10.debounce)(() => hooks.onChange(), 250, true);
  const rerender = () => renderColumnConfig(container.parentElement.createDiv(), view, hooks);
  const list = container.createDiv({ cls: "rb-col-config-list" });
  cols.forEach((key, idx) => {
    const row = list.createDiv({ cls: "rb-col-config-row" });
    const orderWrap = row.createDiv({ cls: "rb-col-order-wrap" });
    const orderInput = orderWrap.createEl("input", {
      cls: "rb-col-order-input",
      attr: { type: "number", min: "1", max: String(cols.length), value: String(idx + 1) }
    });
    orderInput.onchange = () => {
      const target = Math.max(1, Math.min(cols.length, parseInt(orderInput.value) || 1)) - 1;
      if (target === idx) return;
      const next = [...cols];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      view.columns = next;
      hooks.onStructureChange();
    };
    const fields = row.createDiv({ cls: "rb-col-config-fields" });
    fields.createSpan({ cls: "rb-col-key-label", text: key });
    const labelInput = fields.createEl("input", {
      cls: "rb-col-field-input",
      attr: { type: "text", placeholder: "Custom label\u2026" }
    });
    labelInput.value = cfg()[key]?.label ?? "";
    labelInput.oninput = () => {
      cfg()[key] = { ...cfg()[key], label: labelInput.value.trim() || void 0 };
      hooks.onChange();
    };
    const colorWrap = fields.createDiv({ cls: "rb-col-color-wrap" });
    colorWrap.createSpan({ cls: "rb-col-color-label", text: "Color" });
    const colorInput = colorWrap.createEl("input", {
      cls: "rb-col-color-input",
      attr: { type: "color", value: cfg()[key]?.color ?? "#888888" }
    });
    const clearColor = colorWrap.createEl("button", { cls: "rb-col-clear-color", text: "\u2715" });
    if (!cfg()[key]?.color) clearColor.style.visibility = "hidden";
    colorInput.oninput = () => {
      cfg()[key] = { ...cfg()[key], color: colorInput.value };
      clearColor.style.visibility = "visible";
      debouncedChange();
    };
    clearColor.onclick = () => {
      cfg()[key] = { ...cfg()[key], color: void 0 };
      clearColor.style.visibility = "hidden";
      hooks.onChange();
    };
    const hiddenWrap = fields.createDiv({ cls: "rb-col-hidden-wrap" });
    hiddenWrap.createSpan({ cls: "rb-col-hidden-label", text: "Hide" });
    const hiddenCheck = hiddenWrap.createEl("input", { attr: { type: "checkbox" } });
    hiddenCheck.checked = cfg()[key]?.hidden ?? false;
    hiddenCheck.onchange = () => {
      cfg()[key] = { ...cfg()[key], hidden: hiddenCheck.checked || void 0 };
      hooks.onChange();
    };
    const removeBtn = row.createEl("button", { cls: "rb-col-remove-btn", text: "\xD7" });
    removeBtn.onclick = () => {
      view.columns = cols.filter((_, i) => i !== idx);
      hooks.onStructureChange();
    };
  });
  const addRow = container.createDiv({ cls: "rb-col-add-row" });
  const addInput = addRow.createEl("input", {
    cls: "rb-col-add-input",
    attr: { type: "text", placeholder: "Column value\u2026" }
  });
  const addBtn = addRow.createEl("button", { cls: "rb-col-add-btn", text: "+ Add" });
  const doAdd = () => {
    const val = addInput.value.trim();
    if (val && !cols.includes(val)) {
      view.columns = [...cols, val];
      hooks.onStructureChange();
    }
    addInput.value = "";
  };
  addBtn.onclick = doAdd;
  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doAdd();
  });
}
function renderDatabaseSettings(container, config, hooks) {
  container.empty();
  new import_obsidian10.Setting(container).setName("Name").addText(
    (t) => t.setValue(config.name ?? "").onChange((v) => {
      config.name = v.trim() || void 0;
      hooks.onChange();
    })
  );
  new import_obsidian10.Setting(container).setName("Base tag").setDesc("Without the leading #.").addText(
    (t) => t.setValue(config.sourceTag).onChange((v) => {
      config.sourceTag = v.replace(/^#/, "").trim().toLowerCase();
      hooks.onChange();
    })
  );
  new import_obsidian10.Setting(container).setName("New note location").setDesc('Folder where the "New note" button creates notes. Required for that button.').addText(
    (t) => t.setPlaceholder("e.g. Games/Backlog").setValue(config.newNoteFolder ?? "").onChange((v) => {
      config.newNoteFolder = v.trim() || void 0;
      hooks.onChange();
    })
  );
  container.createEl("h4", { text: "Properties" });
  renderPropertyEditor(container.createDiv(), config.properties, hooks.onChange);
  if (hooks.onRefresh) {
    const refresh = hooks.onRefresh;
    new import_obsidian10.Setting(container).setName("Refresh index").setDesc("Re-query notes from the vault.").addButton(
      (b) => b.setButtonText("Refresh").onClick(() => refresh())
    );
  }
}

// src/BoardView.ts
var BOARD_VIEW_TYPE = "r-board-view";
var BOARD_EXTENSION = "board";
var TYPE_ICON = {
  gallery: "layout-grid",
  kanban: "columns-3",
  table: "table"
};
var BoardView = class extends import_obsidian11.TextFileView {
  constructor(leaf, plugin) {
    super(leaf);
    /** While an edit modal is open, suppress re-renders until it closes. */
    this.renderSuspended = false;
    this.config = null;
    this.parseError = null;
    this.activeView = "";
    this.searchQuery = "";
    this.sidebar = null;
    this.ui = { collapsed: /* @__PURE__ */ new Set(), pages: {}, listScroll: {} };
    this.bodyEl = null;
    this.toolbarEl = null;
    this.sidebarEl = null;
    this.plugin = plugin;
  }
  getViewType() {
    return BOARD_VIEW_TYPE;
  }
  getIcon() {
    return "layout-dashboard";
  }
  getDisplayText() {
    return this.config?.name ?? this.file?.basename ?? "Board";
  }
  // --- TextFileView contract -------------------------------------------------
  getViewData() {
    return this.data;
  }
  setViewData(data, _clear) {
    this.data = data;
    const result = parseDatabaseConfig(data);
    if (result.ok) {
      this.config = result.config;
      this.parseError = null;
      const saved = this.file ? this.plugin.getActiveView(this.file.path) : void 0;
      const exists = saved && this.config.views.some((v) => v.name === saved);
      this.activeView = exists ? saved : this.config.defaultView ?? this.config.views[0]?.name ?? "";
    } else {
      this.config = null;
      this.parseError = result.error;
    }
    this.render();
  }
  clear() {
    this.config = null;
    this.parseError = null;
    this.contentEl.empty();
  }
  // --- Lifecycle -------------------------------------------------------------
  async onOpen() {
    this.contentEl.addClass("rb-root");
    const refresh = (0, import_obsidian11.debounce)(() => this.renderBody(), 250, true);
    this.registerEvent(this.app.metadataCache.on("resolved", refresh));
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
  }
  // --- Config persistence ----------------------------------------------------
  /**
   * Persist the current in-memory config to the `.board` file without forcing a
   * full reload (so the sidebar keeps focus). Refreshes body + toolbar.
   */
  saveConfig() {
    if (!this.config) return;
    this.data = serializeDatabase(this.config);
    this.requestSave();
    this.renderToolbar();
    this.renderBody();
  }
  currentView() {
    if (!this.config) return null;
    return this.config.views.find((v) => v.name === this.activeView) ?? this.config.views[0] ?? null;
  }
  setActiveView(name) {
    if (this.activeView === name) return;
    this.activeView = name;
    this.ui.collapsed.clear();
    this.ui.pages = {};
    this.ui.listScroll = {};
    this.ui.kanbanScroll = 0;
    if (this.file) void this.plugin.setActiveView(this.file.path, name);
    this.render();
  }
  // --- Rendering -------------------------------------------------------------
  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("rb-root");
    if (!this.config) {
      this.renderSetup(root);
      return;
    }
    this.toolbarEl = root.createDiv({ cls: "rb-toolbar" });
    this.renderToolbar();
    const main = root.createDiv({ cls: "rb-main" });
    this.bodyEl = main.createDiv({ cls: "rb-body" });
    this.sidebarEl = main.createDiv({ cls: "rb-sidebar" });
    if (this.config.views.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: "rb-empty rb-empty-views" });
      empty.createDiv({ text: "This board has no views yet." });
      const btn = empty.createEl("button", { cls: "rb-home-create", text: "Create view" });
      btn.onclick = (e) => this.openCreateViewMenu(e);
    } else {
      this.renderBody();
    }
    this.renderSidebar();
  }
  /** Setup prompt shown when the `.board` file is empty or unparseable. */
  renderSetup(root) {
    const box = root.createDiv({ cls: "rb-setup" });
    (0, import_obsidian11.setIcon)(box.createDiv({ cls: "rb-setup-icon" }), "layout-dashboard");
    box.createEl("h3", { text: "Set up this board" });
    if (this.parseError && this.data.trim() !== "" && this.data.trim() !== "{}") {
      box.createEl("p", { cls: "rb-setup-error", text: this.parseError });
    }
    const btn = box.createEl("button", { cls: "rb-home-create", text: "Configure board" });
    btn.onclick = () => {
      new WizardModal(this.app, {}, "Set up board", (config) => {
        this.config = config;
        this.activeView = config.views[0]?.name ?? "";
        this.saveConfig();
        this.render();
      }).open();
    };
  }
  // --- Toolbar ---------------------------------------------------------------
  renderToolbar() {
    const bar = this.toolbarEl;
    if (!bar || !this.config) return;
    bar.empty();
    const tabsRow = bar.createDiv({ cls: "rb-tabs-row" });
    const tabs = tabsRow.createDiv({ cls: "rb-view-switch" });
    for (const view2 of this.config.views) {
      const btn = tabs.createEl("button", {
        cls: view2.name === this.activeView ? "rb-view-btn rb-active" : "rb-view-btn",
        attr: { title: `${view2.name} (${view2.type})` }
      });
      (0, import_obsidian11.setIcon)(btn.createSpan({ cls: "rb-view-btn-icon" }), TYPE_ICON[view2.type]);
      btn.createSpan({ text: view2.name });
      btn.onclick = () => this.setActiveView(view2.name);
      btn.oncontextmenu = (e) => this.openTabMenu(e, view2);
    }
    tabsRow.createDiv({ cls: "rb-spacer" });
    const tools = tabsRow.createDiv({ cls: "rb-tools" });
    const view = this.currentView();
    this.toolButton(tools, "plus", "Create view", (e) => this.openCreateViewMenu(e));
    if (view) {
      this.toolButton(tools, "sliders-horizontal", "View settings", () => this.toggleSidebar("view"), this.sidebar === "view");
    }
    this.toolButton(tools, "settings", "Board settings", () => this.toggleSidebar("board"), this.sidebar === "board");
    const ctrlRow = bar.createDiv({ cls: "rb-controls-row" });
    const search = ctrlRow.createEl("input", {
      cls: "rb-search",
      attr: { type: "search", placeholder: "Search\u2026" }
    });
    search.value = this.searchQuery;
    search.oninput = () => {
      this.searchQuery = search.value;
      this.renderBody();
    };
    if (view) {
      this.renderSortChip(ctrlRow, view);
      this.renderFilterChip(ctrlRow, view);
    }
    ctrlRow.createDiv({ cls: "rb-spacer" });
    const newNote = ctrlRow.createEl("button", { cls: "rb-new-note", attr: { title: "Create a new note in this database" } });
    (0, import_obsidian11.setIcon)(newNote.createSpan({ cls: "rb-new-note-icon" }), "file-plus");
    newNote.createSpan({ text: "New note" });
    newNote.onclick = () => void this.createNewNote();
  }
  renderSortChip(parent, view) {
    const sort = effectiveSort(view);
    const active = !!view.sort;
    const label = active ? `${this.propLabel(sort.property)} ${sort.dir === "asc" ? "\u2191" : "\u2193"}` : "Sort";
    const chip = this.chip(parent, "arrow-up-down", label, active);
    chip.onclick = (e) => this.openSortMenu(e, view);
  }
  renderFilterChip(parent, view) {
    const count = countFilterRules(view.filter);
    const chip = this.chip(parent, "filter", count ? `Filter \xB7 ${count}` : "Filter", count > 0);
    chip.onclick = () => this.openFilter(view);
  }
  chip(parent, icon, label, active) {
    const chip = parent.createEl("button", { cls: active ? "rb-chip rb-chip-active" : "rb-chip" });
    (0, import_obsidian11.setIcon)(chip.createSpan({ cls: "rb-chip-icon" }), icon);
    chip.createSpan({ text: label });
    return chip;
  }
  toolButton(parent, icon, label, onClick, active = false) {
    const btn = parent.createEl("button", {
      cls: active ? "rb-tool-btn rb-active" : "rb-tool-btn",
      attr: { "aria-label": label, title: label }
    });
    (0, import_obsidian11.setIcon)(btn, icon);
    btn.onclick = onClick;
  }
  propLabel(key) {
    if (key === TITLE_SORT_KEY) return "Title";
    const p = this.config?.properties.find((q) => q.name === key);
    return p ? propertyLabel(p) : key;
  }
  // --- Toolbar actions -------------------------------------------------------
  openCreateViewMenu(e) {
    if (!this.config) return;
    const menu = new import_obsidian11.Menu();
    ["gallery", "kanban", "table"].forEach((type) => {
      menu.addItem(
        (item) => item.setTitle(`New ${type} view`).setIcon(TYPE_ICON[type]).onClick(() => {
          const view = makeDefaultView(type, this.config.views);
          this.config.views.push(view);
          this.activeView = view.name;
          if (this.file) void this.plugin.setActiveView(this.file.path, view.name);
          this.sidebar = "view";
          this.saveConfig();
          this.render();
        })
      );
    });
    menu.showAtMouseEvent(e);
  }
  /**
   * Create a new note (carrying the database's source tag) in the configured
   * "New note location" and open it. If that location isn't set, open Board
   * settings so the user can set it first.
   */
  async createNewNote() {
    if (!this.config) return;
    const folder = this.config.newNoteFolder?.trim();
    if (!folder) {
      new import_obsidian11.Notice('R Board: set a "New note location" in board settings to use this.');
      this.toggleSidebar("board", true);
      return;
    }
    try {
      const dir = (0, import_obsidian11.normalizePath)(folder);
      if (!(this.app.vault.getAbstractFileByPath(dir) instanceof import_obsidian11.TFolder)) {
        await this.app.vault.createFolder(dir).catch(() => void 0);
      }
      let path = (0, import_obsidian11.normalizePath)(`${dir}/Untitled.md`);
      let i = 1;
      while (this.app.vault.getAbstractFileByPath(path)) {
        path = (0, import_obsidian11.normalizePath)(`${dir}/Untitled ${i++}.md`);
      }
      const content = `---
tags:
  - ${this.config.sourceTag}
---
`;
      const file = await this.app.vault.create(path, content);
      await this.app.workspace.getLeaf("tab").openFile(file);
    } catch (e) {
      new import_obsidian11.Notice(`R Board: could not create note \u2014 ${e.message}`);
    }
  }
  openTabMenu(e, view) {
    e.preventDefault();
    const menu = new import_obsidian11.Menu();
    menu.addItem((i) => i.setTitle("View settings").setIcon("sliders-horizontal").onClick(() => {
      this.setActiveView(view.name);
      this.toggleSidebar("view", true);
    }));
    menu.addItem((i) => i.setTitle("Delete view").setIcon("trash").onClick(() => this.deleteView(view.name)));
    menu.showAtMouseEvent(e);
  }
  openSortMenu(e, view) {
    if (!this.config) return;
    const current = effectiveSort(view);
    const menu = new import_obsidian11.Menu();
    const addItem = (key, label) => {
      menu.addItem((item) => {
        item.setTitle(label);
        if (current.property === key) item.setIcon(current.dir === "asc" ? "arrow-up" : "arrow-down");
        item.onClick(() => {
          const dir = current.property === key && current.dir === "asc" ? "desc" : "asc";
          view.sort = { property: key, dir };
          this.saveConfig();
        });
      });
    };
    addItem(TITLE_SORT_KEY, "Title");
    for (const p of this.config.properties) addItem(p.name, propertyLabel(p));
    menu.showAtMouseEvent(e);
  }
  openFilter(view) {
    if (!this.config) return;
    new FilterModal(this.app, view.filter, this.config.properties, (group) => {
      view.filter = group;
      this.saveConfig();
    }).open();
  }
  deleteView(name) {
    if (!this.config) return;
    this.config.views = this.config.views.filter((v) => v.name !== name);
    if (this.activeView === name) this.activeView = this.config.views[0]?.name ?? "";
    this.config.defaultView = this.config.views[0]?.name;
    if (this.sidebar === "view" && this.config.views.length === 0) this.sidebar = null;
    this.saveConfig();
    this.render();
  }
  // --- Sidebar ---------------------------------------------------------------
  toggleSidebar(mode, force = false) {
    this.sidebar = !force && this.sidebar === mode ? null : mode;
    this.contentEl.toggleClass("rb-has-sidebar", this.sidebar !== null);
    this.renderToolbar();
    this.renderSidebar();
  }
  renderSidebar() {
    const el = this.sidebarEl;
    if (!el || !this.config) return;
    el.empty();
    this.contentEl.toggleClass("rb-has-sidebar", this.sidebar !== null);
    if (!this.sidebar) return;
    const header = el.createDiv({ cls: "rb-sidebar-header" });
    header.createSpan({ cls: "rb-sidebar-title", text: this.sidebar === "board" ? "Board settings" : "View settings" });
    const close = header.createEl("button", { cls: "rb-sidebar-close", attr: { "aria-label": "Close" } });
    (0, import_obsidian11.setIcon)(close, "x");
    close.onclick = () => this.toggleSidebar(this.sidebar);
    const content = el.createDiv({ cls: "rb-sidebar-content rb-wizard" });
    if (this.sidebar === "board") {
      renderDatabaseSettings(content, this.config, {
        onChange: () => this.saveConfig(),
        onStructureChange: () => {
          this.saveConfig();
          this.renderSidebar();
        },
        onRefresh: () => this.renderBody()
      });
    } else {
      const view = this.currentView();
      if (!view) {
        content.createDiv({ cls: "rb-empty", text: "No view selected." });
        return;
      }
      const syncName = () => {
        if (this.activeView !== view.name) {
          this.activeView = view.name;
          if (this.file) void this.plugin.setActiveView(this.file.path, view.name);
        }
      };
      renderViewSettings(
        this.app,
        content,
        this.config,
        view,
        {
          onChange: () => {
            syncName();
            this.saveConfig();
          },
          onStructureChange: () => {
            syncName();
            this.saveConfig();
            this.renderSidebar();
          }
        },
        () => this.deleteView(view.name)
      );
    }
  }
  // --- Body ------------------------------------------------------------------
  /**
   * Open the in-place edit modal for an item. Re-renders are suspended while
   * the modal is open, so the view repaints exactly once, on close.
   */
  openEditModal(file, title) {
    if (!this.config) return;
    this.renderSuspended = true;
    new NoteEditModal(this.app, file, title ?? file.basename, () => {
      this.renderSuspended = false;
      this.renderBody();
    }).open();
  }
  renderBody() {
    if (this.renderSuspended) return;
    const body = this.bodyEl;
    const view = this.currentView();
    if (!body || !this.config || !view) return;
    body.empty();
    const properties = visibleProperties(this.config, view);
    const sort = effectiveSort(view);
    let items = queryItems(this.app, this.config);
    items = applyFilter(items, view.filter, this.config.properties);
    items = filterBySearch(items, properties, this.searchQuery);
    items = applySort(items, sort, this.config.properties);
    const ctx = {
      app: this.app,
      config: this.config,
      view,
      properties,
      boardFile: this.file,
      component: this,
      editFile: (file, title) => this.openEditModal(file, title),
      sort,
      setSort: (s) => {
        view.sort = s;
        this.saveConfig();
      },
      commit: () => this.saveConfig(),
      refresh: () => this.renderBody(),
      ui: this.ui
    };
    switch (view.type) {
      case "kanban":
        renderKanban(body, items, ctx);
        break;
      case "table":
        renderTable(body, items, ctx);
        break;
      case "gallery":
      default:
        renderGallery(body, items, ctx);
        break;
    }
  }
};

// src/home/HomeView.ts
var import_obsidian12 = require("obsidian");
var HOME_VIEW_TYPE = "r-board-home";
var BoardHomeView = class extends import_obsidian12.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return HOME_VIEW_TYPE;
  }
  getDisplayText() {
    return "R Board";
  }
  getIcon() {
    return "layout-dashboard";
  }
  async onOpen() {
    await this.render();
    const refresh = () => void this.render();
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
  }
  async render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("rb-home");
    const header = root.createDiv({ cls: "rb-home-header" });
    header.createEl("h2", { text: "Boards" });
    const create = header.createEl("button", { cls: "rb-home-create" });
    (0, import_obsidian12.setIcon)(create.createSpan({ cls: "rb-home-create-icon" }), "plus");
    create.createSpan({ text: "Create board" });
    create.onclick = () => this.openCreateWizard();
    const files = this.plugin.listBoardFiles();
    if (files.length === 0) {
      root.createDiv({
        cls: "rb-home-empty",
        text: "No boards yet. Click \u201CCreate board\u201D to make your first one."
      });
      return;
    }
    const grid = root.createDiv({ cls: "rb-home-grid" });
    for (const file of files) {
      let raw = "";
      try {
        raw = await this.app.vault.cachedRead(file);
      } catch {
      }
      this.renderCard(grid, file, raw);
    }
  }
  renderCard(grid, file, raw) {
    const card = grid.createDiv({ cls: "rb-home-card" });
    const result = parseDatabaseConfig(raw);
    (0, import_obsidian12.setIcon)(card.createDiv({ cls: "rb-home-card-icon" }), "layout-dashboard");
    const body = card.createDiv({ cls: "rb-home-card-body" });
    body.createDiv({
      cls: "rb-home-card-title",
      text: result.ok ? result.config.name ?? file.basename : file.basename
    });
    if (result.ok) {
      const n = result.config.views.length;
      body.createDiv({
        cls: "rb-home-card-meta",
        text: `#${result.config.sourceTag} \xB7 ${n} view${n === 1 ? "" : "s"}`
      });
    } else {
      body.createDiv({ cls: "rb-home-card-meta rb-home-card-error", text: "Not configured yet" });
    }
    card.onclick = () => void this.plugin.openBoard(file);
  }
  openCreateWizard() {
    new WizardModal(this.app, {}, "Create database", (config) => {
      void this.plugin.createDatabaseFromConfig(config);
    }).open();
  }
};

// src/recipe/token.ts
var NAMED_MODES = {
  const: { kind: "const" },
  linear: { kind: "linear" },
  sqrt: { kind: "pow", k: 0.5 },
  step: { kind: "step" }
};
function parseToken(src, defaultMode) {
  const trimmed = src.trim();
  const hasOpen = trimmed.startsWith("{");
  const hasClose = trimmed.endsWith("}");
  if (hasOpen !== hasClose) return { error: "Unbalanced braces" };
  const inner = hasOpen ? trimmed.slice(1, -1) : trimmed;
  const lint = [];
  const entries = [];
  for (const raw of splitTop(inner)) {
    const part = raw.trim();
    if (part === "") return { error: "Empty entry" };
    const entry = parseEntry(part, defaultMode, lint);
    if ("error" in entry) return entry;
    entries.push(entry);
  }
  if (entries.length === 0) return { error: "Empty token" };
  return { entries, raw: trimmed, lint };
}
function splitTop(s) {
  return s.split(",");
}
function parseEntry(src, defaultMode, lint) {
  const [valuePart, ...tagParts] = src.split(":");
  const value = parseValue(valuePart.trim());
  if ("error" in value) return value;
  let mode = null;
  let point = null;
  let round = { kind: "none" };
  let min = null;
  let max = null;
  for (const rawTag of tagParts) {
    const tag = rawTag.trim();
    if (tag === "") continue;
    const m = parseMode(tag);
    if (m) {
      if (mode) lint.push(`multiple modes in "${src.trim()}" \u2014 using last`);
      mode = m;
      continue;
    }
    const p = parsePoint(tag);
    if (p) {
      if (point) lint.push(`multiple conditions in "${src.trim()}" \u2014 using last`);
      point = p;
      continue;
    }
    const r = parseRound(tag);
    if (r) {
      if (round.kind !== "none") lint.push(`multiple rounding in "${src.trim()}" \u2014 using last`);
      round = r;
      continue;
    }
    const b = parseBound(tag);
    if (b) {
      if (b.which === "min") min = b.n;
      else max = b.n;
      continue;
    }
    lint.push(`unknown tag "${tag}" \u2014 ignored`);
  }
  if (min !== null && max !== null && min > max) {
    lint.push(`min ${min} exceeds max ${max} \u2014 both ignored`);
    min = null;
    max = null;
  }
  return {
    value: value.n,
    unit: value.unit,
    mode: mode ?? defaultMode,
    point,
    round,
    min,
    max
  };
}
function parseValue(src) {
  const m = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(src);
  if (!m) return { error: `No numeric value in "${src}"` };
  return { n: Number(m[1]), unit: m[2].trim() };
}
function parseMode(tag) {
  if (tag in NAMED_MODES) return NAMED_MODES[tag];
  const m = /^pow=(-?\d+(?:\.\d+)?)$/.exec(tag);
  return m ? { kind: "pow", k: Number(m[1]) } : null;
}
function parsePoint(tag) {
  const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)p$/.exec(tag);
  if (range) return { rel: "range", lo: Number(range[1]), hi: Number(range[2]) };
  const rel = /^(>=|<=|>|<)?(\d+(?:\.\d+)?)p$/.exec(tag);
  if (!rel) return null;
  const n = Number(rel[2]);
  switch (rel[1]) {
    case ">":
      return { rel: "gt", n };
    case "<":
      return { rel: "lt", n };
    case ">=":
      return { rel: "gte", n };
    case "<=":
      return { rel: "lte", n };
    default:
      return { rel: "eq", n };
  }
}
function parseRound(tag) {
  if (tag === "int") return { kind: "int" };
  if (tag === "round") return { kind: "nearest", step: 1 };
  if (tag === "ceil") return { kind: "ceil" };
  if (tag === "floor") return { kind: "floor" };
  const m = /^round=(\d+(?:\.\d+)?)$/.exec(tag);
  return m ? { kind: "nearest", step: Number(m[1]) } : null;
}
function parseBound(tag) {
  const m = /^(min|max)=\s*(-?\d+(?:\.\d+)?)/.exec(tag);
  return m ? { which: m[1], n: Number(m[2]) } : null;
}
function resolve(token, portions, anchor) {
  const base = token.entries[0];
  const baseValue = base.value;
  const fail = (msg, extra = []) => ({
    value: baseValue,
    unit: base.unit,
    error: { message: [...token.lint, msg, ...extra].filter(Boolean).join("; "), base: baseValue }
  });
  const preLint = token.lint.length > 0;
  const ok = (value, unit) => preLint ? fail("") : { value, unit };
  if (token.entries.length === 1) {
    if (base.point === null || base.point.rel === "eq") {
      const a = base.point ? base.point.n : anchor;
      return ok(applyPost(base, scaleByMode(base, portions, a)), base.unit);
    }
    if (pointMatches(base.point, portions)) return ok(applyPost(base, base.value), base.unit);
    return fail(`no rule matches ${portions}p`);
  }
  const matches2 = token.entries.filter((e) => pointMatches(e.point, portions));
  const conflicts = [];
  if (matches2.length >= 1) {
    const rank = (e) => specificity(e.point);
    const best = Math.min(...matches2.map(rank));
    const top = matches2.filter((e) => rank(e) === best);
    if (top.length > 1) conflicts.push(`overlapping condition at ${portions}p`);
    const chosen = top[top.length - 1];
    if (preLint || conflicts.length > 0) return fail("", conflicts);
    return { value: matchedValue(chosen, portions, anchor), unit: chosen.unit };
  }
  const gap = interpolate(token, portions, anchor);
  if (!gap) return fail(`no rule matches ${portions}p`);
  return ok(gap.value, gap.unit);
}
function matchedValue(entry, p, blockAnchor) {
  const raw = entry.point === null ? scaleByMode(entry, p, blockAnchor) : entry.value;
  return applyPost(entry, raw);
}
function pointMatches(point, p) {
  if (!point) return true;
  switch (point.rel) {
    case "eq":
      return p === point.n;
    case "gt":
      return p > point.n;
    case "lt":
      return p < point.n;
    case "gte":
      return p >= point.n;
    case "lte":
      return p <= point.n;
    case "range":
      return p >= point.lo && p <= point.hi;
  }
}
function specificity(point) {
  if (!point) return 4;
  if (point.rel === "eq") return 1;
  if (point.rel === "range") return 2;
  return 3;
}
function scaleByMode(entry, p, a) {
  const ratio = a === 0 ? 1 : p / a;
  switch (entry.mode.kind) {
    case "const":
    case "step":
      return entry.value;
    case "linear":
      return entry.value * ratio;
    case "pow":
      return entry.value * Math.pow(ratio, entry.mode.k);
  }
}
function anchorOf(point) {
  return point.rel === "range" ? point.lo : point.n;
}
function applyPost(entry, v) {
  let out = v;
  switch (entry.round.kind) {
    case "int":
      out = Math.round(out);
      break;
    case "nearest":
      out = Math.round(out / entry.round.step) * entry.round.step;
      break;
    case "ceil":
      out = Math.ceil(out);
      break;
    case "floor":
      out = Math.floor(out);
      break;
    case "none":
      break;
  }
  if (entry.min !== null) out = Math.max(out, entry.min);
  if (entry.max !== null) out = Math.min(out, entry.max);
  return out;
}
function reference(entry) {
  if (!entry.point) return null;
  const p = anchorOf(entry.point);
  return { p, value: applyPost(entry, entry.value) };
}
function interpolate(token, p, _anchor) {
  const isStep = token.entries.some((e) => e.mode.kind === "step");
  const refs = token.entries.map((e) => ({ e, r: reference(e) })).filter((x) => x.r !== null);
  let below = null;
  let above = null;
  for (const x of refs) {
    if (x.r.p <= p && (!below || x.r.p > below.r.p)) below = x;
    if (x.r.p >= p && (!above || x.r.p < above.r.p)) above = x;
  }
  if (below && above) {
    if (isStep || below.r.p === above.r.p) return { value: below.r.value, unit: below.e.unit };
    const t = (p - below.r.p) / (above.r.p - below.r.p);
    return { value: below.r.value + t * (above.r.value - below.r.value), unit: below.e.unit };
  }
  if (below) return { value: below.r.value, unit: below.e.unit };
  if (above) return { value: above.r.value, unit: above.e.unit };
  return null;
}

// src/recipe/parse.ts
var LINEAR = { kind: "linear" };
var CONST = { kind: "const" };
var TIME_UNITS = /* @__PURE__ */ new Set([
  "sec",
  "secs",
  "second",
  "seconds",
  "s",
  "min",
  "mins",
  "minute",
  "minutes",
  "m",
  "hr",
  "hrs",
  "hour",
  "hours",
  "h"
]);
function makeCell(raw, defaultMode) {
  const parsed = parseToken(raw, defaultMode);
  return "error" in parsed ? { raw, token: null, parseError: parsed.error } : { raw, token: parsed, parseError: null };
}
function stepDefaultMode(tokenSrc) {
  const m = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/.exec(tokenSrc);
  return m && TIME_UNITS.has(m[2].toLowerCase()) ? CONST : LINEAR;
}
function parseIngredient(line) {
  const s = line.trim();
  if (s.startsWith("{")) {
    const close = s.indexOf("}");
    if (close !== -1) {
      const raw = s.slice(0, close + 1);
      const name = s.slice(close + 1).trim();
      return { cell: makeCell(raw, LINEAR), name };
    }
  }
  const m = /^(-?\d+(?:\.\d+)?)(\s+.*)?$/.exec(s);
  if (m) {
    return { cell: makeCell(m[1], LINEAR), name: (m[2] ?? "").trim() };
  }
  return { cell: null, name: s };
}
function parseStep(line) {
  const parts = [];
  const re = /\{[^}]*\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push({ kind: "text", text: line.slice(last, m.index) });
    parts.push({ kind: "token", cell: makeCell(m[0], stepDefaultMode(m[0])) });
    last = re.lastIndex;
  }
  if (last < line.length) parts.push({ kind: "text", text: line.slice(last) });
  return { parts };
}
function parseRecipe(source) {
  const recipe = { portions: 1, ingredients: [], steps: [] };
  let section = null;
  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "") continue;
    const portions = /^\s*portions:\s*(\d+(?:\.\d+)?)/i.exec(line);
    if (portions) {
      recipe.portions = Number(portions[1]);
      section = null;
      continue;
    }
    if (/^\s*ingredients:\s*$/i.test(line)) {
      section = "ingredients";
      continue;
    }
    if (/^\s*steps:\s*$/i.test(line)) {
      section = "steps";
      continue;
    }
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && section === "ingredients") recipe.ingredients.push(parseIngredient(item[1]));
    else if (item && section === "steps") recipe.steps.push(parseStep(item[1]));
  }
  return recipe;
}

// src/recipe/render.ts
var MIN_PORTIONS = 1;
var MAX_PORTIONS = 99;
function formatNum(n) {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}
function resolveCell(cell, portions, anchor) {
  if (cell.parseError) {
    const bare = cell.raw.replace(/^\{|\}$/g, "");
    return { text: bare, error: cell.parseError };
  }
  const r = resolve(cell.token, portions, anchor);
  const text = r.unit ? `${formatNum(r.value)} ${r.unit}` : formatNum(r.value);
  return { text, error: r.error ? r.error.message : null };
}
function drawCell(parent, res, errors) {
  parent.appendText(res.text);
  if (res.error) {
    errors.push(res.error);
    parent.createSpan({ cls: "rb-token-error", text: " \u26A0", attr: { "aria-label": res.error, title: res.error } });
  }
}
function renderRecipe(el, recipe) {
  const root = el.createDiv({ cls: "rb-recipe" });
  let portions = recipe.portions;
  const header = root.createDiv({ cls: "rb-recipe-header" });
  header.createSpan({ cls: "rb-recipe-title", text: "Recipe" });
  const stepper = header.createDiv({ cls: "rb-recipe-portions" });
  const dec = stepper.createEl("button", { cls: "rb-recipe-step", text: "\u2212", attr: { "aria-label": "fewer portions" } });
  const count = stepper.createSpan({ cls: "rb-recipe-count" });
  const inc = stepper.createEl("button", { cls: "rb-recipe-step", text: "+", attr: { "aria-label": "more portions" } });
  stepper.createSpan({ cls: "rb-recipe-portions-label", text: "portions" });
  const bodyEl = root.createDiv({ cls: "rb-recipe-body" });
  const repaint = () => {
    count.setText(String(portions));
    dec.toggleAttribute("disabled", portions <= MIN_PORTIONS);
    inc.toggleAttribute("disabled", portions >= MAX_PORTIONS);
    bodyEl.empty();
    const errors = [];
    if (recipe.ingredients.length > 0) {
      bodyEl.createDiv({ cls: "rb-recipe-label", text: "Ingredients" });
      const table = bodyEl.createEl("table", { cls: "rb-recipe-ing" });
      for (const ing of recipe.ingredients) {
        const tr = table.createEl("tr");
        const amt = tr.createEl("td", { cls: "rb-recipe-amt" });
        if (ing.cell) drawCell(amt, resolveCell(ing.cell, portions, recipe.portions), errors);
        tr.createEl("td", { cls: "rb-recipe-name", text: ing.name });
      }
    }
    if (recipe.steps.length > 0) {
      bodyEl.createDiv({ cls: "rb-recipe-label", text: "Method" });
      const ol = bodyEl.createEl("ol", { cls: "rb-recipe-steps" });
      for (const step of recipe.steps) drawStep(ol.createEl("li"), step, portions, recipe.portions, errors);
    }
    if (errors.length > 0) {
      const strip = bodyEl.createDiv({ cls: "rb-recipe-errors" });
      strip.createSpan({ text: "\u26A0 " });
      strip.appendText(
        errors.length === 1 ? errors[0] : `${errors.length} scaling issues \u2014 hover the \u26A0 marks to see each.`
      );
    }
  };
  const clamp = (n) => Math.max(MIN_PORTIONS, Math.min(MAX_PORTIONS, n));
  dec.onclick = () => {
    portions = clamp(portions - 1);
    repaint();
  };
  inc.onclick = () => {
    portions = clamp(portions + 1);
    repaint();
  };
  repaint();
}
function drawStep(li, step, portions, anchor, errors) {
  for (const part of step.parts) {
    if (part.kind === "text") li.appendText(part.text);
    else {
      const span = li.createSpan({ cls: "rb-recipe-time" });
      drawCell(span, resolveCell(part.cell, portions, anchor), errors);
    }
  }
}

// main.ts
var RBoardPlugin = class extends import_obsidian13.Plugin {
  constructor() {
    super(...arguments);
    this.data = {};
  }
  async onload() {
    this.data = await this.loadData() ?? {};
    this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardView(leaf, this));
    this.registerView(HOME_VIEW_TYPE, (leaf) => new BoardHomeView(leaf, this));
    this.registerExtensions([BOARD_EXTENSION], BOARD_VIEW_TYPE);
    this.registerMarkdownCodeBlockProcessor("recipe", (source, el) => {
      renderRecipe(el, parseRecipe(source));
    });
    this.addRibbonIcon("circuit-board", "R Board", () => void this.openHome());
    this.addCommand({
      id: "open-home",
      name: "Open R Board",
      callback: () => void this.openHome()
    });
    this.addCommand({
      id: "create-database",
      name: "Create new database",
      callback: () => this.openCreateWizard()
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        const folder = file instanceof import_obsidian13.TFolder ? file : file instanceof import_obsidian13.TFile ? file.parent : null;
        if (!folder) return;
        menu.addItem(
          (item) => item.setTitle("New board").setIcon("circuit-board").setSection("action").onClick(() => this.openCreateWizard(folder.path))
        );
      })
    );
  }
  // --- Active-view persistence ----------------------------------------------
  getActiveView(path) {
    return this.data.activeViews?.[path];
  }
  async setActiveView(path, name) {
    if (!this.data.activeViews) this.data.activeViews = {};
    if (this.data.activeViews[path] === name) return;
    this.data.activeViews[path] = name;
    await this.saveData(this.data);
  }
  // --- Home + boards ---------------------------------------------------------
  /** Open (or reveal) the R Board home view in a tab. */
  async openHome() {
    const existing = this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      void existing[0].view.render();
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: HOME_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  /** Every `.board` file in the vault, sorted by path. */
  listBoardFiles() {
    return this.app.vault.getFiles().filter((f) => f.extension === BOARD_EXTENSION).sort((a, b) => a.path.localeCompare(b.path));
  }
  /** Open a `.board` file as a board view. */
  async openBoard(file) {
    await this.app.workspace.getLeaf(true).openFile(file);
  }
  openCreateWizard(folderPath) {
    new WizardModal(this.app, {}, "Create database", (config) => {
      void this.createDatabaseFromConfig(config, folderPath);
    }).open();
  }
  /** Write a new `.board` file from a config and open it. */
  async createDatabaseFromConfig(config, folderPath) {
    const folder = folderPath !== void 0 ? this.app.vault.getAbstractFileByPath(folderPath) : this.app.fileManager.getNewFileParent("");
    const dir = folder instanceof import_obsidian13.TFolder && folder.path ? `${folder.path}/` : "";
    const base = (config.name?.trim() || "New Database").replace(/[\\/:*?"<>|]/g, "-");
    let path = (0, import_obsidian13.normalizePath)(`${dir}${base}.${BOARD_EXTENSION}`);
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = (0, import_obsidian13.normalizePath)(`${dir}${base} ${i++}.${BOARD_EXTENSION}`);
    }
    try {
      const file = await this.app.vault.create(path, serializeDatabase(config));
      await this.openBoard(file);
    } catch (e) {
      new import_obsidian13.Notice(`R Board: could not create database \u2014 ${e.message}`);
    }
  }
};
