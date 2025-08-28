# Scripts

This directory contains utility scripts for processing NYC 3D building data.

## extract.js

Extracts 3D building data from CityGML files and converts them to glTF format.

### Usage

```bash
# Use defaults (data/sample -> out/sample)
npm run extract

# Custom input/output directories
npm run extract -- --in data/sample --out out/sample

# Process complete dataset with LOD2
npm run extract -- --in data/complete --out out/complete --lod2

# Process single file
npm run extract -- --in data/sample/DA1_3D_Buildings_Merged_Sample.gml --out out/single
```

### Arguments

- `--in <directory>`: Input directory containing CityGML files (default: `data/sample`)
- `--out <directory>`: Output directory for glTF files (default: `out/sample`)
- `--lod2`: Use LOD2 geometry instead of LOD1 (default: LOD1)
- `--single`: Process only the first file found (useful for testing)

### Output Files

After a successful run, you'll get four files inside the output directory you specified (e.g., `out/sample` or `out/complete`):

```
out/sample/
├── footprints.geojson    # GeoJSON FeatureCollection with all building footprints + height_m
├── index.bin             # Flatbush R-tree binary for fast spatial queries
├── ids.json              # Array of building IDs aligned with index.bin
└── buildings.draco.glb   # Draco-compressed GLB mesh of all buildings
```

#### What each file is for:

**footprints.geojson**
- Standard GeoJSON FeatureCollection
- Each feature = one building
- `geometry`: 2D polygon footprint (reprojected to EPSG:3857)
- `properties`: `{ id: "...", height_m: <number> }`

**index.bin**
- The serialized Flatbush index (bounding boxes only)
- Lets you quickly ask "which buildings intersect this query box?" in the browser

**ids.json**
- Array of building IDs in the same order as index.bin
- Lets you map a Flatbush search result index back to a building's ID (and then to geometry/feature)

**buildings.draco.glb**
- Draco-compressed glTF binary
- Contains either extruded prisms (default) or full LOD2 roofs/walls (--lod2)
- Loadable directly in Three.js using GLTFLoader + DRACOLoader

## sample.js

Creates sample files by extracting a percentage of buildings from large CityGML files.

### Usage

```bash
# Process single DA file
npm run sample -- --idx 1

# Process multiple DA files
npm run sample -- --idx 1,2,3

# Process with custom sampling percentage
npm run sample -- --idx 1,2,3 --pct 5

# Process all DA files
npm run sample -- --all
```

### Arguments

- `-i, --idx, --index <numbers>`: Comma-separated DA numbers to process (e.g., "1,2,3")
- `-p, --pct, --percent <number>`: Sampling percentage (default: 1)
- `--all, -a`: Process all DA files in the `data/complete` directory
- `-h, --help`: Show help message

### Output

- Creates sample files in `data/sample/` directory
- Sample files contain the specified percentage of buildings from the original files
- Files are named with `_Sample.gml` suffix
- Maintains original CityGML structure and format

### Examples

```bash
# Process DA1 with 1% sampling (default)
npm run sample -- --idx 1

# Process DA1, DA2, and DA3 with 1% sampling
npm run sample -- --idx 1,2,3

# Process DA1, DA2, and DA3 with 5% sampling
npm run sample -- --idx 1,2,3 --pct 5

# Process all files with 2% sampling
npm run sample -- --all --pct 2
```

## Notes

- Both scripts use streaming approaches to handle large files efficiently
- Sample files are useful for testing and development
- Extract script supports both LOD1 (simpler) and LOD2 (detailed) geometry
- All scripts provide progress indicators and detailed output
