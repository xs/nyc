import { extractFromCityGML, ExtractedBuilding } from '../extract-citygml';
import * as fs from 'fs';
import * as path from 'path';

// Sample CityGML data for testing
const sampleCityGML = `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:bldg="http://www.opengis.net/citygml/building/2.0" xmlns:gml="http://www.opengis.net/gml">
  <core:cityObjectMember>
    <bldg:Building gml:id="building_001">
      <bldg:boundedBy>
        <bldg:GroundSurface>
          <gml:Polygon>
            <gml:exterior>
              <gml:LinearRing>
                <gml:posList>0 0 0 10 0 0 10 10 0 0 10 0 0 0 0</gml:posList>
              </gml:LinearRing>
            </gml:exterior>
          </gml:Polygon>
        </bldg:GroundSurface>
        <bldg:WallSurface>
          <gml:Polygon>
            <gml:exterior>
              <gml:LinearRing>
                <gml:posList>0 0 0 0 0 20 0 10 20 0 10 0 0 0 0</gml:posList>
              </gml:LinearRing>
            </gml:exterior>
          </gml:Polygon>
        </bldg:WallSurface>
        <bldg:RoofSurface>
          <gml:Polygon>
            <gml:exterior>
              <gml:LinearRing>
                <gml:posList>0 0 20 10 0 20 10 10 20 0 10 20 0 0 20</gml:posList>
              </gml:LinearRing>
            </gml:exterior>
          </gml:Polygon>
        </bldg:RoofSurface>
      </bldg:boundedBy>
    </bldg:Building>
    <bldg:Building gml:id="building_002">
      <bldg:boundedBy>
        <bldg:GroundSurface>
          <gml:Polygon>
            <gml:exterior>
              <gml:LinearRing>
                <gml:posList>20 20 0 30 20 0 30 30 0 20 30 0 20 20 0</gml:posList>
              </gml:LinearRing>
            </gml:exterior>
          </gml:Polygon>
        </bldg:GroundSurface>
        <bldg:RoofSurface>
          <gml:Polygon>
            <gml:exterior>
              <gml:LinearRing>
                <gml:posList>20 20 15 30 20 15 30 30 15 20 30 15 20 20 15</gml:posList>
              </gml:LinearRing>
            </gml:exterior>
          </gml:Polygon>
        </bldg:RoofSurface>
      </bldg:boundedBy>
    </bldg:Building>
  </core:cityObjectMember>
</core:CityModel>`;

// Create test data directory and files
const testDataDir = path.join(__dirname, 'test-data');
const testGMLFile = path.join(testDataDir, 'sample-buildings.gml');

function setupTestData() {
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
  fs.writeFileSync(testGMLFile, sampleCityGML);
}

function cleanupTestData() {
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
}

// Test functions
function testExtractFromCityGML() {
  console.log('Testing extractFromCityGML...');
  
  const buildings = extractFromCityGML(testGMLFile);
  
  // Test that we extracted the expected number of buildings
  if (buildings.length !== 2) {
    throw new Error(`Expected 2 buildings, got ${buildings.length}`);
  }
  
  // Test first building
  const building1 = buildings[0];
  if (building1.id !== 'building_001') {
    throw new Error(`Expected building ID 'building_001', got '${building1.id}'`);
  }
  
  if (building1.height !== 20) {
    throw new Error(`Expected building height 20, got ${building1.height}`);
  }
  
  if (building1.footprint.length !== 5) {
    throw new Error(`Expected 5 footprint points, got ${building1.footprint.length}`);
  }
  
  // Test second building
  const building2 = buildings[1];
  if (building2.id !== 'building_002') {
    throw new Error(`Expected building ID 'building_002', got '${building2.id}'`);
  }
  
  if (building2.height !== 15) {
    throw new Error(`Expected building height 15, got ${building2.height}`);
  }
  
  console.log('✅ extractFromCityGML test passed');
}

function testBuildingGeometry() {
  console.log('Testing building geometry extraction...');
  
  const buildings = extractFromCityGML(testGMLFile);
  const building1 = buildings[0];
  
  // Test that walls were extracted
  if (!building1.walls || building1.walls.length === 0) {
    throw new Error('Expected wall geometry to be extracted');
  }
  
  // Test that roof was extracted
  if (!building1.roof || building1.roof.length === 0) {
    throw new Error('Expected roof geometry to be extracted');
  }
  
  // Test that ground was extracted
  if (!building1.ground || building1.ground.length === 0) {
    throw new Error('Expected ground geometry to be extracted');
  }
  
  console.log('✅ Building geometry test passed');
}

function testFootprintCoordinates() {
  console.log('Testing footprint coordinate extraction...');
  
  const buildings = extractFromCityGML(testGMLFile);
  const building1 = buildings[0];
  
  // Test that footprint is 2D (only x, y coordinates)
  for (const point of building1.footprint) {
    if (point.length !== 2) {
      throw new Error(`Expected 2D coordinates, got ${point.length}D`);
    }
  }
  
  // Test that footprint coordinates are reasonable
  const expectedFootprint = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  if (building1.footprint.length !== expectedFootprint.length) {
    throw new Error(`Expected ${expectedFootprint.length} footprint points, got ${building1.footprint.length}`);
  }
  
  console.log('✅ Footprint coordinates test passed');
}

// Main test runner
function runTests() {
  console.log('🧪 Running CityGML extraction tests...\n');
  
  try {
    setupTestData();
    
    testExtractFromCityGML();
    testBuildingGeometry();
    testFootprintCoordinates();
    
    console.log('\n🎉 All tests passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    cleanupTestData();
  }
}

// Run tests if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('extract-citygml.test.ts')) {
  runTests();
}

export { runTests };
