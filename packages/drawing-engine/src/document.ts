import * as Y from 'yjs';
import { generateId } from './id.js';
import { DEFAULT_TRANSFORM } from './types.js';
import type { FrameData, LayerData, Style, VectorObjectData } from './types.js';

export type YObject = Y.Map<unknown>;
export type YLayer = Y.Map<unknown>;
export type YFrame = Y.Map<unknown>;

const DEFAULT_FPS = 12;

export function createDocument(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('fps', DEFAULT_FPS);
  const frames = doc.getArray<YFrame>('frames');
  frames.push([createFrame('Frame 1')]);
  return doc;
}

export function createDocumentFromSnapshot(update: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc;
}

export function getFramesArray(doc: Y.Doc): Y.Array<YFrame> {
  return doc.getArray<YFrame>('frames');
}

export function getFps(doc: Y.Doc): number {
  return (doc.getMap('meta').get('fps') as number) ?? DEFAULT_FPS;
}

export function setFps(doc: Y.Doc, fps: number): void {
  doc.getMap('meta').set('fps', Math.max(1, Math.round(fps)));
}

export function createFrame(name: string): YFrame {
  const frame: YFrame = new Y.Map();
  frame.set('id', generateId());
  frame.set('name', name);
  const layers = new Y.Array<YLayer>();
  layers.push([createLayer('Layer 1')]);
  frame.set('layers', layers);
  return frame;
}

export function addFrame(doc: Y.Doc, name = 'Frame'): YFrame {
  const frame = createFrame(name);
  getFramesArray(doc).push([frame]);
  return frame;
}

export function getLayersArray(frame: YFrame): Y.Array<YLayer> {
  return frame.get('layers') as Y.Array<YLayer>;
}

export function createLayer(name: string): YLayer {
  const layer: YLayer = new Y.Map();
  layer.set('id', generateId());
  layer.set('name', name);
  layer.set('visible', true);
  layer.set('locked', false);
  layer.set('objects', new Y.Array<YObject>());
  return layer;
}

export function addLayer(frame: YFrame, name = 'Layer'): YLayer {
  const layer = createLayer(name);
  getLayersArray(frame).push([layer]);
  return layer;
}

export function getObjectsArray(layer: YLayer): Y.Array<YObject> {
  return layer.get('objects') as Y.Array<YObject>;
}

export function isLayerEditable(layer: YLayer): boolean {
  return layer.get('visible') === true && layer.get('locked') !== true;
}

export function createVectorObject(data: Omit<VectorObjectData, 'id'> & { id?: string }): YObject {
  const obj: YObject = new Y.Map();
  obj.set('id', data.id ?? generateId());
  obj.set('kind', data.kind);
  obj.set('points', data.points);
  obj.set('style', data.style);
  obj.set('transform', data.transform);
  obj.set('createdBy', data.createdBy);
  return obj;
}

function cloneVectorObject(obj: YObject, preserveId: boolean): YObject {
  const data = vectorObjectToData(obj);
  return createVectorObject({ ...data, id: preserveId ? data.id : undefined });
}

function cloneLayer(layer: YLayer, options: { preserveIds: boolean; nameOverride?: string }): YLayer {
  const data = layerToData(layer);
  const clone: YLayer = new Y.Map();
  clone.set('id', options.preserveIds ? data.id : generateId());
  clone.set('name', options.nameOverride ?? data.name);
  clone.set('visible', data.visible);
  clone.set('locked', data.locked);
  const clonedObjects = getObjectsArray(layer)
    .toArray()
    .map((obj) => cloneVectorObject(obj, options.preserveIds));
  const objects = new Y.Array<YObject>();
  objects.push(clonedObjects);
  clone.set('objects', objects);
  return clone;
}

/** Refuses to delete the frame's last remaining layer; returns whether it deleted. */
export function deleteLayer(frame: YFrame, index: number): boolean {
  const layers = getLayersArray(frame);
  if (layers.length <= 1) return false;
  layers.delete(index, 1);
  return true;
}

