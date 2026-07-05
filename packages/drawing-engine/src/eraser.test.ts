import { describe, expect, it } from 'vitest';
import { eraseFromLayer, eraseFromObjectData } from './eraser';
import { addLayer, createDocument, createVectorObject, getFramesArray, getLayersArray, getObjectsArray, vectorObjectToData } from './document';
import { DEFAULT_TRANSFORM } from './types';
import type { Point, VectorObjectData } from './types';

function makeStroke(points: { x: number; y: number }[], width = 2): VectorObjectData {
  return {
    id: 'stroke-1',
    kind: 'stroke',
    points: points.map((p) => ({ ...p, pressure: 1 })),
    style: { color: '#000', width, opacity: 1 },
    transform: { ...DEFAULT_TRANSFORM },
    createdBy: 'animator-1',
  };
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

// --- Geometry helpers for verifying *coverage*, mirroring what the renderer/hit-tester do,
// without needing an actual CanvasRenderingContext2D (unavailable in this node test environment). ---

function pointInRing(ring: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Even-odd rule across all rings, matching paintFilledPath's fill rule. */
function pointInRings(rings: Point[][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    if (pointInRing(ring, x, y)) inside = !inside;
  }
  return inside;
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

function pointNearStroke(fragment: Omit<VectorObjectData, 'id'>, x: number, y: number): boolean {
  const pts = fragment.points;
  const widths = fragment.style.widths ?? pts.map(() => fragment.style.width);
  if (pts.length === 0) return false;
  if (pts.length === 1) return Math.hypot(pts[0].x - x, pts[0].y - y) <= widths[0] / 2;
  for (let i = 1; i < pts.length; i++) {
    const halfWidth = (widths[i - 1] + widths[i]) / 4;
    if (distanceToSegment({ x, y }, pts[i - 1], pts[i]) <= halfWidth) return true;
  }
  return false;
}

/** Is (x, y) covered by any surviving fragment, regardless of whether it landed as a raw
 *  untouched 'stroke' or a boolean-subtracted 'filledPath'? */
function isCovered(fragments: Omit<VectorObjectData, 'id'>[], x: number, y: number): boolean {
  return fragments.some((f) => (f.kind === 'filledPath' ? pointInRings(f.rings ?? [], x, y) : pointNearStroke(f, x, y)));
}

describe('eraseFromObjectData — stroke', () => {
  it('returns null when the eraser path misses the stroke entirely', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 1000, y: 1000 }], 5);
    expect(result).toBeNull();
  });

  it('returns an empty array when the eraser fully covers the stroke (whole-object removal)', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 0, y: 0 }, { x: 10, y: 0 }], 5);
    expect(result).toEqual([]);
  });

  it('carves a bounded gap around the erase center, not the whole stroke (real boolean subtraction, not old whole-segment deletion)', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 200, y: 0 }], 2);
    const radius = 4;
    const result = eraseFromObjectData(stroke, [{ x: 100, y: 0 }], radius);
    expect(result).not.toBeNull();
    expect(isCovered(result!, 90, 0)).toBe(true);
    expect(isCovered(result!, 100, 0)).toBe(false);
    expect(isCovered(result!, 110, 0)).toBe(true);
    // Bounded: well past the visible eraser circle, on both sides, ink still survives.
    expect(isCovered(result!, 0, 0)).toBe(true);
    expect(isCovered(result!, 200, 0)).toBe(true);
  });

  it('shaves only the touched portion of a strongly tapered stroke — true partial-width erasing', () => {
    // Width tapers 2 -> 20 across several segments; a small dab near the wide end, off-center
    // but within its rendered half-width, used to either miss (centerline-only test) or delete
    // the whole segment (old whole-segment-at-full-width deletion). Now it should notch out only
    // the locally touched ink.
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 50, y: 0 }, { x: 75, y: 0 }, { x: 100, y: 0 }]);
    stroke.style.widths = [2, 6, 11, 16, 20];
    const dabX = 90;
    const dabY = 8; // within the wide end's ~9px half-width, well off the centerline
    const result = eraseFromObjectData(stroke, [{ x: dabX, y: dabY }], 1);
    expect(result).not.toBeNull();
    expect(isCovered(result!, dabX, dabY)).toBe(false);
    // Nearby ink at the same wide end, away from the dab, survives.
    expect(isCovered(result!, 90, -8)).toBe(true);
    // The narrow end, far from the dab, is completely untouched.
    expect(isCovered(result!, 5, 0)).toBe(true);
  });

  it('splits a stroke into two disconnected survivors when cut through the middle, both ends intact', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 125, y: 0 }], 4);
    expect(result).not.toBeNull();
    expect(isCovered(result!, 0, 0)).toBe(true);
    expect(isCovered(result!, 200, 0)).toBe(true);
    expect(isCovered(result!, 125, 0)).toBe(false);
    expect(isCovered(result!, 118, 0)).toBe(true);
    expect(isCovered(result!, 132, 0)).toBe(true);
  });

  it('trims only the tail when the eraser touches right at the stroke\'s endpoint', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 150, y: 0 }], 4);
    expect(result).not.toBeNull();
    expect(isCovered(result!, 0, 0)).toBe(true);
    expect(isCovered(result!, 100, 0)).toBe(true);
    expect(isCovered(result!, 150, 0)).toBe(false);
  });

  it('leaves an untouched far segment covered even when a near segment right next to it is erased (near/far boundary has no gap)', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 50, y: 0 }, { x: 75, y: 0 }, { x: 100, y: 0 }]);
    const result = eraseFromObjectData(stroke, [{ x: 50, y: 0 }], 10);
    expect(result).not.toBeNull();
    // Far ranges (well outside the eraser's reach) stay fully covered right up to the boundary.
    expect(isCovered(result!, 2, 0)).toBe(true);
    expect(isCovered(result!, 98, 0)).toBe(true);
    // The touched middle is gone.
    expect(isCovered(result!, 50, 0)).toBe(false);
  });

  it('does not erase beyond the eraser radius, even for a stroke with widely-spaced points', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 200, y: 0 }], 0.1);
    const result = eraseFromObjectData(stroke, [{ x: 100, y: 0 }], 4);
    expect(result).not.toBeNull();
    expect(isCovered(result!, 80, 0)).toBe(true);
    expect(isCovered(result!, 120, 0)).toBe(true);
  });

  it('bakes the object transform into surviving fragment points and resets to identity', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 1000, y: 0 }]);
    stroke.transform = { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0 };

    const missed = eraseFromObjectData(stroke, [{ x: 9999, y: 9999 }], 3);
    expect(missed).toBeNull();

    const hit = eraseFromObjectData(stroke, [{ x: 100, y: 50 }], 3);
    expect(hit).not.toBeNull();
    for (const fragment of hit!) expect(fragment.transform).toEqual(DEFAULT_TRANSFORM);
    // The far point (local 1000,0 -> world 1100,50) survives, untouched, as its own fragment.
    expect(isCovered(hit!, 1100, 50)).toBe(true);
    expect(isCovered(hit!, 100, 50)).toBe(false);
  });

  it('carries per-point widths into untouched far-run stroke fragments with matching lengths', () => {
    const stroke = makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }]);
    stroke.style.widths = [2, 4, 6, 8, 10];
    const result = eraseFromObjectData(stroke, [{ x: 125, y: 0 }], 2);
    expect(result).not.toBeNull();
    for (const fragment of result!) {
      if (fragment.kind === 'stroke') expect(fragment.style.widths).toHaveLength(fragment.points.length);
    }
  });
});

