const fs = require('fs');
const path = require('path');

function createSampleGML() {
  const inputFile = 'data/complete/DA1_3D_Buildings_Merged.gml';
  const outputFile = 'data/sample/DA1_3D_Buildings_Sample.gml';
  
  console.log('Reading original GML file...');
  const content = fs.readFileSync(inputFile, 'utf8');
  
  // Split content into lines
  const lines = content.split('\n');
  
  // Find the header (everything before the first building)
  let headerEndIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<bldg:Building gml:id=')) {
      headerEndIndex = i;
      break;
    }
  }
  
  // Extract header
  const header = lines.slice(0, headerEndIndex).join('\n');
  
  // Find all building start and end lines
  const buildingRanges: {start: number, end: number}[] = [];
  let currentStart = -1;
  let depth = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes('<bldg:Building gml:id=')) {
      currentStart = i;
      depth = 1;
    } else if (currentStart !== -1) {
      if (line.includes('<bldg:') && !line.includes('</bldg:')) {
        depth++;
      } else if (line.includes('</bldg:')) {
        depth--;
        if (depth === 0) {
          buildingRanges.push({start: currentStart, end: i});
          currentStart = -1;
        }
      }
    }
  }
  
  console.log(`Found ${buildingRanges.length} buildings in original file`);
  
  // Calculate sample size (5% of total buildings)
  const sampleSize = Math.floor(buildingRanges.length * 0.05);
  console.log(`Creating sample with ${sampleSize} buildings (5% of total)`);
  
  // Select buildings to include (every 20th building for approximately 5%)
  const selectedRanges: {start: number, end: number}[] = [];
  const step = Math.floor(buildingRanges.length / sampleSize);
  
  for (let i = 0; i < sampleSize; i++) {
    const index = i * step;
    if (index < buildingRanges.length) {
      selectedRanges.push(buildingRanges[index]);
    }
  }
  
  // Extract building content
  const buildingContents: string[] = [];
  
  for (const range of selectedRanges) {
    const buildingContent = lines.slice(range.start, range.end + 1).join('\n');
    buildingContents.push(buildingContent);
  }
  
  // Create the sample file content
  const sampleContent = header + '\n' + 
    buildingContents.join('\n') + '\n' +
    '  </cityObjectMember>\n' +
    '</CityModel>\n';
  
  // Write the sample file
  fs.writeFileSync(outputFile, sampleContent);
  
  console.log(`Sample GML file created: ${outputFile}`);
  console.log(`Sample contains ${buildingContents.length} buildings`);
  
  // Verify the sample
  const sampleBuildingCount = sampleContent.split('\n').filter(line => 
    line.includes('<bldg:Building gml:id=')
  ).length;
  
  console.log(`Verified: Sample contains ${sampleBuildingCount} buildings`);
  
  // Show file sizes for comparison
  const originalSize = fs.statSync(inputFile).size;
  const sampleSize_bytes = fs.statSync(outputFile).size;
  const sizeReduction = ((originalSize - sampleSize_bytes) / originalSize * 100).toFixed(1);
  
  console.log(`Original file size: ${(originalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Sample file size: ${(sampleSize_bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Size reduction: ${sizeReduction}%`);
}

// Run the function
createSampleGML();
