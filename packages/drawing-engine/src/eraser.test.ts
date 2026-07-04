import { describe, expect, it } from 'vitest';
import { eraseFromLayer, eraseFromObjectData } from './eraser';
import { addLayer, createDocument, createVectorObject, getFramesArray, getLayersArray, getObjectsArray, vectorObjectToData } from './document';
import { DEFAULT_TRANSFORM } from './types';
import type { VectorObjectData } from './types';

function makeStroke(points: { x: number; y: number }[], width = 0): VectorObjectData {
  return {
    id: 'stroke-1',
    kind: 'stroke',
    points: points.map((p) => ({ ...p, pressure: 1 })),
    style: { color: '#000', width, opacity: 1 },
    transform: { ...DEFAULT_TRANSFORM },
    createdBy: 'animator-1',
  };
}

function xRange(points: { x: number }[]): [number, number] {
  const xs = points.map((p) => p.x);
  return [Math.min(...xs), Math.max(...xs)];
}

function makeShape(kind: 'rectangle' | 'ellipse', corners: [{ x: number; y: number }, { x: number; y: number }]): VectorObjectData {
  return {
    id: 'shape-1',
    kind,
    points: corners.map((p) => ({ ...p, pressure: 1 })),
    style: { color: '#000', width: 1, opacity: 1 },
    transform: { ...DEFAULT_TRANSFORM },
    createdBy: 'animator-1',
  };
}

describe('eraseFromObjectData', () => {
  it('returns null when the eraser path misses the stroke entirely', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 1000, y: 1000 }], 5);
    expect(result).toBeNull();
  });

  it('returns an empty array when the eraser fully covers the stroke (whole-object removal, not a special case)', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);
    expect(result).toEqual([]);
  });

  it('does not erase beyond the eraser radius, even for a stroke with widely-spaced points', () => {
    // Regression test: erasing used to mark a whole segment's endpoints erased if any
    // part of it was touched, so a long segment (as a fast/coarse stroke produces)
    // could lose far more than the visible eraser circle — e.g. minimum-size erasing
    // sometimes deleted almost everything nearby. Precision must now be bounded by a
    // small fixed amount, not by how sparse the original stroke happened to be.
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    const radius = 4;
    const eraseCenter = 100;
    const result = eraseFromObjectData(stroke, [{ x: eraseCenter, y: 0 }], radius);
    expect(result).toHaveLength(2);
    const [, leftMax] = xRange(result![0].points);
    const [rightMin] = xRange(result![1].points);
    expect(leftMax).toBeLessThan(eraseCenter);
    expect(rightMin).toBeGreaterThan(eraseCenter);
    // The gap should be roughly 2x the radius, not "most of the 200px stroke".
    expect(rightMin - leftMax).toBeLessThan(radius * 4);
  });

  it('widens the hit test by the stroke half-width, so erasing removes ink wherever it visually touches, not just at the centerline', () => {
    // A thick stroke (width 20, half-width 10): its rendered ink extends 10px past
    // its centerline, so an eraser whose circle visually overlaps that ink should
    // remove it even though the eraser's *center* is farther than its radius from
    // the centerline. 8px off centerline, radius 2 -> effective reach 2+10=12, hits.
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 1000, y: 0 }], 20);
    const hit = eraseFromObjectData(stroke, [{ x: 50, y: 8 }], 2);
    expect(hit).toHaveLength(2); // splits around x=50; the far point at x=1000 survives in the second fragment
    const [, max] = xRange(hit![1].points);
    expect(max).toBeCloseTo(1000, 0);

    // But it's still bounded, not unlimited: well beyond radius + half-width, it misses.
    const miss = eraseFromObjectData(stroke, [{ x: 50, y: 50 }], 2);
    expect(miss).toBeNull();
  });

  it('erases a stroke even when the eraser passes through the middle of a segment, nowhere near any sample point', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 50, y: 0 }], 5);
    expect(result).toHaveLength(2); // splits, rather than being missed entirely (the original bug)
    const [, leftMax] = xRange(result![0].points);
    const [rightMin] = xRange(result![1].points);
    expect(leftMax).toBeLessThan(50);
    expect(rightMin).toBeGreaterThan(50);
  });

  it('splits a stroke into two fragments when the eraser cuts through one segment in the middle', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 125, y: 0 }], 4);
    expect(result).toHaveLength(2);
    const [leftMin, leftMax] = xRange(result![0].points);
    const [rightMin, rightMax] = xRange(result![1].points);
    expect(leftMin).toBeCloseTo(0, 0);
    expect(leftMax).toBeLessThan(125);
    expect(rightMin).toBeGreaterThan(125);
    expect(rightMax).toBeCloseTo(200, 0);
  });

  it('trims the tail when the eraser touches right at the stroke\'s endpoint', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 150, y: 0 }], 4);
    expect(result).toHaveLength(1);
    const [min, max] = xRange(result![0].points);
    expect(min).toBeCloseTo(0, 0);
    expect(max).toBeLessThan(150);
  });

  it('leaves a small untouched tip as its own fragment instead of deleting the whole rest of a long segment', () => {
    // The regression this guards against: erasing at x=140 with radius 4 must not
    // also remove the tip at x=150 (10px away, outside the radius).
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 140, y: 0 }], 4);
    expect(result).toHaveLength(2);
    const [, bodyMax] = xRange(result![0].points);
    const [tipMin, tipMax] = xRange(result![1].points);
    expect(bodyMax).toBeLessThan(136);
    expect(tipMin).toBeGreaterThan(144);
    expect(tipMax).toBeCloseTo(150, 0);
  });

  it('bakes the object transform into surviving fragment points and resets to identity', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 1000, y: 0 }]);
    stroke.transform = { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0 };

    const missed = eraseFromObjectData(stroke, [{ x: 9999, y: 9999 }], 3);
    expect(missed).toBeNull();

    const hit = eraseFromObjectData(stroke, [{ x: 100, y: 50 }], 3);
    expect(hit).toHaveLength(1);
    expect(hit![0].transform).toEqual(DEFAULT_TRANSFORM);
    const [, max] = xRange(hit![0].points);
    expect(max).toBeCloseTo(1100, 0); // 1000 (local) + 100 (translate) — the surviving far point
  });

  it('carries per-point widths into the split fragments with matching lengths', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }]);
    stroke.style.widths = [2, 4, 6, 8, 10];
    const result = eraseFromObjectData(stroke, [{ x: 125, y: 0 }], 2);
    expect(result).toHaveLength(2);
    for (const fragment of result!) {
      expect(fragment.style.widths).toHaveLength(fragment.points.length);
    }
  });
});

