import { arrayMove } from '@dnd-kit/sortable';
import { useBoard, useBoardContext } from '../board/context';
import { TYPE_ICON, TYPE_NAME } from '../board/viewTypes';
import { Icon } from '../react/Icon';
import { DragHandle, IconButton, Pill, SimpleCard, SortableList } from '../ui';

/** Board settings → Views: the order of the view tabs, and which one opens first. */
export function ViewsSettings() {
  const { actions } = useBoardContext();
  const config = useBoard((s) => s.config);
  const updateConfig = useBoard((s) => s.updateConfig);
  if (!config) return null;
  const views = config.views;
  const names = views.map((v) => v.name);
  const first = config.defaultView && names.includes(config.defaultView) ? config.defaultView : names[0];

  return (
    <SimpleCard icon="layout-list" title="Views" desc="Drag to reorder the view tabs. The default view opens first when the board opens.">
      {views.length === 0 ? (
        <div className="rb-wizard-hint">No views yet — add one with ＋ next to the view tabs.</div>
      ) : (
        <SortableList
          ids={names}
          onReorder={(from, to) => updateConfig((c) => void (c.views = arrayMove(c.views, from, to)))}
          className="rb-views-list"
          renderRow={(name, i, handle) => {
            const v = views[i];
            const isDefault = name === first;
            return (
              <div className="rb-views-row">
                <DragHandle handle={handle} />
                <Icon name={TYPE_ICON[v.type]} className="rb-views-icon" />
                <span className="rb-views-name">{v.name}</span>
                <span className="rb-views-type">{TYPE_NAME[v.type]}</span>
                {isDefault && <Pill className="rb-views-default">Default</Pill>}
                <span className="rb-views-actions">
                  {!isDefault && <IconButton icon="home" label={`Open ${v.name} first`} size="sm" onClick={() => updateConfig((c) => void (c.defaultView = name))} />}
                  <IconButton icon="sliders-horizontal" label={`${v.name} settings`} size="sm" onClick={() => actions.openViewSettings(i)} />
                </span>
              </div>
            );
          }}
        />
      )}
    </SimpleCard>
  );
}
