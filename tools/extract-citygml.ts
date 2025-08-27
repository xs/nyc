import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import * as path from 'path';

interface ExtractedBuilding {
  id: string;
  footprint: number[][]; // 2D coordinates [x, y]
  height: number;
  walls?: number[][][]; // 3D wall polygons [[x, y, z], ...]
  roof?: number[][][];  // 3D roof polygons [[x, y, z], ...]
  ground?: number[][][]; // 3D ground polygons [[x, y, z], ...]
}

interface CityGMLBuilding {
  '@_gml:id'?: string;
  'bldg:consistsOfBuildingPart'?: CityGMLBuilding[];
  'bldg:boundedBy'?: CityGMLSurface[];
}

interface CityGMLSurface {
  'bldg:WallSurface'?: CityGMLGeometry;
  'bldg:RoofSurface'?: CityGMLGeometry;
  'bldg:GroundSurface'?: CityGMLGeometry;
}

interface CityGMLGeometry {
  'gml:MultiSurface'?: {
    'gml:surfaceMember'?: CityGMLPolygon[];
  };
  'gml:Polygon'?: CityGMLPolygon;
  'bldg:lod2MultiSurface'?: {
    'gml:MultiSurface'?: {
      'gml:surfaceMember'?: CityGMLPolygon[];
    };
  };
}

interface CityGMLSurfaceMember {
  'gml:Polygon'?: CityGMLPolygon;
}

interface CityGMLPolygon {
  'gml:exterior'?: {
    'gml:LinearRing'?: {
      'gml:posList'?: string;
    };
  };
  'gml:interior'?: {
    'gml:LinearRing'?: {
      'gml:posList'?: string;
    };
  }[];
}

function parsePosList(posList: string): number[][] {
  if (!posList) return [];
  
  const coords = posList.trim().split(/\s+/).map(Number);
  const points: number[][] = [];
  
  // CityGML typically uses 3D coordinates (x, y, z)
  for (let i = 0; i < coords.length; i += 3) {
    if (i + 2 < coords.length) {
      const x = coords[i];
      const y = coords[i + 1];
      const z = coords[i + 2];
      if (x !== undefined && y !== undefined && z !== undefined) {
        points.push([x, y, z]);
      }
    }
  }
  
  return points;
}

function extractPolygons(geometry: CityGMLGeometry): number[][][] {
  const polygons: number[][][] = [];
  
  // Check for bldg:lod2MultiSurface first (this is where the actual geometry is)
  if (geometry['bldg:lod2MultiSurface']?.['gml:MultiSurface']?.['gml:surfaceMember']) {
    const members = Array.isArray(geometry['bldg:lod2MultiSurface']['gml:MultiSurface']['gml:surfaceMember']) 
      ? geometry['bldg:lod2MultiSurface']['gml:MultiSurface']['gml:surfaceMember'] 
      : [geometry['bldg:lod2MultiSurface']['gml:MultiSurface']['gml:surfaceMember']];
    
    for (const member of members) {
      if (member['gml:Polygon']?.['gml:exterior']?.['gml:LinearRing']?.['gml:posList']) {
        const exterior = parsePosList(member['gml:Polygon']['gml:exterior']['gml:LinearRing']['gml:posList']);
        if (exterior.length > 0) {
          polygons.push(exterior);
        }
      }
    }
  }
  
  // Also check for direct gml:Polygon (fallback)
  if (geometry['gml:Polygon']) {
    const polygon = geometry['gml:Polygon'];
    if (polygon['gml:exterior']?.['gml:LinearRing']?.['gml:posList']) {
      const exterior = parsePosList(polygon['gml:exterior']['gml:LinearRing']['gml:posList']);
      if (exterior.length > 0) {
        polygons.push(exterior);
      }
    }
  }
  
  // Also check for direct gml:MultiSurface (fallback)
  if (geometry['gml:MultiSurface']?.['gml:surfaceMember']) {
    const members = Array.isArray(geometry['gml:MultiSurface']['gml:surfaceMember']) 
      ? geometry['gml:MultiSurface']['gml:surfaceMember'] 
      : [geometry['gml:MultiSurface']['gml:surfaceMember']];
    
    for (const member of members) {
      const surfaceMember = member as CityGMLSurfaceMember;
      if (surfaceMember['gml:Polygon']?.['gml:exterior']?.['gml:LinearRing']?.['gml:posList']) {
        const exterior = parsePosList(surfaceMember['gml:Polygon']['gml:exterior']['gml:LinearRing']['gml:posList']);
        if (exterior.length > 0) {
          polygons.push(exterior);
        }
      }
    }
  }
  
  return polygons;
}