describe('eraseFromObjectData — rectangle/ellipse (real partial trim via boolean subtraction)', () => {
  it('punches a hole when the eraser dab lands entirely inside a rectangle\'s interior', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    const result = eraseFromObjectData(rect, [{ x: 50, y: 50 }], 10);
    expect(result).toHaveLength(1);
    expect(result![0].kind).toBe('filledPath');
    expect(result![0].rings).toHaveLength(2); // outer boundary + one hole
    expect(pointInRings(result![0].rings!, 50, 50)).toBe(false); // hole center: not filled
    expect(pointInRings(result![0].rings!, 5, 5)).toBe(true); // far corner: still filled
    expect(pointInRings(result![0].rings!, 65, 50)).toBe(true); // just past the hole's edge: still filled
  });

  it('carves a partial notch (not a whole-object delete) when the eraser only grazes an edge', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    // 3px outside the left edge, radius 5 -> reaches 2px into the interior along that edge only.
    const result = eraseFromObjectData(rect, [{ x: -3, y: 50 }], 5);
    expect(result).not.toBeNull();
    expect(result).not.toEqual([]); // real partial survivor, not the old whole-object delete
    expect(pointInRings(result![0].rings!, 50, 50)).toBe(true); // far interior untouched
    expect(pointInRings(result![0].rings!, 1, 50)).toBe(false); // right at the notch: gone
  });

  it('leaves a rectangle untouched when the eraser is outside its radius', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    const result = eraseFromObjectData(rect, [{ x: -10, y: 50 }], 5);
    expect(result).toBeNull();
  });

  it('deletes a rectangle entirely when the eraser dab covers it completely', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const result = eraseFromObjectData(rect, [{ x: 5, y: 5 }], 20);
    expect(result).toEqual([]);
  });

  it('punches a hole in an ellipse\'s interior', () => {
    const ellipse = makeShape('ellipse', [{ x: 0, y: 0 }, { x: 100, y: 100 }]); // center (50,50), rx=ry=50
    const result = eraseFromObjectData(ellipse, [{ x: 50, y: 50 }], 10);
    expect(result).toHaveLength(1);
    expect(result![0].rings).toHaveLength(2);
    expect(pointInRings(result![0].rings!, 50, 50)).toBe(false);
  });

  it('leaves an ellipse untouched when the eraser is outside its radius (bounding-box corner, outside the inscribed ellipse)', () => {
    const ellipse = makeShape('ellipse', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    const result = eraseFromObjectData(ellipse, [{ x: 0, y: 0 }], 1);
    expect(result).toBeNull();
  });

  it('bakes the shape\'s transform into the world-space subtraction', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    rect.transform = { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0 };
    const missedAtLocalOrigin = eraseFromObjectData(rect, [{ x: 5, y: 5 }], 1);
    expect(missedAtLocalOrigin).toBeNull(); // (5,5) is only inside pre-transform local space
    const hitAtWorldPosition = eraseFromObjectData(rect, [{ x: 105, y: 105 }], 20);
    expect(hitAtWorldPosition).toEqual([]); // fully covers the small 10x10 shape at its world position
  });
});

