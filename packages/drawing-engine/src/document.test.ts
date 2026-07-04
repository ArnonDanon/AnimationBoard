import { describe, expect, it } from 'vitest';
import {
  addFrame,
  addLayer,
  createDocument,
  createVectorObject,
  deleteFrame,
  deleteLayer,
  duplicateFrame,
  duplicateLayer,
  frameToData,
  getFps,
  getFramesArray,
  getLayersArray,
  getObjectsArray,
  isLayerEditable,
  layerToData,
  moveFrame,
  moveLayer,
  renameFrame,
  renameLayer,
  setFps,
  setLayerLocked,
  setLayerVisible,
  vectorObjectToData,
} from './document';
import { DEFAULT_TRANSFORM } from './types';

describe('createDocument', () => {
  it('starts with one frame containing one default layer', () => {
    const doc = createDocument();
    const frames = getFramesArray(doc);
    expect(frames.length).toBe(1);
    const layers = getLayersArray(frames.get(0));
    expect(layers.length).toBe(1);
    expect(layerToData(layers.get(0)).name).toBe('Layer 1');
  });
});

describe('addFrame / addLayer', () => {
  it('appends a frame with its own default layer, independent of other frames', () => {
    const doc = createDocument();
    addFrame(doc, 'Frame 2');
    const frames = getFramesArray(doc);
    expect(frames.length).toBe(2);
    expect(frameToData(frames.get(1)).name).toBe('Frame 2');
    expect(getLayersArray(frames.get(1)).length).toBe(1);
  });

  it('adding a layer to one frame does not affect another frame', () => {
    const doc = createDocument();
    const frame2 = addFrame(doc, 'Frame 2');
    addLayer(frame2, 'Extra Layer');

    const frames = getFramesArray(doc);
    expect(getLayersArray(frames.get(0)).length).toBe(1);
    expect(getLayersArray(frames.get(1)).length).toBe(2);
  });
});

describe('isLayerEditable', () => {
  it('is editable by default', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    expect(isLayerEditable(layer)).toBe(true);
  });

  it('is not editable when locked or hidden', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    layer.set('locked', true);
    expect(isLayerEditable(layer)).toBe(false);
    layer.set('locked', false);
    layer.set('visible', false);
    expect(isLayerEditable(layer)).toBe(false);
  });
});

describe('layer management', () => {
  it('renames, hides, and locks a layer independently of other layers', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    addLayer(frame, 'Layer 2');
    const layers = getLayersArray(frame);

    renameLayer(layers.get(1), 'Line Art');
    setLayerVisible(layers.get(1), false);
    setLayerLocked(layers.get(1), true);

    expect(layerToData(layers.get(1))).toMatchObject({ name: 'Line Art', visible: false, locked: true });
    expect(layerToData(layers.get(0))).toMatchObject({ name: 'Layer 1', visible: true, locked: false });
  });

  it('refuses to delete the last remaining layer in a frame', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    const deleted = deleteLayer(frame, 0);
    expect(deleted).toBe(false);
    expect(getLayersArray(frame).length).toBe(1);
  });

  it('deletes a layer when another one remains', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    addLayer(frame, 'Layer 2');
    const deleted = deleteLayer(frame, 0);
    expect(deleted).toBe(true);
    const layers = getLayersArray(frame);
    expect(layers.length).toBe(1);
    expect(layerToData(layers.get(0)).name).toBe('Layer 2');
  });

  it('refuses to delete a locked layer, even when another layer remains', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    addLayer(frame, 'Layer 2');
    const layers = getLayersArray(frame);
    setLayerLocked(layers.get(0), true);

    const deleted = deleteLayer(frame, 0);

    expect(deleted).toBe(false);
    expect(getLayersArray(frame).length).toBe(2);
  });

  it('deletes a previously-locked layer once unlocked', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    addLayer(frame, 'Layer 2');
    const layers = getLayersArray(frame);
    setLayerLocked(layers.get(0), true);
    setLayerLocked(layers.get(0), false);

    const deleted = deleteLayer(frame, 0);

    expect(deleted).toBe(true);
    expect(getLayersArray(frame).length).toBe(1);
  });

  it('duplicates a layer with independent copies of its objects, inserted directly above it', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    const layers = getLayersArray(frame);
    const original = layers.get(0);
    getObjectsArray(original).push([
      createVectorObject({
        kind: 'stroke',
        points: [{ x: 0, y: 0, pressure: 1 }],
        style: { color: '#000', width: 2, opacity: 1 },
        transform: { ...DEFAULT_TRANSFORM },
        createdBy: 'a',
      }),
    ]);

    duplicateLayer(frame, 0);

    expect(layers.length).toBe(2);
    expect(layerToData(layers.get(1)).name).toBe('Layer 1 copy');
    expect(getObjectsArray(layers.get(1)).length).toBe(1);

    // Independent copy: mutating the original's objects doesn't affect the duplicate.
    getObjectsArray(original).delete(0, 1);
    expect(getObjectsArray(original).length).toBe(0);
    expect(getObjectsArray(layers.get(1)).length).toBe(1);
  });

  it('moves a layer to a new position, preserving its id and content', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    addLayer(frame, 'Layer 2');
    addLayer(frame, 'Layer 3');
    const layers = getLayersArray(frame);
    const originalBottomId = layerToData(layers.get(0)).id;

    const newIndex = moveLayer(frame, 0, 2);

    expect(newIndex).toBe(2);
    const moved = layerToData(getLayersArray(frame).get(2));
    expect(moved.id).toBe(originalBottomId);
    expect(moved.name).toBe('Layer 1');
    expect(getLayersArray(frame).length).toBe(3);
  });

  it('clamps the move target to valid bounds', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    addLayer(frame, 'Layer 2');
    const newIndex = moveLayer(frame, 0, 999);
    expect(newIndex).toBe(1);
  });
});

