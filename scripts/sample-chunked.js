import fs from 'fs';
import path from 'path';
import readline from 'readline';

// XML header for CityGML files
const CITYGML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:smil20="http://www.w3.org/2001/SMIL20/" xmlns:grp="http://www.opengis.net/citygml/cityobjectgroup/1.0" xmlns:smil20lang="http://www.w3.org/2001/SMIL20/Language" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:base="http://www.citygml.org/citygml/profiles/base/1.0" xmlns:luse="http://www.opengis.net/citygml/landuse/1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:frn="http://www.opengis.net/citygml/cityfurniture/1.0" xmlns:dem="http://www.opengis.net/citygml/relief/1.0" xmlns:tran="http://www.opengis.net/citygml/transportation/1.0" xmlns:wtr="http://www.opengis.net/citygml/waterbody/1.0" xmlns:tex="http://www.opengis.net/citygml/texturedsurface/1.0" xmlns:core="http://www.opengis.net/citygml/1.0" xmlns:xAL="urn:oasis:names:tc:ciq:xsdschema:xAL:2.0" xmlns:bldg="http://www.opengis.net/citygml/building/1.0" xmlns:sch="http://www.ascc.net/xml/schematron" xmlns:app="http://www.opengis.net/citygml/appearance/1.0" xmlns:veg="http://www.opengis.net/citygml/vegetation/1.0" xmlns:gml="http://www.opengis.net/gml" xmlns:gen="http://www.opengis.net/citygml/generics/1.0">`;

const CITYGML_FOOTER = '</CityModel>';

// Number of cityObjectMember elements per chunk
const CHUNK_SIZE = 3000;