describe('eraseFromObjectData — re-erasing filledPath objects', () => {
  it('further erodes an already-erased filledPath (a hole punched twice grows correctly)', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    const firstPass = eraseFromObjectData(rect, [{ x: 50, y: 50 }], 10);
    expect(firstPass).toHaveLength(1);

    const filledPath: VectorObjectData = { ...firstPass![0], id: 'filled-1' };
    const secondPass = eraseFromObjectData(filledPath, [{ x: 50, y: 50 }], 20);
    expect(secondPass).toHaveLength(1);
    expect(pointInRings(secondPass![0].rings!, 50, 50)).toBe(false);
    // The larger second dab reaches further than the first (radius 20 vs. 10).
    expect(pointInRings(secondPass![0].rings!, 35, 50)).toBe(false);
    expect(pointInRings(secondPass![0].rings!, 5, 5)).toBe(true);
  });

  it('re-bakes the transform on every pass, so a moved filledPath erases correctly at its new world position', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    const firstPass = eraseFromObjectData(rect, [{ x: 50, y: 50 }], 10);
    const movedData: VectorObjectData = {
      ...firstPass![0],
      id: 'filled-1',
      transform: { x: 1000, y: 1000, scaleX: 1, scaleY: 1, rotation: 0 },
    };

    // A dab at the pre-move world position now misses entirely (nothing left there).
    expect(eraseFromObjectData(movedData, [{ x: 50, y: 50 }], 10)).toBeNull();
    // A dab at the (still-solid) corner only lines up with real ink once the transform is
    // re-baked to the object's new, post-move world position.
    const result = eraseFromObjectData(movedData, [{ x: 1005, y: 1005 }], 3);
    expect(result).not.toBeNull();
    expect(pointInRings(result![0].rings!, 1005, 1005)).toBe(false);
    expect(pointInRings(result![0].rings!, 1050, 1050)).toBe(false); // the original hole survives too
  });
});

