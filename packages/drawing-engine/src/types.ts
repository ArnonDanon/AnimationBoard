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

/** 'pressure' = width driven by resolvePointWidth (pen pressure). 'directional' = width
 *  driven by stroke angle and speed instead (see resolveDirectionalWidths), for
 *  nib-style brushes like the Mapping Pen that vary width without pressure input. */
export type WidthSource = 'pressure' | 'directional';

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
  widthSource: WidthSource;
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
  /** 'rectangle'/'ellipse' store exactly 2 points — opposite corners of the bounding box.
   *  'filledPath' stores its geometry in `rings` instead — `points` is unused ([]). */
  kind: 'stroke' | 'rectangle' | 'ellipse' | 'filledPath';
  points: Point[];
  /** Only populated for 'filledPath': one or more closed polygons, each as [outer, ...holes]. */
  rings?: Point[][];
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
