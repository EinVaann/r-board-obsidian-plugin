import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

const GAP = 4;
const EDGE = 8;

/**
 * A box fixed to the viewport under (or above) `anchor`, so scroll areas and
 * dialogs neither clip it nor grow a scrollbar for it. Opens on the side with
 * more room and follows the anchor when anything scrolls.
 */
export function Floating({
  anchor,
  children,
  className,
  matchWidth = true,
  role,
}: {
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  /** At least as wide as the anchor. */
  matchWidth?: boolean;
  role?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden', left: 0, top: 0 });
  const [side, setSide] = useState<'top' | 'bottom'>('bottom');

  useLayoutEffect(() => {
    const el = ref.current;
    const trigger = anchor.current;
    if (!el || !trigger) return;
    const doc = trigger.ownerDocument;
    const win = doc.defaultView ?? window;
    const place = (): void => {
      const r = trigger.getBoundingClientRect();
      const below = win.innerHeight - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      const up = el.scrollHeight > below && above > below;
      const width = Math.max(el.offsetWidth, matchWidth ? r.width : 0);
      const left = Math.max(EDGE, Math.min(r.left, win.innerWidth - width - EDGE));
      const top = up ? r.top - GAP - Math.min(el.scrollHeight, above) : r.bottom + GAP;
      // A transformed ancestor (an animating modal) moves the fixed box's origin; measure it and compensate.
      const now = el.getBoundingClientRect();
      const originX = now.left - (parseFloat(el.style.left) || 0);
      const originY = now.top - (parseFloat(el.style.top) || 0);
      setSide(up ? 'top' : 'bottom');
      setStyle({ position: 'fixed', left: left - originX, top: top - originY, minWidth: matchWidth ? r.width : undefined, maxHeight: up ? above : below });
    };
    place();
    const onScroll = (e: Event): void => {
      if (!el.contains(e.target as Node)) place();
    };
    doc.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', place);
    return () => {
      doc.removeEventListener('scroll', onScroll, true);
      win.removeEventListener('resize', place);
    };
  }, [anchor, matchWidth]);

  return (
    <div ref={ref} className={className} data-side={side} style={style} role={role}>
      {children}
    </div>
  );
}
