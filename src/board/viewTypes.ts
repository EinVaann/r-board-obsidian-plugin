import type { ViewType } from '../types';

/** The icon for each view type (tabs, menus, settings). */
export const TYPE_ICON: Record<ViewType, string> = {
  gallery: 'layout-grid',
  kanban: 'columns-3',
  table: 'table',
  recipe: 'utensils',
  chart: 'bar-chart-3',
  schedule: 'calendar-range',
};

/** The display name of each view type. */
export const TYPE_NAME: Record<ViewType, string> = {
  gallery: 'Gallery',
  kanban: 'Board',
  table: 'Table',
  recipe: 'Recipe',
  chart: 'Chart',
  schedule: 'Schedule',
};
