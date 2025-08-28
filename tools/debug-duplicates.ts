import * as fs from 'fs';
import * as path from 'path';

interface Building {
  id: string;
  footprint: number[][];
  height_m: number;
  mesh?: {
    positions: Float32Array;
    indices: Uint32Array;
  };
}

function analyzeDuplicates(buildings: Building[]) {
  console.log(`\n=== Duplicate Analysis ===`);
  console.log(`Total buildings: ${buildings.length}`);
  
  // Check for duplicate IDs
  const idCounts = new Map<string, number>();
  const duplicateIds = new Set<string>();
  
  for (const building of buildings) {
    const count = idCounts.get(building.id) || 0;
    idCounts.set(building.id, count + 1);
    if (count > 0) {
      duplicateIds.add(building.id);
    }
  }
  
  console.log(`\nDuplicate IDs found: ${duplicateIds.size}`);
  if (duplicateIds.size > 0) {
    console.log('Duplicate IDs:');
    for (const id of duplicateIds) {
      console.log(`  ${id}: ${idCounts.get(id)} instances`);
    }
  }
  
  // Check for duplicate footprints (same coordinates)
  const footprintMap = new Map<string, Building[]>();
  const duplicateFootprints = new Set<string>();
  
  for (const building of buildings) {
    const footprintKey = JSON.stringify(building.footprint);
    if (!footprintMap.has(footprintKey)) {
      footprintMap.set(footprintKey, []);
    }
    footprintMap.get(footprintKey)!.push(building);
    
    if (footprintMap.get(footprintKey)!.length > 1) {
      duplicateFootprints.add(footprintKey);
    }
  }
  
  console.log(`\nDuplicate footprints found: ${duplicateFootprints.size}`);
  if (duplicateFootprints.size > 0) {
    console.log('Sample duplicate footprints:');
    let count = 0;
    for (const footprintKey of duplicateFootprints) {
      if (count >= 5) break; // Show first 5
      const buildings = footprintMap.get(footprintKey)!;
      console.log(`  Footprint with ${buildings.length} instances:`);
      for (const building of buildings) {
        console.log(`    ID: ${building.id}, Height: ${building.height_m}m`);
      }
      count++;
    }
  }
  
  // Check for buildings with same ID but different footprints
  const idToFootprints = new Map<string, Set<string>>();
  for (const building of buildings) {
    if (!idToFootprints.has(building.id)) {
      idToFootprints.set(building.id, new Set());
    }
    idToFootprints.get(building.id)!.add(JSON.stringify(building.footprint));
  }
  
  const inconsistentIds = new Set<string>();
  for (const [id, footprints] of idToFootprints) {
    if (footprints.size > 1) {
      inconsistentIds.add(id);
    }
  }
  
  console.log(`\nIDs with inconsistent footprints: ${inconsistentIds.size}`);
  if (inconsistentIds.size > 0) {
    console.log('Sample inconsistent IDs:');
    let count = 0;
    for (const id of inconsistentIds) {
      if (count >= 3) break;
      const footprints = idToFootprints.get(id)!;
      console.log(`  ID ${id} has ${footprints.size} different footprints`);
      count++;
    }
  }
  
  return {
    duplicateIds: Array.from(duplicateIds),
    duplicateFootprints: Array.from(duplicateFootprints),
    inconsistentIds: Array.from(inconsistentIds)
  };
}

function fixBuildingIds(buildings: Building[]): Building[] {
  console.log(`\n=== Fixing Building IDs ===`);
  
  // Create a map to track unique footprints and assign new IDs
  const footprintToBuilding = new Map<string, Building>();
  const fixedBuildings: Building[] = [];
  let newIdCounter = 0;
  
  for (const building of buildings) {
    const footprintKey = JSON.stringify(building.footprint);
    
    if (!footprintToBuilding.has(footprintKey)) {
      // This is a new unique footprint
      const fixedBuilding = {
        ...building,
        id: `building_${newIdCounter++}`
      };
      footprintToBuilding.set(footprintKey, fixedBuilding);
      fixedBuildings.push(fixedBuilding);
    } else {
      // Duplicate footprint found - skip it
      console.log(`Skipping duplicate building with ID ${building.id}`);
    }
  }
  
  console.log(`Original buildings: ${buildings.length}`);
  console.log(`Fixed buildings: ${fixedBuildings.length}`);
  console.log(`Removed duplicates: ${buildings.length - fixedBuildings.length}`);
  
  return fixedBuildings;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: npx ts-node tools/debug-duplicates.ts <path-to-footprints.geojson>');
    console.log('Example: npx ts-node tools/debug-duplicates.ts out/williamsburg/footprints.geojson');
    process.exit(1);
  }
  
  const geojsonPath = args[0];
  const outputDir = path.dirname(geojsonPath);
  
  if (!fs.existsSync(geojsonPath)) {
    console.error(`File not found: ${geojsonPath}`);
    process.exit(1);
  }
  
  console.log(`Analyzing: ${geojsonPath}`);
  
  try {
    const geojsonContent = fs.readFileSync(geojsonPath, 'utf8');
    const geojson = JSON.parse(geojsonContent);
    
    const buildings: Building[] = geojson.features.map((feature: any) => ({
      id: feature.properties.id,
      footprint: feature.geometry.coordinates[0],
      height_m: feature.properties.height_m
    }));
    
    // Analyze duplicates
    const analysis = analyzeDuplicates(buildings);
    
    // Fix duplicates if any found
    if (analysis.duplicateIds.length > 0 || analysis.duplicateFootprints.length > 0) {
      console.log(`\n=== Applying Fixes ===`);
      const fixedBuildings = fixBuildingIds(buildings);
      
      // Write fixed GeoJSON
      const fixedGeojson = {
        type: 'FeatureCollection',
        features: fixedBuildings.map(building => ({
          type: 'Feature',
          properties: { id: building.id, height_m: building.height_m },
          geometry: { type: 'Polygon', coordinates: [building.footprint] }
        }))
      };
      
      const fixedPath = path.join(outputDir, 'footprints-fixed.geojson');
      fs.writeFileSync(fixedPath, JSON.stringify(fixedGeojson, null, 2));
      console.log(`\nFixed GeoJSON written to: ${fixedPath}`);
      
      // Write analysis report
      const reportPath = path.join(outputDir, 'duplicate-analysis.json');
      fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        originalCount: buildings.length,
        fixedCount: fixedBuildings.length,
        removedCount: buildings.length - fixedBuildings.length,
        analysis
      }, null, 2));
      console.log(`Analysis report written to: ${reportPath}`);
    } else {
      console.log(`\nNo duplicates found!`);
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run main function
main();
