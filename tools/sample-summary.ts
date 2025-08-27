const fs = require('fs');
const path = require('path');

function generateSummary() {
  const completeDir = 'data/complete';
  const sampleDir = 'data/sample';
  
  console.log('📊 NYC 3D Buildings Sample Generation Summary');
  console.log('='.repeat(60));
  
  // Get all original files
  const originalFiles = fs.readdirSync(completeDir)
    .filter((file: string) => file.endsWith('.gml'))
    .sort((a: string, b: string) => {
      const aNum = parseInt(a.match(/DA(\d+)/)?.[1] || '0');
      const bNum = parseInt(b.match(/DA(\d+)/)?.[1] || '0');
      return aNum - bNum;
    });
  
  // Get all sample files
  const sampleFiles = fs.readdirSync(sampleDir)
    .filter((file: string) => file.endsWith('_Sample.gml'))
    .sort((a: string, b: string) => {
      const aNum = parseInt(a.match(/DA(\d+)/)?.[1] || '0');
      const bNum = parseInt(b.match(/DA(\d+)/)?.[1] || '0');
      return aNum - bNum;
    });
  
  console.log(`\n📁 Original files: ${originalFiles.length} (in data/complete/)`);
  console.log(`📁 Sample files created: ${sampleFiles.length} (in data/sample/)`);
  
  let totalOriginalSize = 0;
  let totalSampleSize = 0;
  let totalOriginalBuildings = 0;
  let totalSampleBuildings = 0;
  
  console.log('\n📋 File-by-file breakdown:');
  console.log('─'.repeat(80));
  console.log('DA# | Original Size | Sample Size | Reduction | Status');
  console.log('─'.repeat(80));
  
  for (const originalFile of originalFiles) {
    const daNumber = originalFile.match(/DA(\d+)/)?.[1] || '?';
    const originalPath = path.join(completeDir, originalFile);
    const originalStats = fs.statSync(originalPath);
    const originalSizeMB = (originalStats.size / 1024 / 1024).toFixed(1);
    
    const sampleFile = originalFile.replace('.gml', '_Sample.gml');
    const samplePath = path.join(sampleDir, sampleFile);
    
    if (fs.existsSync(samplePath)) {
      const sampleStats = fs.statSync(samplePath);
      const sampleSizeMB = (sampleStats.size / 1024 / 1024).toFixed(1);
      const reduction = ((originalStats.size - sampleStats.size) / originalStats.size * 100).toFixed(1);
      
      // Count buildings in sample file
      const sampleContent = fs.readFileSync(samplePath, 'utf8');
      const buildingCount = (sampleContent.match(/<bldg:Building gml:id=/g) || []).length;
      
      totalOriginalSize += originalStats.size;
      totalSampleSize += sampleStats.size;
      totalSampleBuildings += buildingCount;
      
      console.log(`DA${daNumber.padStart(2)} | ${originalSizeMB.padStart(11)} MB | ${sampleSizeMB.padStart(10)} MB | ${reduction.padStart(8)}% | ✅ Complete`);
    } else {
      console.log(`DA${daNumber.padStart(2)} | ${originalSizeMB.padStart(11)} MB | ${'N/A'.padStart(10)} | ${'N/A'.padStart(8)} | ❌ Pending`);
    }
  }
  
  console.log('─'.repeat(80));
  
  // Summary statistics
  const overallReduction = ((totalOriginalSize - totalSampleSize) / totalOriginalSize * 100).toFixed(1);
  
  console.log('\n📊 Overall Summary:');
  console.log(`Files processed: ${sampleFiles.length}/${originalFiles.length} (${((sampleFiles.length / originalFiles.length) * 100).toFixed(1)}%)`);
  console.log(`Total size: ${(totalOriginalSize / 1024 / 1024 / 1024).toFixed(1)} GB → ${(totalSampleSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Overall size reduction: ${overallReduction}%`);
  console.log(`Sample buildings created: ${totalSampleBuildings.toLocaleString()}`);
  
  // List remaining files to process
  const remainingFiles = originalFiles.filter(originalFile => {
    const sampleFile = originalFile.replace('.gml', '_Sample.gml');
    return !fs.existsSync(path.join(sampleDir, sampleFile));
  });
  
  if (remainingFiles.length > 0) {
    console.log('\n⏳ Remaining files to process:');
    remainingFiles.forEach(file => {
      const daNumber = file.match(/DA(\d+)/)?.[1] || '?';
      const filePath = path.join(completeDir, file);
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
      console.log(`  - ${file} (${sizeMB} MB)`);
    });
    
    console.log('\n💡 Note: Larger files (>500MB) may cause memory issues.');
    console.log('   Consider using a streaming approach or processing on a machine with more RAM.');
  }
  
  console.log('\n✅ Sample generation complete for available files!');
}

generateSummary();
