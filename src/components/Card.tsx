import { memo, type ReactNode } from 'react';
import type { BoardItem, PropertyConfig } from '../types';
import { useBoardContext } from '../board/context';
import { fieldNode, type FieldEnv } from './fields';
import { NoteExcerpt } from './NoteExcerpt';

/** The first visible image property, if any (drawn as the card cover). */
export function coverProperty(properties: PropertyConfig[]): PropertyConfig | undefined {
  return properties.find((p) => p.type === 'image');
}

/** Visible non-image properties drawn in the card body, excluding `title`. */
export function bodyProperties(properties: PropertyConfig[]): PropertyConfig[] {
  return properties.filter((p) => p.type !== 'image' && p.name !== 'title');
}

/** Field renderer environment from the board context. */
export function useFieldEnv(): FieldEnv {
  const { app, actions, boardFile } = useBoardContext();
  return { app, editFile: actions.editFile, sourceFile: boardFile };
}

/**
 * The clickable title. A plain click opens the in-place edit modal; a
 * Ctrl/Cmd-click opens the note in a new tab.
 */
export function TitleLink({ item, className = 'rb-title' }: { item: BoardItem; className?: string }) {
  const { actions } = useBoardContext();
  return (
    <a
      className={className}
      href="#"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) actions.openNote(item, true);
        else actions.editItem(item);
      }}
    >
      {item.title}
    </a>
  );
}

export interface CardProps {
  item: BoardItem;
  /** Visible properties (memoized per view, so cards can skip re-rendering). */
  properties: PropertyConfig[];
  showContent?: boolean;
  className: string;
  /** Extra content under the fields (e.g. a recipe block). */
  footer?: ReactNode;
  /** Absolutely-positioned overlay (e.g. a kanban card menu button). */
  overlay?: ReactNode;
}

/**
 * A board card: cover image, title, visible fields, and optionally an excerpt
 * of the note. Memoized — it only re-renders when its note or the view's
 * visible properties change.
 */
export const Card = memo(function Card({ item, properties, showContent, className, footer, overlay }: CardProps) {
  const env = useFieldEnv();
  const cover = coverProperty(properties);
  return (
    <div className={`rb-card ${className}`}>
      {overlay}
      {cover && fieldNode(env, item, cover)}
      <div className="rb-card-body">
        <TitleLink item={item} />
        {bodyProperties(properties).map((prop) => {
          const node = fieldNode(env, item, prop);
          return node ? <div key={prop.name} className="rb-field">{node}</div> : null;
        })}
        {showContent && item.file && <NoteExcerpt file={item.file} mtime={item.file.stat.mtime} />}
        {footer}
      </div>
    </div>
  );
});
