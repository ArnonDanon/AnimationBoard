import * as Y from 'yjs';
import { generateId } from './id';
import { DEFAULT_TRANSFORM } from './types';
import type { FrameData, LayerData, Style, VectorObjectData } from './types';

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

export function createVectorObject(data: Omit<VectorObjectData, 'id'>): YObject {
  const obj: YObject = new Y.Map();
  obj.set('id', generateId());
  obj.set('kind', data.kind);
  obj.set('points', data.points);
  obj.set('style', data.style);
  obj.set('transform', data.transform);
  obj.set('createdBy', data.createdBy);
  return obj;
}

export function vectorObjectToData(obj: YObject): VectorObjectData {
  return {
    id: obj.get('id') as string,
    kind: obj.get('kind') as 'stroke',
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
