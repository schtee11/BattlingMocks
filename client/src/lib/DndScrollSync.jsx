import { useEffect } from 'react';
import { useDndContext } from '@dnd-kit/core';

// Re-measure droppable rects whenever ANY scrollable ancestor scrolls
// during a drag. Without this, @dnd-kit's stored droppable rects are stale
// after a scroll and the collision detector lights up the WRONG slot —
// visually the drop highlight drifts away from the cursor.
//
// Why this is needed: `useDroppableMeasuring` only re-measures on
// ResizeObserver callbacks and on its dependency list `[translate.x,
// translate.y]`. It does NOT listen to scroll events. `useScrollOffsets`
// *does* listen to scroll on scrollable ancestors, but it only feeds the
// `scrollAdjustment` used for event payloads — collision detection
// (`collisionRect = getAdjustedRect(draggingNodeRect, modifiedTranslate)`,
// core.esm.js line 2984) compares against `droppableRects` directly.
// Stale rects + fresh cursor position = drop-zone drift.
//
// Fix: subscribe to scroll events at the window capture phase while a
// drag is active and imperatively call `measureDroppableContainers()`.
// Throttled to one call per animation frame to avoid flooding React
// with setState while the user scrolls quickly.
//
// Render this component as a child of `<DndContext>` (the hook reads
// from the context provider).
export function DndScrollSync() {
  const { active, measureDroppableContainers } = useDndContext();

  useEffect(() => {
    if (!active || !measureDroppableContainers) return;

    let raf = null;
    function onScroll() {
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        // Passing no ids re-measures every registered droppable, which is
        // what we want — any scrollable ancestor can shift any droppable.
        measureDroppableContainers();
      });
    }

    // `capture: true` because native scroll events don't bubble; catching
    // them on the capture phase at the window lets us handle scroll on any
    // ancestor (including internal panels with overflow: auto).
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [active, measureDroppableContainers]);

  return null;
}
