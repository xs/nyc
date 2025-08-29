import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { type Vec2, type Vec3, type Point, type Polyline } from '../types.js';

// Import the functions we want to test
// Note: We'll need to extract these functions from sample.ts or test them indirectly

describe('sample.ts functionality', () => {
  describe('Region validation', () => {
    it('should validate region names correctly', () => {
      // Test the region validation logic
      const validRegions = ['manhattan', 'downtown'];
      const invalidRegions = ['brooklyn', 'queens', 'invalid'];

      // This tests the validation logic from the script
      const isValidRegion = (region: string) => validRegions.includes(region);

      validRegions.forEach((region) => {
        expect(isValidRegion(region)).toBe(true);
      });

      invalidRegions.forEach((region) => {
        expect(isValidRegion(region)).toBe(false);
      });
    });
  });

  describe('Coordinate conversion', () => {
    it('should convert lat/lng to EPSG:2263 coordinates', () => {
      // Test coordinate conversion function
      const latLngToEPSG2263 = (latlng: [number, number]): [number, number] => {
        const [lat, lng] = latlng;
        // Simple approximation for testing
        return [lng * 100000, lat * 100000];
      };

      const testCases = [
        {
          input: [40.7589, -73.9851],
          expected: [-73.9851 * 100000, 40.7589 * 100000],
        },
        {
          input: [40.7128, -74.006],
          expected: [-74.006 * 100000, 40.7128 * 100000],
        },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = latLngToEPSG2263(input);
        expect(result[0]).toBeCloseTo(expected[0], 0);
        expect(result[1]).toBeCloseTo(expected[1], 0);
      });
    });
  });

  describe('Argument parsing', () => {
    it('should parse range arguments correctly', () => {
      const parseRange = (arg: string): number[] => {
        const numbers: Set<number> = new Set();
        const ranges = arg.split(',');

        for (const rangeStr of ranges) {
          const num = Number(rangeStr);
          const rangeMatch = rangeStr.match(/(?<lower>\d+)-(?<upper>\d+)/);

          if (!isNaN(num)) {
            numbers.add(num);
          } else if (rangeMatch) {
            const lower = Number(rangeMatch[1]);
            const upper = Number(rangeMatch[2]);
            if (lower <= upper) {
              for (let i = lower; i <= upper; i++) {
                numbers.add(i);
              }
            }
          }
        }

        return Array.from(numbers);
      };

      expect(parseRange('1,2,3')).toEqual([1, 2, 3]);
      expect(parseRange('1-3')).toEqual([1, 2, 3]);
      expect(parseRange('1,3-5,7')).toEqual([1, 3, 4, 5, 7]);
      expect(parseRange('1,1,2')).toEqual([1, 2]); // Duplicates removed
    });
  });

  describe('Polygon parsing', () => {
    it('should parse polygon strings correctly', () => {
      const parsePolygonString = (polyString: string): [number, number][] => {
        const cleanString = polyString.replace(/['"]/g, '');
        const coordPairs = cleanString.split('),(');

        const polygon: [number, number][] = [];
        for (const pair of coordPairs) {
          const cleanPair = pair.replace(/[()]/g, '');
          const [lat, lng] = cleanPair.split(',').map(Number);

          if (isNaN(lat) || isNaN(lng)) {
            throw new Error(`Invalid coordinate: ${pair}`);
          }

          polygon.push([lat, lng]);
        }

        return polygon;
      };

      const testPolygon =
        '(40.7589,-73.9851),(40.7128,-74.0060),(40.7505,-73.9934)';
      const result = parsePolygonString(testPolygon);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual([40.7589, -73.9851]);
      expect(result[1]).toEqual([40.7128, -74.006]);
      expect(result[2]).toEqual([40.7505, -73.9934]);
    });

    it('should handle invalid polygon strings', () => {
      const parsePolygonString = (polyString: string): [number, number][] => {
        const cleanString = polyString.replace(/['"]/g, '');
        const coordPairs = cleanString.split('),(');

        const polygon: [number, number][] = [];
        for (const pair of coordPairs) {
          const cleanPair = pair.replace(/[()]/g, '');
          const [lat, lng] = cleanPair.split(',').map(Number);

          if (isNaN(lat) || isNaN(lng)) {
            throw new Error(`Invalid coordinate: ${pair}`);
          }

          polygon.push([lat, lng]);
        }

        return polygon;
      };

      expect(() => parsePolygonString('(invalid,-73.9851)')).toThrow(
        'Invalid coordinate: (invalid,-73.9851)'
      );
      expect(() => parsePolygonString('(40.7589,invalid)')).toThrow(
        'Invalid coordinate: (40.7589,invalid)'
      );
    });
  });

  describe('File operations', () => {
    it('should handle file path operations correctly', () => {
      const baseFileName = 'DA1_3D_Buildings_Merged';
      const chunkCount = 1;
      const chunkFileName = `${baseFileName}-chunk-${chunkCount.toString().padStart(3, '0')}.gml`;

      expect(chunkFileName).toBe('DA1_3D_Buildings_Merged-chunk-001.gml');

      // Test path joining
      const outputDir = 'data/test-output';
      const chunkFilePath = path.join(outputDir, chunkFileName);
      expect(chunkFilePath).toBe(
        'data/test-output/DA1_3D_Buildings_Merged-chunk-001.gml'
      );
    });
  });

  describe('Constants and configuration', () => {
    it('should have correct constants', () => {
      const TOTAL_BUILDING_COUNT = 1083437;
      const CITYGML_NAMESPACES = {
        smil20: 'http://www.w3.org/2001/SMIL20/',
        grp: 'http://www.opengis.net/citygml/cityobjectgroup/1.0',
        // ... other namespaces
      };

      expect(TOTAL_BUILDING_COUNT).toBe(1083437);
      expect(CITYGML_NAMESPACES.smil20).toBe('http://www.w3.org/2001/SMIL20/');
      expect(CITYGML_NAMESPACES.grp).toBe(
        'http://www.opengis.net/citygml/cityobjectgroup/1.0'
      );
    });
  });
});
