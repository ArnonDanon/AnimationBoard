import type { YObject } from './document';
import type { Transform } from './types';

export function translateObject(obj: YObject, dx: number, dy: number): void {
  const t = obj.get('transform') as Transform;
  obj.set('transform', { ...t, x: t.x + dx, y: t.y + dy });
}

export function scaleObject(obj: YObject, factor: number): void {
  const t = obj.get('transform') as Transform;
  obj.set('transform', { ...t, scaleX: t.scaleX * factor, scaleY: t.scaleY * factor });
}

export function rotateObject(obj: YObject, deltaDegrees: number): void {
  const t = obj.get('transform') as Transform;
  obj.set('transform', { ...t, rotation: t.rotation + deltaDegrees });
}
