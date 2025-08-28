import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Manhattan borough polygon coordinates (lat, lng)
// ['(40.69338,-74.02154)', '(40.70360,-74.00009)', '(40.71021,-73.97083)', '(40.74587,-73.96747)', 
//  '(40.77425,-73.94167)', '(40.78228,-73.94033)', '(40.79185,-73.93049)', '(40.80192,-73.92736)', 
//  '(40.80865,-73.93318)', '(40.82045,-73.93379)', '(40.83443,-73.93441)', '(40.84575,-73.92854)', 
//  '(40.85732,-73.91997)', '(40.86546,-73.91218)', '(40.87192,-73.90980)', '(40.87388,-73.91149)', 
//  '(40.87621,-73.92103)', '(40.87806,-73.92369)', '(40.87858,-73.93236)', '(40.84290,-73.95531)', 
//  '(40.75411,-74.01612)', '(40.77699,-74.00033)']
const MANHATTAN_LATLNG = [
  [40.69338, -74.02154], [40.70360, -74.00009], [40.71021, -73.97083], [40.74587, -73.96747],
  [40.77425, -73.94167], [40.78228, -73.94033], [40.79185, -73.93049], [40.80192, -73.92736],
  [40.80865, -73.93318], [40.82045, -73.93379], [40.83443, -73.93441], [40.84575, -73.92854],
  [40.85732, -73.91997], [40.86546, -73.91218], [40.87192, -73.90980], [40.87388, -73.91149],
  [40.87621, -73.92103], [40.87806, -73.92369], [40.87858, -73.93236], [40.84290, -73.95531],
  [40.75411, -74.01612], [40.77699, -74.00033]
];

// Convert lat/lng to EPSG:2263 (NAD83 / New York Long Island)
// This is a simplified transformation - for production use, use a proper geodetic library
function latLngToEPSG2263(lat, lng) {
  // Simplified transformation coefficients for NYC area
  // These are approximate - for accuracy, use proj4js or similar
  const lat0 = 40.7128; // NYC latitude
  const lng0 = -74.0060; // NYC longitude
  const scale = 111320; // meters per degree (approximate)
  
  // Convert to meters from NYC center
  const x = (lng - lng0) * scale * Math.cos(lat0 * Math.PI / 180);
  const y = (lat - lat0) * scale;
  
  // Offset to EPSG:2263 origin (approximate)
  return [x + 1000000, y + 200000];
}

// Convert Manhattan polygon to EPSG:2263 coordinates
const MANHATTAN_POLYGON_EPSG2263 = MANHATTAN_LATLNG.map(([lat, lng]) => latLngToEPSG2263(lat, lng));

// Simple bounding box check (fast)
function isInManhattanBounds(coords) {
  // Manhattan roughly spans from 995000 to 1005000 in X and 188000 to 200000 in Y (EPSG:2263)
  return coords.some(coord => {
    const [x, y] = coord;
    return x >= 995000 && x <= 1005000 && y >= 188000 && y <= 200000;
  });
}

// Point-in-polygon check (more accurate but slower)
function isInManhattanPolygon(coords) {
  return coords.some(coord => pointInPolygon(coord, MANHATTAN_POLYGON_EPSG2263));
}

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

// Extract coordinates from GML posList or pos elements
function extractCoordinates(gmlText) {
  const posListMatch = gmlText.match(/<gml:posList[^>]*>([^<]+)<\/gml:posList>/);
  if (posListMatch) {
    const coords = posListMatch[1].trim().split(/\s+/).map(Number);
    const points = [];
    for (let i = 0; i < coords.length; i += 2) {
      points.push([coords[i], coords[i + 1]]);
    }
    return points;
  }
  
  const posMatches = gmlText.match(/<gml:pos[^>]*>([^<]+)<\/gml:pos>/g);
  if (posMatches) {
    return posMatches.map(match => {
      const coords = match.replace(/<gml:pos[^>]*>([^<]+)<\/gml:pos>/, '$1').trim().split(/\s+/).map(Number);
      return [coords[0], coords[1]];
    });
  }
  
  return null;
}

