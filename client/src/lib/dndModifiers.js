// Shared @dnd-kit modifiers.
//
// snapCenterToCursor: keeps the dragged element's center locked to the cursor
// no matter where on the card the user initially pressed. Important detail —
// dnd-kit passes different `draggingNodeRect` values to DndContext vs
// DragOverlay modifiers:
//
//   • DndContext (affects collision detection / over target):
//       draggingNodeRect = dragOverlay.rect ?? activeNodeRect
//   • DragOverlay (affects overlay visual position):
//       draggingNodeRect = dragOverlay.rect
//
// If you only pass the modifier to <DragOverlay>, the overlay follows the
// cursor but the collision rect is still calculated against the un-offset
// translate — which is why the drop-target highlight appears shifted away
// from the cursor by exactly the "click offset from card center" distance.
//
// Fix: pass this modifier to BOTH <DndContext modifiers={...}> AND
// <DragOverlay modifiers={...}>. Both calls then use the same
// `draggingNodeRect` (the overlay rect, once it's mounted), so the ghost
// and the collision rect stay in lockstep under the cursor.
export function snapCenterToCursor({ activatorEvent, draggingNodeRect, transform }) {
  if (!draggingNodeRect || !activatorEvent) return transform;
  // activatorEvent may be PointerEvent, MouseEvent, or TouchEvent depending on
  // which sensor fired. Normalize to client coordinates.
  const ax =
    activatorEvent.clientX ??
    activatorEvent.touches?.[0]?.clientX ??
    activatorEvent.changedTouches?.[0]?.clientX;
  const ay =
    activatorEvent.clientY ??
    activatorEvent.touches?.[0]?.clientY ??
    activatorEvent.changedTouches?.[0]?.clientY;
  if (ax == null || ay == null) return transform;
  // Shift from "cursor's offset inside the card at drag start" to
  // "cursor at the card's center". This is a stable, one-time offset —
  // `transform` already accounts for pointer movement during the drag.
  const offsetX = ax - draggingNodeRect.left;
  const offsetY = ay - draggingNodeRect.top;
  return {
    ...transform,
    x: transform.x + offsetX - draggingNodeRect.width / 2,
    y: transform.y + offsetY - draggingNodeRect.height / 2,
  };
}
