import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';

function debugExtract(gmlPath: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '_text',
    parseAttributeValue: false
  });
  
  console.log(`Debug parsing: ${gmlPath}`);
  
  try {
    const xml = fs.readFileSync(gmlPath, 'utf-8');
    const parsed = parser.parse(xml);
    
    console.log('Parsed structure keys:', Object.keys(parsed));
    
    const cityModel = parsed['CityModel'];
    console.log('CityModel keys:', Object.keys(cityModel || {}));
    
    const cityObjectMembers = cityModel?.['cityObjectMember'];
    console.log('cityObjectMember type:', typeof cityObjectMembers);
    console.log('cityObjectMember is array:', Array.isArray(cityObjectMembers));
    
    if (Array.isArray(cityObjectMembers)) {
      console.log('cityObjectMember array length:', cityObjectMembers.length);
      console.log('First cityObjectMember keys:', Object.keys(cityObjectMembers[0] || {}));
      
      // Check if first member has bldg:Building
      const firstMember = cityObjectMembers[0];
      if (firstMember && firstMember['bldg:Building']) {
        console.log('First member has bldg:Building!');
        const building = firstMember['bldg:Building'];
        console.log('bldg:Building keys:', Object.keys(building));
        
        // Check bldg:boundedBy
        if (building['bldg:boundedBy']) {
          console.log('Building has bldg:boundedBy!');
          const boundedBy = building['bldg:boundedBy'];
          console.log('bldg:boundedBy type:', typeof boundedBy);
          console.log('bldg:boundedBy is array:', Array.isArray(boundedBy));
          
          if (Array.isArray(boundedBy)) {
            console.log('bldg:boundedBy array length:', boundedBy.length);
            console.log('First boundedBy keys:', Object.keys(boundedBy[0] || {}));
            
            // Check for surface types
            const firstSurface = boundedBy[0];
            if (firstSurface) {
              console.log('Surface keys:', Object.keys(firstSurface));
              if (firstSurface['bldg:WallSurface']) {
                console.log('Has WallSurface!');
              }
              if (firstSurface['bldg:RoofSurface']) {
                console.log('Has RoofSurface!');
              }
              if (firstSurface['bldg:GroundSurface']) {
                console.log('Has GroundSurface!');
              }
            }
          }
        } else {
          console.log('Building does not have bldg:boundedBy');
        }
      } else {
        console.log('First member does not have bldg:Building');
      }
    } else if (cityObjectMembers) {
      console.log('cityObjectMember is object, keys:', Object.keys(cityObjectMembers));
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run debug on the sample file
debugExtract('data/sample/DA1_3D_Buildings_Merged_Sample.gml');
