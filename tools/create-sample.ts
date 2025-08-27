const fs = require('fs');
const path = require('path');

function createSampleFromFile(inputFile: string, outputFile: string) {
  console.log(`Processing: ${path.basename(inputFile)}`);
  
  try {
    // Check file size first
    const stats = fs.statSync(inputFile);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`📁 File size: ${fileSizeMB} MB`);
    
    if (stats.size > 1024 * 1024 * 1024) { // > 1GB
      console.log(`⚠️  Large file detected, processing with caution...`);
    }
    
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

function processAllFiles() {
  const completeDir = 'data/complete';
  const sampleDir = 'data/sample';
  
  // Ensure sample directory exists
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }
  
  // Get all GML files
  const gmlFiles = fs.readdirSync(completeDir)
    .filter((file: string) => file.endsWith('.gml'))
    .sort((a: string, b: string) => {
      // Sort by DA number (DA1, DA2, ..., DA20)
      const aNum = parseInt(a.match(/DA(\d+)/)?.[1] || '0');
      const bNum = parseInt(b.match(/DA(\d+)/)?.[1] || '0');
      return aNum - bNum;
    });
  
  console.log(`Found ${gmlFiles.length} GML files to process:`);
  gmlFiles.forEach((file: string) => console.log(`  - ${file}`));
  
  const results: any[] = [];
  let totalOriginalBuildings = 0;
  let totalSampleBuildings = 0;
  let totalOriginalSize = 0;
  let totalSampleSize = 0;
  let processedCount = 0;
  
  // Process each file
  for (const gmlFile of gmlFiles) {
    const inputFile = path.join(completeDir, gmlFile);
    const outputFile = path.join(sampleDir, gmlFile.replace('.gml', '_Sample.gml'));
    
    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`Processing file ${processedCount + 1} of ${gmlFiles.length}: ${gmlFile}`);
      console.log(`${'='.repeat(50)}`);
      
      const result = createSampleFromFile(inputFile, outputFile);
      results.push({
        file: gmlFile,
        ...result
      });
      
      totalOriginalBuildings += result.originalBuildings;
      totalSampleBuildings += result.sampleBuildings;
      totalOriginalSize += result.originalSize;
      totalSampleSize += result.sampleSize;
      processedCount++;
      
      console.log(`✅ Successfully processed ${gmlFile}`);
      
    } catch (error: any) {
      console.error(`❌ Failed to process ${gmlFile}:`, error.message);
      console.log(`⏭️  Skipping to next file...`);
      continue;
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Files processed: ${processedCount}/${gmlFiles.length}`);
  console.log(`Total buildings: ${totalOriginalBuildings.toLocaleString()} → ${totalSampleBuildings.toLocaleString()} (${((totalSampleBuildings / totalOriginalBuildings) * 100).toFixed(1)}%)`);
  console.log(`Total size: ${(totalOriginalSize / 1024 / 1024 / 1024).toFixed(1)} GB → ${(totalSampleSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Overall size reduction: ${((totalOriginalSize - totalSampleSize) / totalOriginalSize * 100).toFixed(1)}%`);
  
  console.log('\n📁 Sample files created in: data/sample/');
  results.forEach(result => {
    console.log(`  - ${result.file.replace('.gml', '_Sample.gml')} (${result.sampleBuildings} buildings)`);
  });
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('NYC 3D Buildings Sample Generator');
  console.log('================================');
  console.log('');
  console.log('Usage:');
  console.log('  npx tsx tools/create-sample.ts <DA_number>     # Process single DA file');
  console.log('  npx tsx tools/create-sample.ts --all          # Process all DA files');
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx tools/create-sample.ts 1              # Process DA1');
  console.log('  npx tsx tools/create-sample.ts 6              # Process DA6');
  console.log('  npx tsx tools/create-sample.ts --all          # Process all files');
  console.log('');
  console.log('Note: Larger files (>500MB) may cause memory issues.');
  process.exit(1);
}

if (args[0] === '--all' || args[0] === '-a') {
  console.log('🚀 Processing all DA files...');
  processAllFiles();
} else {
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
  
  console.log(`🚀 Processing DA${daNumber}...`);
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
}
