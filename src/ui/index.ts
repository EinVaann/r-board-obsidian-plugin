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
export { Button, IconButton, type ButtonProps, type IconButtonProps } from './primitives/button';
export { Input, TextInput, NumberInput, type InputProps, type NumberInputProps } from './primitives/input';
export { Select, MultiSelect, type SelectProps, type MultiSelectProps } from './primitives/select';
export { Segmented } from './primitives/segmented';
export { Switch } from './primitives/switch';
export { Pill, Chip } from './primitives/pill';
export { Card, CardHeader, CardIcon, CardTitle, CardDescription, CardActions, CardContent, CardFooter, SimpleCard } from './primitives/card';
export { Field, FieldInfo, FieldLabel, FieldHint, FieldDescription, FieldControl, FieldError, LabeledField } from './primitives/field';
export { SettingRow } from './primitives/setting-row';
export { Tabs, type TabDef } from './primitives/tabs';
export { SortableList, DragHandle, type HandleProps } from './primitives/sortable-list';
