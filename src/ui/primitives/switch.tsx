import * as RadixSwitch from '@radix-ui/react-switch';
import { slot } from '../cx';

/** An on/off switch (Radix Switch). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <RadixSwitch.Root {...slot('switch')} className="rb-switch" checked={checked} onCheckedChange={onChange} aria-label={label}>
      <RadixSwitch.Thumb {...slot('switch-thumb')} className="rb-switch-thumb" />
    </RadixSwitch.Root>
  );
}
