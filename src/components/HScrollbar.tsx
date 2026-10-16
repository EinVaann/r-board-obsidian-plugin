import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * A drawn, always-visible horizontal scrollbar for `target` (whose native bar
 * is hidden): drag the thumb, click the track, or use the wheel over it.
 */
export function HScrollbar({ target }: { target: RefObject<HTMLElement | null> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = target.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;
    // Thumb width and travel, from the target's current scroll state.
    const metrics = () => {
      const max = el.scrollWidth - el.clientWidth;
      const tw = track.clientWidth;
      const w = max > 0 ? Math.max(40, (el.clientWidth / el.scrollWidth) * tw) : tw;
      return { max, travel: Math.max(1, tw - w), w };
    };
    const update = (): void => {
      const { max, travel, w } = metrics();
      track.classList.toggle('rb-hidden', max <= 1);
      thumb.style.width = `${w}px`;
      thumb.style.transform = `translateX(${max > 0 ? (el.scrollLeft / max) * travel : 0}px)`;
    };

    let drag: { x: number; left: number } | null = null;
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      const { max, travel, w } = metrics();
      if (e.target !== thumb) {
        // Click on the track: centre the thumb there.
        const x = e.clientX - track.getBoundingClientRect().left - w / 2;
        el.scrollLeft = (x / travel) * max;
      }
      drag = { x: e.clientX, left: el.scrollLeft };
      track.setPointerCapture(e.pointerId);
      track.classList.add('rb-dragging');
    };
    const onMove = (e: PointerEvent): void => {
      if (!drag) return;
      const { max, travel } = metrics();
      el.scrollLeft = drag.left + ((e.clientX - drag.x) / travel) * max;
    };
    const onUp = (): void => {
      drag = null;
      track.classList.remove('rb-dragging');
    };
    // A mouse wheel over the bar scrolls sideways.
    const onWheel = (e: WheelEvent): void => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      el.scrollLeft += d;
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    track.addEventListener('pointerdown', onDown);
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onUp);
    track.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(track);
    // The content (a table whose columns get resized) changes the scroll width.
    const mo = new MutationObserver(() => {
      for (const child of el.querySelectorAll('table')) ro.observe(child);
      update();
    });
    mo.observe(el, { childList: true, subtree: true });
    for (const child of el.querySelectorAll('table')) ro.observe(child);
    return () => {
      el.removeEventListener('scroll', update);
      track.removeEventListener('pointerdown', onDown);
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
      track.removeEventListener('wheel', onWheel);
      ro.disconnect();
      mo.disconnect();
    };
  }, [target]);

  return (
    <div className="rb-hscroll" ref={trackRef} aria-hidden="true">
      <div className="rb-hscroll-thumb" ref={thumbRef} />
    </div>
  );
}