function extractBuildingGeometry(building: CityGMLBuilding): Partial<ExtractedBuilding> {
  const result: Partial<ExtractedBuilding> = {
    id: building['@_gml:id'] || `building_${Math.random().toString(36).substr(2, 9)}`,
    footprint: [],
    height: 0,
    walls: [],
    roof: [],
    ground: []
  };
  
  if (!building['bldg:boundedBy']) return result;
  
  const surfaces = Array.isArray(building['bldg:boundedBy']) 
    ? building['bldg:boundedBy'] 
    : [building['bldg:boundedBy']];
  
  let maxHeight = 0;
  let groundPolygons: number[][][] = [];
  
  for (const surface of surfaces) {
    // Extract wall surfaces
    if (surface['bldg:WallSurface']) {
      const wallPolygons = extractPolygons(surface['bldg:WallSurface']);
      if (result.walls) {
        result.walls.push(...wallPolygons);
      }
      
      // Calculate max height from wall coordinates
      for (const polygon of wallPolygons) {
        for (const point of polygon) {
          if (point.length >= 3 && point[2] !== undefined && point[2] > maxHeight) {
            maxHeight = point[2];
          }
        }
      }
    }
    
    // Extract roof surfaces
    if (surface['bldg:RoofSurface']) {
      const roofPolygons = extractPolygons(surface['bldg:RoofSurface']);
      if (result.roof) {
        result.roof.push(...roofPolygons);
      }
      
      // Calculate max height from roof coordinates
      for (const polygon of roofPolygons) {
        for (const point of polygon) {
          if (point.length >= 3 && point[2] !== undefined && point[2] > maxHeight) {
            maxHeight = point[2];
          }
        }
      }
    }
    
    // Extract ground surfaces (for footprint)
    if (surface['bldg:GroundSurface']) {
      const groundPolygons = extractPolygons(surface['bldg:GroundSurface']);
      if (result.ground) {
        result.ground.push(...groundPolygons);
      }
    }
  }
  
  // Create 2D footprint from ground surfaces
  if (result.ground && result.ground.length > 0) {
    // Use the first ground polygon as the footprint, convert to 2D
    const firstGround = result.ground[0];
    if (firstGround) {
      result.footprint = firstGround.map(point => [point[0] ?? 0, point[1] ?? 0]);
    }
  }
  
  result.height = maxHeight;
  
  return result;
}

function extractFromCityGML(gmlPath: string): ExtractedBuilding[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '_text',
    parseAttributeValue: false
  });
  
  console.log(`Parsing CityGML file: ${gmlPath}`);
  
  try {
    const xml = fs.readFileSync(gmlPath, 'utf-8');
    const parsed = parser.parse(xml);
    
    // Debug: Log the parsed structure for large files
    if (gmlPath.includes('DA')) {
      console.log('  Parsed structure keys:', Object.keys(parsed));
    }
  
  const buildings: ExtractedBuilding[] = [];
  
  // Navigate through CityGML structure to find buildings
  const cityModel = parsed['core:CityModel'] || parsed['CityModel'] || parsed['cityModel'] || parsed;
  
  // Debug: Log city model structure for large files
  if (gmlPath.includes('DA')) {
    console.log('  CityModel keys:', Object.keys(cityModel || {}));
  }
  
  // Look for building members in various possible locations
  const buildingMembers = cityModel?.['core:cityObjectMember'] || 
                         cityModel?.['cityObjectMember'] ||
                         cityModel?.['bldg:Building'] ||
                         [];
  
  // Handle the case where buildingMembers contains an array of buildings
  let buildingsToProcess: any[] = [];
  
  if (buildingMembers && typeof buildingMembers === 'object') {
    if (Array.isArray(buildingMembers)) {
      buildingsToProcess = buildingMembers;
    } else if (buildingMembers['bldg:Building']) {
      // Handle case where bldg:Building is an array
      const buildingArray = buildingMembers['bldg:Building'];
      if (Array.isArray(buildingArray)) {
        buildingsToProcess = buildingArray;
      } else {
        buildingsToProcess = [buildingArray];
      }
    } else {
      buildingsToProcess = [buildingMembers];
    }
  }
  
  for (const building of buildingsToProcess) {
    if (!building) continue;
    
    // Handle case where building is a cityObjectMember containing bldg:Building
    let actualBuilding = building;
    if (building['bldg:Building']) {
      actualBuilding = building['bldg:Building'];
    }
    
    if (actualBuilding['bldg:boundedBy']) {
      const extracted = extractBuildingGeometry(actualBuilding);
      if (extracted.footprint && extracted.footprint.length > 0) {
        buildings.push(extracted as ExtractedBuilding);
      }
    }
  }
  
  console.log(`Extracted ${buildings.length} buildings from ${gmlPath}`);
  return buildings;
  } catch (error) {
    console.error(`Error parsing ${gmlPath}:`, error);
    return [];
  }
}

