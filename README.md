# NYC 3D Buildings Processing

This project processes NYC 3D building data from CityGML format into optimized formats for web visualization.

## Overview

The project consists of two main scripts:

- **`sample.js`**: Creates sample datasets by extracting a percentage of buildings from large CityGML files
- **`extract.js`**: Converts CityGML files to glTF format with spatial indexing for web use

## Scripts

### sample.js - NYC 3D Buildings Sample Generator

Creates sample files by extracting a percentage of buildings from large CityGML files using streaming for memory efficiency.

#### Usage

```bash
# Process single DA file
npm run sample -- --idx 1

# Process multiple DA files
npm run sample -- --idx 1,2,3

# Process with custom sampling percentage
npm run sample -- --idx 1,2,3 --pct 5

# Process all DA files
npm run sample -- --all

# Filter to Manhattan borough only
npm run sample -- --all --borough

# Filter to custom polygon
npm run sample -- --all --poly "(40.69338,-74.02154),(40.70360,-74.00009)"

# Custom output directory
npm run sample -- --all --borough --output-dir manhattan-data
```

#### Arguments

- `-i, --idx, --index <numbers>`: Comma-separated DA numbers to process (e.g., "1,2,3")
- `-p, --pct, --percent <number>`: Sampling percentage (default: 1)
- `--all, -a`: Process all DA files in `data/complete/` directory
- `--skip-on-error`: Continue processing other files on error (default: exit)
- `--borough`: Filter to Manhattan borough only
- `--poly <polygon>`: Filter to custom polygon (lat,lng format)
- `--output-dir <name>`: Custom output directory name
- `-h, --help`: Show help message

#### Output Directory Naming

The script automatically generates output directory names based on parameters:

- `nyc-{percent}` (no filtering)
- `manhattan-{percent}` (borough filter)
- `manhattan-all` (borough filter, 100% sampling)
- `poly-{percent}` (custom polygon)
- Custom name if `--output-dir` is specified

#### Examples

```bash
# Process DA1 with 1% sampling (default)
npm run sample -- --idx 1

# Process DA1, DA2, and DA3 with 5% sampling
npm run sample -- --idx 1,2,3 --pct 5

# Process all files with 2% sampling
npm run sample -- --all --pct 2

# Process all files, Manhattan only, 100% sampling
npm run sample -- --all --borough --pct 100

# Process all files with custom polygon filter
npm run sample -- --all --poly "(40.69338,-74.02154),(40.70360,-74.00009),(40.71021,-73.97083)"

# Custom output directory
npm run sample -- --all --borough --output-dir my-manhattan-data
```

### extract.js - NYC 3D Buildings Extractor

Extracts 3D building data from CityGML files and converts them to glTF format with spatial indexing.

#### Usage

```bash
# Use defaults (data/sample -> out/sample)
npm run extract

# Custom input/output directories
npm run extract -- --in data/sample --out out/sample

# Process complete dataset with LOD2
npm run extract -- --in data/complete --out out/complete --lod2

# Process single file
npm run extract -- --in data/sample/DA1_3D_Buildings_Merged_Sample.gml --out out/single

# Test with single file
npm run extract -- --in data/sample --out out/test --single
```

#### Arguments

- `--in <directory>`: Input directory containing CityGML files (default: `data/sample`)
- `--out <directory>`: Output directory for glTF files (default: `out/sample`)
- `--lod2`: Use LOD2 geometry instead of LOD1 (default: LOD1)
- `--single`: Process only the first file found (useful for testing)
- `-h, --help`: Show help message

#### Output Files

After a successful run, you'll get four files inside the output directory:

```
out/sample/
├── footprints.geojson    # GeoJSON FeatureCollection with all building footprints + height_m
├── index.bin             # Flatbush R-tree binary for fast spatial queries
├── ids.json              # Array of building IDs aligned with index.bin
└── buildings.draco.glb   # Draco-compressed GLB mesh of all buildings
```

#### File Descriptions

**footprints.geojson**

- Standard GeoJSON FeatureCollection
- Each feature = one building
- `geometry`: 2D polygon footprint (reprojected to EPSG:3857)
- `properties`: `{ id: "...", height_m: <number> }`

**index.bin**

- The serialized Flatbush index (bounding boxes only)
- Enables fast spatial queries in the browser

**ids.json**

- Array of building IDs in the same order as index.bin
- Maps Flatbush search result indices back to building IDs

**buildings.draco.glb**

- Draco-compressed glTF binary
- Contains either extruded prisms (LOD1) or full LOD2 roofs/walls
- Loadable directly in Three.js using GLTFLoader + DRACOLoader

#### Examples

```bash
# Process data/sample with defaults
npm run extract

# Process complete dataset with LOD2 geometry
npm run extract -- --in data/complete --out out/complete --lod2

# Test with single file
npm run extract -- --in data/sample --out out/test --single

# Process custom sample directory
npm run extract -- --in data/manhattan-100 --out out/manhattan
```

## Data Flow

1. **Raw Data**: Large CityGML files in `data/complete/`
2. **Sampling**: Use `sample.js` to create manageable samples
3. **Extraction**: Use `extract.js` to convert to web-ready format
4. **Web Use**: Load the output files in Three.js for 3D visualization

## Performance Features

- **Streaming**: Both scripts use streaming approaches to handle large files efficiently
- **Early Skip**: `sample.js` includes early skip optimization for spatial filtering
- **Memory Efficient**: Processes files without loading entire contents into memory
- **Spatial Indexing**: `extract.js` creates optimized spatial indexes for fast queries

## Notes

- Sample files are useful for testing and development
- Extract script supports both LOD1 (simpler) and LOD2 (detailed) geometry
- All scripts provide progress indicators and detailed output
- Borough filtering uses precise Manhattan polygon boundary
- Custom polygon filtering supports any lat/lng polygon
