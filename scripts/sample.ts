import readline from 'readline';
import fs from 'fs';
import path from 'path';
import proj4 from 'proj4';

// XML namespaces for CityGML
const CITYGML_NAMESPACES = {
  smil20: 'http://www.w3.org/2001/SMIL20/',
  grp: 'http://www.opengis.net/citygml/cityobjectgroup/1.0',
  smil20lang: 'http://www.w3.org/2001/SMIL20/Language',
  xlink: 'http://www.w3.org/1999/xlink',
  base: 'http://www.citygml.org/citygml/profiles/base/1.0',
  luse: 'http://www.opengis.net/citygml/landuse/1.0',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  frn: 'http://www.opengis.net/citygml/cityfurniture/1.0',
  dem: 'http://www.opengis.net/citygml/relief/1.0',
  tran: 'http://www.opengis.net/citygml/transportation/1.0',
  wtr: 'http://www.opengis.net/citygml/waterbody/1.0',
  tex: 'http://www.opengis.net/citygml/texturedsurface/1.0',
  core: 'http://www.opengis.net/citygml/1.0',
  xAL: 'urn:oasis:names:tc:ciq:xsdschema:xAL:2.0',
  bldg: 'http://www.opengis.net/citygml/building/1.0',
  sch: 'http://www.ascc.net/xml/schematron',
  app: 'http://www.opengis.net/citygml/appearance/1.0',
  veg: 'http://www.opengis.net/citygml/vegetation/1.0',
  gml: 'http://www.opengis.net/gml',
  gen: 'http://www.opengis.net/citygml/generics/1.0',
};

// Construct XML header
const CITYGML_HEADER: string = `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel ${Object.entries(CITYGML_NAMESPACES)
  .map(([ns, url]) => `xmlns:${ns}="${url}"`)
  .join(' ')}>`;

const CITYGML_FOOTER = '</CityModel>';

type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Point = Vec2 | Vec3;
type Polyline = Vec2[];

// Named region polygon coordinates (lat, lng)
// Based on actual building coordinate ranges in EPSG:2263
// Buildings are in range: X: 995000-1000000, Y: 198000-200000
// Let's create a polygon that covers this range with some buffer
type Region = 'manhattan';

const REGIONS: Map<Region, Polyline> = new Map<Region, Polyline>([
  [
    'manhattan',
    [
      [40.6988, -74.01355],
      [40.71161, -73.97322],
      [40.75516, -73.96023],
      [40.77962, -73.9376],
      [40.78787, -73.93593],
      [40.7974, -73.92768],
      [40.80455, -73.92994],
      [40.80977, -73.93323],
      [40.83528, -73.93426],
      [40.85428, -73.92289],
      [40.8681, -73.91012],
      [40.87348, -73.9105],
      [40.87949, -73.93056],
      [40.73901, -74.0221],
      [40.70193, -74.02398],
    ],
  ],
]);

const REGIONS_EPSG2263: Map<Region, Polyline> = makeEPSG2263Regions();

function makeEPSG2263Regions(): Map<Region, Polyline> {
  let regions: [Region, Polyline][] = [];

  for (const [region, polyline] of REGIONS.entries()) {
    regions.push([region, polyline.map(latLngToEPSG2263)]);
  }

  return new Map(regions);
}

// Define EPSG:2263 projection for precise coordinate transformation
proj4.defs(
  'EPSG:2263',
  '+proj=lcc +lat_1=41.03333333333333 +lat_2=40.66666666666666 +lat_0=40.16666666666666 +lon_0=-74 +x_0=300000.0000000001 +y_0=0 +datum=NAD83 +units=us-ft +no_defs'
);

// Convert lat/lng to EPSG:2263 with maximum precision
function latLngToEPSG2263(latlng: Vec2): Vec2 {
  // Use proj4js for precise coordinate transformation
  const [lat, lng] = latlng;
  const transformed = proj4('EPSG:4326', 'EPSG:2263', [lng, lat]);

  return [transformed[0], transformed[1]];
}

interface Envelope {
  minX: number;
  minY: number;
  minZ?: number;
  maxX: number;
  maxY: number;
  maxZ?: number;
}

