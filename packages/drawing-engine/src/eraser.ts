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

// Rectangle/ellipse geometry, in world space (corners already transform-applied).
// Only used to decide "did the eraser touch this shape at all" — see the whole-object
// erase note on eraseFromObjectData for why there's no partial-shape trimming.
function isPointNearRect(p: { x: number; y: number }, corners: Point[], radius: number): boolean {
  const minX = Math.min(corners[0].x, corners[1].x) - radius;
  const maxX = Math.max(corners[0].x, corners[1].x) + radius;
  const minY = Math.min(corners[0].y, corners[1].y) - radius;
  const maxY = Math.max(corners[0].y, corners[1].y) + radius;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

function isPointNearEllipse(p: { x: number; y: number }, corners: Point[], radius: number): boolean {
  const cx = (corners[0].x + corners[1].x) / 2;
  const cy = (corners[0].y + corners[1].y) / 2;
  const rx = Math.abs(corners[1].x - corners[0].x) / 2 + radius;
  const ry = Math.abs(corners[1].y - corners[0].y) / 2 + radius;
  if (rx === 0 || ry === 0) return false;
  const dx = (p.x - cx) / rx;
  const dy = (p.y - cy) / ry;
  return dx * dx + dy * dy <= 1;
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

// Only subdivides where it might matter — segments nowhere near the eraser stay at
// their original point count, so this doesn't bloat far-away, untouched geometry.
function buildWorkingGeometry(
  points: Point[],
  widths: number[],
  erasePath: { x: number; y: number }[],
  eraseRadius: number,
): { points: Point[]; widths: number[] } {
  if (points.length < 2) return { points, widths };

  // Precision is bounded by this fixed spacing instead of by whatever the original
  // stroke's point spacing happened to be (which depends on how fast it was drawn —
  // an invisible factor with no relationship to what the eraser circle shows on
  // screen). Scales with the eraser radius so a bigger eraser doesn't pay for
  // needless precision.
  const maxSpacing = Math.max(1, eraseRadius / 3);

  const outPoints: Point[] = [points[0]];
  const outWidths: number[] = [widths[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const wa = widths[i - 1];
    const wb = widths[i];
    const segLength = Math.hypot(b.x - a.x, b.y - a.y);
    const mightMatter = minDistanceSegmentToPath(a, b, erasePath) <= eraseRadius + segLength + Math.max(wa, wb) / 2;

    if (mightMatter && segLength > maxSpacing) {
      const steps = Math.ceil(segLength / maxSpacing);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        outPoints.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, pressure: a.pressure + (b.pressure - a.pressure) * t });
        outWidths.push(wa + (wb - wa) * t);
      }
    } else {
      outPoints.push(b);
      outWidths.push(wb);
    }
  }
  return { points: outPoints, widths: outWidths };
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
  // Rectangles/ellipses are filled shapes stored as 2 bounding-box corners, not a
  // polyline — the segment-subdivision/per-point-width logic below assumes stroke
  // topology and would silently mangle a shape into stroke fragments along its
  // diagonal if it ran against one. Partial-erase of a filled shape has no
  // well-defined geometry without real boolean subtraction (same class of gap as the
  // documented thick-stroke partial-width limitation), so a touch just deletes the
  // whole object instead.
  if (data.kind !== 'stroke') {
    const worldCorners = data.points.map((p) => applyTransform(p, data.transform));
    if (worldCorners.length < 2) return null;
    const touched = erasePath.some((p) =>
      data.kind === 'rectangle' ? isPointNearRect(p, worldCorners, eraseRadius) : isPointNearEllipse(p, worldCorners, eraseRadius),
    );
    return touched ? [] : null;
  }

  const rawWorldPoints = data.points.map((p) => applyTransform(p, data.transform));
  const rawWidths = data.points.map((_, i) => data.style.widths?.[i] ?? data.style.width);

  // Test the stroke's own rendered *segments* against the eraser path, not just its
  // sample points — otherwise a fast/coarse stroke with widely-spaced points can be
  // visually crossed by the eraser without either endpoint being close enough to
  // register.
  const { points: worldPoints, widths } = buildWorkingGeometry(rawWorldPoints, rawWidths, erasePath, eraseRadius);

  // The test is widened by the stroke's own half-width, because the eraser should
  // remove ink wherever it visually touches it — a thick stroke's rendered edge
  // extends past its centerline, same as a real eraser doesn't care about a pen's
  // "center", only where its tip actually contacts the page. Precision doesn't
  // suffer from this the way it used to: erase granularity is now bounded by
  // buildWorkingGeometry's fixed subdivision, not by the stroke's original point
  // spacing, so this stays predictable instead of ballooning unpredictably.
  const erased = new Array<boolean>(worldPoints.length).fill(false);
  if (worldPoints.length === 1) {
    const effectiveRadius = eraseRadius + widths[0] / 2;
    if (distanceToPath(worldPoints[0], erasePath) <= effectiveRadius) erased[0] = true;
  } else {
    for (let i = 1; i < worldPoints.length; i++) {
      const effectiveRadius = eraseRadius + (widths[i - 1] + widths[i]) / 4;
      if (minDistanceSegmentToPath(worldPoints[i - 1], worldPoints[i], erasePath) <= effectiveRadius) {
        erased[i - 1] = true;
        erased[i] = true;
      }
    }
  }

  const isErased = (i: number) => erased[i];
  const runs = splitSurvivingRuns(worldPoints.length, isErased);
  const survivingCount = runs.reduce((sum, r) => sum + r.length, 0);
  if (survivingCount === worldPoints.length) return null;

  return runs.map((run) => ({
    kind: 'stroke' as const,
    points: run.map((i) => worldPoints[i]),
    style: {
      color: data.style.color,
      width: data.style.width,
      widths: run.map((i) => widths[i]),
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
