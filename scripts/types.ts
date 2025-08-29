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

interface ACCESSOR_VEC3 {
  bufferView: number;
  componentType: number;
  count: number;
  type: 'VEC3';
  max: Vec3;
  min: Vec3;
}

interface ACCESSOR_SCALAR {
  bufferView: number;
  componentType: number;
  count: number;
  type: 'SCALAR';
}

export interface GLTF {
  asset: {
    version: string;
  };
  scene: number;
  scenes: {
    nodes: number[];
  }[];
  nodes: {
    mesh: number;
    translation: Vec3;
  }[];
  meshes: {
    primitives: {
      attributes: { POSITION: number };
      indices: number;
    }[];
  }[];
  accessors: (ACCESSOR_VEC3 | ACCESSOR_SCALAR)[];
  bufferViews: {
    buffer: number;
    byteOffset: number;
    byteLength: number;
  }[];
  buffers: {
    uri?: string;
    byteLength: number;
  }[];
}