// Extract boundedBy envelope from GML file (streaming version)
async function extractBoundedByEnvelopeStreaming(
  inputFile: string
): Promise<Envelope | null> {
  return new Promise((resolve) => {
    // Read only the first 1MB to find the boundedBy section
    const fileStream = fs.createReadStream(inputFile, {
      encoding: 'utf8',
      highWaterMark: 64 * 1024, // 64KB buffer
      start: 0,
      end: 1024 * 1024, // Read only first 1MB
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
function extractBoundedByEnvelope(gmlText: string): Envelope | null {
  const boundedByMatch = gmlText.match(
    /<gml:boundedBy>[\s\S]*?<gml:Envelope[^>]*>[\s\S]*?<gml:lowerCorner>([^<]+)<\/gml:lowerCorner>[\s\S]*?<gml:upperCorner>([^<]+)<\/gml:upperCorner>[\s\S]*?<\/gml:Envelope>[\s\S]*?<\/gml:boundedBy>/
  );
  if (boundedByMatch) {
    const lowerCorner = boundedByMatch[1].trim().split(/\s+/).map(Number);
    const upperCorner = boundedByMatch[2].trim().split(/\s+/).map(Number);
    return {
      minX: lowerCorner[0],
      minY: lowerCorner[1],
      maxX: upperCorner[0],
      maxY: upperCorner[1],
    };
  }
  return null;
}

// Check if envelope is entirely outside our bounding filter
function isEnvelopeOutsidePolygon(
  envelope: Envelope | null,
  boundary: Polyline
) {
  if (!envelope) return false; // If no envelope, we can't skip the file

  const polygonBounds = {
    minX: Math.min(...boundary.map((p) => p[0])),
    maxX: Math.max(...boundary.map((p) => p[0])),
    minY: Math.min(...boundary.map((p) => p[1])),
    maxY: Math.max(...boundary.map((p) => p[1])),
  };
  return (
    envelope.maxX < polygonBounds.minX ||
    envelope.minX > polygonBounds.maxX ||
    envelope.maxY < polygonBounds.minY ||
    envelope.minY > polygonBounds.maxY
  );
}

// Point-in-polygon check for custom polygon
function isInPolygon(points: Point[], polygon: Polyline) {
  return points.some((point) => pointInPolygon(point, polygon));
}

// Point-in-polygon test using ray casting algorithm with floating point tolerance
function pointInPolygon(point: Point, polygon: Polyline) {
  const [x, y] = [point[0], point[1]];
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
      if (
        Math.abs(y - yi) < EPSILON &&
        x >= Math.min(xi, xj) - EPSILON &&
        x <= Math.max(xi, xj) + EPSILON
      ) {
        return true; // Point is on the edge
      }
      continue; // Skip horizontal edges for ray casting
    }

    // Check if ray intersects edge
    if (yi > y + EPSILON !== yj > y + EPSILON) {
      // Calculate intersection point
      const intersectX = xi + ((xj - xi) * (y - yi)) / (yj - yi);

      // Check if intersection is to the right of the point
      if (x < intersectX + EPSILON) {
        inside = !inside;
      }
    }
  }

  return inside;
}

// Generate output directory name based on parameters
function generateOutputDirName(
  percent: number,
  region: Region | undefined,
  customPolygon: Polyline | undefined
) {
  const prefix = customPolygon ? 'poly' : region ? region : 'nyc';
  const percentStr = percent === 100 ? 'all' : percent.toString();
  return `${prefix}-${percentStr}-${Date.now()}`;
}

// Extract coordinates from GML posList or pos elements
function extractionPositionPoints(gmlText: string): Vec3[] {
  const posListMatch = gmlText.match(
    /<gml:posList[^>]*>([^<]+)<\/gml:posList>/
  );
  if (posListMatch) {
    const coords = posListMatch[1].trim().split(/\s+/).map(Number);
    const points: Vec3[] = [];
    // GML coordinates are X/Y/Z triplets
    for (let i = 0; i < coords.length; i += 3) {
      points.push([coords[i], coords[i + 1], coords[i + 2]]); // X, Y, Z
    }
    return points;
  }

  const posMatches = gmlText.match(/<gml:pos[^>]*>([^<]+)<\/gml:pos>/g);
  if (posMatches) {
    return posMatches.map((match) => {
      const coords = match
        .replace(/<gml:pos[^>]*>([^<]+)<\/gml:pos>/, '$1')
        .trim()
        .split(/\s+/)
        .map(Number);
      return [coords[0], coords[1], coords[2]]; // X, Y, Z
    });
  }

  return [];
}

interface FilterResult {
  file?: string;
  buildingCount: number;
  filteredCount: number;
  originalSize: number;
  chunkCount: number;
}

async function createSampleFromFile(
  inputFile: string,
  outputFile: string,
  percent: number,
  chunkSize?: number,
  region?: Region,
  polygon?: Polyline
): Promise<FilterResult> {
  console.log(`Processing: ${path.basename(inputFile)}`);

  try {
    // Check file size first
    const stats = fs.statSync(inputFile);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`📁 File size: ${fileSizeMB} MB`);

    // Early boundedBy check for spatial filtering
    if (region || polygon) {
      const envelope = await extractBoundedByEnvelopeStreaming(inputFile);
      const boundary: Polyline = region
        ? REGIONS_EPSG2263.get(region)!
        : polygon!;

      if (envelope) {
        console.log(
          `🗺️  File envelope: X[${envelope.minX.toFixed(0)}-${envelope.maxX.toFixed(0)}], Y[${envelope.minY.toFixed(0)}-${envelope.maxY.toFixed(0)}]`
        );

        if (isEnvelopeOutsidePolygon(envelope, boundary)) {
          console.log(
            `⏭️  File envelope entirely outside filter bounds - skipping file`
          );
          // Create empty output file
          return {
            buildingCount: 0,
            filteredCount: 0,
            chunkCount: 0,
            originalSize: stats.size,
          };
        }
      } else {
        console.log(`⚠️  No boundedBy envelope found - processing entire file`);
      }
    }

    // Create read stream with larger buffer size
    const fileStream = fs.createReadStream(inputFile, {
      encoding: 'utf8',
      highWaterMark: 64 * 1024, // 64KB buffer
    });

    // Use a custom line reader to handle very long lines
    let buffer = '';
    let lineCount = 0;

    let buildingLines: string[] = [];
    let currentBuilding: string[] = [];
    let inBuilding = false;
    let buildingDepth = 0;
    let buildingCount = 0;
    let headerComplete = false;
    let currentBuildingInBoundary = false;
    let buildingPoints: Point[] = [];
    let skipBuildingLines = false;

    function indentLine(line: string): string {
      return '  '.repeat(buildingDepth) + line;
    }

    // let tmpOutputStream: fs.WriteStream

    // chunk stream
    let currentChunkStream: fs.WriteStream | undefined = undefined;
    // let tmpChunkStream: fs.WriteStream;
    let chunkCount = 0;
    let buildingsInCurrentChunk = 0;
    let baseFileName: string;

    // Chunking mode - we'll create multiple files
    baseFileName = path.basename(inputFile, '.gml');
    console.log(`📄 Chunking mode: ${chunkSize} buildings per file`);

    // Generate random indices for sampling (p out of every 100)
    const p = Math.max(1, Math.floor(percent));

    // Create array [0, 1, 2, ..., 98, 99]
    const indices = Array.from({ length: 100 }, (_, i) => i);

    // Fisher-Yates shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    // Take first p elements and create a Set for O(1) lookup
    const selectedIndicesSet = new Set(indices.slice(0, p));
    console.log(selectedIndicesSet);

    console.log(`🔍 Scanning for buildings...`);
    if (p < 100) {
      console.log(
        `Will select ${p} out of every 100 buildings for ~${percent}% sample`
      );
    }

    // Custom line processing function
    const processLine = (line: string): void => {
      lineCount++;

      // Write header lines directly to output file
      if (!headerComplete) {
        if (
          line.includes('<core:cityObjectMember>') ||
          line.includes('<cityObjectMember>')
        ) {
          headerComplete = true;
        }
        // We always write out own header (i.e., everything before the first cityObjectMember)
        return;
      }

      // Now we're past the header, look for buildings

      if (!inBuilding && line.includes('<bldg:Building gml:id=')) {
        inBuilding = true;
        buildingDepth = 1;
        currentBuilding = ['  <cityObjectMember>', line]; // Start with cityObjectMember tag
        buildingCount++;
        currentBuildingInBoundary = false;
        buildingPoints = [];
        skipBuildingLines = false;

        // Create new chunk file if needed; reset chunk streams and envelope
        if (chunkSize && !currentChunkStream) {
          chunkCount++;
          const chunkFileName = `${baseFileName}_chunk_${chunkCount.toString().padStart(3, '0')}.gml`;
          const chunkFilePath = path.join(
            path.dirname(outputFile),
            chunkFileName
          );

          // const tmpChunkFileName = `${chunkFileName}.tmp`;
          /*
          const tmpChunkFilePath = path.join(
            path.dirname(outputFile),
            tmpChunkFileName
          );
          */

          currentChunkStream = fs.createWriteStream(chunkFilePath);
          // tmpChunkStream = fs.createWriteStream(tmpChunkFilePath);

          // Write header to new chunk file, then wait for buildings.
          currentChunkStream.write(CITYGML_HEADER + '\n');

          console.log(`📄 Creating chunk ${chunkCount}: ${chunkFileName}`);
        }

        // Estimate total buildings (rough approximation) - only on first building
        if (buildingCount === 1) {
          const estimatedTotal = Math.floor(stats.size / 15000);
          const sampleSize = Math.floor(estimatedTotal * (percent / 100));
          console.log(`Based on file size....`);
          console.log(
            `Estimated total buildings:  ~${estimatedTotal.toLocaleString()} buildings`
          );
          console.log(
            `Target sample size:         ~${sampleSize.toLocaleString()} buildings`
          );
          process.stdout.write('\n');
        }
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
              buildingPoints = [];
              skipBuildingLines = false;
            }
          }
          return; // Skip all other processing for this building
        }

        // Extract coordinates for filtering (only if we haven't found any yet)
        if (
          (region || polygon) &&
          buildingPoints.length == 0 &&
          (line.includes('<gml:posList') || line.includes('<gml:pos'))
        ) {
          buildingPoints = extractionPositionPoints(line);
          if (buildingPoints.length > 0) {
            // Check if any point of the building is in the target area
            let inTargetArea = false;
            let boundary: Polyline = region
              ? REGIONS_EPSG2263.get(region)!
              : polygon!;
            inTargetArea = isInPolygon(buildingPoints, boundary);
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
        currentBuilding.push(indentLine(line));

        if (line.includes('<bldg:') && !line.includes('</bldg:')) {
          buildingDepth++;
        } else if (line.includes('</bldg:')) {
          buildingDepth--;
          if (buildingDepth === 0) {
            // Building complete
            // check the sample
            // Only include building if it's in the target area (when filtering is enabled)
            if (!(region || polygon) || currentBuildingInBoundary) {
              currentBuilding.push('  </cityObjectMember>'); // Close cityObjectMember tag

              // Check if this building should be selected based on random sampling
              const positionInGroup = buildingCount % 100;
              if (selectedIndicesSet.has(positionInGroup)) {
                if (chunkSize) {
                  // Write building to current chunk
                  currentBuilding.forEach((buildingLine) => {
                    currentChunkStream!.write(buildingLine + '\n');
                  });
                  buildingsInCurrentChunk++;

                  // Check if we need to start a new chunk
                  if (buildingsInCurrentChunk >= chunkSize) {
                    // Close current chunk
                    currentChunkStream!.write(CITYGML_FOOTER + '\n');
                    currentChunkStream!.end();

                    console.log(
                      `✅ Completed chunk ${chunkCount} with ${buildingsInCurrentChunk} buildings`
                    );

                    // Reset for next chunk
                    buildingsInCurrentChunk = 0;
                    currentChunkStream = undefined;
                  }
                } else {
                  // Single file mode
                  buildingLines.push(...currentBuilding);
                }
              }
            }

            currentBuilding = [];
            inBuilding = false;
            currentBuildingInBoundary = false;
            buildingPoints = [];
            skipBuildingLines = false;
          }
        }

        // Progress indicator
        if (buildingCount % 1000 === 0 && buildingCount > 0) {
          var progress =
            ' ' + '█'.repeat(Math.floor((buildingCount * 600000) / stats.size));
          readline.clearLine(process.stdout, 0);
          process.stdout.write(`${progress}\n`);
          process.stdout.write(
            `Found ${buildingCount.toLocaleString()} buildings\r`
          );
          readline.moveCursor(process.stdout, 0, -1);
        }
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
          } catch (e) {
            let error = e as Error;
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
          } catch (e) {
            let error = e as Error;
            console.error(`Error processing final line:`, error.message);
            reject(error);
            return;
          }
        }

        readline.clearLine(process.stdout, 0);
        readline.moveCursor(process.stdout, 0, -1);
        readline.clearLine(process.stdout, 0);
        process.stdout.write(
          `Found ${buildingCount.toLocaleString()} buildings\n`
        );

        // Close the last chunk if it has content
        if (currentChunkStream && buildingsInCurrentChunk > 0) {
          currentChunkStream.write(CITYGML_FOOTER + '\n');
          currentChunkStream.end();
          console.log(
            `✅ Completed final chunk ${chunkCount} with ${buildingsInCurrentChunk} buildings`
          );
        }

        const totalSelectedBuildings = buildingLines.filter((line) =>
          line.includes('<bldg:Building gml:id=')
        ).length;
        console.log(
          `Selected ${totalSelectedBuildings} buildings for sample (${chunkCount} chunks)`
        );

        // Wait for the stream to finish writing
        if (currentChunkStream) {
          currentChunkStream.on('finish', () => {
            console.log(
              `✅ Created ${chunkCount} chunk files in: ${path.dirname(outputFile)}`
            );

            // In chunking mode, we don't have a single output file to stat
            // Just show the original size and chunk count
            const originalSize = stats.size;
            console.log(
              `📊 Original: ${(originalSize / 1024 / 1024).toFixed(1)} MB → ${chunkCount} chunk files created`
            );

            resolve({
              buildingCount: buildingCount,
              filteredCount: totalSelectedBuildings,
              originalSize,
              chunkCount: chunkCount,
            });
          });
        } else {
          resolve({
            buildingCount: buildingCount,
            filteredCount: buildingLines.filter((line) =>
              line.includes('<bldg:Building gml:id=')
            ).length,
            originalSize: stats.size,
            chunkCount: chunkCount,
          });
        }
      });

      fileStream.on('error', (error) => {
        reject(error);
      });
    });
  } catch (e) {
    let error = e as Error;
    console.error(
      `❌ Error processing ${path.basename(inputFile)}:`,
      error.message
    );
    throw error;
  }
}

