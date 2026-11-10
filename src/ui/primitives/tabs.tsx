import { useState, type ReactNode } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import { Icon } from '../../react/Icon';
import { slot } from '../cx';

export interface TabDef {
  id: string;
  label: string;
  icon: string;
  content: ReactNode;
}

/** Tabs over a scrolling body (Radix Tabs). A tab that disappears falls back to the first. */
export function Tabs({ tabs, initial, className }: { tabs: TabDef[]; initial?: string; className?: string }) {
  const [tab, setTab] = useState(initial ?? tabs[0]?.id);
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;
  return (
    <RadixTabs.Root {...slot('tabs')} className={className} value={current} onValueChange={setTab}>
      <RadixTabs.List {...slot('tabs-list')} className="rb-settings-tabs">
        {tabs.map((t) => (
          <RadixTabs.Trigger key={t.id} value={t.id} {...slot('tabs-trigger')} className="rb-settings-tab">
            <Icon name={t.icon} className="rb-settings-tab-icon" />
            <span>{t.label}</span>
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((t) => (
        <RadixTabs.Content key={t.id} value={t.id} {...slot('tabs-content')} className="rb-settings-body">
          {t.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