function processDirectory(inputDir: string): ExtractedBuilding[] {
  const allBuildings: ExtractedBuilding[] = [];
  
  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory does not exist: ${inputDir}`);
    return allBuildings;
  }
  
  const files = fs.readdirSync(inputDir);
  const gmlFiles = files.filter((file: string) => file.toLowerCase().endsWith('.gml'));
  
  if (gmlFiles.length === 0) {
    console.error(`No .gml files found in ${inputDir}`);
    return allBuildings;
  }
  
  for (const file of gmlFiles) {
    const filePath = path.join(inputDir, file);
    try {
      const buildings = extractFromCityGML(filePath);
      allBuildings.push(...buildings);
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
    }
  }
  
  return allBuildings;
}

function processAllDAFiles(): ExtractedBuilding[] {
  const daDir = './data/complete';
  const allBuildings: ExtractedBuilding[] = [];
  
  if (!fs.existsSync(daDir)) {
    console.error(`DA directory does not exist: ${daDir}`);
    return allBuildings;
  }
  
  const files = fs.readdirSync(daDir);
  const daFiles = files
    .filter((file: string) => file.toLowerCase().endsWith('.gml'))
    .sort(); // Sort to process in order DA1, DA2, etc.
  
  if (daFiles.length === 0) {
    console.error(`No DA .gml files found in ${daDir}`);
    return allBuildings;
  }
  
  console.log(`Found ${daFiles.length} DA files to process`);
  
  for (let i = 0; i < daFiles.length; i++) {
    const file = daFiles[i];
    const filePath = path.join(daDir, file);
    const fileSize = fs.statSync(filePath).size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
    
    console.log(`Processing ${file} (${fileSizeMB}MB) [${i + 1}/${daFiles.length}]`);
    
    try {
      const buildings = extractFromCityGML(filePath);
      allBuildings.push(...buildings);
      console.log(`  ✓ Extracted ${buildings.length} buildings from ${file}`);
    } catch (error) {
      console.error(`  ✗ Error processing ${file}:`, error);
    }
  }
  
  return allBuildings;
}

// CLI interface
// Check if this is the main module being executed
const isMainModule = process.argv[1] && process.argv[1].endsWith('extract-citygml.ts');

if (isMainModule) {
  const args = process.argv.slice(2);
  const hasAllFlag = args.includes('--all') || args.includes('-a');
  
  let inputDir: string;
  let outputFile: string;
  
  if (hasAllFlag) {
    // Remove the --all flag from args for parsing
    const filteredArgs = args.filter(arg => arg !== '--all' && arg !== '-a');
    inputDir = './data/complete'; // Always use DA directory for --all
    outputFile = filteredArgs[0] || './data/all-da-buildings.json';
  } else {
    inputDir = args[0] || './data/citygml';
    outputFile = args[1] || './data/extracted-buildings.json';
  }
  
  console.log('Starting CityGML extraction...');
  console.log(`Input directory: ${inputDir}`);
  console.log(`Output file: ${outputFile}`);
  
  let buildings: ExtractedBuilding[];
  
  if (hasAllFlag) {
    console.log('Processing all DA files...');
    buildings = processAllDAFiles();
  } else {
    // Check if input is a file or directory
    const stats = fs.statSync(inputDir);
    if (stats.isFile()) {
      // Process single file
      buildings = extractFromCityGML(inputDir);
    } else {
      // Process directory
      buildings = processDirectory(inputDir);
    }
  }
  
  if (buildings.length > 0) {
    // Ensure output directory exists
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputFile, JSON.stringify(buildings, null, 2));
    console.log(`Successfully extracted ${buildings.length} buildings to ${outputFile}`);
    
    // Print some statistics
    const avgHeight = buildings.reduce((sum, b) => sum + b.height, 0) / buildings.length;
    console.log(`Average building height: ${avgHeight.toFixed(2)} units`);
    
    const totalFootprintPoints = buildings.reduce((sum, b) => sum + b.footprint.length, 0);
    console.log(`Total footprint points: ${totalFootprintPoints}`);
  } else {
    console.error('No buildings were extracted. Check your input files.');
  }
}

export { extractFromCityGML, processDirectory, processAllDAFiles, ExtractedBuilding };
