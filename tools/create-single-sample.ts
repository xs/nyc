const fs = require('fs');
const path = require('path');

function createSampleFromFile(inputFile: string, outputFile: string) {
  console.log(`Processing: ${path.basename(inputFile)}`);
  
  try {
    // Check file size first
    const stats = fs.statSync(inputFile);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`📁 File size: ${fileSizeMB} MB`);
    
    const content = fs.readFileSync(inputFile, 'utf8');
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
    
    console.log(`🔍 Scanning for buildings...`);
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
      
      // Progress indicator for large files
      if (i % 100000 === 0 && i > 0) {
        process.stdout.write(`  Progress: ${((i / lines.length) * 100).toFixed(1)}%\r`);
      }
    }
    process.stdout.write('\n');
    
    console.log(`Found ${buildingRanges.length} buildings`);
    
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
    
    console.log(`📝 Extracting building data...`);
    for (let i = 0; i < selectedRanges.length; i++) {
      const range = selectedRanges[i];
      const buildingContent = lines.slice(range.start, range.end + 1).join('\n');
      buildingContents.push(buildingContent);
      
      // Progress indicator
      if (i % 100 === 0 && i > 0) {
        process.stdout.write(`  Progress: ${((i / selectedRanges.length) * 100).toFixed(1)}%\r`);
      }
    }
    process.stdout.write('\n');
    
    // Create the sample file content
    const sampleContent = header + '\n' + 
      buildingContents.join('\n') + '\n' +
      '  </cityObjectMember>\n' +
      '</CityModel>\n';
    
    // Write the sample file
    fs.writeFileSync(outputFile, sampleContent);
    
    // Show file sizes for comparison
    const originalSize = stats.size;
    const sampleSize_bytes = fs.statSync(outputFile).size;
    const sizeReduction = ((originalSize - sampleSize_bytes) / originalSize * 100).toFixed(1);
    
    console.log(`✅ Sample created: ${path.basename(outputFile)}`);
    console.log(`📊 Original: ${(originalSize / 1024 / 1024).toFixed(1)} MB → Sample: ${(sampleSize_bytes / 1024 / 1024).toFixed(1)} MB (${sizeReduction}% reduction)`);
    
    return {
      originalBuildings: buildingRanges.length,
      sampleBuildings: buildingContents.length,
      originalSize,
      sampleSize: sampleSize_bytes
    };
    
  } catch (error: any) {
    console.error(`❌ Error processing ${path.basename(inputFile)}:`, error.message);
    throw error;
  }
}

// Get command line arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage: npx tsx tools/create-single-sample.ts <DA_number>');
  console.log('Example: npx tsx tools/create-single-sample.ts 6');
  process.exit(1);
}

const daNumber = args[0];
const inputFile = `data/complete/DA${daNumber}_3D_Buildings_Merged.gml`;
const outputFile = `data/sample/DA${daNumber}_3D_Buildings_Merged_Sample.gml`;

// Ensure sample directory exists
if (!fs.existsSync('data/sample')) {
  fs.mkdirSync('data/sample', { recursive: true });
}

// Check if input file exists
if (!fs.existsSync(inputFile)) {
  console.error(`❌ Input file not found: ${inputFile}`);
  process.exit(1);
}

console.log(`Processing DA${daNumber}...`);
console.log(`Input: ${inputFile}`);
console.log(`Output: ${outputFile}`);
console.log('');

try {
  createSampleFromFile(inputFile, outputFile);
  console.log(`\n✅ Successfully processed DA${daNumber}!`);
} catch (error) {
  console.error(`\n❌ Failed to process DA${daNumber}`);
  process.exit(1);
}
