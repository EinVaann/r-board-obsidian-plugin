import type { App, HoverParent, Plugin, TFile } from 'obsidian';

// The page-preview / hover-editor integration isn't in the obsidian typings.
// `registerHoverLinkSource` is provided by the core Page Preview plugin; the
// `hover-link` workspace event is what it (and the Hover Editor plugin) listen
// on to spawn a popover.
declare module 'obsidian' {
  interface Plugin {
    registerHoverLinkSource(
      id: string,
      info: { display: string; defaultMod?: boolean },
    ): void;
  }
}

/** Id we register with Page Preview, so users can toggle the source on/off. */
export const HOVER_SOURCE = 'r-board';

/** Register R Board as a hover-link source (call once, in plugin onload). */
export function registerHoverSource(plugin: Plugin): void {
  plugin.registerHoverLinkSource(HOVER_SOURCE, {
    display: 'R Board',
    // Require Ctrl/Cmd-hover by default so plain hovering doesn't spam previews.
    defaultMod: true,
  });
}

/**
 * Open Obsidian's hover popover for `file`, anchored at `targetEl`. With the
 * Hover Editor plugin installed this popover is fully editable (native
 * frontmatter property widgets + body), giving inline note editing for free;
 * without it, a read-only preview. Either way edits land in the file and the
 * board's `metadataCache` listener repaints the affected card.
 *
 * `force` synthesizes the modifier key so an explicit button always opens the
 * popover regardless of the user's page-preview trigger setting.
 */
export function openHoverEditor(
  app: App,
  hoverParent: HoverParent,
  targetEl: HTMLElement,
  file: TFile,
  sourcePath: string,
  baseEvent: MouseEvent,
  force = false,
): void {
  const event = force
    ? new MouseEvent('mouseover', {
        clientX: baseEvent.clientX,
        clientY: baseEvent.clientY,
        ctrlKey: true,
        metaKey: true,
      })
    : baseEvent;

  app.workspace.trigger('hover-link', {
    event,
    source: HOVER_SOURCE,
    hoverParent,
    targetEl,
    linktext: file.path,
    sourcePath,
  });
}
