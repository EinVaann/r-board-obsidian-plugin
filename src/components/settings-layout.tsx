import { useState, type ReactNode } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardIcon, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Icon } from '@/components/icon';
import { cn } from '@/lib/utils';

/*
 * How settings screens are laid out, built from the shadcn Card / Field / Tabs. Screens compose
 * these; they never restyle them.
 */

/** A settings card: icon, title and description, optional actions, then rows or fields. */
export function SettingsCard({ icon, title, desc, actions, children, className }: { icon: string; title: string; desc?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardIcon>
          <Icon name={icon} className="rb:inline-flex" />
        </CardIcon>
        <CardTitle>{title}</CardTitle>
        {desc && <CardDescription>{desc}</CardDescription>}
        {actions && <CardAction>{actions}</CardAction>}
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
    </Card>
  );
}

/** Label and description left, control right; a hairline between consecutive rows. */
export function SettingRow({ name, desc, children, className }: { name?: ReactNode; desc?: ReactNode; children?: ReactNode; className?: string; toggle?: boolean }) {
  return (
    <Field
      orientation="horizontal"
      data-slot="setting-row"
      className={cn(
        // Wraps: when label and control don't fit side by side (phones), the control drops below.
        'rb:flex-wrap rb:gap-y-2 rb:py-2.5 rb:px-1 rb:[&+&]:border-t rb:[&+&]:border-solid rb:[&+&]:border-divider rb:[&+&]:border-x-0 rb:[&+&]:border-b-0',
        className,
      )}
    >
      <div className="rb:flex rb:min-w-0 rb:flex-1 rb:basis-[220px] rb:flex-col rb:gap-0.5">
        {name && <div data-slot="setting-row-name" className="rb:flex rb:items-center rb:gap-2 rb:text-control rb:font-medium rb:text-foreground">{name}</div>}
        {desc && <FieldDescription>{desc}</FieldDescription>}
      </div>
      {children !== undefined && (
        <div className="rb:flex rb:shrink-0 rb:items-center rb:justify-end rb:gap-1.5 rb:ml-auto rb:max-w-full rb:[&>[data-slot=input]]:w-[200px] rb:[&>[data-slot=native-select-wrapper]]:min-w-[200px] rb:max-sm:grow rb:max-sm:[&>[data-slot=input]]:flex-1 rb:max-sm:[&>[data-slot=native-select-wrapper]]:flex-1 rb:max-sm:[&>[data-slot=native-select-wrapper]]:min-w-0">
          {children}
        </div>
      )}
    </Field>
  );
}

/** Label above its control, with an optional hint: the field grids inside cards. */
export function LabeledField({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <Field className={className}>
      <FieldLabel>
        {label}
        {hint && <span className="rb:text-hint rb:font-normal rb:text-faint-foreground">{hint}</span>}
      </FieldLabel>
      <div className="rb:flex rb:min-w-0 rb:items-center rb:[&>[data-slot=input]]:w-full rb:[&>[data-slot=native-select-wrapper]]:w-full">{children}</div>
    </Field>
  );
}

export interface TabDef {
  id: string;
  label: string;
  icon: string;
  content: ReactNode;
}

/** The settings dialog's tabs over a scrolling body. A tab that disappears falls back to the first. */
export function SettingsTabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [tab, setTab] = useState(initial ?? tabs[0]?.id);
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;
  return (
    <Tabs value={current} onValueChange={setTab} className="rb-wizard rb-settings rb:gap-0">
      <TabsList variant="line" className="rb-settings-tabs">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="rb-settings-tab">
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="rb-settings-body">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
