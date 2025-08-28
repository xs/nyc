import readline from 'readline';
import fs, { read } from 'fs';
import path from 'path';
import proj4 from 'proj4';

// Named region polygon coordinates (lat, lng)
// Based on actual building coordinate ranges in EPSG:2263
// Buildings are in range: X: 995000-1000000, Y: 198000-200000
// Let's create a polygon that covers this range with some buffer
const REGIONS = {
  manhattan: [ 
  [40.69880, -74.01355],
  [40.71161, -73.97322],
  [40.75516, -73.96023],
  [40.77962, -73.93760],
  [40.78787, -73.93593],
  [40.79740, -73.92768],
  [40.80455, -73.92994],
  [40.80977, -73.93323],
  [40.83528, -73.93426],
  [40.85428, -73.92289],
  [40.86810, -73.91012],
  [40.87348, -73.91050],
  [40.87949, -73.93056],
  [40.73901, -74.02210],
  [40.70193, -74.02398]
]
};

// Define EPSG:2263 projection for precise coordinate transformation
proj4.defs(
  'EPSG:2263',
  '+proj=lcc +lat_1=41.03333333333333 +lat_2=40.66666666666666 +lat_0=40.16666666666666 +lon_0=-74 +x_0=300000.0000000001 +y_0=0 +datum=NAD83 +units=us-ft +no_defs'
);

const REGIONS_EPSG2263 = {}
for (const [name, coords] of Object.entries(REGIONS)) {
  REGIONS_EPSG2263[name] = coords.map(([lat, lng]) => latLngToEPSG2263(lat, lng));
}

// Convert lat/lng to EPSG:2263 with maximum precision
function latLngToEPSG2263(lat, lng) {
  // Use proj4js for precise coordinate transformation
  const transformed = proj4('EPSG:4326', 'EPSG:2263', [lng, lat]);
  
  return [transformed[0], transformed[1]];
}

// Extract boundedBy envelope from GML file (streaming version)
async function extractBoundedByEnvelopeStreaming(inputFile) {
  return new Promise((resolve) => {
    // Read only the first 1MB to find the boundedBy section
    const fileStream = fs.createReadStream(inputFile, { 
      encoding: 'utf8',
      highWaterMark: 64 * 1024, // 64KB buffer
      start: 0,
      end: 1024 * 1024 // Read only first 1MB
    });
    
    let buffer = '';
    
    fileStream.on('data', (chunk) => {
      buffer += chunk;
    });
    
    fileStream.on('end', () => {
      const envelope = extractBoundedByEnvelope(buffer);
      resolve(envelope);
    });
    
    fileStream.on('error', () => {
      resolve(null);
    });
  });
}

// Extract boundedBy envelope from GML file (legacy version for small files)
function extractBoundedByEnvelope(gmlText) {
  const boundedByMatch = gmlText.match(/<gml:boundedBy>[\s\S]*?<gml:Envelope[^>]*>[\s\S]*?<gml:lowerCorner>([^<]+)<\/gml:lowerCorner>[\s\S]*?<gml:upperCorner>([^<]+)<\/gml:upperCorner>[\s\S]*?<\/gml:Envelope>[\s\S]*?<\/gml:boundedBy>/);
  if (boundedByMatch) {
    const lowerCorner = boundedByMatch[1].trim().split(/\s+/).map(Number);
    const upperCorner = boundedByMatch[2].trim().split(/\s+/).map(Number);
    return {
      minX: lowerCorner[0],
      minY: lowerCorner[1],
      maxX: upperCorner[0],
      maxY: upperCorner[1]
    };
  }
  return null;
}

