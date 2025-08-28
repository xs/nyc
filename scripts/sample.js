import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Manhattan polygon coordinates (lat, lng)
const MANHATTAN_POLYGON = [
  [40.69338, -74.02154], [40.70360, -74.00009], [40.71021, -73.97083],
  [40.74587, -73.96747], [40.77425, -73.94167], [40.78228, -73.94033],
  [40.79185, -73.93049], [40.80192, -73.92736], [40.80865, -73.93318],
  [40.82045, -73.93379], [40.83443, -73.93441], [40.84575, -73.92854],
  [40.85732, -73.91997], [40.86546, -73.91218], [40.87192, -73.90980],
  [40.87388, -73.91149], [40.87621, -73.92103], [40.87806, -73.92369],
  [40.87858, -73.93236], [40.84290, -73.95531], [40.75411, -74.01612],
  [40.77699, -74.00033]
];

// Point-in-polygon test using ray casting algorithm
function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

// Convert EPSG:2263 coordinates to lat/lng (approximate)
function convertToLatLng(x, y) {
  // This is a rough approximation - in a real implementation you'd use proper projection
  // For now, we'll use a simple offset and scale
  const lat = 40.7128 + (y - 1000000) / 100000; // Rough conversion
  const lng = -74.0060 + (x - 1000000) / 100000; // Rough conversion
  return [lat, lng];
}

// Check if building coordinates are in Manhattan
function isBuildingInManhattan(buildingLines) {
  const coordinates = [];
  
  // Extract coordinates from building lines
  for (const line of buildingLines) {
    if (line.includes('<gml:posList>')) {
      const match = line.match(/<gml:posList>([^<]+)<\/gml:posList>/);
      if (match) {
        const coords = match[1].trim().split(/\s+/).map(Number);
        for (let i = 0; i < coords.length; i += 3) {
          if (i + 2 < coords.length) {
            const [x, y, z] = [coords[i], coords[i + 1], coords[i + 2]];
            const [lat, lng] = convertToLatLng(x, y);
            coordinates.push([lat, lng]);
          }
        }
      }
    }
  }
  
  // Check if any coordinate is in Manhattan
  for (const coord of coordinates) {
    if (pointInPolygon(coord, MANHATTAN_POLYGON)) {
      return true;
    }
  }
  
  return false;
}

