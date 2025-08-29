// Type definitions for NYC 3D Buildings processing

// Basic coordinate types
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Polyline = Vec2[];

export interface Point {
  x: number;
  y: number;
  z: number;
}

// Region types
export type Region = 'manhattan' | 'downtown' | 'north-brooklyn' | 'fidi';

// Envelope type for bounding boxes
export interface Envelope {
  minX: number;
  minY: number;
  minZ?: number;
  maxX: number;
  maxY: number;
  maxZ?: number;
}

// Filter result type for processing statistics
export interface FilterResult {
  file?: string;
  buildingCount: number;
  filteredCount: number;
  originalSize: number;
  filteredSize: number;
  chunkCount: number;
}
