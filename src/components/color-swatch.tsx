import { cn } from '@/lib/utils';

/** A small colour square that opens the system colour picker. No colour set: a neutral outline. */
export function ColorSwatch({ color, label, onChange, className }: { color?: string; label: string; onChange: (color: string) => void; className?: string }) {
  return (
    <label
      title={label}
      className={cn(
        'rb:relative rb:inline-block rb:shrink-0 rb:size-3.5 rb:mr-2 rb:rounded-[4px] rb:cursor-pointer rb:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]',
        className,
      )}
      style={{ background: color ?? 'var(--rb-field-border-hover)' }}
    >
      <input
        type="color"
        aria-label={label}
        defaultValue={/^#[0-9a-f]{6}$/i.test(color ?? '') ? color : '#888888'}
        onChange={(e) => onChange(e.target.value)}
        className="rb:absolute rb:inset-0 rb:size-full rb:p-0 rb:border-0 rb:opacity-0 rb:cursor-pointer"
      />
    </label>
  );
}
