// A default import, not `import * as polygonClipping` — the package's ESM build only exports a
// default (`export { index as default }`), so a namespace import silently resolves to an object
// with no callable properties in a real ESM/browser build (it only happens to work under
// vitest/CJS resolution, where wildcard interop copies module.exports' own properties across).
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon as PCMultiPolygon } from 'polygon-clipping';
import { createVectorObject, getObjectsArray, vectorObjectToData } from './document';
import type { YLayer } from './document';
import {
  capsulePolygon,
  circlePolygon,
  DEFAULT_CAP_SEGMENTS,
  ellipseToPolygon,
  eraserSweepPolygons,
  fromPCMultiPolygon,
  multiPolygonArea,
  polygonArea,
  rectToPolygon,
  ringsAsMultiPolygon,
  toPCPolygon,
} from './polygon';
import type { Polygon, Ring } from './polygon';
import { DEFAULT_TRANSFORM } from './types';
import type { Point, Transform, VectorObjectData } from './types';

/** Real geometry that could register as "changed" is always well above this; anything smaller is
 *  floating-point noise from the polygon-clipping sweep, not an actual surviving sliver. */
const AREA_EPSILON = 1e-3;
/** Separate from AREA_EPSILON on purpose (see eraseFromObjectData's block comment): this one
 *  decides "is there anything left to draw," not "did the shape change at all." */
