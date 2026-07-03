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

function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const onSegment = (a: { x: number; y: number }, p: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);

  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(p3, p1, p4)) return true;
  if (d2 === 0 && onSegment(p3, p2, p4)) return true;
  if (d3 === 0 && onSegment(p1, p3, p2)) return true;
  if (d4 === 0 && onSegment(p1, p4, p2)) return true;
  return false;
}

// Distance between two line segments — the minimum of the four endpoint-to-opposite-segment
// distances, or zero if they cross. Needed because two segments can pass right through each
// other without either one's endpoints coming close to the other's endpoints.
function distanceSegmentToSegment(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distanceToSegment(a1, b1, b2),
    distanceToSegment(a2, b1, b2),
    distanceToSegment(b1, a1, a2),
    distanceToSegment(b2, a1, a2),
  );
}

function minDistanceSegmentToPath(a1: { x: number; y: number }, a2: { x: number; y: number }, path: { x: number; y: number }[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return distanceToSegment(path[0], a1, a2);
  let min = Infinity;
  for (let i = 1; i < path.length; i++) {
    min = Math.min(min, distanceSegmentToSegment(a1, a2, path[i - 1], path[i]));
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
  const widthAt = (i: number) => data.style.widths?.[i] ?? data.style.width;

  // Test the stroke's own rendered *segments* against the eraser path, not just its
  // sample points — otherwise a fast/coarse stroke with widely-spaced points can be
  // visually crossed by the eraser without either endpoint being close enough to
  // register. Also widen the test by the segment's own half-width, since a thick
  // stroke's visible ink extends past its centerline.
  const erased = new Array<boolean>(worldPoints.length).fill(false);
  if (worldPoints.length === 1) {
    const effectiveRadius = eraseRadius + widthAt(0) / 2;
    if (distanceToPath(worldPoints[0], erasePath) <= effectiveRadius) erased[0] = true;
  } else {
    for (let i = 1; i < worldPoints.length; i++) {
      const effectiveRadius = eraseRadius + (widthAt(i - 1) + widthAt(i)) / 4;
      if (minDistanceSegmentToPath(worldPoints[i - 1], worldPoints[i], erasePath) <= effectiveRadius) {
        erased[i - 1] = true;
        erased[i] = true;
      }
    }
  }

  const isErased = (i: number) => erased[i];
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
