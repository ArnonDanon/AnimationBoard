import type { Point } from './types';

export interface PointerModifiers {
  shiftKey: boolean;
}

export interface PointerStreamHandlers {
  onStart: (p: Point, modifiers: PointerModifiers) => void;
  onMove: (p: Point, modifiers: PointerModifiers) => void;
  onEnd: (p: Point, modifiers: PointerModifiers) => void;
  /** Fires on every pointer move, including hover (no button pressed) — for cursor feedback only. */
  onHover?: (p: Point) => void;
  onHoverEnd?: () => void;
}

export function attachPointerCapture(canvas: HTMLCanvasElement, handlers: PointerStreamHandlers): () => void {
  function toPoint(e: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure: e.pressure };
  }

  function toModifiers(e: PointerEvent): PointerModifiers {
    return { shiftKey: e.shiftKey };
  }

  function onPointerDown(e: PointerEvent): void {
    canvas.setPointerCapture(e.pointerId);
    handlers.onStart(toPoint(e), toModifiers(e));
  }
  function onPointerMove(e: PointerEvent): void {
    const p = toPoint(e);
    handlers.onHover?.(p);
    if (e.buttons === 0) return;
    handlers.onMove(p, toModifiers(e));
  }
  function onPointerUp(e: PointerEvent): void {
    handlers.onEnd(toPoint(e), toModifiers(e));
  }
  function onPointerLeave(): void {
    handlers.onHoverEnd?.();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('pointerleave', onPointerLeave);
  };
}
