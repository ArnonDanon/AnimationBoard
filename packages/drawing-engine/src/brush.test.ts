import { describe, expect, it } from 'vitest';
import { BUILT_IN_BRUSHES, resolvePointWidth, resolveStrokeOpacity, resolveStrokeStyle } from './brush';
import type { Brush, Point } from './types';

const pencil = BUILT_IN_BRUSHES.find((b) => b.id === 'brush-pencil') as Brush;
const marker = BUILT_IN_BRUSHES.find((b) => b.id === 'brush-marker') as Brush;
const ink = BUILT_IN_BRUSHES.find((b) => b.id === 'brush-ink') as Brush;

describe('built-in brushes', () => {
  it('ships exactly three brushes, at least one pressure-sensitive', () => {
    expect(BUILT_IN_BRUSHES).toHaveLength(3);
    expect(BUILT_IN_BRUSHES.some((b) => b.pressureSensitive)).toBe(true);
  });
});

describe('resolvePointWidth', () => {
  it('varies with pressure for a width-sensitive brush', () => {
    const light = resolvePointWidth(pencil, 0);
    const heavy = resolvePointWidth(pencil, 1);
    expect(heavy).toBeGreaterThan(light);
  });

  it('ignores pressure for a non-pressure-sensitive brush', () => {
    expect(resolvePointWidth(marker, 0)).toBe(marker.baseWidth);
    expect(resolvePointWidth(marker, 1)).toBe(marker.baseWidth);
  });

  it('ignores pressure for width when the brush only maps pressure to opacity', () => {
    const opacityOnlyBrush: Brush = { ...pencil, pressureAffects: 'opacity' };
    expect(resolvePointWidth(opacityOnlyBrush, 0)).toBe(opacityOnlyBrush.baseWidth);
    expect(resolvePointWidth(opacityOnlyBrush, 1)).toBe(opacityOnlyBrush.baseWidth);
  });
});

describe('resolveStrokeOpacity', () => {
  const points: Point[] = [{ x: 0, y: 0, pressure: 0.2 }, { x: 1, y: 1, pressure: 0.8 }];

  it('varies with average pressure for an opacity-sensitive brush', () => {
    const low = resolveStrokeOpacity(ink, [{ x: 0, y: 0, pressure: 0.1 }]);
    const high = resolveStrokeOpacity(ink, [{ x: 0, y: 0, pressure: 1 }]);
    expect(high).toBeGreaterThan(low);
  });

  it('ignores pressure for a width-only brush', () => {
    expect(resolveStrokeOpacity(pencil, points)).toBe(pencil.opacity);
  });
});

describe('resolveStrokeStyle', () => {
  it('bakes a resolved, non-live style: mutating the brush afterwards does not affect it', () => {
    const points: Point[] = [{ x: 0, y: 0, pressure: 1 }, { x: 5, y: 5, pressure: 1 }];
    const brush = { ...pencil };
    const style = resolveStrokeStyle(brush, points, '#123456');

    brush.baseWidth = 999;

    expect(style.color).toBe('#123456');
    expect(style.widths).toHaveLength(points.length);
    expect(style.width).not.toBe(999);
  });
});
