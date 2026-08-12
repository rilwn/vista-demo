import { useEffect, useRef } from 'react';

/** Keeps the selected item visible inside a horizontally scrolling navigation rail. */
export function useActiveItemVisibility<T extends HTMLElement>(activeKey: string) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    const alignActiveItem = () => {
      const container = containerRef.current;
      const active = container?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!container || !active) return;

      const inset = 12;
      const containerBounds = container.getBoundingClientRect();
      const activeBounds = active.getBoundingClientRect();
      let nextScroll = container.scrollLeft;

      if (activeBounds.left < containerBounds.left + inset) {
        nextScroll += activeBounds.left - containerBounds.left - inset;
      } else if (activeBounds.right > containerBounds.right - inset) {
        nextScroll += activeBounds.right - containerBounds.right + inset;
      }

      container.scrollLeft = Math.min(
        Math.max(0, nextScroll),
        Math.max(0, container.scrollWidth - container.clientWidth),
      );
    };

    if (typeof window.requestAnimationFrame !== 'function') {
      alignActiveItem();
      return;
    }

    let frame = 0;
    const scheduleAlignment = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(alignActiveItem);
    };
    scheduleAlignment();
    window.addEventListener('resize', scheduleAlignment);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleAlignment);
    };
  }, [activeKey]);

  return containerRef;
}
