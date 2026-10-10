import { KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/**
 * Drag sensors shared by every drag-and-drop surface:
 * - mouse: starts after moving 6px, so plain clicks still click;
 * - touch: starts on a 250ms long-press, so swiping still scrolls;
 * - keyboard: Space to pick up, arrows to move, Space to drop.
 */
export function useDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}
