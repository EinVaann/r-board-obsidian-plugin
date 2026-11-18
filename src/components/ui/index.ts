/**
 * R Board's UI primitives. Import from here, never style a control inline.
 *
 * Contract: every part renders `data-slot` (kebab-case family-part), plus
 * `data-variant` / `data-size` / `data-state` when it has them. Shapes live in
 * styles/ui/*.css (one file per primitive, tokens only); a theme module in
 * styles/themes/<name>/ sets token values and may restyle a slot. See
 * styles/themes/README.md.
 */
export * from './types';
export { cx, slot } from './cx';
export { Button, IconButton, type ButtonProps, type IconButtonProps } from './button';
export { Input, TextInput, NumberInput, type InputProps, type NumberInputProps } from './input';
export { Select, MultiSelect, type SelectProps, type MultiSelectProps } from './select';
export { Segmented } from './segmented';
export { Floating } from './popover';
export { Switch } from './switch';
export { Pill, Chip } from './pill';
export { Card, CardHeader, CardIcon, CardTitle, CardDescription, CardActions, CardContent, CardFooter, SimpleCard } from './card';
export { Field, FieldInfo, FieldLabel, FieldHint, FieldDescription, FieldControl, FieldError, LabeledField } from './field';
export { SettingRow } from './setting-row';
export { Tabs, type TabDef } from './tabs';
export { SortableList, DragHandle, type HandleProps } from './sortable-list';
export { SettingsList, SortableSettingsList, SettingsRow, AddRow, type SettingsRowProps } from './settings-list';