async function processAllFiles(
  percent: number,
  skipOnError: boolean,
  region: Region | undefined,
  polygon: Polyline | undefined,
  outputDirName: string,
  specificDANumbers: number[] | undefined,
  chunkSize: number
): Promise<void> {
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
    gmlFiles = specificDANumbers.map(
      (daNum) => `DA${daNum}_3D_Buildings_Merged.gml`
    );
    console.log(`Processing ${gmlFiles.length} specified DA files:`);
    gmlFiles.forEach((file) => console.log(`  - ${file}`));
  } else {
    // Process all GML files
    gmlFiles = fs
      .readdirSync(completeDir)
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

  const results: FilterResult[] = [];
  let totalOriginalBuildings = 0;
  let totalSampleBuildings = 0;
  let totalOriginalSize = 0;
  let totalSampleSize = 0;
  let processedCount = 0;
  let failedCount = 0;
  let statusEmojis: string[] = [];

  // Process each file
  for (let i = 0; i < gmlFiles.length; i++) {
    const gmlFile = gmlFiles[i];
    const inputFile = path.join(completeDir, gmlFile);
    const outputFile = path.join(
      sampleDir,
      gmlFile.replace('.gml', '_Sample.gml')
    );

    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`Processing file ${i + 1} of ${gmlFiles.length}: ${gmlFile}`);
      console.log(`${'='.repeat(50)}`);

      const result = await createSampleFromFile(
        inputFile,
        outputFile,
        percent,
        chunkSize,
        region,
        polygon
      );

      // Check if we have any buildings in the sample
      if (result.filteredCount > 0) {
        results.push({
          file: gmlFile,
          ...result,
        });

        totalOriginalBuildings += result.buildingCount;
        totalSampleBuildings += result.filteredCount;
        totalOriginalSize += result.originalSize;
        processedCount++;
        statusEmojis.push('✅');

        console.log(
          `✅ Successfully processed ${gmlFile} (${result.filteredCount} buildings)`
        );
      } else {
        processedCount++;
        statusEmojis.push('0️⃣');

        console.log(
          `0️⃣ Processed ${gmlFile} (no buildings in ${polygon ? 'given polygon' : { regionArg }})`
        );

        // Remove the output file if it's empty
        if (fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }
      }
    } catch (e) {
      const error = e as Error;

      console.error(`❌ Failed to process ${gmlFile}:`, error.message);
      failedCount++;
      statusEmojis.push('❌');

      if (skipOnError) {
        console.log(`⏭️  Skipping to next file...`);
        continue;
      } else {
        console.error(
          `\n❌ Processing stopped due to error. Use --skip-on-error to continue processing other files.`
        );
        printSummary();
        process.exit(1);
      }
    }
  }
  printSummary();

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

    console.log(
      `Total buildings: ${totalOriginalBuildings.toLocaleString()} → ${totalSampleBuildings.toLocaleString()} (${((totalSampleBuildings / totalOriginalBuildings) * 100).toFixed(1)}%)`
    );
    if (chunkSize) {
      const totalChunks = results.reduce(
        (sum, r) => sum + (r.chunkCount || 0),
        0
      );
      console.log(`Total chunks created: ${totalChunks.toLocaleString()}`);
      console.log(`Chunk size: ${chunkSize} buildings per file`);
    }
    console.log(
      `Total size: ${(totalOriginalSize / 1024 / 1024 / 1024).toFixed(1)} GB → ${(totalSampleSize / 1024 / 1024).toFixed(1)} MB`
    );
    console.log(
      `Overall size reduction: ${(((totalOriginalSize - totalSampleSize) / totalOriginalSize) * 100).toFixed(1)}%`
    );

    // Add emoji status row
    const emojiRow = statusEmojis.join('');
    console.log(`\n📊 Status: ${emojiRow}`);

    console.log('\n📁 Sample files created in: data/sample/');
    results.forEach((result) => {
      console.log(
        `  - ${result.file!.replace('.gml', '_Sample.gml')} (${result.filteredCount} buildings)`
      );
    });
  }

  if (processedCount === gmlFiles.length) {
    console.log('\n✅ All files processed successfully!');
  } else if (failedCount > 0) {
    console.log(`\n⚠️  Processing completed with ${failedCount} failures.`);
  } else {
    console.log('\n✅ All files processed successfully!');
  }

  return;
}

