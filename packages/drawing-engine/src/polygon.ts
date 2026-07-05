import type { MultiPolygon as PCMultiPolygon, Pair, Polygon as PCPolygon } from 'polygon-clipping';
import { getBoundingBox } from './render';
import type { Point } from './types';

/** A closed polygon boundary in domain space. Not required to repeat its first point at the end. */
export type Ring = Point[];

/** [outer, ...holes] — one connected region, matching polygon-clipping's `Polygon`. */
export type Polygon = Ring[];

const MIN_RADIUS = 0.05;

/** Segments per semicircle (a capsule has two caps, so 2x this many arc segments total). */
export const DEFAULT_CAP_SEGMENTS = 8;
export const DEFAULT_ELLIPSE_SEGMENTS = 64;

export function circlePolygon(cx: number, cy: number, r: number, segments: number): Ring {
  const radius = Math.max(r, MIN_RADIUS);
  const ring: Ring = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    ring.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), pressure: 0 });
  }
  return ring;
}

/**
 * A straight segment with round caps on both ends — the same shape Canvas2D already renders for
 * `lineCap: 'round'` / `lineJoin: 'round'` strokes (see render.ts's paintUniformStroke), so fill
 * geometry matches rendered pixels exactly. `capSegments` is the arc resolution per semicircle cap.
 */
export function capsulePolygon(a: { x: number; y: number }, b: { x: number; y: number }, radius: number, capSegments: number): Ring {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return circlePolygon(a.x, a.y, radius, capSegments * 2);

  const r = Math.max(radius, MIN_RADIUS);
  const dirAngle = Math.atan2(dy, dx);
  const nx = (-dy / length) * r;
  const ny = (dx / length) * r;

  const leftA = { x: a.x + nx, y: a.y + ny, pressure: 0 };
  const leftB = { x: b.x + nx, y: b.y + ny, pressure: 0 };
  const rightB = { x: b.x - nx, y: b.y - ny, pressure: 0 };
  const rightA = { x: a.x - nx, y: a.y - ny, pressure: 0 };

  const ring: Ring = [leftA, leftB];
  // Leading cap at b: sweeps from leftB, through the forward direction, to rightB.
  for (let i = 1; i < capSegments; i++) {
    const angle = dirAngle + Math.PI / 2 - Math.PI * (i / capSegments);
    ring.push({ x: b.x + r * Math.cos(angle), y: b.y + r * Math.sin(angle), pressure: 0 });
  }
  ring.push(rightB, rightA);
  // Trailing cap at a: sweeps from rightA, through the backward direction, to leftA.
  for (let i = 1; i < capSegments; i++) {
    const angle = dirAngle - Math.PI / 2 - Math.PI * (i / capSegments);
    ring.push({ x: a.x + r * Math.cos(angle), y: a.y + r * Math.sin(angle), pressure: 0 });
  }
  return ring;
}

/**
 * One capsule per stroke segment (unmerged — polygon-clipping accepts overlapping polygons within
 * one MultiPolygon input directly, no manual union pass needed). Per-segment radius mirrors
 * render.ts's paintVariableWidthSegments, which averages the two endpoint widths rather than
 * tapering smoothly — this keeps fill geometry consistent with what's actually painted.
 */
export function strokeToPolygons(points: Point[], widths: number[], capSegments: number = DEFAULT_CAP_SEGMENTS): Ring[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [circlePolygon(points[0].x, points[0].y, widths[0] / 2, capSegments * 2)];

  const rings: Ring[] = [];
  for (let i = 1; i < points.length; i++) {
    const radius = (widths[i - 1] + widths[i]) / 4;
    rings.push(capsulePolygon(points[i - 1], points[i], radius, capSegments));
  }
  return rings;
}

/** Same primitives as strokeToPolygons, reused directly (not a separate construction) for the
 *  eraser's own swept area — a uniform-radius "stroke" along the erase path. */
export function eraserSweepPolygons(path: { x: number; y: number }[], radius: number, capSegments: number = DEFAULT_CAP_SEGMENTS): Ring[] {
  if (path.length === 0) return [];
  if (path.length === 1) return [circlePolygon(path[0].x, path[0].y, radius, capSegments * 2)];

  const rings: Ring[] = [];
  for (let i = 1; i < path.length; i++) {
    rings.push(capsulePolygon(path[i - 1], path[i], radius, capSegments));
  }
  return rings;
}

/** `corners` is a shape's 2 opposite bounding-box corners (see VectorObjectData.kind). */
export function rectToPolygon(corners: Point[]): Ring {
  const box = getBoundingBox(corners);
  return [
    { x: box.minX, y: box.minY, pressure: 0 },
    { x: box.maxX, y: box.minY, pressure: 0 },
    { x: box.maxX, y: box.maxY, pressure: 0 },
    { x: box.minX, y: box.maxY, pressure: 0 },
  ];
}

export function ellipseToPolygon(corners: Point[], segments: number = DEFAULT_ELLIPSE_SEGMENTS): Ring {
  const box = getBoundingBox(corners);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const rx = (box.maxX - box.minX) / 2;
  const ry = (box.maxY - box.minY) / 2;
  const ring: Ring = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    ring.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), pressure: 0 });
  }
  return ring;
}

/** Shoelace formula — signed area, magnitude only meaningful (winding direction isn't tracked). */
export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** rings[0] = outer boundary, rest = holes — net area regardless of winding convention. */
export function polygonArea(rings: Ring[]): number {
  if (rings.length === 0) return 0;
  let area = Math.abs(ringArea(rings[0]));
  for (let i = 1; i < rings.length; i++) area -= Math.abs(ringArea(rings[i]));
  return Math.max(area, 0);
}

export function multiPolygonArea(polygons: Ring[][]): number {
  return polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
}

export function toPCPolygon(rings: Ring[]): PCPolygon {
  return rings.map((ring) => ring.map((p): Pair => [p.x, p.y]));
}

export function fromPCPolygon(polygon: PCPolygon): Ring[] {
  return polygon.map((ring) => ring.map(([x, y]): Point => ({ x, y, pressure: 0 })));
}

/** Wraps each independent ring as its own single-ring (no-holes) polygon within a MultiPolygon —
 *  the shape a set of unmerged capsules needs to be handed to polygon-clipping as one input. */
export function ringsAsMultiPolygon(rings: Ring[]): PCMultiPolygon {
  return rings.map((ring) => toPCPolygon([ring]));
}

export function fromPCMultiPolygon(multiPolygon: PCMultiPolygon): Polygon[] {
  return multiPolygon.map(fromPCPolygon);
}