async function createSampleFromFile(inputFile, outputFile, percent = 1, borough = false) {
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
    
    let headerLines = [];
    let buildingLines = [];
    let currentBuilding = [];
    let inBuilding = false;
    let buildingDepth = 0;
    let buildingCount = 0;
    let selectedBuildings = [];
    let selectedIndices = [];
    let counter = 0;
    let headerComplete = false;
    
    // Generate random indices for sampling (p out of every 100)
    const p = Math.max(1, Math.floor(percent));
    
    // Create array [0, 1, 2, ..., 98, 99]
    const indices = Array.from({length: 100}, (_, i) => i);
    
    // Fisher-Yates shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    // Take first p elements and create a Set for O(1) lookup
    const selectedIndicesSet = new Set(indices.slice(0, p));
    const selectedIndicesArray = indices.slice(0, p).sort((a, b) => a - b); // For display
    
    console.log(`🔍 Scanning for buildings...`);
    console.log(`Will select ${p} out of every 100 buildings for ~${percent}% sample`);
    console.log(`Selected indices: [${selectedIndicesArray.join(', ')}]`);
    
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
        
        // Estimate total buildings (rough approximation) - only on first building
        if (buildingCount === 1) {
          const estimatedTotal = Math.floor(stats.size / 15000);
          const sampleSize = Math.floor(estimatedTotal * (percent / 100));
          console.log(`Estimated total buildings based on file size: ~${estimatedTotal.toLocaleString()}`);
          console.log(`Target sample size: ~${sampleSize.toLocaleString()} buildings`);
        }
        
        // Check if this building should be selected based on random sampling
        const positionInGroup = counter % 100;
        if (selectedIndicesSet.has(positionInGroup)) {
          selectedBuildings.push(line);
        }
        counter++;
      } else if (inBuilding) {
        currentBuilding.push(line);
        
        if (line.includes('<bldg:') && !line.includes('</bldg:')) {
          buildingDepth++;
        } else if (line.includes('</bldg:')) {
          buildingDepth--;
          if (buildingDepth === 0) {
            // Building complete
            if (selectedBuildings.length > 0 && selectedBuildings[selectedBuildings.length - 1] === currentBuilding[1]) {
              // Check borough filter if enabled
              let shouldInclude = true;
              if (borough) {
                shouldInclude = isBuildingInManhattan(currentBuilding);
              }
              
              if (shouldInclude) {
                currentBuilding.push('  </cityObjectMember>'); // Close cityObjectMember tag
                buildingLines.push(...currentBuilding);
              }
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
    
  } catch (error) {
    console.error(`❌ Error processing ${path.basename(inputFile)}:`, error.message);
    throw error;
  }
}

async function processAllFiles(percent = 1, borough = false) {
  const completeDir = 'data/complete';
  const sampleDir = 'data/sample';
  
  // Ensure sample directory exists
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }
  
  // Get all GML files
  const gmlFiles = fs.readdirSync(completeDir)
    .filter((file) => file.endsWith('.gml'))
    .sort((a, b) => {
      // Sort by DA number (DA1, DA2, ..., DA20)
      const aNum = parseInt(a.match(/DA(\d+)/)?.[1] || '0');
      const bNum = parseInt(b.match(/DA(\d+)/)?.[1] || '0');
      return aNum - bNum;
    });
  
  console.log(`Found ${gmlFiles.length} GML files to process:`);
  gmlFiles.forEach((file) => console.log(`  - ${file}`));
  
  const results = [];
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
      
      const result = await createSampleFromFile(inputFile, outputFile, percent, borough);
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
      
    } catch (error) {
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

// Check for help flag
if (args.includes('--help') || args.includes('-h')) {
  console.log('NYC 3D Buildings Sample Generator (Streaming)');
  console.log('============================================');
  console.log('');
  console.log('Usage:');
  console.log('  npm run sample -- --idx 1                                    # Process DA1');
  console.log('  npm run sample -- --idx 1,2,3                               # Process DA1, DA2, DA3');
  console.log('  npm run sample -- --idx 1,2,3 --pct 5                      # Process with 5% sampling');
  console.log('  npm run sample -- --idx 1,2,3 --borough                    # Process with Manhattan filter');
  console.log('  npm run sample -- --all                                     # Process all DA files');
  console.log('');
  console.log('Arguments:');
  console.log('  -i, --idx, --index <numbers>  Comma-separated DA numbers to process (e.g., "1,2,3")');
  console.log('  -p, --pct, --percent <number>  Sampling percentage (default: 1)');
  console.log('  --borough                    Filter buildings to Manhattan only');
  console.log('  --all, -a                     Process all DA files in data/complete/');
  console.log('  -h, --help                    Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npm run sample -- --idx 1                                   # Process DA1 with 1% sampling');
  console.log('  npm run sample -- --idx 1,2,3                              # Process DA1, DA2, DA3 with 1% sampling');
  console.log('  npm run sample -- --idx 1,2,3 --pct 5                     # Process DA1, DA2, DA3 with 5% sampling');
  console.log('  npm run sample -- --idx 1,2,3 --borough                    # Process with Manhattan filter');
  console.log('  npm run sample -- --all --pct 2                           # Process all files with 2% sampling');
  console.log('');
  console.log('Note: Uses streaming approach to handle large files efficiently.');
  process.exit(0);
}

// Argument parsing function
function getArg(name, aliases = [], defaultValue = undefined) {
  const allNames = [name, ...aliases];
  for (const argName of allNames) {
    const arg = args.find((s) => s === `--${argName}` || s.startsWith(`--${argName}=`));
    if (arg) {
      if (arg.includes('=')) return arg.split('=')[1];
      // Find the next argument as the value
      const index = args.indexOf(arg);
      if (index < args.length - 1 && !args[index + 1].startsWith('-')) {
        return args[index + 1];
      }
      return true;
    }
  }
  return defaultValue;
}

// Parse arguments
const indexArg = getArg('idx', ['index', 'i']);
const percentArg = getArg('pct', ['percent', 'p'], '1');
const borough = args.includes('--borough');
const processAll = args.includes('--all') || args.includes('-a');

// Validate arguments
if (!indexArg && !processAll) {
  console.error('❌ Error: Must specify either --idx <numbers> or --all');
  console.log('Use --help for usage information.');
  process.exit(1);
}

// Parse percentage
const percent = parseInt(percentArg);
if (isNaN(percent) || percent < 1 || percent > 100) {
  console.error('❌ Error: Percentage must be a number between 1 and 100');
  process.exit(1);
}

// Parse DA numbers
let daNumbers = [];
if (indexArg) {
  daNumbers = indexArg.split(',').map(num => {
    const parsed = parseInt(num.trim());
    if (isNaN(parsed)) {
      console.error(`❌ Error: Invalid DA number: ${num}`);
      process.exit(1);
    }
    return parsed;
  });
}



if (processAll) {
  console.log(`🚀 Processing all DA files with ${percent}% sampling${borough ? ' (Manhattan only)' : ''}...`);
  processAllFiles(percent, borough)
    .then(() => {
      console.log('\n✅ All files processed successfully!');
    })
    .catch((error) => {
      console.error('\n❌ Error during batch processing:', error.message);
      process.exit(1);
    });
} else {
  // Process specific DA numbers
  console.log(`🚀 Processing DA files: ${daNumbers.join(', ')} with ${percent}% sampling${borough ? ' (Manhattan only)' : ''}...`);
  
  // Ensure sample directory exists
  if (!fs.existsSync('data/sample')) {
    fs.mkdirSync('data/sample', { recursive: true });
  }
  
  // Process each DA number
  Promise.all(daNumbers.map(async (daNumber) => {
    const inputFile = `data/complete/DA${daNumber}_3D_Buildings_Merged.gml`;
    const outputFile = `data/sample/DA${daNumber}_3D_Buildings_Merged_Sample.gml`;
    
    // Check if input file exists
    if (!fs.existsSync(inputFile)) {
      console.error(`❌ Input file not found: ${inputFile}`);
      return;
    }
    
    console.log(`\nProcessing DA${daNumber}...`);
    console.log(`Input: ${inputFile}`);
    console.log(`Output: ${outputFile}`);
    
          try {
        await createSampleFromFile(inputFile, outputFile, percent, borough);
        console.log(`✅ Successfully processed DA${daNumber}!`);
      } catch (error) {
        console.error(`❌ Failed to process DA${daNumber}:`, error.message);
      }
  })).then(() => {
    console.log('\n✅ All specified files processed!');
  }).catch((error) => {
    console.error('\n❌ Error during processing:', error.message);
    process.exit(1);
  });
}
