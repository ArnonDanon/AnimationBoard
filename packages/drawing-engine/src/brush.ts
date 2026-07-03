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
  const widths = points.map((p) => resolvePointWidth(brush, p.pressure));
  const avgWidth = widths.length > 0 ? widths.reduce((a, b) => a + b, 0) / widths.length : brush.baseWidth;
  return {
    color,
    width: avgWidth,
    widths,
    opacity: resolveStrokeOpacity(brush, points),
  };
}