export function duplicateLayer(frame: YFrame, index: number): YLayer {
  const layers = getLayersArray(frame);
  const source = layers.get(index);
  const copy = cloneLayer(source, { preserveIds: false, nameOverride: `${layerToData(source).name} copy` });
  layers.insert(index + 1, [copy]);
  return copy;
}

export function renameLayer(layer: YLayer, name: string): void {
  layer.set('name', name);
}

export function setLayerVisible(layer: YLayer, visible: boolean): void {
  layer.set('visible', visible);
}

export function setLayerLocked(layer: YLayer, locked: boolean): void {
  layer.set('locked', locked);
}

/**
 * Repositions a layer to `toIndex` (clamped to valid bounds). Yjs shared types can't
 * be relocated in place once integrated, so this clones-with-preserved-id, deletes the
 * original, and reinserts the clone — same pattern as the eraser's split/replace.
 * Returns the layer's actual resulting index.
 */
export function moveLayer(frame: YFrame, fromIndex: number, toIndex: number): number {
  const layers = getLayersArray(frame);
  const clampedTo = Math.max(0, Math.min(toIndex, layers.length - 1));
  if (fromIndex < 0 || fromIndex >= layers.length || fromIndex === clampedTo) return fromIndex;

  const clone = cloneLayer(layers.get(fromIndex), { preserveIds: true });
  layers.delete(fromIndex, 1);
  layers.insert(clampedTo, [clone]);
  return clampedTo;
}

function cloneFrame(frame: YFrame, options: { preserveIds: boolean; nameOverride?: string }): YFrame {
  const data = frameToData(frame);
  const clone: YFrame = new Y.Map();
  clone.set('id', options.preserveIds ? data.id : generateId());
  clone.set('name', options.nameOverride ?? data.name);
  const clonedLayers = getLayersArray(frame)
    .toArray()
    .map((layer) => cloneLayer(layer, { preserveIds: options.preserveIds }));
  const layers = new Y.Array<YLayer>();
  layers.push(clonedLayers);
  clone.set('layers', layers);
  return clone;
}

/** Refuses to delete the timeline's last remaining frame; returns whether it deleted. */
export function deleteFrame(doc: Y.Doc, index: number): boolean {
  const frames = getFramesArray(doc);
  if (frames.length <= 1) return false;
  frames.delete(index, 1);
  return true;
}

export function duplicateFrame(doc: Y.Doc, index: number): YFrame {
  const frames = getFramesArray(doc);
  const source = frames.get(index);
  const copy = cloneFrame(source, { preserveIds: false, nameOverride: `${frameToData(source).name} copy` });
  frames.insert(index + 1, [copy]);
  return copy;
}

export function renameFrame(frame: YFrame, name: string): void {
  frame.set('name', name);
}

/** Same clone+delete+reinsert pattern as `moveLayer`, one level up. */
export function moveFrame(doc: Y.Doc, fromIndex: number, toIndex: number): number {
  const frames = getFramesArray(doc);
  const clampedTo = Math.max(0, Math.min(toIndex, frames.length - 1));
  if (fromIndex < 0 || fromIndex >= frames.length || fromIndex === clampedTo) return fromIndex;

  const clone = cloneFrame(frames.get(fromIndex), { preserveIds: true });
  frames.delete(fromIndex, 1);
  frames.insert(clampedTo, [clone]);
  return clampedTo;
}

export function vectorObjectToData(obj: YObject): VectorObjectData {
  return {
    id: obj.get('id') as string,
    kind: obj.get('kind') as VectorObjectData['kind'],
    points: obj.get('points') as VectorObjectData['points'],
    style: obj.get('style') as Style,
    transform: (obj.get('transform') as VectorObjectData['transform']) ?? { ...DEFAULT_TRANSFORM },
    createdBy: obj.get('createdBy') as string,
  };
}

export function layerToData(layer: YLayer): LayerData {
  return {
    id: layer.get('id') as string,
    name: layer.get('name') as string,
    visible: layer.get('visible') as boolean,
    locked: layer.get('locked') as boolean,
  };
}

export function frameToData(frame: YFrame): FrameData {
  return {
    id: frame.get('id') as string,
    name: frame.get('name') as string,
  };
}
