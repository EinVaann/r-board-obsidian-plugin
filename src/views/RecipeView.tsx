import { memo, useEffect, useState } from 'react';
import type { TFile } from 'obsidian';
import type { BoardItem, PropertyConfig, ViewConfig } from '../types';
import { Card } from '../components/Card';
import { Sections, ViewMore, usePaged } from '../components/layout';
import { useApp } from '../react/mount';
import { extractRecipeBlock, parseRecipe, type Recipe as RecipeData } from '../recipe/parse';
import { Recipe } from '../recipe/Recipe';

/**
 * Recipe view: one card per note, showing the note's title, its visible
 * properties, and its full interactive recipe block. Only the title link opens
 * the note, so the portions stepper stays usable. When the view sets `group`,
 * cards are split into sections.
 */
export function RecipeView({ view, items, properties }: { view: ViewConfig; items: BoardItem[]; properties: PropertyConfig[] }) {
  if (items.length === 0) return <div className="rb-empty">No notes match this view.</div>;

  const groupProp = view.group ? properties.find((p) => p.name === view.group) : undefined;
  const list = (group: BoardItem[], pageKey: string) => <RecipeList key={pageKey} items={group} pageKey={pageKey} view={view} properties={properties} />;
  return groupProp ? (
    <Sections items={items} groupProp={groupProp} view={view} pagePrefix="r">{list}</Sections>
  ) : (
    list(items, 'r')
  );
}

function RecipeList({ items, pageKey, view, properties }: { items: BoardItem[]; pageKey: string; view: ViewConfig; properties: PropertyConfig[] }) {
  const { visible, more, remaining } = usePaged(pageKey, items, view.limit ?? 50);
  return (
    <div className="rb-recipe-view">
      {visible.map((item) => (
        <RecipeCard key={item.file.path} item={item} properties={properties} />
      ))}
      <ViewMore more={more} remaining={remaining} />
    </div>
  );
}

const RecipeCard = memo(function RecipeCard({ item, properties }: { item: BoardItem; properties: PropertyConfig[] }) {
  return (
    <Card
      item={item}
      properties={properties}
      className="rb-recipe-card"
      footer={<NoteRecipe file={item.file} mtime={item.file.stat.mtime} />}
    />
  );
});

/** The note's first recipe block, rendered in full (or a note that it has none). */
function NoteRecipe({ file, mtime }: { file: TFile; mtime: number }) {
  const app = useApp();
  const [recipe, setRecipe] = useState<RecipeData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    app.vault
      .cachedRead(file)
      .then((raw) => {
        const src = extractRecipeBlock(raw);
        if (!cancelled) setRecipe(src ? parseRecipe(src) : null);
      })
      .catch(() => {
        /* unreadable note: show nothing */
      });
    return () => {
      cancelled = true;
    };
  }, [app, file, mtime]);

  return (
    <div className="rb-recipe-mount">
      {recipe === null && <div className="rb-recipe-none">No recipe block in this note.</div>}
      {recipe && <Recipe recipe={recipe} />}
    </div>
  );
}
