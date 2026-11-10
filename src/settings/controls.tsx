/**
 * Settings controls: the UI primitives (src/ui) under the names the settings
 * screens use. New code imports from '../ui' directly.
 */
import { SimpleCard, Switch, Tabs, type TabDef } from '../ui';

export {
  SettingRow,
  TextInput,
  Select,
  Segmented,
  SortableList,
  DragHandle,
  LabeledField as Field,
  type Option,
  type HandleProps,
  type TabDef,
} from '../ui';

/** An on/off switch. */
export const Toggle = Switch;

/** A settings card: icon, title and description, then rows or fields. */
export const SettingsCard = SimpleCard;

/** The settings dialog's tabs over a scrolling body. */
export function SettingsTabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  return <Tabs tabs={tabs} initial={initial} className="rb-wizard rb-settings" />;
}
