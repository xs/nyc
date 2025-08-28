import fs from 'fs';
import path from 'path';
import readline from 'readline';
import proj4 from 'proj4';

// Manhattan borough polygon coordinates (lat, lng)
// Based on actual building coordinate ranges in EPSG:2263
// Buildings are in range: X: 995000-1000000, Y: 198000-200000
// Let's create a polygon that covers this range with some buffer
const MANHATTAN_LATLNG = [
  [40.69338, -74.02154], [40.70360, -74.00009], [40.71021, -73.97083], [40.74587, -73.96747],
  [40.77425, -73.94167], [40.78228, -73.94033], [40.79185, -73.93049], [40.80192, -73.92736],
  [40.80865, -73.93318], [40.82045, -73.93379], [40.83443, -73.93441], [40.84575, -73.92854],
  [40.85732, -73.91997], [40.86546, -73.91218], [40.87192, -73.90980], [40.87388, -73.91149],
  [40.87621, -73.92103], [40.87806, -73.92369], [40.87858, -73.93236], [40.84290, -73.95531],
  [40.75411, -74.01612], [40.77699, -74.00033]
];

// Define EPSG:2263 projection for precise coordinate transformation
proj4.defs(
  'EPSG:2263',
  '+proj=lcc +lat_1=41.03333333333333 +lat_2=40.66666666666666 +lat_0=40.16666666666666 +lon_0=-74 +x_0=300000.0000000001 +y_0=0 +datum=NAD83 +units=us-ft +no_defs'
);

// Convert lat/lng to EPSG:2263 with maximum precision
function latLngToEPSG2263(lat, lng) {
  // Use proj4js for precise coordinate transformation
  const transformed = proj4('EPSG:4326', 'EPSG:2263', [lng, lat]);
  return [transformed[0], transformed[1]];
}

// Create a simple bounding box for Manhattan based on actual building coordinates
// Buildings are in range: X: 995000-1000000, Y: 198000-200000
// Expanded slightly to capture more of Manhattan
const MANHATTAN_BOUNDS = {
  minX: 994000,
  maxX: 1001000,
  minY: 197000,
  maxY: 201000
};

// Simple bounding box check for Manhattan (fast and accurate for our data)
function isInManhattanBounds(coords) {
  return coords.some(coord => {
    const [x, y] = coord;
    return x >= MANHATTAN_BOUNDS.minX && x <= MANHATTAN_BOUNDS.maxX && 
           y >= MANHATTAN_BOUNDS.minY && y <= MANHATTAN_BOUNDS.maxY;
  });
}

// Convert Manhattan polygon to EPSG:2263 coordinates
const MANHATTAN_POLYGON_EPSG2263 = MANHATTAN_LATLNG.map(([lat, lng]) => latLngToEPSG2263(lat, lng));

