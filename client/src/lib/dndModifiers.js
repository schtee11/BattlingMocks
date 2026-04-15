// Shared @dnd-kit modifiers.
//
// snapCenterToCursor: keeps the dragged element's center locked to the cursor
// no matter where on the card the user initially pressed.
//
// **Pass ONLY to <DndContext modifiers={...}>. Do NOT also pass it to
// <DragOverlay modifiers={...}>.**
//
// Reason: @dnd-kit stores the DndContext-modified translate in
// `ActiveDraggableContext`, which `<DragOverlay>` reads as its starting
// `transform` before applying its own modifiers (core.esm.js lines 2996,
// 3359, 3923). Passing this modifier to both sites would apply the
// center-snap offset twice — the overlay visually drifts past the cursor
// while the drop target (which uses `modifiedTranslate` directly at line
// 2984) stays correctly under it. That mismatch is exactly the symptom
// "the drop area follows my cursor but the visual card doesn't."
//
// With the modifier on <DndContext> only, both collision detection and
// overlay transform pick up a single, consistent offset and stay in
// lockstep under the pointer.
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