async function createChunkedSampleFromFile(inputFile, outputDir, chunkSize = CHUNK_SIZE) {
  console.log(`Processing: ${path.basename(inputFile)}`);
  
  try {
    // Check file size first
    const stats = fs.statSync(inputFile);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`📁 File size: ${fileSizeMB} MB`);
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Create read stream with larger buffer size
    const fileStream = fs.createReadStream(inputFile, { 
      encoding: 'utf8',
      highWaterMark: 64 * 1024 // 64KB buffer
    });
    
    let buffer = '';
    let lineCount = 0;
    
    let buildingLines = [];
    let currentBuilding = [];
    let inBuilding = false;
    let buildingDepth = 0;
    let buildingCount = 0;
    let chunkCount = 0;
    let headerComplete = false;
    let currentChunkFile = null;
    let currentChunkStream = null;
    let buildingsInCurrentChunk = 0;
    
    // Generate base filename for chunks
    const baseFileName = path.basename(inputFile, '.gml');
    
    // Custom line processing function
    const processLine = (line) => {
      lineCount++;
      
      // Write header lines directly to output file (skip the original cityObjectMember opening)
      if (!headerComplete && (line.includes('<core:cityObjectMember>') || line.includes('<cityObjectMember>'))) {
        headerComplete = true;
        // Don't include this line - we'll add our own cityObjectMember tags
        return;
      }
      
      if (!headerComplete) {
        // Skip header lines - we'll write our own header
        return;
      }
      
      // Now we're past the header, look for buildings
      if (!inBuilding && line.includes('<bldg:Building gml:id=')) {
        inBuilding = true;
        buildingDepth = 1;
        currentBuilding = ['  <cityObjectMember>', line]; // Start with cityObjectMember tag
        buildingCount++;
        
        // Create new chunk file if needed
        if (buildingsInCurrentChunk === 0) {
          chunkCount++;
          const chunkFileName = `${baseFileName}_chunk_${chunkCount.toString().padStart(3, '0')}.gml`;
          const chunkFilePath = path.join(outputDir, chunkFileName);
          
          currentChunkFile = chunkFilePath;
          currentChunkStream = fs.createWriteStream(chunkFilePath);
          
          // Write header to new chunk file
          currentChunkStream.write(CITYGML_HEADER + '\n');
          
          console.log(`📄 Creating chunk ${chunkCount}: ${chunkFileName}`);
        }
        
      } else if (inBuilding) {
        // Add line to currentBuilding
        currentBuilding.push(line);
        
        if (line.includes('<bldg:') && !line.includes('</bldg:')) {
          buildingDepth++;
        } else if (line.includes('</bldg:')) {
          buildingDepth--;
          if (buildingDepth === 0) {
            // Building complete
            currentBuilding.push('  </cityObjectMember>'); // Close cityObjectMember tag
            
            // Write building to current chunk
            currentBuilding.forEach(buildingLine => {
              currentChunkStream.write(buildingLine + '\n');
            });
            
            buildingsInCurrentChunk++;
            
            // Check if we need to start a new chunk
            if (buildingsInCurrentChunk >= chunkSize) {
              // Close current chunk
              currentChunkStream.write(CITYGML_FOOTER + '\n');
              currentChunkStream.end();
              
              console.log(`✅ Completed chunk ${chunkCount} with ${buildingsInCurrentChunk} buildings`);
              
              // Reset for next chunk
              buildingsInCurrentChunk = 0;
              currentChunkStream = null;
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
        
        // Close the last chunk if it has content
        if (currentChunkStream && buildingsInCurrentChunk > 0) {
          currentChunkStream.write(CITYGML_FOOTER + '\n');
          currentChunkStream.end();
          console.log(`✅ Completed final chunk ${chunkCount} with ${buildingsInCurrentChunk} buildings`);
        }
        
        // Wait for the stream to finish writing
        if (currentChunkStream) {
          currentChunkStream.on('finish', () => {
            console.log(`✅ Created ${chunkCount} chunk files in: ${outputDir}`);
            
            resolve({
              totalBuildings: buildingCount,
              totalChunks: chunkCount,
              chunkSize: chunkSize
            });
          });
        } else {
          resolve({
            totalBuildings: buildingCount,
            totalChunks: chunkCount,
            chunkSize: chunkSize
          });
        }
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

async function processAllFiles(skipOnError = false, chunkSize = CHUNK_SIZE, outputDirName = 'chunked', specificDANumbers = null) {
  const completeDir = 'data/complete';
  const outputDir = `data/${outputDirName}`;
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
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
  let totalBuildings = 0;
  let totalChunks = 0;
  let processedCount = 0;
  let failedCount = 0;
  let statusEmojis = [];
  
  // Process each file
  for (let i = 0; i < gmlFiles.length; i++) {
    const gmlFile = gmlFiles[i];
    const inputFile = path.join(completeDir, gmlFile);
    
    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`Processing file ${i + 1} of ${gmlFiles.length}: ${gmlFile}`);
      console.log(`${'='.repeat(50)}`);
      
      const result = await createChunkedSampleFromFile(inputFile, outputDir, chunkSize);
      
      results.push({
        file: gmlFile,
        ...result
      });
      
      totalBuildings += result.totalBuildings;
      totalChunks += result.totalChunks;
      processedCount++;
      statusEmojis.push('✅');
      
      console.log(`✅ Successfully processed ${gmlFile} (${result.totalBuildings} buildings → ${result.totalChunks} chunks)`);
      
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
  console.log(`Total buildings: ${totalBuildings.toLocaleString()}`);
  console.log(`Total chunks created: ${totalChunks.toLocaleString()}`);
  console.log(`Chunk size: ${chunkSize} buildings per file`);
  
  // Add emoji status row
  const emojiRow = statusEmojis.join('');
  console.log(`\n📊 Status: ${emojiRow}`);
  
  console.log(`\n📁 Chunk files created in: ${outputDir}/`);
  results.forEach(result => {
    console.log(`  - ${result.file.replace('.gml', '')}: ${result.totalChunks} chunks`);
  });
  
  return { processedCount, failedCount, totalFiles: gmlFiles.length };
}

// Get command line arguments
const args = process.argv.slice(2);

// Check for help flag
if (args.includes('--help') || args.includes('-h')) {
  console.log('NYC 3D Buildings Chunked Sample Generator');
  console.log('========================================');
  console.log('');
  console.log('Usage:');
  console.log('  npm run sample-chunked -- --idx 1                                    # Process DA1');
  console.log('  npm run sample-chunked -- --idx 1,2,3                               # Process DA1, DA2, DA3');
  console.log('  npm run sample-chunked -- --idx 1,2,3 --chunk-size 5000             # Process with 5000 buildings per chunk');
  console.log('  npm run sample-chunked -- --all                                     # Process all DA files');
  console.log('');
  console.log('Arguments:');
  console.log('  -i, --idx, --index <numbers>  Comma-separated DA numbers to process (e.g., "1,2,3")');
  console.log('  --chunk-size <number>         Number of buildings per chunk file (default: 3000)');
  console.log('  --all, -a                     Process all DA files in data/complete/');
  console.log('  --skip-on-error               Continue processing other files on error (default: exit)');
  console.log('  --output-dir <name>           Custom output directory name (default: chunked)');
  console.log('  -h, --help                    Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npm run sample-chunked -- --idx 1                                   # Process DA1 with 3000 buildings per chunk');
  console.log('  npm run sample-chunked -- --idx 1,2,3                              # Process DA1, DA2, DA3 with 3000 buildings per chunk');
  console.log('  npm run sample-chunked -- --idx 1,2,3 --chunk-size 5000            # Process with 5000 buildings per chunk');
  console.log('  npm run sample-chunked -- --all --chunk-size 1000                  # Process all files with 1000 buildings per chunk');
  console.log('  npm run sample-chunked -- --all --skip-on-error                    # Process all files, skip errors');
  console.log('  npm run sample-chunked -- --all --output-dir my-chunks             # Custom output directory');
  console.log('');
  console.log('Note: Creates new GML files with proper CityGML headers and 3000 buildings each.');
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
const chunkSizeArg = getArg('chunk-size', [], '3000');
const processAll = args.includes('--all') || args.includes('-a');
const skipOnError = args.includes('--skip-on-error');
const outputDirArg = getArg('output-dir', [], 'chunked');

// Validate arguments
if (!indexArg && !processAll) {
  console.error('❌ Error: Must specify either --idx <numbers> or --all');
  console.log('Use --help for usage information.');
  process.exit(1);
}

// Parse chunk size
const chunkSize = parseInt(chunkSizeArg);
if (isNaN(chunkSize) || chunkSize < 1) {
  console.error('❌ Error: Chunk size must be a positive number');
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
  console.log(`🚀 Processing all DA files with ${chunkSize} buildings per chunk...`);
  if (skipOnError) {
    console.log(`⚠️  --skip-on-error flag enabled: will continue processing on errors`);
  }
  console.log(`📁 Output directory: data/${outputDirArg}`);
  processAllFiles(skipOnError, chunkSize, outputDirArg, null)
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
  console.log(`🚀 Processing DA files: ${daNumbers.join(', ')} with ${chunkSize} buildings per chunk...`);
  if (skipOnError) {
    console.log(`⚠️  --skip-on-error flag enabled: will continue processing on errors`);
  }
  console.log(`📁 Output directory: data/${outputDirArg}`);
  
  processAllFiles(skipOnError, chunkSize, outputDirArg, daNumbers)
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
