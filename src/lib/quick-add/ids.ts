/** Command id (without the plugin prefix) for a quick-add id. */
export const quickAddCommand = (id: string): string => `quick-add-${id}`;

/** Full command id, as Obsidian's hotkeys store it. */
export const quickAddCommandId = (id: string): string => `r-board:${quickAddCommand(id)}`;