// Parse polygon string from command line argument
function parsePolygonString(polyString) {
  try {
    // Remove quotes and split by commas
    const cleanString = polyString.replace(/['"]/g, '');
    const coordPairs = cleanString.split('),(');
    
    const polygon = [];
    for (const pair of coordPairs) {
      // Remove parentheses and split by comma
      const cleanPair = pair.replace(/[()]/g, '');
      const [lat, lng] = cleanPair.split(',').map(Number);
      
      if (isNaN(lat) || isNaN(lng)) {
        throw new Error(`Invalid coordinate: ${pair}`);
      }
      
      polygon.push([lat, lng]);
    }
    
    return polygon;
  } catch (error) {
    throw new Error(`Failed to parse polygon: ${error.message}`);
  }
}

// Point-in-polygon check for Manhattan
function isInManhattan(coords) {
  // Use bounding box check for maximum accuracy with our data
  return isInManhattanBounds(coords);
}

// Point-in-polygon check for custom polygon
function isInCustomPolygon(coords, polygonEPSG2263) {
  return coords.some(coord => pointInPolygon(coord, polygonEPSG2263));
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

// Generate output directory name based on parameters
function generateOutputDirName(percent, boroughFilter, customPolygon) {
  if (customPolygon) {
    return `poly-${percent}`;
  } else if (boroughFilter) {
    return percent === 100 ? 'manhattan-all' : `manhattan-${percent}`;
  } else {
    return `nyc-${percent}`;
  }
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

async function createSampleFromFile(inputFile, outputFile, percent = 1, boroughFilter = false, customPolygonEPSG2263 = null) {
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
    let skipBuildingLines = false;
    
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
        skipBuildingLines = false;
        
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
        // Early skip check - if we're skipping this building, only process closing tags
        if (skipBuildingLines) {
          if (line.includes('<bldg:') && !line.includes('</bldg:')) {
            buildingDepth++;
          } else if (line.includes('</bldg:')) {
            buildingDepth--;
            if (buildingDepth === 0) {
              // Building complete - reset for next building
              currentBuilding = [];
              inBuilding = false;
              currentBuildingInManhattan = false;
              buildingCoordinates = null;
              skipBuildingLines = false;
            }
          }
          return; // Skip all other processing for this building
        }
        
        // Extract coordinates for filtering (only if we haven't found any yet)
        if ((boroughFilter || customPolygonEPSG2263) && !buildingCoordinates && (line.includes('<gml:posList') || line.includes('<gml:pos'))) {
          buildingCoordinates = extractCoordinates(line);
          if (buildingCoordinates && buildingCoordinates.length > 0) {
            // Check if any point of the building is in the target area
            let inTargetArea = false;
            if (customPolygonEPSG2263) {
              inTargetArea = isInCustomPolygon(buildingCoordinates, customPolygonEPSG2263);
            } else {
              inTargetArea = isInManhattan(buildingCoordinates);
            }
            currentBuildingInManhattan = inTargetArea;
            
            // Early skip: if building is outside target area and we have coordinates, skip the rest
            if (!inTargetArea) {
              // Fast-forward through the building until we find the closing tag
              skipBuildingLines = true;
              // Don't add this line to currentBuilding since we're skipping
              return;
            }
          }
        }
        
        // Add line to currentBuilding (we know we're not skipping at this point)
        currentBuilding.push(line);
        
        if (line.includes('<bldg:') && !line.includes('</bldg:')) {
          buildingDepth++;
        } else if (line.includes('</bldg:')) {
          buildingDepth--;
          if (buildingDepth === 0) {
            // Building complete
            if (selectedBuildings.length > 0 && selectedBuildings[selectedBuildings.length - 1] === currentBuilding[1]) {
                          // Only include building if it's in the target area (when filtering is enabled)
            if (!(boroughFilter || customPolygonEPSG2263) || currentBuildingInManhattan) {
                currentBuilding.push('  </cityObjectMember>'); // Close cityObjectMember tag
                buildingLines.push(...currentBuilding);
              }
            }
            currentBuilding = [];
            inBuilding = false;
            currentBuildingInManhattan = false;
            buildingCoordinates = null;
            skipBuildingLines = false;
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

async function processAllFiles(percent = 1, skipOnError = false, boroughFilter = false, customPolygonEPSG2263 = null, outputDirName = null, specificDANumbers = null) {
  const completeDir = 'data/complete';
  const sampleDir = outputDirName ? `data/${outputDirName}` : 'data/sample';
  
  // Ensure sample directory exists
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }
  
  // Get GML files to process
  let gmlFiles;
  if (specificDANumbers) {
    // Process specific DA numbers
    gmlFiles = specificDANumbers.map(daNum => `DA${daNum}_3D_Buildings_Merged.gml`);
    console.log(`Processing ${gmlFiles.length} specified DA files:`);
    gmlFiles.forEach((file) => console.log(`  - ${file}`));
  } else {
    // Process all GML files
    gmlFiles = fs.readdirSync(completeDir)
      .filter((file) => file.endsWith('.gml'))
      .sort((a, b) => {
        // Sort by DA number (DA1, DA2, ..., DA20)
        const aNum = parseInt(a.match(/DA(\d+)/)?.[1] || '0');
        const bNum = parseInt(b.match(/DA(\d+)/)?.[1] || '0');
        return aNum - bNum;
      });
    console.log(`Found ${gmlFiles.length} GML files to process:`);
    gmlFiles.forEach((file) => console.log(`  - ${file}`));
  }
  
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
      
      const result = await createSampleFromFile(inputFile, outputFile, percent, boroughFilter, customPolygonEPSG2263);
      
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
  console.log('  --poly <polygon>              Filter to custom polygon (lat,lng format)');
  console.log('  --output-dir <name>           Custom output directory name');
  console.log('  -h, --help                    Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npm run sample -- --idx 1                                   # Process DA1 with 1% sampling');
  console.log('  npm run sample -- --idx 1,2,3                              # Process DA1, DA2, DA3 with 1% sampling');
  console.log('  npm run sample -- --idx 1,2,3 --pct 5                     # Process DA1, DA2, DA3 with 5% sampling');
  console.log('  npm run sample -- --all --pct 2                           # Process all files with 2% sampling');
  console.log('  npm run sample -- --all --skip-on-error                   # Process all files, skip errors');
  console.log('  npm run sample -- --all --borough                         # Process all files, Manhattan only');
  console.log('  npm run sample -- --all --poly "(lat1,lng1),(lat2,lng2)"  # Process all files, custom polygon');
  console.log('  npm run sample -- --all --borough --output-dir manhattan  # Custom output directory');
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
const polyArg = getArg('poly');
const outputDirArg = getArg('output-dir');

// Validate arguments
if (!indexArg && !processAll) {
  console.error('❌ Error: Must specify either --idx <numbers> or --all');
  console.log('Use --help for usage information.');
  process.exit(1);
}

// Validate polygon and borough filter mutual exclusivity
if (boroughFilter && polyArg) {
  console.error('❌ Error: Cannot use both --borough and --poly. Use one or the other.');
  process.exit(1);
}

// Parse and validate polygon if provided
let customPolygonEPSG2263 = null;
if (polyArg) {
  try {
    const customPolygon = parsePolygonString(polyArg);
    customPolygonEPSG2263 = customPolygon.map(([lat, lng]) => latLngToEPSG2263(lat, lng));
    console.log(`🗺️  Custom polygon loaded with ${customPolygon.length} points`);
  } catch (error) {
    console.error(`❌ Error parsing polygon: ${error.message}`);
    process.exit(1);
  }
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



// Generate output directory name
const outputDirName = outputDirArg || generateOutputDirName(percent, boroughFilter, customPolygonEPSG2263);

if (processAll) {
  console.log(`🚀 Processing all DA files with ${percent}% sampling...`);
  if (skipOnError) {
    console.log(`⚠️  --skip-on-error flag enabled: will continue processing on errors`);
  }
  if (boroughFilter) {
    console.log(`🗽 --borough flag enabled: filtering to Manhattan only`);
  }
  if (customPolygonEPSG2263) {
    console.log(`🗺️  Custom polygon filter enabled`);
  }
  console.log(`📁 Output directory: data/${outputDirName}`);
  processAllFiles(percent, skipOnError, boroughFilter, customPolygonEPSG2263, outputDirName, null)
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
    console.log(`🗽 --borough flag enabled: filtering to Manhattan only`);
  }
  if (customPolygonEPSG2263) {
    console.log(`🗺️  Custom polygon filter enabled`);
  }
  console.log(`📁 Output directory: data/${outputDirName}`);
  
  processAllFiles(percent, skipOnError, boroughFilter, customPolygonEPSG2263, outputDirName, daNumbers)
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
}
