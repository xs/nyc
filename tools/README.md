# NYC CityGML Processing Tools

This directory contains tools for processing NYC CityGML data as part of the 3D building visualization pipeline.

## Overview

The tools implement **Step 2** of the NYC building visualization plan: extracting useful parts from raw CityGML files.

### What it does:

- Parses CityGML XML files containing building data
- Extracts building footprints (2D ground outlines)
- Calculates building heights from roof coordinates
- Optionally preserves full 3D geometry (walls/roofs)
- Outputs structured JSON for the next pipeline steps

## Files

### Core Extraction Script

- **`extract-citygml.ts`** - Main CityGML parsing and extraction logic
  - Parses XML using `fast-xml-parser`
  - Extracts building geometry from various CityGML surface types
  - Handles different CityGML structure variations
  - Outputs standardized building data format

### Sample Generation Script

- **`create-sample.ts`** - Creates 5% samples of GML files for testing
  - Uses streaming approach to handle large files efficiently
  - Processes individual DA files or all files at once
  - Maintains complete CityGML structure and building data
  - Reduces file sizes by ~95% for easier testing and development
  - Includes progress indicators and error handling
  - Can handle files up to 1.3GB without memory issues

### Test Infrastructure

- **`_tests/extract-citygml.test.ts`** - Comprehensive test suite
  - Tests parsing logic with sample CityGML data
  - Validates building extraction, geometry, and coordinates
  - Includes sample CityGML data for testing
- **`_tests/run-tests.ts`** - Test runner for all test suites

## Usage

### Basic Extraction

```bash
# Extract from default directory
npm run extract

# Extract with custom paths
npm run extract ./path/to/citygml/files ./path/to/output.json
```

### NYC Project Example

This project contains NYC CityGML data organized by delivery areas:

```bash
# Extract buildings from a single delivery area
npm run extract ./data/complete ./data/extracted-buildings.json

# Extract from a specific delivery area (e.g., DA1)
npm run extract ./data/complete/DA1_3D_Buildings_Merged.gml ./data/da1-buildings.json

# Extract from ALL delivery areas at once (recommended)
npm run extract:all
npm run extract:all ./data/all-buildings.json

# Or use the --all flag directly
npm run extract -- --all
npm run extract -- --all ./data/all-buildings.json

# Extract from multiple areas and combine (manual approach)
npm run extract ./data/complete/DA1_3D_Buildings_Merged.gml ./data/da1-buildings.json
npm run extract ./data/complete/DA2_3D_Buildings_Merged.gml ./data/da2-buildings.json
# ... then combine the JSON files
```

**Data Structure:**

- **Location**: `./data/complete/`
- **Format**: 20 delivery area files (DA1-DA20) with 3D building data
- **File sizes**: 208MB - 1.3GB per file (total ~12GB)
- **Content**: ~400k buildings total across all delivery areas
- **Naming**: `DA{number}_3D_Buildings_Merged.gml`

**Processing Tips:**

- Start with smaller files (DA1, DA2, DA4) for testing
- Larger files (DA19, DA20) may take longer to process but are handled efficiently
- Use `npm run extract:all` to process all DA files in one command
- The `--all` flag automatically sorts files and shows progress
- Sample generation uses streaming to handle all file sizes without memory issues

### Running Tests

```bash
# Run the main test suite
npm test

# Run all test suites
npm run test:all
```

### Direct Script Execution

```bash
# Run extraction script directly
npx tsx tools/extract-citygml.ts [input-dir] [output-file]

# Run sample generation script
npx tsx tools/create-sample.ts <DA_number>     # Process single DA file
npx tsx tools/create-sample.ts --all          # Process all DA files

# Run tests directly
npx tsx tools/_tests/extract-citygml.test.ts
```

## Input Format

The script expects CityGML files (`.gml` extension) with building data in this structure:

```xml
<core:CityModel>
  <core:cityObjectMember>
    <bldg:Building gml:id="building_id">
      <bldg:boundedBy>
        <bldg:GroundSurface>
          <!-- Ground polygon coordinates -->
        </bldg:GroundSurface>
        <bldg:WallSurface>
          <!-- Wall polygon coordinates -->
        </bldg:WallSurface>
        <bldg:RoofSurface>
          <!-- Roof polygon coordinates -->
        </bldg:RoofSurface>
      </bldg:boundedBy>
    </bldg:Building>
  </core:cityObjectMember>
</core:CityModel>
```

## Output Format

Each extracted building is represented as:

```typescript
interface ExtractedBuilding {
  id: string; // Building identifier
  footprint: number[][]; // 2D coordinates [x, y]
  height: number; // Building height in units
  walls?: number[][][]; // 3D wall polygons [[x, y, z], ...]
  roof?: number[][][]; // 3D roof polygons [[x, y, z], ...]
  ground?: number[][][]; // 3D ground polygons [[x, y, z], ...]
}
```

## Dependencies

- **`fast-xml-parser`** - XML parsing for CityGML files
- **`@types/node`** - TypeScript definitions for Node.js
- **`tsx`** - TypeScript execution environment

## Development

### Adding New Tests

1. Create test file in `_tests/` directory
2. Add test function to `run-tests.ts`
3. Update `package.json` scripts if needed

### Extending Functionality

The extraction script is designed to be extensible:

- Add new surface types by extending `CityGMLSurface` interface
- Add new geometry types by extending `CityGMLGeometry` interface
- Modify output format by updating `ExtractedBuilding` interface

### Debugging

The script includes detailed logging when parsing fails. Check console output for:

- Parsed XML structure
- Building member extraction
- Geometry processing steps

## Next Steps

This extracted data feeds into:

1. **Coordinate conversion** (EPSG:2263 → EPSG:3857)
2. **GLB mesh generation** (3D geometry → Three.js format)
3. **Spatial indexing** (building lookup optimization)

## Example Output

```json
[
  {
    "id": "building_001",
    "footprint": [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0]
    ],
    "height": 20,
    "walls": [
      [
        [0, 0, 0],
        [0, 0, 20],
        [0, 10, 20],
        [0, 10, 0],
        [0, 0, 0]
      ]
    ],
    "roof": [
      [
        [0, 0, 20],
        [10, 0, 20],
        [10, 10, 20],
        [0, 10, 20],
        [0, 0, 20]
      ]
    ],
    "ground": [
      [
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
        [0, 10, 0],
        [0, 0, 0]
      ]
    ]
  }
]
```