// Get command line arguments
const args = process.argv.slice(2);

// Check for help flag
if (args.includes('--help') || args.includes('-h')) {
  console.log('NYC 3D Buildings Sample Generator (Streaming)');
  console.log('============================================');
  console.log('');
  console.log('Usage:');
  console.log(
    '  npm run sample -- --idx 1                                  # Process DA1'
  );
  console.log(
    '  npm run sample -- --idx 1,2,3                              # Process DA1, DA2, DA3'
  );
  console.log(
    '  npm run sample -- --idx 1,2,3 --pct 5                      # Process with 5% sampling'
  );
  console.log(
    '  npm run sample                                             # Process all DA files'
  );
  console.log('');
  console.log('Arguments:');
  console.log(
    '  -i, --idx, --index <numbers>   Comma-separated DA numbers to process (e.g., "1,2,3")'
  );
  console.log(
    '  -p, --pct, --percent <number>  Sampling percentage (default: 1)'
  );
  console.log(
    '  --skip-on-error                Continue processing other files on error (default: exit)'
  );
  console.log(
    `  -r, --region <name>            Filter to named region only (one of ${Object.keys(REGIONS).join(', ')})`
  );
  console.log(
    '  --polygon <polygon>            Filter to custom polygon (lat,lng format)'
  );
  console.log(
    '  -o, --out <name>               Custom output directory name: data/<name>/; default based on parameters'
  );
  console.log(
    '  -c, --chunk-size <number>      Number of buildings to output per file (default: 3000)'
  );
  console.log('  -h, --help                     Show this help message');
  console.log('');
  console.log('Examples:');
  console.log(
    '  npm run sample -- --idx 1                                     # Process DA1 with 1% sampling'
  );
  console.log(
    '  npm run sample -- --idx 1,2,3                                 # Process DA1, DA2, DA3 with 1% sampling'
  );
  console.log(
    '  npm run sample -- --idx 1,2,3 --pct 5                         # Process DA1, DA2, DA3 with 5% sampling'
  );
  console.log(
    '  npm run sample -- --pct 2                                     # Process all files with 2% sampling'
  );
  console.log(
    '  npm run sample -- --skip-on-error                             # Process all files, skip errors'
  );
  console.log(
    '  npm run sample -- --region manhattan                          # Process all files, Manhattan only'
  );
  console.log(
    '  npm run sample -- --polygon "(lat,lng),(lat,lng),(lat,lng)"   # Process all files, custom polygon'
  );
  console.log(
    '  npm run sample -- --region manhattan --out work-island        # Custom output directory'
  );
  console.log('');
  console.log(
    'Note: Uses streaming approach to handle large files efficiently.'
  );
  process.exit(0);
}

