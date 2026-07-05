import type { Brush, Point, Style } from './types';

export const BUILT_IN_BRUSHES: Brush[] = [
  {
    id: 'brush-pencil',
    ownerId: null,
    name: 'Pencil',
    shape: 'round',
    baseWidth: 2,
    opacity: 1,
    pressureSensitive: true,
    pressureAffects: 'width',
    widthSource: 'pressure',
  },
  {
    id: 'brush-marker',
    ownerId: null,
    name: 'Marker',
    shape: 'round',
    baseWidth: 10,
    opacity: 0.85,
    pressureSensitive: false,
    pressureAffects: 'width',
    widthSource: 'pressure',
  },
  {
    id: 'brush-ink',
    ownerId: null,
    name: 'Ink Brush',
    shape: 'round',
    baseWidth: 6,
    opacity: 1,
    pressureSensitive: true,
    pressureAffects: 'both',
    widthSource: 'pressure',
  },
  {
    id: 'brush-mapping-pen',
    ownerId: null,
    name: 'Mapping Pen',
    shape: 'round',
    baseWidth: 3,
    opacity: 1,
    pressureSensitive: false,
    pressureAffects: 'width',
    widthSource: 'directional',
  },
];

export const DEFAULT_BRUSH: Brush = BUILT_IN_BRUSHES[0];

const MIN_WIDTH_FACTOR = 0.3;
const MAX_WIDTH_FACTOR = 1.6;
const MIN_OPACITY_FACTOR = 0.35;

function affectsWidth(brush: Brush): boolean {
  return brush.pressureSensitive && (brush.pressureAffects === 'width' || brush.pressureAffects === 'both');
}

function affectsOpacity(brush: Brush): boolean {
  return brush.pressureSensitive && (brush.pressureAffects === 'opacity' || brush.pressureAffects === 'both');
}

export function resolvePointWidth(brush: Brush, pressure: number): number {
  if (!affectsWidth(brush)) return brush.baseWidth;
  const factor = MIN_WIDTH_FACTOR + pressure * (MAX_WIDTH_FACTOR - MIN_WIDTH_FACTOR);
  return brush.baseWidth * factor;
}

// Mapping Pen: emulates a real nib pen (e.g. IbisPaint's mapping pen / a G-pen) held at
// a fixed angle rather than deriving width from pen pressure. A flat nib dragged
// perpendicular to its edge lays down the widest line, dragged parallel to its edge lays
// down the thinnest, and slower strokes pool thicker than fast ones — so width comes from
// the stroke's direction and speed instead.
const NIB_ANGLE = Math.PI / 4;
const DIRECTIONAL_MIN_FACTOR = 0.25;
const DIRECTIONAL_MAX_FACTOR = 1.75;
// Per-sample pointer-move distance (px) treated as "fast" (thinnest line). There's no
// per-point timestamp in Point, so distance between consecutive samples stands in for
// speed — pointermove fires at a roughly steady rate, so a bigger gap means a faster drag.
const SPEED_SATURATION_DISTANCE = 40;

function directionalSegmentFactor(prev: Point, next: Point): number {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return 0.5;

  const theta = Math.atan2(dy, dx);
  const angleFactor = Math.abs(Math.sin(theta - NIB_ANGLE));
  const speedFactor = 1 - Math.min(distance / SPEED_SATURATION_DISTANCE, 1);
  return angleFactor * 0.6 + speedFactor * 0.4;
}

function resolveDirectionalWidths(brush: Brush, points: Point[]): number[] {
  if (points.length <= 1) return points.map(() => brush.baseWidth);

  const segmentFactors: number[] = [];
  for (let i = 1; i < points.length; i++) {
    segmentFactors.push(directionalSegmentFactor(points[i - 1], points[i]));
  }

  return points.map((_, i) => {
    const before = segmentFactors[i - 1];
    const after = segmentFactors[i];
    const factor = before !== undefined && after !== undefined ? (before + after) / 2 : (before ?? after);
    const scaled = DIRECTIONAL_MIN_FACTOR + factor * (DIRECTIONAL_MAX_FACTOR - DIRECTIONAL_MIN_FACTOR);
    return brush.baseWidth * scaled;
  });
}

// Opacity responds to the stroke's average pressure rather than varying per point —
// Canvas2D has no per-vertex alpha for a single fill/stroke call, and per-point opacity
// would mean compositing many overlapping translucent segments, which is a real cost
// for a POC feature that only needs to demonstrate "pressure affects opacity."
export function resolveStrokeOpacity(brush: Brush, points: Point[]): number {
  if (!affectsOpacity(brush) || points.length === 0) return brush.opacity;
  const avgPressure = points.reduce((sum, p) => sum + p.pressure, 0) / points.length;
  const factor = MIN_OPACITY_FACTOR + avgPressure * (1 - MIN_OPACITY_FACTOR);
  return brush.opacity * factor;
}

export function resolveStrokeStyle(brush: Brush, points: Point[], color: string): Style {
  const widths = brush.widthSource === 'directional'
    ? resolveDirectionalWidths(brush, points)
    : points.map((p) => resolvePointWidth(brush, p.pressure));
  const avgWidth = widths.length > 0 ? widths.reduce((a, b) => a + b, 0) / widths.length : brush.baseWidth;
  return {
    color,
    width: avgWidth,
    widths,
    opacity: resolveStrokeOpacity(brush, points),
  };
}
