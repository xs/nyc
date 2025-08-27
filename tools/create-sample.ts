const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function createSampleFromFile(inputFile: string, outputFile: string) {
  console.log(`Processing: ${path.basename(inputFile)}`);
  
  try {
    // Check file size first
    const stats = fs.statSync(inputFile);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`📁 File size: ${fileSizeMB} MB`);
    
    if (stats.size > 1024 * 1024 * 1024) { // > 1GB
      console.log(`⚠️  Large file detected, using streaming approach...`);
    }
    
    // Create read stream
    const fileStream = fs.createReadStream(inputFile, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    let headerLines: string[] = [];
    let buildingLines: string[] = [];
    let currentBuilding: string[] = [];
    let inBuilding = false;
    let buildingDepth = 0;
    let buildingCount = 0;
    let selectedBuildings: string[] = [];
    let step = 1;
    let currentStep = 0;
    let headerComplete = false;
    
    console.log(`🔍 Scanning for buildings...`);
    
    for await (const line of rl) {
      // Collect header lines until first cityObjectMember
      if (!headerComplete && line.includes('<cityObjectMember>')) {
        headerComplete = true;
        // Don't include this line in header - we'll add our own cityObjectMember tags
        continue;
      }
      
      if (!headerComplete) {
        headerLines.push(line);
        continue;
      }
      
      // Now we're past the header, look for buildings
      if (!inBuilding && line.includes('<bldg:Building gml:id=')) {
        inBuilding = true;
        buildingDepth = 1;
        currentBuilding = ['  <cityObjectMember>', line]; // Start with cityObjectMember tag
        buildingCount++;
        
        // Calculate step for 5% sampling
        if (buildingCount === 1) {
          // Estimate total buildings (rough approximation)
          const estimatedTotal = Math.floor(stats.size / 15000); // Rough estimate based on file size
          const sampleSize = Math.floor(estimatedTotal * 0.05);
          step = Math.floor(estimatedTotal / sampleSize);
          console.log(`Estimated total buildings: ~${estimatedTotal.toLocaleString()}`);
          console.log(`Will select every ${step}th building for ~5% sample`);
        }
        
        currentStep++;
        if (currentStep === step) {
          selectedBuildings.push(line);
          currentStep = 0;
        }
      } else if (inBuilding) {
        currentBuilding.push(line);
        
        if (line.includes('<bldg:') && !line.includes('</bldg:')) {
          buildingDepth++;
        } else if (line.includes('</bldg:')) {
          buildingDepth--;
          if (buildingDepth === 0) {
            // Building complete
            if (selectedBuildings.length > 0 && selectedBuildings[selectedBuildings.length - 1] === currentBuilding[1]) {
              currentBuilding.push('  </cityObjectMember>'); // Close cityObjectMember tag
              buildingLines.push(...currentBuilding);
            }
            currentBuilding = [];
            inBuilding = false;
          }
        }
      }
      
      // Progress indicator
      if (buildingCount % 1000 === 0 && buildingCount > 0) {
        process.stdout.write(`  Found ${buildingCount.toLocaleString()} buildings\r`);
      }
    }
    
    process.stdout.write('\n');
    console.log(`Found ${buildingCount.toLocaleString()} buildings`);
    console.log(`Selected ${buildingLines.filter(line => line.includes('<bldg:Building gml:id=')).length} buildings for sample`);
    
    // Create the sample file content
    const sampleContent = headerLines.join('\n') + '\n' + 
      buildingLines.join('\n') + '\n' +
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
      originalBuildings: buildingCount,
      sampleBuildings: buildingLines.filter(line => line.includes('<bldg:Building gml:id=')).length,
      originalSize,
      sampleSize: sampleSize_bytes
    };
    
  } catch (error: any) {
    console.error(`❌ Error processing ${path.basename(inputFile)}:`, error.message);
    throw error;
  }
}

async function processAllFiles() {
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
      
      const result = await createSampleFromFile(inputFile, outputFile);
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
  console.log('NYC 3D Buildings Sample Generator (Streaming)');
  console.log('============================================');
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
  console.log('Note: Uses streaming approach to handle large files efficiently.');
  process.exit(1);
}

if (args[0] === '--all' || args[0] === '-a') {
  console.log('🚀 Processing all DA files with streaming...');
  processAllFiles()
    .then(() => {
      console.log('\n✅ All files processed successfully!');
    })
    .catch((error) => {
      console.error('\n❌ Error during batch processing:', error.message);
      process.exit(1);
    });
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
  
  console.log(`🚀 Processing DA${daNumber} with streaming approach...`);
  console.log(`Input: ${inputFile}`);
  console.log(`Output: ${outputFile}`);
  console.log('');
  
  createSampleFromFile(inputFile, outputFile)
    .then(() => {
      console.log(`\n✅ Successfully processed DA${daNumber}!`);
    })
    .catch((error) => {
      console.error(`\n❌ Failed to process DA${daNumber}:`, error.message);
      process.exit(1);
    });
}
