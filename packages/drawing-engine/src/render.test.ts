import { describe, expect, it } from 'vitest';
import { getTransformPivot } from './render';
import type { Point } from './types';

function pt(x: number, y: number): Point {
  return { x, y, pressure: 1 };
}

// Mirrors exactly how withObjectTransform composes ctx.translate/rotate/scale calls:
// screen = R(S(p - pivot)) + pivot + (transform.x, transform.y)
// (canvas transforms apply to a drawn point in reverse call order — the last call made
// is the first one applied to the point).
function applyTransform(
  p: Point,
  pivot: { x: number; y: number },
  transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number },
): { x: number; y: number } {
  const rad = (transform.rotation * Math.PI) / 180;
  const dx = (p.x - pivot.x) * transform.scaleX;
  const dy = (p.y - pivot.y) * transform.scaleY;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  return { x: rx + pivot.x + transform.x, y: ry + pivot.y + transform.y };
}

describe('getTransformPivot', () => {
  it('is the bounding-box center of a rectangle/ellipse\'s 2 corner points, not the origin', () => {
    expect(getTransformPivot([pt(100, 100), pt(140, 120)])).toEqual({ x: 120, y: 110 });
  });

  it('is the bounding-box center of a multi-point stroke', () => {
    expect(getTransformPivot([pt(0, 0), pt(20, 0), pt(10, 10)])).toEqual({ x: 10, y: 5 });
  });

  it('is the point itself for a single-point stroke (a dot)', () => {
    expect(getTransformPivot([pt(37, -12)])).toEqual({ x: 37, y: -12 });
  });
});

describe('rotation pivot (regression for swinging around canvas origin)', () => {
  const points = [pt(100, 100), pt(140, 120)]; // center (120, 110), far from canvas origin
  const pivot = getTransformPivot(points);
  const transform = { x: 0, y: 0, rotation: 180, scaleX: 1, scaleY: 1 };

  it('keeps the object\'s own center fixed under a 180° rotation', () => {
    const center = applyTransform(pt(120, 110), pivot, transform);
    expect(center.x).toBeCloseTo(120);
    expect(center.y).toBeCloseTo(110);
  });

  it('swaps opposite corners in place instead of relocating near the canvas origin', () => {
    const rotatedCorner = applyTransform(pt(100, 100), pivot, transform);
    expect(rotatedCorner.x).toBeCloseTo(140);
    expect(rotatedCorner.y).toBeCloseTo(120);

    // The old bug pivoted around the canvas origin (0,0) instead of the object's center,
    // which for this far-from-origin shape would land nowhere near either corner.
    const buggyOriginPivot = applyTransform(pt(100, 100), { x: 0, y: 0 }, transform);
    expect(buggyOriginPivot.x).toBeCloseTo(-100);
    expect(buggyOriginPivot.y).toBeCloseTo(-100);
  });
});