describe('fps', () => {
  it('defaults to 12 and can be changed', () => {
    const doc = createDocument();
    expect(getFps(doc)).toBe(12);
    setFps(doc, 24);
    expect(getFps(doc)).toBe(24);
  });

  it('rounds and floors fps at 1', () => {
    const doc = createDocument();
    setFps(doc, 23.6);
    expect(getFps(doc)).toBe(24);
    setFps(doc, -5);
    expect(getFps(doc)).toBe(1);
  });
});

describe('frame management', () => {
  it('renames a frame', () => {
    const doc = createDocument();
    const frame = getFramesArray(doc).get(0);
    renameFrame(frame, 'Intro');
    expect(frameToData(frame).name).toBe('Intro');
  });

  it('refuses to delete the timeline\'s last remaining frame', () => {
    const doc = createDocument();
    const deleted = deleteFrame(doc, 0);
    expect(deleted).toBe(false);
    expect(getFramesArray(doc).length).toBe(1);
  });

  it('deletes a frame when another one remains', () => {
    const doc = createDocument();
    addFrame(doc, 'Frame 2');
    const deleted = deleteFrame(doc, 0);
    expect(deleted).toBe(true);
    const frames = getFramesArray(doc);
    expect(frames.length).toBe(1);
    expect(frameToData(frames.get(0)).name).toBe('Frame 2');
  });

  it('duplicates a frame with independent copies of its layers and objects', () => {
    const doc = createDocument();
    const frames = getFramesArray(doc);
    const original = frames.get(0);
    const originalLayer = getLayersArray(original).get(0);
    getObjectsArray(originalLayer).push([
      createVectorObject({
        kind: 'stroke',
        points: [{ x: 0, y: 0, pressure: 1 }],
        style: { color: '#000', width: 2, opacity: 1 },
        transform: { ...DEFAULT_TRANSFORM },
        createdBy: 'a',
      }),
    ]);

    duplicateFrame(doc, 0);

    expect(frames.length).toBe(2);
    expect(frameToData(frames.get(1)).name).toBe('Frame 1 copy');
    const copiedLayer = getLayersArray(frames.get(1)).get(0);
    expect(getObjectsArray(copiedLayer).length).toBe(1);

    // Independent copy: mutating the original's content doesn't affect the duplicate.
    getObjectsArray(originalLayer).delete(0, 1);
    expect(getObjectsArray(originalLayer).length).toBe(0);
    expect(getObjectsArray(copiedLayer).length).toBe(1);
  });

  it('moves a frame to a new position, preserving its id and content', () => {
    const doc = createDocument();
    addFrame(doc, 'Frame 2');
    addFrame(doc, 'Frame 3');
    const frames = getFramesArray(doc);
    const originalFirstId = frameToData(frames.get(0)).id;

    const newIndex = moveFrame(doc, 0, 2);

    expect(newIndex).toBe(2);
    const moved = frameToData(getFramesArray(doc).get(2));
    expect(moved.id).toBe(originalFirstId);
    expect(moved.name).toBe('Frame 1');
    expect(getFramesArray(doc).length).toBe(3);
  });
});

describe('vector objects', () => {
  it('round-trips through the Yjs map representation', () => {
    const doc = createDocument();
    const layer = getLayersArray(getFramesArray(doc).get(0)).get(0);
    const objects = getObjectsArray(layer);

    const obj = createVectorObject({
      kind: 'stroke',
      points: [{ x: 0, y: 0, pressure: 0.5 }, { x: 10, y: 10, pressure: 0.8 }],
      style: { color: '#000000', width: 3, opacity: 1 },
      transform: { ...DEFAULT_TRANSFORM },
      createdBy: 'animator-1',
    });
    objects.push([obj]);

    const data = vectorObjectToData(objects.get(0));
    expect(data.points).toHaveLength(2);
    expect(data.style.color).toBe('#000000');
    expect(data.createdBy).toBe('animator-1');
    expect(typeof data.id).toBe('string');
  });
});