function argNameToFlag(argName: string): string {
  return (argName.length == 1 ? '-' : '--') + argName;
}

// Argument parsing function
function getArg(name: string, aliases: string[] = []) {
  const allNames = [name, ...aliases];
  let flags = allNames.map(argNameToFlag);

  const arg = args.find((s) =>
    flags.some((flag) => s === flag || s.startsWith(flag + '='))
  );
  if (arg) {
    if (arg.includes('=')) return arg.split('=')[1];
    // Find the next argument as the value
    const index = args.indexOf(arg);
    if (index < args.length - 1 && !args[index + 1].startsWith('-')) {
      return args[index + 1];
    }
    // if next arg isn't a value, we have a "true" flag
    return true;
  }
  return undefined;
}

interface ArgOpts<T> {
  required?: boolean;
  default?: T | undefined;
}

// Parse polygon string from command line argument
function parsePolygonString(polyString: string): Polyline {
  try {
    // Remove quotes and split by commas
    const cleanString = polyString.replace(/['"]/g, '');
    const coordPairs = cleanString.split('),(');

    const polygon: Polyline = [];
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
  } catch (e) {
    const error = e as Error;
    throw new Error(`Failed to parse polygon: ${error.message}`);
  }
}

function makeArgGetter<T>(
  parse: (stringValue: string, argName: string) => T,
  defaultValue?: T
) {
  return function (
    name: string,
    aliases: string[] = [],
    opts?: ArgOpts<T>
  ): T | undefined {
    // value is...
    // true        if just the flag
    // a string    if the flag is followed by a value
    // undefined   if the arg is not supplied
    let argValue = getArg(name, aliases);
    let flagsString = [name, ...aliases].map(argNameToFlag).join('/');

    if (typeof argValue === 'string') {
      return parse(argValue, name);
    } else if (argValue === true) {
      // hack to allow boolean flags
      if (typeof defaultValue === 'boolean') {
        return parse('true', name);
      } else {
        throw new Error(`Using ${flagsString} requires passing a value`);
      }
    } else if (argValue === undefined) {
      if (opts?.default !== undefined) {
        return opts?.default;
      } else if (opts?.required) {
        throw new Error(`${flagsString} is required`);
      } else {
        return undefined;
      }
    }
  };
}

function parseRange(arg: string, argName: string): number[] {
  let numbers: Set<number> = new Set<number>();
  let ranges = arg.split(',');

  for (const rangeStr of ranges) {
    let num = Number(rangeStr);
    let rangeMatch = rangeStr.match(/(?<lower>\d+)-(?<upper>\d+)/);

    if (!isNaN(num)) {
      numbers.add(num);
      continue;
    } else if (rangeMatch) {
      const lower = Number(rangeMatch[1]);
      const upper = Number(rangeMatch[2]);
      if (lower <= upper) {
        for (let i = lower; i <= upper; i++) {
          numbers.add(i);
        }
        continue;
      }
    }

    // could not parse, or lower > upper
    throw new Error(
      `${argNameToFlag(argName)} takes a comma-separated range  (e.g. "1,2,5-7")`
    );
  }

  if (!numbers.size) {
    throw new Error(
      `${argNameToFlag(argName)} takes a comma-separated range  (e.g. "1,2,5-7")`
    );
  }

  return Array.from(numbers);
}

const getStringArg = makeArgGetter<string>(String);
const getRangeArg = makeArgGetter<number[]>(parseRange);
const getNumberArg = makeArgGetter<number>(Number);
const getPolylineArg = makeArgGetter<Polyline>(parsePolygonString);
const getBoolArg = makeArgGetter<boolean>(() => true, false);

// Parse arguments
const indexArg = getRangeArg('idx', ['index', 'i']);
const percent = getNumberArg('pct', ['percent', 'p'], { default: 1 });
const skipOnError = getBoolArg('skip-on-error', [], {
  default: false,
}) as boolean;
const regionArg = getStringArg('region', ['r']);
const polygonArg = getPolylineArg('polygon');
let outputDirName = getStringArg('out', ['o']);
const chunkSize = getNumberArg('chunk-size', ['c', 'chunk'], { default: 3000 }); // number of buildings per file

// Validate polygon and regionArg filter mutual exclusivity
if (regionArg && polygonArg) {
  console.error(
    '❌ Error: Cannot use both --region and --polygon. Use one or the other.'
  );
  process.exit(1);
}

if (regionArg && !(regionArg in REGIONS)) {
  console.error(
    `❌ Error: Invalid region name: ${regionArg}. Valid options are: ${Object.keys(REGIONS).join(', ')}`
  );
  process.exit(1);
}

let region = regionArg as Region | undefined;

// Parse and validate polygon if provided
let polygon = undefined;
if (polygonArg) {
  try {
    polygon = polygonArg.map(latLngToEPSG2263);
    console.log(`🗺️  Custom polygon loaded with ${polygonArg.length} points`);
  } catch (e) {
    console.error(`❌ Error parsing polygon: ${(e as Error).message}`);
    process.exit(1);
  }
}

// Parse percentage
if (!percent || percent < 1 || percent > 100) {
  console.error('❌ Error: Percentage must be a number between 1 and 100');
  process.exit(1);
}

// Parse chunk size
if (chunkSize == undefined || chunkSize < 0) {
  console.error('❌ Error: Chunk size must be a nonnegative number');
  process.exit(1);
}

// Parse DA numbers
let daNumbers = indexArg;

// Generate output directory name
outputDirName ||= generateOutputDirName(percent, region, polygon);

const filesToProcess = daNumbers
  ? `DA files: ${daNumbers.join(', ')}`
  : 'all DA files';

console.log(`🚀 Processing ${filesToProcess} with ${percent}% sampling...`);
if (skipOnError) {
  console.log(
    `⚠️  --skip-on-error flag enabled: will continue processing on errors`
  );
}
if (region) {
  console.log(`🗽 --region flag enabled: filtering to ${region} only`);
}
if (polygon) {
  console.log(`🗺️  Custom polygon filter enabled`);
}
if (chunkSize) {
  console.log(`📄 --chunk-size flag enabled: ${chunkSize} buildings per file`);
}
console.log(`📁 Output directory: data/${outputDirName}`);

processAllFiles(
  percent,
  skipOnError,
  region,
  polygon,
  outputDirName,
  daNumbers,
  chunkSize
).catch((error) => {
  console.error('\n❌ Error during batch processing:', error.message);
  process.exit(1);
});