describe('eraseFromObjectData — degenerate results', () => {
  it('resolves a near-total erase down to a thin sliver as full deletion, not a leftover fragment', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    // A dab radius comfortably larger than the shape itself leaves at most a sliver, if anything.
    const result = eraseFromObjectData(rect, [{ x: 5, y: 5 }], 15);
    expect(result).toEqual([]);
  });

  it('a clear miss is still null, distinct from a full-deletion empty array', () => {
    const rect = makeShape('rectangle', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const result = eraseFromObjectData(rect, [{ x: 1000, y: 1000 }], 5);
    expect(result).toBeNull();
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

  it('punching a hole in a rectangle keeps it as one object (a hole doesn\'t split it)', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);
    objects.push([createVectorObject(makeShape('rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }]))]);

    eraseFromLayer(layer, [{ x: 50, y: 50 }], 10);

    expect(objects.length).toBe(1);
    expect(vectorObjectToData(objects.get(0)).kind).toBe('filledPath');
  });

  it('a mid-stroke cut produces disconnected survivors in the layer', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);
    objects.push([createVectorObject(makeStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 200, y: 0 }]))]);

    eraseFromLayer(layer, [{ x: 125, y: 0 }], 4);

    expect(objects.length).toBeGreaterThan(1);
    const survivors = objects.toArray().map((o) => vectorObjectToData(o));
    expect(isCovered(survivors, 0, 0)).toBe(true);
    expect(isCovered(survivors, 200, 0)).toBe(true);
    expect(isCovered(survivors, 125, 0)).toBe(false);
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

describe('eraseFromLayer — perf smoke test', () => {
  it('stays fast across a handful of ordinary strokes', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);
    for (let s = 0; s < 5; s++) {
      const pts = Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: s * 20 }));
      objects.push([createVectorObject(makeStroke(pts))]);
    }

    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      eraseFromLayer(layer, [{ x: i * 5, y: 40 }, { x: i * 5 + 2, y: 40 }], 5);
    }
    const elapsedMs = performance.now() - start;
    expect(elapsedMs / 20).toBeLessThan(50); // generous ceiling — catching a gross regression, not micro-benchmarking
  });

  it('a long single stroke stays fast, confirming the near/far split bounds cost regardless of total point count', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);
    const longStroke = Array.from({ length: 800 }, (_, i) => ({ x: i, y: 0 }));
    objects.push([createVectorObject(makeStroke(longStroke))]);

    const start = performance.now();
    eraseFromLayer(layer, [{ x: 400, y: 0 }, { x: 402, y: 0 }], 5);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(200);
  });

  it('touching many overlapping strokes at once fires exactly one doc update, not one per touched object', () => {
    // Regression guard: eraseFromLayer used to mutate each touched object's delete+insert as its
    // own untransacted Yjs edit, so N overlapping objects under one dab fired ~2N 'update' events
    // — each triggering a full synchronous re-render in engine.ts — turning a single erase step
    // into dozens of redundant repaints and making dense, stacked strokes feel slow and jaggy.
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);
    for (let i = 0; i < 40; i++) {
      const y = 100 + (i % 3);
      objects.push([createVectorObject(makeStroke([{ x: 100, y }, { x: 300, y }, { x: 500, y }], 18))]);
    }

    let updateCount = 0;
    doc.on('update', () => updateCount++);
    eraseFromLayer(layer, [{ x: 90, y: 100 }, { x: 510, y: 100 }], 20);

    expect(updateCount).toBe(1);
  });

  it('stays fast across many overlapping strokes under one eraser dab', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);
    for (let i = 0; i < 40; i++) {
      const y = 100 + (i % 3);
      objects.push([createVectorObject(makeStroke([{ x: 100, y }, { x: 300, y }, { x: 500, y }], 18))]);
    }

    const ticks = [
      [{ x: 90, y: 95 }, { x: 150, y: 100 }],
      [{ x: 150, y: 100 }, { x: 250, y: 105 }],
      [{ x: 250, y: 105 }, { x: 350, y: 100 }],
      [{ x: 350, y: 100 }, { x: 450, y: 95 }],
      [{ x: 450, y: 95 }, { x: 510, y: 100 }],
    ];
    const start = performance.now();
    for (const path of ticks) eraseFromLayer(layer, path, 20);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs / ticks.length).toBeLessThan(50); // generous ceiling — catching a gross regression, not micro-benchmarking
  });
});