async function createSampleFromFile(inputFile, outputFile, percent = 1, boroughFilter = false, usePolygon = false) {
  console.log(`Processing: ${path.basename(inputFile)}`);
  
  try {
    // Check file size first
    const stats = fs.statSync(inputFile);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`📁 File size: ${fileSizeMB} MB`);
    
    // Create read stream with larger buffer size
    const fileStream = fs.createReadStream(inputFile, { 
      encoding: 'utf8',
      highWaterMark: 64 * 1024 // 64KB buffer
    });
    
    // Use a custom line reader to handle very long lines
    let buffer = '';
    let lineCount = 0;
    
    let buildingLines = [];
    let currentBuilding = [];
    let inBuilding = false;
    let buildingDepth = 0;
    let buildingCount = 0;
    let selectedBuildings = [];
    let selectedIndices = [];
    let counter = 0;
    let headerComplete = false;
    let headerWritten = false;
    let currentBuildingInManhattan = false;
    let buildingCoordinates = null;
    
    // Create output file and write header immediately
    const outputStream = fs.createWriteStream(outputFile);
    
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
    
    // Custom line processing function
    const processLine = (line) => {
      lineCount++;
      
      // Write header lines directly to output file
      if (!headerComplete && (line.includes('<core:cityObjectMember>') || line.includes('<cityObjectMember>'))) {
        headerComplete = true;
        // Don't include this line in header - we'll add our own cityObjectMember tags
        return;
      }
      
      if (!headerComplete) {
        outputStream.write(line + '\n');
        return;
      }
      
      // Now we're past the header, look for buildings
      if (!inBuilding && line.includes('<bldg:Building gml:id=')) {
        inBuilding = true;
        buildingDepth = 1;
        currentBuilding = ['  <cityObjectMember>', line]; // Start with cityObjectMember tag
        buildingCount++;
        currentBuildingInManhattan = false;
        buildingCoordinates = null;
        
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
        
        // Extract coordinates for borough filtering
        if (boroughFilter && !buildingCoordinates && (line.includes('<gml:posList') || line.includes('<gml:pos'))) {
          buildingCoordinates = extractCoordinates(line);
          if (buildingCoordinates && buildingCoordinates.length > 0) {
            // Check if any point of the building is in Manhattan
            if (usePolygon) {
              currentBuildingInManhattan = isInManhattanPolygon(buildingCoordinates);
            } else {
              currentBuildingInManhattan = isInManhattanBounds(buildingCoordinates);
            }
          }
        }
        
        if (line.includes('<bldg:') && !line.includes('</bldg:')) {
          buildingDepth++;
        } else if (line.includes('</bldg:')) {
          buildingDepth--;
          if (buildingDepth === 0) {
            // Building complete
            if (selectedBuildings.length > 0 && selectedBuildings[selectedBuildings.length - 1] === currentBuilding[1]) {
              // Only include building if it's in Manhattan (when borough filter is enabled)
              if (!boroughFilter || currentBuildingInManhattan) {
                currentBuilding.push('  </cityObjectMember>'); // Close cityObjectMember tag
                buildingLines.push(...currentBuilding);
              }
            }
            currentBuilding = [];
            inBuilding = false;
            currentBuildingInManhattan = false;
            buildingCoordinates = null;
          }
        }
      }
      
      // Progress indicator
      if (buildingCount % 1000 === 0 && buildingCount > 0) {
        process.stdout.write(`  Found ${buildingCount.toLocaleString()} buildings\r`);
      }
    };

    // Process the file using data events
    return new Promise((resolve, reject) => {
      fileStream.on('data', (chunk) => {
        buffer += chunk;
        
        // Process complete lines
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex).replace(/\r$/, '');
          buffer = buffer.substring(newlineIndex + 1);
          
          try {
            processLine(line);
          } catch (error) {
            console.error(`Error processing line ${lineCount}:`, error.message);
            reject(error);
            return;
          }
        }
      });
      
      fileStream.on('end', () => {
        // Process any remaining buffer content
        if (buffer.trim()) {
          try {
            processLine(buffer.trim());
          } catch (error) {
            console.error(`Error processing final line:`, error.message);
            reject(error);
            return;
          }
        }
        
        process.stdout.write('\n');
        console.log(`Found ${buildingCount.toLocaleString()} buildings`);
        console.log(`Selected ${buildingLines.filter(line => line.includes('<bldg:Building gml:id=')).length} buildings for sample`);
        
        // Write the building lines to the output file
        buildingLines.forEach(line => {
          outputStream.write(line + '\n');
        });
        
        // Close the XML
        outputStream.write('</CityModel>\n');
        outputStream.end();
        
        // Wait for the stream to finish writing
        outputStream.on('finish', () => {
          // Show file sizes for comparison
          const originalSize = stats.size;
          const sampleSize_bytes = fs.statSync(outputFile).size;
          const sizeReduction = ((originalSize - sampleSize_bytes) / originalSize * 100).toFixed(1);
          
          console.log(`✅ Sample created: ${path.basename(outputFile)}`);
          console.log(`📊 Original: ${(originalSize / 1024 / 1024).toFixed(1)} MB → Sample: ${(sampleSize_bytes / 1024 / 1024).toFixed(1)} MB (${sizeReduction}% reduction)`);
          
          resolve({
            originalBuildings: buildingCount,
            sampleBuildings: buildingLines.filter(line => line.includes('<bldg:Building gml:id=')).length,
            originalSize,
            sampleSize: sampleSize_bytes
          });
        });
      });
      
      fileStream.on('error', (error) => {
        reject(error);
      });
    });
    
  } catch (error) {
    console.error(`❌ Error processing ${path.basename(inputFile)}:`, error.message);
    throw error;
  }
}

