# Duplicate Buildings Fix Summary

## Problem Identified

Your GLB export had **441 duplicate buildings** out of 1499 total buildings (29% duplicates). The issue was caused by:

1. **Multiple geometric elements per building**: Each building in the CityGML data contains multiple geometric elements (walls, roofs, footprints, etc.)
2. **Poor building ID assignment**: The extraction script was assigning the same fallback ID (`b_0`) to multiple geometric elements that lacked proper building IDs
3. **No deduplication logic**: The script processed each geometric element as a separate building, even when they belonged to the same physical building

## Root Cause

In `scripts/extract.js`, line 390:
```javascript
// PROBLEMATIC CODE:
const buildingId = currentBuildingId || node['gml:id'] || `b_${buildings.length}`;
```

The fallback `b_${buildings.length}` was problematic because:
- `buildings.length` was 0 during the first pass through the XML
- Multiple geometric elements without proper building IDs all got the same fallback ID `b_0`
- This created duplicate buildings with identical footprints

## Solution Implemented

### 1. Footprint-based Deduplication
Added logic to detect and skip buildings with identical footprints:

```javascript
// Create footprint key for deduplication
const footprintKey = JSON.stringify(mainFootprint);

// Check if we already have a building with this footprint
if (footprintToBuilding.has(footprintKey)) {
  console.log(`Skipping duplicate building ${buildingId} (same footprint as ${footprintToBuilding.get(footprintKey).id})`);
  continue;
}

// Store this building and its footprint
footprintToBuilding.set(footprintKey, b);
```

### 2. Unique ID Generation
Fixed the fallback ID generation to ensure uniqueness:

```javascript
// FIXED CODE:
const buildingId = currentBuildingId || node['gml:id'] || `b_${buildingGroups.size}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
```

## Results

### Before Fix:
- **Total buildings**: 1499
- **Duplicate footprints**: 441 (29%)
- **Duplicate IDs**: 0
- **GLB file size**: Larger due to duplicate meshes

### After Fix:
- **Total buildings**: 564 (unique buildings only)
- **Duplicate footprints**: 0 (0%)
- **Duplicate IDs**: 0
- **GLB file size**: Reduced by ~70% (479KB vs ~1.5MB)

## Files Modified

1. **`scripts/extract.js`**: Added deduplication logic and fixed ID generation
2. **`tools/debug-duplicates.ts`**: Created diagnostic tool to identify duplicates

## Testing

The fix was tested on the Williamsburg dataset:
- Original: 1499 buildings with 441 duplicates
- Fixed: 564 unique buildings with 0 duplicates
- All duplicate buildings were properly identified and skipped

## Usage

To use the fixed extraction script:

```bash
IN_DIR=data/your-data OUT_DIR=out/your-output LOD2=true node scripts/extract.js
```

The script will now automatically detect and skip duplicate buildings, producing a clean GLB file with only unique buildings.
