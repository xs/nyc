import { describe, it, expect } from 'vitest';
import {
  type Vec2,
  type Vec3,
  type Point,
  type Polyline,
  type Region,
  type Envelope,
  type FilterResult,
} from '../types.js';

describe('types.ts functionality', () => {
  it('should allow creation of Vec2 arrays', () => {
    const point: Vec2 = [40.7589, -73.9851];
    expect(point).toEqual([40.7589, -73.9851]);
    expect(point).toHaveLength(2);
  });

  it('should allow creation of Vec3 arrays', () => {
    const point: Vec3 = [40.7589, -73.9851, 100];
    expect(point).toEqual([40.7589, -73.9851, 100]);
    expect(point).toHaveLength(3);
  });

  it('should allow creation of Polyline arrays', () => {
    const polyline: Polyline = [
      [40.7589, -73.9851],
      [40.7128, -74.006],
      [40.7505, -73.9934],
    ];
    expect(polyline).toHaveLength(3);
    expect(polyline[0]).toEqual([40.7589, -73.9851]);
  });

  it('should allow creation of Region values', () => {
    const region1: Region = 'manhattan';
    const region2: Region = 'downtown';

    expect(region1).toBe('manhattan');
    expect(region2).toBe('downtown');
  });

  it('should allow creation of Envelope objects', () => {
    const envelope: Envelope = {
      minX: 1000000,
      minY: 200000,
      maxX: 1050000,
      maxY: 250000,
    };

    expect(envelope.minX).toBe(1000000);
    expect(envelope.maxY).toBe(250000);
  });

  it('should allow creation of FilterResult objects', () => {
    const result: FilterResult = {
      buildingCount: 1000,
      filteredCount: 100,
      originalSize: 1024 * 1024,
      filteredSize: 100 * 1024,
      chunkCount: 1,
    };

    expect(result.buildingCount).toBe(1000);
    expect(result.filteredCount).toBe(100);
    expect(result.chunkCount).toBe(1);
  });

  it('should allow Point to be either Vec2 or Vec3', () => {
    const point2D: Point = [40.7589, -73.9851];
    const point3D: Point = [40.7589, -73.9851, 100];

    expect(point2D).toHaveLength(2);
    expect(point3D).toHaveLength(3);
  });
});
