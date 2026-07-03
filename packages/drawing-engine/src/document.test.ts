import { describe, expect, it } from 'vitest';
import {
  addFrame,
  addLayer,
  createDocument,
  createVectorObject,
  frameToData,
  getFramesArray,
  getLayersArray,
  getObjectsArray,
  isLayerEditable,
  layerToData,
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