describe('eraseFromObjectData — rectangle/ellipse (whole-object erase, no partial trim)', () => {
  it('deletes a rectangle entirely when the eraser touches its interior', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    const result = eraseFromObjectData(rect, [{ x: 50, y: 50 }], 5);
    expect(result).toEqual([]); // whole-object removal, never a partial fragment
  });

  it('deletes a rectangle when the eraser is just within radius of its boundary', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    const result = eraseFromObjectData(rect, [{ x: -3, y: 50 }], 5); // 3px outside the left edge, radius 5
    expect(result).toEqual([]);
  });

  it('leaves a rectangle untouched when the eraser is outside its radius', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    const result = eraseFromObjectData(rect, [{ x: -10, y: 50 }], 5); // 10px outside, radius 5
    expect(result).toBeNull();
  });

  it('deletes an ellipse entirely when the eraser touches its interior', () => {
    const ellipse = makeShape('ellipse', [{ x: 0, y: 0 }, { x: 100, y: 100 }]); // center (50,50), rx=ry=50
    const result = eraseFromObjectData(ellipse, [{ x: 50, y: 50 }], 5);
    expect(result).toEqual([]);
  });

  it('leaves an ellipse untouched when the eraser is outside its radius (corner of the bounding box, outside the inscribed ellipse)', () => {
    const ellipse = makeShape('ellipse', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    // The bounding box's corner (0,0) is outside the inscribed circle (dist from
    // center (50,50) is ~70.7, radius 50) — exactly the case isPointInPath would
    // reject too, distinguishing the ellipse dispatch from a naive rect check.
    const result = eraseFromObjectData(ellipse, [{ x: 0, y: 0 }], 1);
    expect(result).toBeNull();
  });

  it('bakes the shape\'s transform into the world-space hit test', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    rect.transform = { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0 };
    const missedAtLocalOrigin = eraseFromObjectData(rect, [{ x: 5, y: 5 }], 1);
    expect(missedAtLocalOrigin).toBeNull(); // (5,5) is only inside pre-transform local space
    const hitAtWorldPosition = eraseFromObjectData(rect, [{ x: 105, y: 105 }], 1);
    expect(hitAtWorldPosition).toEqual([]);
  });
});

describe('eraseFromLayer', () => {
  it('removes a fully-erased object and keeps an untouched one unchanged', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);

    objects.push([
      createVectorObject(makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }])),
      createVectorObject(makeStroke([{ x: 500, y: 500 }, { x: 510, y: 500 }])),
    ]);

    eraseFromLayer(layer, [{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);

    expect(objects.length).toBe(1);
    expect(vectorObjectToData(objects.get(0)).points[0].x).toBe(500);
  });

  it('splitting a stroke replaces one object with two in the layer', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);
    objects.push([
      createVectorObject(makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }])),
    ]);

    eraseFromLayer(layer, [{ x: 125, y: 0 }], 4);

    expect(objects.length).toBe(2);
  });

  it('does not touch objects in a different layer', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    const layer1 = getLayersArray(frame).get(0);
    const layer2 = addLayer(frame, 'Layer 2');
    getObjectsArray(layer1).push([createVectorObject(makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]))]);
    getObjectsArray(layer2).push([createVectorObject(makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]))]);

    eraseFromLayer(layer1, [{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);

    expect(getObjectsArray(layer1).length).toBe(0);
    expect(getObjectsArray(layer2).length).toBe(1);
  });
});
