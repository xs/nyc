import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';

interface ExtractedBuilding {
  id: string;
  footprint: number[][]; // 2D coordinates [x, y]
  height: number;
  walls?: number[][][]; // 3D wall polygons [[x, y, z], ...]
  roof?: number[][][];  // 3D roof polygons [[x, y, z], ...]
  ground?: number[][][]; // 3D ground polygons [[x, y, z], ...]
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

function extractPolygons(geometry: any): number[][][] {
  const polygons: number[][][] = [];
  
  // Check for bldg:lod2MultiSurface first (this is where the actual geometry is)
  if (geometry['bldg:lod2MultiSurface']?.['gml:MultiSurface']?.['gml:surfaceMember']) {
    console.log('Found bldg:lod2MultiSurface structure');
    const members = Array.isArray(geometry['bldg:lod2MultiSurface']['gml:MultiSurface']['gml:surfaceMember']) 
      ? geometry['bldg:lod2MultiSurface']['gml:MultiSurface']['gml:surfaceMember'] 
      : [geometry['bldg:lod2MultiSurface']['gml:MultiSurface']['gml:surfaceMember']];
    
    console.log('Number of surface members:', members.length);
    
    for (const member of members) {
      if (member['gml:Polygon']?.['gml:exterior']?.['gml:LinearRing']?.['gml:posList']) {
        console.log('Found gml:posList in surface member');
        const exterior = parsePosList(member['gml:Polygon']['gml:exterior']['gml:LinearRing']['gml:posList']);
        console.log('Parsed exterior with', exterior.length, 'points');
        if (exterior.length > 0) {
          polygons.push(exterior);
        }
      } else {
        console.log('No gml:posList found in surface member');
      }
    }
  } else {
    console.log('No bldg:lod2MultiSurface found');
  }
  
  // Also check for direct gml:Polygon (fallback)
  if (geometry['gml:Polygon']) {
    console.log('Found direct gml:Polygon');
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
    console.log('Found direct gml:MultiSurface');
    const members = Array.isArray(geometry['gml:MultiSurface']['gml:surfaceMember']) 
      ? geometry['gml:MultiSurface']['gml:surfaceMember'] 
      : [geometry['gml:MultiSurface']['gml:surfaceMember']];
    
    for (const member of members) {
      if (member['gml:Polygon']?.['gml:exterior']?.['gml:LinearRing']?.['gml:posList']) {
        const exterior = parsePosList(member['gml:Polygon']['gml:exterior']['gml:LinearRing']['gml:posList']);
        if (exterior.length > 0) {
          polygons.push(exterior);
        }
      }
    }
  }
  
  return polygons;
}

function extractBuildingGeometry(building: any): Partial<ExtractedBuilding> {
  const result: Partial<ExtractedBuilding> = {
    id: building['@_gml:id'] || `building_${Math.random().toString(36).substr(2, 9)}`,
    footprint: [],
    height: 0,
    walls: [],
    roof: [],
    ground: []
  };
  
  console.log('Extracting building:', result.id);
  
  if (!building['bldg:boundedBy']) {
    console.log('No bldg:boundedBy found');
    return result;
  }
  
  const surfaces = Array.isArray(building['bldg:boundedBy']) 
    ? building['bldg:boundedBy'] 
    : [building['bldg:boundedBy']];
  
  console.log('Number of surfaces:', surfaces.length);
  
  let maxHeight = 0;
  let groundPolygons: number[][][] = [];
  
  for (const surface of surfaces) {
    // Extract wall surfaces
    if (surface['bldg:WallSurface']) {
      console.log('Found WallSurface');
      const wallPolygons = extractPolygons(surface['bldg:WallSurface']);
      console.log('Wall polygons extracted:', wallPolygons.length);
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
      console.log('Found RoofSurface');
      const roofPolygons = extractPolygons(surface['bldg:RoofSurface']);
      console.log('Roof polygons extracted:', roofPolygons.length);
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
      console.log('Found GroundSurface');
      const groundPolygons = extractPolygons(surface['bldg:GroundSurface']);
      console.log('Ground polygons extracted:', groundPolygons.length);
      if (result.ground) {
        result.ground.push(...groundPolygons);
      }
      groundPolygons.push(...groundPolygons);
    }
  }
  
  // Create 2D footprint from ground surfaces
  if (result.ground && result.ground.length > 0) {
    console.log('Creating footprint from ground surfaces');
    // Use the first ground polygon as the footprint, convert to 2D
    const firstGround = result.ground[0];
    if (firstGround) {
      result.footprint = firstGround.map(point => [point[0] ?? 0, point[1] ?? 0]);
      console.log('Footprint created with', result.footprint.length, 'points');
    }
  } else {
    console.log('No ground surfaces found for footprint');
  }
  
  result.height = maxHeight;
  console.log('Max height:', maxHeight);
  
  return result;
}

function testExtract() {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '_text',
    parseAttributeValue: false
  });
  
  try {
    const xml = fs.readFileSync('data/sample/DA1_3D_Buildings_Merged_Sample.gml', 'utf-8');
    const parsed = parser.parse(xml);
    
    const cityModel = parsed['CityModel'];
    const cityObjectMembers = cityModel?.['cityObjectMember'];
    
    if (Array.isArray(cityObjectMembers) && cityObjectMembers.length > 0) {
      const firstMember = cityObjectMembers[0];
      if (firstMember && firstMember['bldg:Building']) {
        console.log('Testing extraction of first building...');
        const extracted = extractBuildingGeometry(firstMember['bldg:Building']);
        
        console.log('\nExtraction result:');
        console.log('ID:', extracted.id);
        console.log('Footprint points:', extracted.footprint?.length || 0);
        console.log('Height:', extracted.height);
        console.log('Wall polygons:', extracted.walls?.length || 0);
        console.log('Roof polygons:', extracted.roof?.length || 0);
        console.log('Ground polygons:', extracted.ground?.length || 0);
        
        if (extracted.footprint && extracted.footprint.length > 0) {
          console.log('✅ Building would be included in output');
        } else {
          console.log('❌ Building would be excluded (no footprint)');
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testExtract();
