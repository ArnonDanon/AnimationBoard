import { createVectorObject, getObjectsArray, vectorObjectToData } from './document';
import type { YLayer } from './document';
import { DEFAULT_TRANSFORM } from './types';
import type { Point, Transform, VectorObjectData } from './types';

function applyTransform(p: Point, t: Transform): Point {
  const rad = (t.rotation * Math.PI) / 180;
  const sx = p.x * t.scaleX;
  const sy = p.y * t.scaleY;
  const rx = sx * Math.cos(rad) - sy * Math.sin(rad);
  const ry = sx * Math.sin(rad) + sy * Math.cos(rad);
  return { x: rx + t.x, y: ry + t.y, pressure: p.pressure };
}

function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceToPath(p: { x: number; y: number }, path: { x: number; y: number }[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return Math.hypot(p.x - path[0].x, p.y - path[0].y);
  let min = Infinity;
  for (let i = 1; i < path.length; i++) {
    min = Math.min(min, distanceToSegment(p, path[i - 1], path[i]));
  }
  return min;
}

// Groups surviving (non-erased) indices into consecutive runs — each run becomes its
// own stroke fragment, which is how a single erase pass can split one stroke into two.
export function splitSurvivingRuns(count: number, isErased: (index: number) => boolean): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!isErased(i)) {
      current.push(i);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * Returns the stroke fragments that survive erasing, with the object's transform
 * baked into their point coordinates (fragments always use an identity transform).
 * Returns `null` if the eraser path didn't touch this object at all — callers use
 * that to skip replacing objects the eraser missed.
 */
export function eraseFromObjectData(
  data: VectorObjectData,
  erasePath: { x: number; y: number }[],
  eraseRadius: number,
): Omit<VectorObjectData, 'id'>[] | null {
  const worldPoints = data.points.map((p) => applyTransform(p, data.transform));
  const isErased = (i: number) => distanceToPath(worldPoints[i], erasePath) <= eraseRadius;
  const runs = splitSurvivingRuns(data.points.length, isErased);
  const survivingCount = runs.reduce((sum, r) => sum + r.length, 0);
  if (survivingCount === data.points.length) return null;

  return runs.map((run) => ({
    kind: 'stroke' as const,
    points: run.map((i) => worldPoints[i]),
    style: {
      color: data.style.color,
      width: data.style.width,
      widths: data.style.widths ? run.map((i) => data.style.widths![i]) : undefined,
      opacity: data.style.opacity,
    },
    transform: { ...DEFAULT_TRANSFORM },
    createdBy: data.createdBy,
  }));
}

export function eraseFromLayer(layer: YLayer, erasePath: { x: number; y: number }[], eraseRadius: number): void {
  const objects = getObjectsArray(layer);
  for (let i = objects.length - 1; i >= 0; i--) {
    const data = vectorObjectToData(objects.get(i));
    const fragments = eraseFromObjectData(data, erasePath, eraseRadius);
    if (fragments === null) continue;

    objects.delete(i, 1);
    const survivors = fragments.filter((f) => f.points.length > 0).map((f) => createVectorObject(f));
    if (survivors.length > 0) objects.insert(i, survivors);
  }
}
