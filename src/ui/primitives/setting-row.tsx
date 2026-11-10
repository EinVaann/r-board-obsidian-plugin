import type { ReactNode } from 'react';
import { cx, slot } from '../cx';

/**
 * Label and description left, control right. Keeps Obsidian's `setting-item`
 * markup so it reads like Obsidian's own settings in the Classic theme.
 */
export function SettingRow({
  name,
  desc,
  children,
  className,
  toggle = false,
}: {
  name?: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** A row whose control is a switch: Obsidian keeps these on one line on phones. */
  toggle?: boolean;
}) {
  return (
    <div {...slot('setting-row')} className={cx('setting-item', toggle && 'mod-toggle', className)}>
      <div {...slot('setting-row-info')} className="setting-item-info">
        {name && (
          <div {...slot('setting-row-name')} className="setting-item-name">
            {name}
          </div>
        )}
        {desc && (
          <div {...slot('setting-row-description')} className="setting-item-description">
            {desc}
          </div>
        )}
      </div>
      <div {...slot('setting-row-control')} className="setting-item-control">
        {children}
      </div>
    </div>
  );
}