// Check if envelope is entirely outside our bounding filter
function isEnvelopeOutsideFilter(envelope, regionArg, customPolygonEPSG2263) {
  if (!envelope) return false; // If no envelope, we can't skip the file
  if (!regionArg && !customPolygonEPSG2263) return false; // No filtering

  const boundary = regionArg ? REGIONS_EPSG2263[regionArg] : customPolygonEPSG2263;
  const polygonBounds = {
    minX: Math.min(...boundary.map(p => p[0])),
    maxX: Math.max(...boundary.map(p => p[0])),
    minY: Math.min(...boundary.map(p => p[1])),
    maxY: Math.max(...boundary.map(p => p[1]))
  };
  return envelope.maxX < polygonBounds.minX || 
          envelope.minX > polygonBounds.maxX || 
          envelope.maxY < polygonBounds.minY || 
          envelope.minY > polygonBounds.maxY;

}

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
function isInRegion(coords, region) {
  return coords.some(coord => pointInPolygon(coord, REGIONS_EPSG2263[region]));
}

// Point-in-polygon check for custom polygon
function isInCustomPolygon(coords, polygonEPSG2263) {
  return coords.some(coord => pointInPolygon(coord, polygonEPSG2263));
}

// Point-in-polygon test using ray casting algorithm with floating point tolerance
function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  
  // Floating point tolerance for coordinate comparisons
  // EPSG:2263 coordinates are in meters, try 100 meters tolerance
  const EPSILON = 100;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    
    // Handle horizontal edges (avoid division by zero)
    if (Math.abs(yj - yi) < EPSILON) {
      // Horizontal edge - check if point is on the edge
      if (Math.abs(y - yi) < EPSILON && x >= Math.min(xi, xj) - EPSILON && x <= Math.max(xi, xj) + EPSILON) {
        return true; // Point is on the edge
      }
      continue; // Skip horizontal edges for ray casting
    }
    
    // Check if ray intersects edge
    if ((yi > y + EPSILON) !== (yj > y + EPSILON)) {
      // Calculate intersection point
      const intersectX = xi + (xj - xi) * (y - yi) / (yj - yi);
      
      // Check if intersection is to the right of the point
      if (x < intersectX + EPSILON) {
        inside = !inside;
      }
    }
  }
  
  return inside;
}

// Generate output directory name based on parameters
function generateOutputDirName(percent, regionFilter, customPolygon) {
  const prefix = customPolygon ? 'poly' : regionFilter ? 'manhattan' : 'nyc';
  const percentStr = percent === 100 ? 'all' : percent.toString();
  return `${prefix}-${percentStr}-${Date.now()}`;
}

// Extract coordinates from GML posList or pos elements
function extractCoordinates(gmlText) {
  const posListMatch = gmlText.match(/<gml:posList[^>]*>([^<]+)<\/gml:posList>/);
  if (posListMatch) {
    const coords = posListMatch[1].trim().split(/\s+/).map(Number);
    const points = [];
    // GML coordinates are X/Y/Z triplets, so we skip every third coordinate (Z)
    for (let i = 0; i < coords.length; i += 3) {
      points.push([coords[i], coords[i + 1]]); // X, Y only
    }
    return points;
  }
  
  const posMatches = gmlText.match(/<gml:pos[^>]*>([^<]+)<\/gml:pos>/g);
  if (posMatches) {
    return posMatches.map(match => {
      const coords = match.replace(/<gml:pos[^>]*>([^<]+)<\/gml:pos>/, '$1').trim().split(/\s+/).map(Number);
      return [coords[0], coords[1]]; // X, Y only (ignore Z)
    });
  }
  
  return null;
}