const DEGENERATE_AREA_EPSILON = 1e-6;

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

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(points: { x: number; y: number }[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function padBounds(b: Bounds, pad: number): Bounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

type SubtractResult = { kind: 'unchanged' } | { kind: 'deleted' } | { kind: 'changed'; polygons: Polygon[] };

/**
 * Subtracts the eraser's swept area from `subjectPC` (already resolved to world space) and
 * classifies the result. `originalArea` must be the subject's *true* (de-duplicated) area — for
 * shapes/filledPath that's just `polygonArea`, but for a run of overlapping stroke capsules the
 * caller must derive it from a `union()` first (see eraseStroke), since a naive sum of capsule
 * areas double-counts the overlap at every joint.
 */
function subtractSweep(subjectPC: PCMultiPolygon, originalArea: number, erasePath: { x: number; y: number }[], eraseRadius: number): SubtractResult {
  const sweepPC = ringsAsMultiPolygon(eraserSweepPolygons(erasePath, eraseRadius));
  const resultPC = polygonClipping.difference(subjectPC, sweepPC);
  const resultPolygons = fromPCMultiPolygon(resultPC);
  const resultArea = multiPolygonArea(resultPolygons);

  if (resultPolygons.length === 0 || resultArea <= DEGENERATE_AREA_EPSILON) return { kind: 'deleted' };
  if (Math.abs(resultArea - originalArea) <= AREA_EPSILON) return { kind: 'unchanged' };
  return { kind: 'changed', polygons: resultPolygons };
}

function filledPathFragment(rings: Ring[], data: VectorObjectData): Omit<VectorObjectData, 'id'> {
  return {
    kind: 'filledPath',
    points: [],
    rings,
    style: { color: data.style.color, width: data.style.width, opacity: data.style.opacity },
    transform: { ...DEFAULT_TRANSFORM },
    createdBy: data.createdBy,
  };
}

function resolveShapeResult(result: SubtractResult, data: VectorObjectData): Omit<VectorObjectData, 'id'>[] | null {
  if (result.kind === 'unchanged') return null;
  if (result.kind === 'deleted') return [];
  return result.polygons.filter((polygon) => polygonArea(polygon) > DEGENERATE_AREA_EPSILON).map((polygon) => filledPathFragment(polygon, data));
}

function eraseSingleRingObject(
  ring: Ring,
  erasePath: { x: number; y: number }[],
  eraseRadius: number,
  data: VectorObjectData,
): Omit<VectorObjectData, 'id'>[] | null {
  const area = polygonArea([ring]);
  const result = subtractSweep([toPCPolygon([ring])], area, erasePath, eraseRadius);
  return resolveShapeResult(result, data);
}

function eraseStroke(data: VectorObjectData, erasePath: { x: number; y: number }[], eraseRadius: number, expandedPathBounds: Bounds): Omit<VectorObjectData, 'id'>[] | null {
  const pointsWorld = data.points.map((p) => applyTransform(p, data.transform));
  const widths = data.points.map((_, i) => data.style.widths?.[i] ?? data.style.width);

  const maxHalfWidth = Math.max(...widths) / 2;
  if (!boundsOverlap(padBounds(boundsOf(pointsWorld), maxHalfWidth), expandedPathBounds)) return null;

  if (pointsWorld.length === 1) {
    const ring = circlePolygon(pointsWorld[0].x, pointsWorld[0].y, widths[0] / 2, DEFAULT_CAP_SEGMENTS * 2);
    return eraseSingleRingObject(ring, erasePath, eraseRadius, data);
  }

  // Classify each segment as a candidate for cutting ("near") or definitely out of reach ("far")
  // by the *exact* segment-to-erase-path distance (no sampling/subdivision needed here — unlike
  // the old point-marking approach, the boolean subtraction below is exact regardless of how
  // coarse the stroke's own point spacing is). Only near segments pay the capsule-conversion
  // cost; far segments are re-emitted as their original, untouched stroke geometry.
  const nearSeg: boolean[] = [];
  for (let i = 1; i < pointsWorld.length; i++) {
    const a = pointsWorld[i - 1];
    const b = pointsWorld[i];
    const halfWidth = Math.max(widths[i - 1], widths[i]) / 2;
    nearSeg.push(minDistanceSegmentToPath(a, b, erasePath) <= eraseRadius + halfWidth);
  }
  if (!nearSeg.some(Boolean)) return null;

  const nearCapsules: Ring[] = [];
  const farRanges: [number, number][] = [];
  let cursor = 0;
  let i = 0;
  while (i < nearSeg.length) {
    if (!nearSeg[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < nearSeg.length && nearSeg[end + 1]) end++;
    if (i > cursor) farRanges.push([cursor, i]);
    for (let s = i; s <= end; s++) {
      const radius = (widths[s] + widths[s + 1]) / 4;
      nearCapsules.push(capsulePolygon(pointsWorld[s], pointsWorld[s + 1], radius, DEFAULT_CAP_SEGMENTS));
    }
    cursor = end + 1;
    i = end + 1;
  }
  if (cursor < pointsWorld.length - 1) farRanges.push([cursor, pointsWorld.length - 1]);

  const subjectPC = ringsAsMultiPolygon(nearCapsules);
  const unionedPC = polygonClipping.union(subjectPC);
  const originalArea = multiPolygonArea(fromPCMultiPolygon(unionedPC));
  const result = subtractSweep(subjectPC, originalArea, erasePath, eraseRadius);
  if (result.kind === 'unchanged') return null;

  const farFragments: Omit<VectorObjectData, 'id'>[] = farRanges
    .filter(([s, e]) => e > s)
    .map(([s, e]) => ({
      kind: 'stroke' as const,
      points: pointsWorld.slice(s, e + 1),
      style: { color: data.style.color, width: data.style.width, widths: widths.slice(s, e + 1), opacity: data.style.opacity },
      transform: { ...DEFAULT_TRANSFORM },
      createdBy: data.createdBy,
    }));

  if (result.kind === 'deleted') return farFragments;

  const nearFragments = result.polygons.filter((polygon) => polygonArea(polygon) > DEGENERATE_AREA_EPSILON).map((polygon) => filledPathFragment(polygon, data));
  return [...farFragments, ...nearFragments];
}

function eraseFilledShape(data: VectorObjectData, erasePath: { x: number; y: number }[], eraseRadius: number, expandedPathBounds: Bounds): Omit<VectorObjectData, 'id'>[] | null {
  let ringsWorld: Ring[];
  if (data.kind === 'rectangle') {
    ringsWorld = [rectToPolygon(data.points).map((p) => applyTransform(p, data.transform))];
  } else if (data.kind === 'ellipse') {
    ringsWorld = [ellipseToPolygon(data.points).map((p) => applyTransform(p, data.transform))];
  } else {
    ringsWorld = (data.rings ?? []).map((ring) => ring.map((p) => applyTransform(p, data.transform)));
  }
  if (ringsWorld.length === 0 || ringsWorld[0].length === 0) return null;

  if (!boundsOverlap(boundsOf(ringsWorld.flat()), expandedPathBounds)) return null;

  const originalArea = polygonArea(ringsWorld);
  const result = subtractSweep([toPCPolygon(ringsWorld)], originalArea, erasePath, eraseRadius);
  return resolveShapeResult(result, data);
}

/**
 * Returns the fragments that survive erasing `data` with a swept eraser of `eraseRadius` along
 * `erasePath` (world-space throughout — the object's own transform is baked into world coordinates
 * here and reset to identity on any surviving fragment, same convention regardless of kind).
 *
 * Returns `null` when nothing actually changed (including a bbox/near-segment miss) — callers rely
 * on this to skip replacing objects the eraser didn't really touch, which matters because a
 * replace assigns new ids and would otherwise silently break identity-based tracking (e.g. a
 * currently-selected object) for objects the eraser only grazed without truly touching.
 *
 * "Nothing survives" (full deletion) and "nothing changed" (no-op) are deliberately distinguished
 * by two different epsilons (DEGENERATE_AREA_EPSILON vs AREA_EPSILON) — conflating them would risk
 * silently no-op'ing a heavy, mostly-complete erase, or spuriously replacing an untouched object.
 */
export function eraseFromObjectData(data: VectorObjectData, erasePath: { x: number; y: number }[], eraseRadius: number): Omit<VectorObjectData, 'id'>[] | null {
  if (erasePath.length === 0) return null;
  const expandedPathBounds = padBounds(boundsOf(erasePath), eraseRadius);

  if (data.kind === 'stroke') return eraseStroke(data, erasePath, eraseRadius, expandedPathBounds);
  return eraseFilledShape(data, erasePath, eraseRadius, expandedPathBounds);
}

function eraseObjectsInPlace(layer: YLayer, erasePath: { x: number; y: number }[], eraseRadius: number): void {
  const objects = getObjectsArray(layer);
  for (let i = objects.length - 1; i >= 0; i--) {
    const data = vectorObjectToData(objects.get(i));
    const fragments = eraseFromObjectData(data, erasePath, eraseRadius);
    if (fragments === null) continue;

    objects.delete(i, 1);
    const survivors = fragments.filter((f) => f.points.length > 0 || (f.rings?.length ?? 0) > 0).map((f) => createVectorObject(f));
    if (survivors.length > 0) objects.insert(i, survivors);
  }
}

/**
 * A single erase pass can touch many stacked/overlapping objects at once (a dense scribble of
 * many strokes on top of each other, all under the same eraser dab). Each touched object's
 * delete+insert is its own Yjs mutation; without batching, every one of those fires its own
 * 'update' event — and engine.ts's `doc.on('update', () => this.notify())` does a full
 * synchronous re-render per event. With N touched objects that's up to 2N full-canvas repaints
 * for what should visually be a single erase step, which is what made erasing over many
 * overlapping strokes feel slow and jaggy. Wrapping the whole pass in one transaction collapses
 * it to exactly one 'update' (and one repaint), regardless of how many objects it touches.
 */
export function eraseFromLayer(layer: YLayer, erasePath: { x: number; y: number }[], eraseRadius: number): void {
  if (layer.doc) {
    layer.doc.transact(() => eraseObjectsInPlace(layer, erasePath, eraseRadius));
  } else {
    eraseObjectsInPlace(layer, erasePath, eraseRadius);
  }
}
