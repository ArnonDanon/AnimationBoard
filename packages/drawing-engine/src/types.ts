export interface Point {
  x: number;
  y: number;
  pressure: number;
}

export interface Style {
  color: string;
  /** Representative width — used for hit-testing and as a fallback when `widths` is absent. */
  width: number;
  /** Per-point rendered width (same length as the stroke's points), for pressure-sensitive width. */
  widths?: number[];
  opacity: number;
}

export type PressureAffects = 'width' | 'opacity' | 'both';

export interface Brush {
  id: string;
  /** null = built-in/system brush, per the Personal Library context's ownership model. */
  ownerId: string | null;
  name: string;
  shape: 'round';
  baseWidth: number;
  opacity: number;
  pressureSensitive: boolean;
  pressureAffects: PressureAffects;
}

export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface VectorObjectData {
  id: string;
  /** 'rectangle'/'ellipse' store exactly 2 points — opposite corners of the bounding box. */
  kind: 'stroke' | 'rectangle' | 'ellipse';
  points: Point[];
  style: Style;
  transform: Transform;
  createdBy: string;
}

export interface LayerData {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface FrameData {
  id: string;
  name: string;
}

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

export type Tool = 'brush' | 'eraser' | 'select' | 'colorPicker' | 'rectangle' | 'ellipse';