async function processAllFiles(percent = 1, skipOnError = false, boroughFilter = false, usePolygon = false) {
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
  let failedCount = 0;
  let statusEmojis = [];
  
  // Process each file
  for (let i = 0; i < gmlFiles.length; i++) {
    const gmlFile = gmlFiles[i];
    const inputFile = path.join(completeDir, gmlFile);
    const outputFile = path.join(sampleDir, gmlFile.replace('.gml', '_Sample.gml'));
    
    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`Processing file ${i + 1} of ${gmlFiles.length}: ${gmlFile}`);
      console.log(`${'='.repeat(50)}`);
      
      const result = await createSampleFromFile(inputFile, outputFile, percent, boroughFilter, usePolygon);
      
      // Check if we have any buildings in the sample
      if (result.sampleBuildings > 0) {
        results.push({
          file: gmlFile,
          ...result
        });
        
        totalOriginalBuildings += result.originalBuildings;
        totalSampleBuildings += result.sampleBuildings;
        totalOriginalSize += result.originalSize;
        totalSampleSize += result.sampleSize;
        processedCount++;
        statusEmojis.push('✅');
        
        console.log(`✅ Successfully processed ${gmlFile} (${result.sampleBuildings} buildings)`);
      } else {
        // No buildings in Manhattan, but still consider it a success
        processedCount++;
        statusEmojis.push('🏙️'); // Building emoji for "no buildings in Manhattan"
        
        console.log(`🏙️ Processed ${gmlFile} (no buildings in Manhattan)`);
        
        // Remove the output file if it's empty
        if (fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }
      }
      
    } catch (error) {
      console.error(`❌ Failed to process ${gmlFile}:`, error.message);
      failedCount++;
      statusEmojis.push('❌');
      
      if (skipOnError) {
        console.log(`⏭️  Skipping to next file...`);
        continue;
      } else {
        console.error(`\n❌ Processing stopped due to error. Use --skip-on-error to continue processing other files.`);
        process.exit(1);
      }
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Files processed: ${processedCount}/${gmlFiles.length}`);
  if (failedCount > 0) {
    console.log(`Files failed: ${failedCount}/${gmlFiles.length}`);
  }
  console.log(`Total buildings: ${totalOriginalBuildings.toLocaleString()} → ${totalSampleBuildings.toLocaleString()} (${((totalSampleBuildings / totalOriginalBuildings) * 100).toFixed(1)}%)`);
  console.log(`Total size: ${(totalOriginalSize / 1024 / 1024 / 1024).toFixed(1)} GB → ${(totalSampleSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Overall size reduction: ${((totalOriginalSize - totalSampleSize) / totalOriginalSize * 100).toFixed(1)}%`);
  
  // Add emoji status row
  const emojiRow = statusEmojis.join('');
  console.log(`\n📊 Status: ${emojiRow}`);
  
  console.log('\n📁 Sample files created in: data/sample/');
  results.forEach(result => {
    console.log(`  - ${result.file.replace('.gml', '_Sample.gml')} (${result.sampleBuildings} buildings)`);
  });
  
  return { processedCount, failedCount, totalFiles: gmlFiles.length };
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
  console.log('  npm run sample -- --all                                     # Process all DA files');
  console.log('');
  console.log('Arguments:');
  console.log('  -i, --idx, --index <numbers>  Comma-separated DA numbers to process (e.g., "1,2,3")');
  console.log('  -p, --pct, --percent <number>  Sampling percentage (default: 1)');
  console.log('  --all, -a                     Process all DA files in data/complete/');
  console.log('  --skip-on-error               Continue processing other files on error (default: exit)');
  console.log('  --borough                     Filter to Manhattan borough only');
  console.log('  --polygon                     Use point-in-polygon check (slower but more accurate)');
  console.log('  -h, --help                    Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npm run sample -- --idx 1                                   # Process DA1 with 1% sampling');
  console.log('  npm run sample -- --idx 1,2,3                              # Process DA1, DA2, DA3 with 1% sampling');
  console.log('  npm run sample -- --idx 1,2,3 --pct 5                     # Process DA1, DA2, DA3 with 5% sampling');
  console.log('  npm run sample -- --all --pct 2                           # Process all files with 2% sampling');
  console.log('  npm run sample -- --all --skip-on-error                   # Process all files, skip errors');
  console.log('  npm run sample -- --all --borough                         # Process all files, Manhattan only');
  console.log('  npm run sample -- --all --borough --polygon               # Process all files, Manhattan polygon check');
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
const processAll = args.includes('--all') || args.includes('-a');
const skipOnError = args.includes('--skip-on-error');
const boroughFilter = args.includes('--borough');
const usePolygon = args.includes('--polygon');

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
  console.log(`🚀 Processing all DA files with ${percent}% sampling...`);
  if (skipOnError) {
    console.log(`⚠️  --skip-on-error flag enabled: will continue processing on errors`);
  }
  if (boroughFilter) {
    if (usePolygon) {
      console.log(`🗽 --borough flag enabled: filtering to Manhattan only (polygon check)`);
    } else {
      console.log(`🗽 --borough flag enabled: filtering to Manhattan only (bounding box)`);
    }
  }
  processAllFiles(percent, skipOnError, boroughFilter, usePolygon)
    .then((result) => {
      if (result.processedCount === result.totalFiles) {
        console.log('\n✅ All files processed successfully!');
      } else if (result.failedCount > 0) {
        console.log(`\n⚠️  Processing completed with ${result.failedCount} failures.`);
      } else {
        console.log('\n✅ All files processed successfully!');
      }
    })
    .catch((error) => {
      console.error('\n❌ Error during batch processing:', error.message);
      process.exit(1);
    });
} else {
  // Process specific DA numbers
  console.log(`🚀 Processing DA files: ${daNumbers.join(', ')} with ${percent}% sampling...`);
  if (skipOnError) {
    console.log(`⚠️  --skip-on-error flag enabled: will continue processing on errors`);
  }
  if (boroughFilter) {
    if (usePolygon) {
      console.log(`🗽 --borough flag enabled: filtering to Manhattan only (polygon check)`);
    } else {
      console.log(`🗽 --borough flag enabled: filtering to Manhattan only (bounding box)`);
    }
  }
  
  // Ensure sample directory exists
  if (!fs.existsSync('data/sample')) {
    fs.mkdirSync('data/sample', { recursive: true });
  }
  
  let processedCount = 0;
  let failedCount = 0;
  let statusEmojis = [];
  
  // Process each DA number sequentially
  for (let i = 0; i < daNumbers.length; i++) {
    const daNumber = daNumbers[i];
    const inputFile = `data/complete/DA${daNumber}_3D_Buildings_Merged.gml`;
    const outputFile = `data/sample/DA${daNumber}_3D_Buildings_Merged_Sample.gml`;
    
    // Check if input file exists
    if (!fs.existsSync(inputFile)) {
      console.error(`❌ Input file not found: ${inputFile}`);
      if (skipOnError) {
        failedCount++;
        statusEmojis.push('❌');
        continue;
      } else {
        process.exit(1);
      }
    }
    
    console.log(`\nProcessing DA${daNumber}...`);
    console.log(`Input: ${inputFile}`);
    console.log(`Output: ${outputFile}`);
    
    try {
      const result = await createSampleFromFile(inputFile, outputFile, percent, boroughFilter, usePolygon);
      
      // Check if we have any buildings in the sample
      if (result.sampleBuildings > 0) {
        processedCount++;
        statusEmojis.push('✅');
        console.log(`✅ Successfully processed DA${daNumber}! (${result.sampleBuildings} buildings)`);
      } else {
        // No buildings in Manhattan, but still consider it a success
        processedCount++;
        statusEmojis.push('🏙️'); // Building emoji for "no buildings in Manhattan"
        console.log(`🏙️ Processed DA${daNumber} (no buildings in Manhattan)`);
        
        // Remove the output file if it's empty
        if (fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to process DA${daNumber}:`, error.message);
      failedCount++;
      statusEmojis.push('❌');
      
      if (skipOnError) {
        console.log(`⏭️  Skipping to next file...`);
        continue;
      } else {
        console.error(`\n❌ Processing stopped due to error. Use --skip-on-error to continue processing other files.`);
        process.exit(1);
      }
    }
  }
  
  // Final message with emoji status
  const emojiRow = statusEmojis.join('');
  console.log(`\n📊 Status: ${emojiRow}`);
  
  if (processedCount === daNumbers.length) {
    console.log('\n✅ All specified files processed successfully!');
  } else if (failedCount > 0) {
    console.log(`\n⚠️  Processing completed with ${failedCount} failures.`);
  } else {
    console.log('\n✅ All specified files processed successfully!');
  }
}
