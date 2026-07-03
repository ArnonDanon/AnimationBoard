import type { Point } from './types';

export interface PointerStreamHandlers {
  onStart: (p: Point) => void;
  onMove: (p: Point) => void;
  onEnd: (p: Point) => void;
}

export function attachPointerCapture(canvas: HTMLCanvasElement, handlers: PointerStreamHandlers): () => void {
  function toPoint(e: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure: e.pressure };
  }

  function onPointerDown(e: PointerEvent): void {
    canvas.setPointerCapture(e.pointerId);
    handlers.onStart(toPoint(e));
  }
  function onPointerMove(e: PointerEvent): void {
    if (e.buttons === 0) return;
    handlers.onMove(toPoint(e));
  }
  function onPointerUp(e: PointerEvent): void {
    handlers.onEnd(toPoint(e));
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
  };
}
