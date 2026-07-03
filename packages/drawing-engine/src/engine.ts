import * as Y from 'yjs';
import {
  addFrame as addFrameToDoc,
  addLayer as addLayerToDoc,
  createDocument,
  createVectorObject,
  getFramesArray,
  getLayersArray,
  getObjectsArray,
  isLayerEditable,
  vectorObjectToData,
} from './document';
import type { YFrame, YObject } from './document';
import { attachPointerCapture } from './input';
import { hitTestFrame } from './geometry';
import { paintSelectionOutline, paintStroke, renderFrame } from './render';
import { createUndoManager } from './history';
import { exportSnapshot as encodeSnapshot } from './serialize';
import { rotateObject, scaleObject, translateObject } from './transform';
import { DEFAULT_BRUSH, resolveStrokeStyle } from './brush';
import { BUILT_IN_PALETTE } from './palette';
import { DEFAULT_TRANSFORM } from './types';
import type { Brush, Point } from './types';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  animatorId?: string;
  doc?: Y.Doc;
}

export class DrawingEngine {
  readonly doc: Y.Doc;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly undoManager: Y.UndoManager;
  private readonly detachInput: () => void;
  private readonly animatorId: string;
  private readonly listeners = new Set<() => void>();

  private activeFrameIndex = 0;
  private drawingPoints: Point[] | null = null;
  private selectedObjectId: string | null = null;
  private dragOrigin: Point | null = null;
  private activeBrush: Brush = DEFAULT_BRUSH;
  private activeColor: string = BUILT_IN_PALETTE[0];

  constructor(options: EngineOptions) {
    this.doc = options.doc ?? createDocument();
    this.animatorId = options.animatorId ?? 'local';
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.undoManager = createUndoManager(this.doc);

    this.doc.on('update', () => this.notify());
    this.detachInput = attachPointerCapture(this.canvas, {
      onStart: (p) => this.handlePointerStart(p),
      onMove: (p) => this.handlePointerMove(p),
      onEnd: (p) => this.handlePointerEnd(p),
    });

    this.render();
  }

  private get activeFrame(): YFrame {
    const frames = getFramesArray(this.doc);
    return frames.get(Math.min(this.activeFrameIndex, frames.length - 1));
  }

  // Epic 3 scope: no active-layer picker UI yet (that's Epic 6), so new
  // strokes always land on the topmost layer of the active frame.
  private get activeLayer() {
    const layers = getLayersArray(this.activeFrame);
    return layers.get(layers.length - 1);
  }

  private handlePointerStart(p: Point): void {
    const hit = hitTestFrame(this.ctx, this.activeFrame, p.x, p.y);
    if (hit) {
      this.selectedObjectId = vectorObjectToData(hit).id;
      this.dragOrigin = p;
      this.notify();
      return;
    }
    this.selectedObjectId = null;
    const layer = this.activeLayer;
    if (!layer || !isLayerEditable(layer)) {
      this.notify();
      return;
    }
    this.drawingPoints = [p];
    this.notify();
  }

  private handlePointerMove(p: Point): void {
    if (this.drawingPoints) {
      this.drawingPoints.push(p);
      this.renderWithLiveStroke();
      return;
    }
    if (this.selectedObjectId && this.dragOrigin) {
      const dx = p.x - this.dragOrigin.x;
      const dy = p.y - this.dragOrigin.y;
      this.dragOrigin = p;
      const obj = this.findObjectById(this.selectedObjectId);
      if (obj) translateObject(obj, dx, dy);
    }
  }

  private handlePointerEnd(p: Point): void {
    if (this.drawingPoints) {
      this.drawingPoints.push(p);
      this.commitStroke(this.drawingPoints);
      this.drawingPoints = null;
    }
    this.dragOrigin = null;
  }

  private commitStroke(points: Point[]): void {
    const layer = this.activeLayer;
    if (!layer || !isLayerEditable(layer)) return;
    const obj = createVectorObject({
      kind: 'stroke',
      points,
      style: resolveStrokeStyle(this.activeBrush, points, this.activeColor),
      transform: { ...DEFAULT_TRANSFORM },
      createdBy: this.animatorId,
    });
    getObjectsArray(layer).push([obj]);
  }

  private findObjectById(id: string): YObject | null {
    const layers = getLayersArray(this.activeFrame);
    for (let i = 0; i < layers.length; i++) {
      const objects = getObjectsArray(layers.get(i));
      for (let j = 0; j < objects.length; j++) {
        if (vectorObjectToData(objects.get(j)).id === id) return objects.get(j);
      }
    }
    return null;
  }

  private render(): void {
    renderFrame(this.ctx, this.canvas, this.activeFrame);
    if (this.selectedObjectId) {
      const obj = this.findObjectById(this.selectedObjectId);
      if (obj) {
        const data = vectorObjectToData(obj);
        paintSelectionOutline(this.ctx, data.points, data.transform);
      }
    }
  }

  private renderWithLiveStroke(): void {
    renderFrame(this.ctx, this.canvas, this.activeFrame);
    if (this.drawingPoints) {
      const style = resolveStrokeStyle(this.activeBrush, this.drawingPoints, this.activeColor);
      paintStroke(this.ctx, this.drawingPoints, style, DEFAULT_TRANSFORM);
    }
  }

  private notify(): void {
    this.render();
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getFrameCount(): number {
    return getFramesArray(this.doc).length;
  }

  getActiveFrameIndex(): number {
    return this.activeFrameIndex;
  }

  setActiveFrameIndex(index: number): void {
    const count = this.getFrameCount();
    this.activeFrameIndex = Math.max(0, Math.min(index, count - 1));
    this.selectedObjectId = null;
    this.notify();
  }

  hasSelection(): boolean {
    return this.selectedObjectId !== null;
  }

  getActiveBrush(): Brush {
    return this.activeBrush;
  }

  setActiveBrush(brush: Brush): void {
    this.activeBrush = brush;
    this.notify();
  }

  getActiveColor(): string {
    return this.activeColor;
  }

  setActiveColor(color: string): void {
    this.activeColor = color;
    this.notify();
  }

  addFrame(name?: string): void {
    addFrameToDoc(this.doc, name);
    this.setActiveFrameIndex(this.getFrameCount() - 1);
  }

  addLayer(name?: string): void {
    addLayerToDoc(this.activeFrame, name);
  }

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  scaleSelection(factor: number): void {
    if (!this.selectedObjectId) return;
    const obj = this.findObjectById(this.selectedObjectId);
    if (obj) scaleObject(obj, factor);
  }

  rotateSelection(degrees: number): void {
    if (!this.selectedObjectId) return;
    const obj = this.findObjectById(this.selectedObjectId);
    if (obj) rotateObject(obj, degrees);
  }

  exportSnapshot(): Uint8Array {
    return encodeSnapshot(this.doc);
  }

  destroy(): void {
    this.detachInput();
    this.listeners.clear();
  }
}

export function createEngine(options: EngineOptions): DrawingEngine {
  return new DrawingEngine(options);
}