async function createSampleFromFile(inputFile, outputFile, percent = 1, regionFilter = false, customPolygonEPSG2263 = null) {
  console.log(`Processing: ${path.basename(inputFile)}`);
  
  try {
    // Check file size first
    const stats = fs.statSync(inputFile);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`📁 File size: ${fileSizeMB} MB`);
    
    // Early boundedBy check for spatial filtering
    if (regionFilter || customPolygonEPSG2263) {
      const envelope = await extractBoundedByEnvelopeStreaming(inputFile);
      
      if (envelope) {
        console.log(`🗺️  File envelope: X[${envelope.minX.toFixed(0)}-${envelope.maxX.toFixed(0)}], Y[${envelope.minY.toFixed(0)}-${envelope.maxY.toFixed(0)}]`);
        
        if (isEnvelopeOutsideFilter(envelope, regionFilter, customPolygonEPSG2263)) {
          console.log(`⏭️  File envelope entirely outside filter bounds - skipping file`);
          // Create empty output file
          fs.writeFileSync(outputFile, '');
          return { buildingCount: 0, selectedCount: 0 };
        }
      } else {
        console.log(`⚠️  No boundedBy envelope found - processing entire file`);
      }
    }
    
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
    let counter = 0;
    let headerComplete = false;
    let headerWritten = false;
    let currentBuildingInBoundary = false;
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
    
    console.log(`🔍 Scanning for buildings...`);
    console.log(`Will select ${p} out of every 100 buildings for ~${percent}% sample`);
    
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
        currentBuildingInBoundary = false;
        buildingCoordinates = null;
        skipBuildingLines = false;
        
        // Estimate total buildings (rough approximation) - only on first building
        if (buildingCount === 1) {
          const estimatedTotal = Math.floor(stats.size / 15000);
          const sampleSize = Math.floor(estimatedTotal * (percent / 100));
          console.log(`Based on file size....`);
          console.log(`Estimated total buildings:  ~${estimatedTotal.toLocaleString()} buildings`);
          console.log(`Target sample size:         ~${sampleSize.toLocaleString()} buildings`);
          process.stdout.write('\n')
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
              currentBuildingInBoundary = false;
              buildingCoordinates = null;
              skipBuildingLines = false;
            }
          }
          return; // Skip all other processing for this building
        }
        
        // Extract coordinates for filtering (only if we haven't found any yet)
        if ((regionArg || customPolygonEPSG2263) && !buildingCoordinates && (line.includes('<gml:posList') || line.includes('<gml:pos'))) {
          buildingCoordinates = extractCoordinates(line);
          if (buildingCoordinates && buildingCoordinates.length > 0) {
            // Check if any point of the building is in the target area
            let inTargetArea = false;
            if (customPolygonEPSG2263) {
              inTargetArea = isInCustomPolygon(buildingCoordinates, customPolygonEPSG2263);
            } else {
              inTargetArea = isInRegion(buildingCoordinates, regionArg);
            }
            currentBuildingInBoundary = inTargetArea;
            
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
            if (!(regionArg || customPolygonEPSG2263) || currentBuildingInBoundary) {
                currentBuilding.push('  </cityObjectMember>'); // Close cityObjectMember tag
                buildingLines.push(...currentBuilding);
              }
            }
            currentBuilding = [];
            inBuilding = false;
            currentBuildingInBoundary = false;
            buildingCoordinates = null;
            skipBuildingLines = false;
          }
        }
      }
      
      // Progress indicator
      if (buildingCount % 1000 === 0 && buildingCount > 0) {
        var progress = ' ' + '█'.repeat(Math.floor(buildingCount * 600000 / stats.size));
        readline.clearLine(process.stdout, 0);
        process.stdout.write(`${progress}\n`);
        process.stdout.write(`Found ${buildingCount.toLocaleString()} buildings\r`);
        readline.moveCursor(process.stdout, 0, -1);
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
        
        readline.clearLine(process.stdout, 0);
        readline.moveCursor(process.stdout, 0, -1);
        readline.clearLine(process.stdout, 0);
        process.stdout.write(`Found ${buildingCount.toLocaleString()} buildings\n`);
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

async function processAllFiles(percent = 1, skipOnError = false, regionArg = null, customPolygonEPSG2263 = null, outputDirName = null, specificDANumbers = null) {
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
      
      const result = await createSampleFromFile(inputFile, outputFile, percent, regionArg, customPolygonEPSG2263);
      
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
        processedCount++;
        statusEmojis.push('0️⃣');
        
        console.log(`0️⃣ Processed ${gmlFile} (no buildings in ${customPolygonEPSG2263 ? "given polygon" : {regionArg}})`);
        
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
        printSummary();
        process.exit(1);
      }
    }
  }
  printSummary()
  
  // Summary
  function printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📋 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Files processed: ${processedCount}/${gmlFiles.length}`);
    if (failedCount > 0) {
      console.log(`Files failed: ${failedCount}/${gmlFiles.length}`);
    }
    if (gmlFiles.length > processedCount + failedCount) {
      const errorSkippedCount = gmlFiles.length - processedCount - failedCount;
      console.log(`Files skipped (after error): ${errorSkippedCount}`);
      statusEmojis.push('⏭️'.repeat(errorSkippedCount));
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
  }
  
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
  console.log('  npm run sample -- --idx 1                                  # Process DA1');
  console.log('  npm run sample -- --idx 1,2,3                              # Process DA1, DA2, DA3');
  console.log('  npm run sample -- --idx 1,2,3 --pct 5                      # Process with 5% sampling');
  console.log('  npm run sample                                             # Process all DA files');
  console.log('');
  console.log('Arguments:');
  console.log('  -i, --idx, --index <numbers>  Comma-separated DA numbers to process (e.g., "1,2,3")');
  console.log('  -p, --pct, --percent <number>  Sampling percentage (default: 1)');
  console.log('  --all, -a                     Process all DA files in data/complete/');
  console.log('  --skip-on-error               Continue processing other files on error (default: exit)');
  console.log(`  --region                      Filter to named region only (one of ${Object.keys(REGIONS).join(', ')})`);
  console.log('  --polygon <polygon>           Filter to custom polygon (lat,lng format)');
  console.log('  --out <name>                  Custom output directory name: data/<name>/; default based on parameters');
  console.log('  -h, --help                    Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npm run sample -- --idx 1                                     # Process DA1 with 1% sampling');
  console.log('  npm run sample -- --idx 1,2,3                                 # Process DA1, DA2, DA3 with 1% sampling');
  console.log('  npm run sample -- --idx 1,2,3 --pct 5                         # Process DA1, DA2, DA3 with 5% sampling');
  console.log('  npm run sample -- --pct 2                                     # Process all files with 2% sampling');
  console.log('  npm run sample -- --skip-on-error                             # Process all files, skip errors');
  console.log('  npm run sample -- --region manhattan                          # Process all files, Manhattan only');
  console.log('  npm run sample -- --polygon "(lat,lng),(lat,lng),(lat,lng)"   # Process all files, custom polygon');
  console.log('  npm run sample -- --region manhattan --out work-island        # Custom output directory');
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
const processAll = !indexArg; // Process all by default unless specific indices provided
const skipOnError = args.includes('--skip-on-error');
const regionArg = getArg('region');
const polygonArg = getArg('polygon');
const outputDirArg = getArg('out');

// Validate polygon and regionArg filter mutual exclusivity
if (regionArg && polygonArg) {
  console.error('❌ Error: Cannot use both --region and --polygon. Use one or the other.');
  process.exit(1);
}

if (regionArg && !REGIONS[regionArg.toLowerCase()]) {
  console.error(`❌ Error: Invalid region name: ${regionArg}. Valid options are: ${Object.keys(REGIONS).join(', ')}`);
  process.exit(1);
}

// Parse and validate polygon if provided
let customPolygonEPSG2263 = null;
if (polygonArg) {
  try {
    const customPolygon = parsePolygonString(polygonArg);
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
const outputDirName = outputDirArg || generateOutputDirName(percent, regionArg, customPolygonEPSG2263);

const filesToProcess = processAll ? 'all DA files' : `DA files: ${daNumbers.join(', ')}`;

console.log(`🚀 Processing ${filesToProcess} with ${percent}% sampling...`);
if (skipOnError) {
  console.log(`⚠️  --skip-on-error flag enabled: will continue processing on errors`);
}
if (regionArg) {
  console.log(`🗽 --region flag enabled: filtering to ${regionArg} only`);
}
if (customPolygonEPSG2263) {
  console.log(`🗺️  Custom polygon filter enabled`);
}
console.log(`📁 Output directory: data/${outputDirName}`);

processAllFiles(percent, skipOnError, regionArg, customPolygonEPSG2263, outputDirName, processAll ? null : daNumbers)
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