#!/usr/bin/env node
// scripts/extract.js
import fs from 'fs';
import path from 'path';
import proj4 from 'proj4';
import { XMLParser } from 'fast-xml-parser';
import earcut from 'earcut';
import Flatbush from 'flatbush';
// Remove glTF-transform imports and try manual GLB creation

// No polyfills needed for manual GLB creation

/* =========================
   CLI
   ========================= */
const argv = process.argv.slice(2);

// Check for help flag
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('NYC 3D Buildings Extractor');
  console.log('==========================');
  console.log('');
  console.log('Usage:');
  console.log(
    '  npm run extract                                    # Use defaults (data/sample -> out/sample)'
  );
  console.log('  npm run extract -- --in data/sample --out out/sample');
  console.log(
    '  npm run extract -- --in data/complete --out out/complete --lod2'
  );
  console.log(
    '  npm run extract -- --in data/sample/DA1_3D_Buildings_Merged_Sample.gml --out out/single'
  );
  console.log('');
  console.log('Arguments:');
  console.log(
    '  --in <directory>    Input directory containing CityGML files (default: data/sample)'
  );
  console.log(
    '  --out <directory>   Output directory for glTF files (default: out/sample)'
  );
  console.log(
    '  --lod2              Use LOD2 geometry instead of LOD1 (default: LOD1)'
  );
  console.log(
    '  --single            Process only the first file found (useful for testing)'
  );
  console.log('  -h, --help          Show this help message');
  console.log('');
  console.log('Examples:');
  console.log(
    '  npm run extract                                    # Process data/sample with defaults'
  );
  console.log(
    '  npm run extract -- --in data/complete --out out/complete --lod2'
  );
  console.log('  npm run extract -- --in data/sample --out out/test --single');
  console.log('');
  process.exit(0);
}

function arg(name, def = undefined) {
  const a = argv.find((s) => s === `--${name}` || s.startsWith(`--${name}=`));
  if (!a) return def;
  if (a.includes('=')) return a.split('=')[1];
  // For flags without values, return true only for boolean flags
  if (name === 'lod2' || name === 'single') return true;
  // For other flags without values, look for the next argument
  const idx = argv.indexOf(a);
  if (idx + 1 < argv.length && !argv[idx + 1].startsWith('--')) {
    return argv[idx + 1];
  }
  return def; // For other flags without values, return default
}
const IN_DIR = arg('in', './data/sample');
const OUT_DIR = arg('out', './out/sample');
const LOD2 = !!arg('lod2', false);

fs.mkdirSync(OUT_DIR, { recursive: true });

/* =========================
   CRS (EPSG:2263 ft → EPSG:3857 m)
   ========================= */
proj4.defs(
  'EPSG:2263',
  '+proj=lcc +lat_1=41.03333333333333 +lat_2=40.66666666666666 +lat_0=40.16666666666666 +lon_0=-74 +x_0=300000.0000000001 +y_0=0 +datum=NAD83 +units=us-ft +no_defs'
);

// Define the center point in lat/lng (Williamsburg area)
const CENTER_LAT = 40.71671893970987;
const CENTER_LNG = -73.96201793555863;

// Transform center point to EPSG:3857
const centerMercator = proj4('EPSG:4326', 'EPSG:3857').forward([
  CENTER_LNG,
  CENTER_LAT,
]);

const toMerc = proj4('EPSG:2263', 'EPSG:3857');
const FT_TO_M = 0.3048;

// Modified reprojection function that centers coordinates around the specified point
const reprojXY = (x, y) => {
  const [mx, my] = toMerc.forward([x, y]);
  // Center the coordinates around the specified point
  return [mx - centerMercator[0], my - centerMercator[1]];
};

/* =========================
   XML parsing helpers
   ========================= */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
  processEntities: true,
});

const nsLocal = (tag) => tag?.split(':').pop()?.split('}').pop() || '';

function* walk(node) {
  if (node && typeof node === 'object') {
    yield node;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) {
        for (const c of v) yield* walk(c);
      } else if (v && typeof v === 'object') {
        yield* walk(v);
      }
    }
  }
}

function posListToXYZ(text) {
  const a = text.trim().split(/\s+/).map(Number);
  const out = [];
  for (let i = 0; i + 2 < a.length; i += 3)
    out.push([a[i], a[i + 1], a[i + 2]]);
  return out;
}

/* =========================
   Math & triangulation helpers
   ========================= */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

function planeBasis3D(points) {
  const p0 = points[0];
  let v1 = null;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - p0[0],
      dy = points[i][1] - p0[1],
      dz = points[i][2] - p0[2];
    const n = Math.hypot(dx, dy, dz);
    if (n > 1e-6) {
      v1 = [dx / n, dy / n, dz / n];
      break;
    }
  }
  if (!v1) v1 = [1, 0, 0];

  let v2raw = null;
  for (let j = 2; j < points.length; j++) {
    const dx = points[j][0] - p0[0],
      dy = points[j][1] - p0[1],
      dz = points[j][2] - p0[2];
    const c = cross(v1, [dx, dy, dz]);
    const n = Math.hypot(c[0], c[1], c[2]);
    if (n > 1e-6) {
      v2raw = [dx, dy, dz];
      break;
    }
  }
  if (!v2raw) v2raw = [0, 1, 0];

  const nrm = norm(cross(v1, v2raw));
  const v2 = norm(cross(nrm, v1));

  return {
    origin: p0,
    u: v1,
    v: v2,
    n: nrm,
    to2D: (p) => {
      const w = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]];
      return [dot(w, v1), dot(w, v2)];
    },
    to3D: (uv) => [
      p0[0] + uv[0] * v1[0] + uv[1] * v2[0],
      p0[1] + uv[0] * v1[1] + uv[1] * v2[1],
      p0[2] + uv[0] * v1[2] + uv[1] * v2[2],
    ],
  };
}

// rings3D: [outer[], hole1[], ...]; each ring is [[x,y,z],...]
function triangulate3D(rings3D) {
  const basis = planeBasis3D(rings3D[0]);
  const rings2D = rings3D.map((r) => r.map(basis.to2D));
  const flat = [];
  const holes = [];
  let offset = 0;
  for (let i = 0; i < rings2D.length; i++) {
    const r = rings2D[i];
    if (i > 0) {
      offset += rings2D[i - 1].length;
      holes.push(offset);
    }
    for (const [u, v] of r) flat.push(u, v);
  }
  const idx = earcut(flat, holes.length ? holes : null, 2);
  const verts3D = rings2D.flat().map(basis.to3D);

  const positions = [];
  const remap = new Map();
  const outIdx = new Uint32Array(idx.length);
  let cursor = 0;
  for (let i = 0; i < idx.length; i++) {
    const k = idx[i];
    if (!remap.has(k)) {
      const p = verts3D[k];
      positions.push(p[0], p[1], p[2]);
      remap.set(k, cursor++);
    }
    outIdx[i] = remap.get(k);
  }

  // Fix winding order for correct normals (reverse triangles)
  for (let i = 0; i < outIdx.length; i += 3) {
    const temp = outIdx[i];
    outIdx[i] = outIdx[i + 2];
    outIdx[i + 2] = temp;
  }

  return { positions: new Float32Array(positions), indices: outIdx };
}

function extrudeFootprint(footprint, height) {
  const flat = footprint.flat(); // [x,y,...]
  const tri = earcut(flat, null, 2);
  const n = footprint.length;

  const positions = [];
  for (const [x, y] of footprint) positions.push(x, y, height);
  for (const [x, y] of footprint) positions.push(x, y, 0);

  const topBase = 0,
    botBase = n;
  const indices = [];

  // top
  for (let i = 0; i < tri.length; i += 3) {
    indices.push(topBase + tri[i], topBase + tri[i + 1], topBase + tri[i + 2]);
  }
  // bottom (reversed)
  for (let i = 0; i < tri.length; i += 3) {
    indices.push(botBase + tri[i + 2], botBase + tri[i + 1], botBase + tri[i]);
  }
  // sides (fixed winding order for correct normals)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const aT = i,
      bT = j,
      aB = botBase + i,
      bB = botBase + j;
    // First triangle: aT -> bT -> aB (clockwise from outside)
    indices.push(aT, bT, aB);
    // Second triangle: bT -> bB -> aB (clockwise from outside)
    indices.push(bT, bB, aB);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function bbox2D(coords) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/* =========================
   CityGML readers
   ========================= */
function containsTag(node, name) {
  for (const k of Object.keys(node)) {
    if (nsLocal(k) === name) return true;
    const v = node[k];
    if (Array.isArray(v)) {
      for (const c of v)
        if (c && typeof c === 'object' && containsTag(c, name)) return true;
    } else if (v && typeof v === 'object') {
      if (containsTag(v, name)) return true;
    }
  }
  return false;
}

function findLinearRing(container) {
  const lr =
    container['gml:LinearRing'] || container['LinearRing'] || container;
  const pos = lr?.['gml:posList'] || lr?.['posList'];
  if (typeof pos === 'string') return posListToXYZ(pos);
  return null;
}

// returns array: [ [ring0_xyz[], hole1_xyz[], ...], ... ]
function extractPolygons(node) {
  const polys = [];
  for (const sub of walk(node)) {
    for (const k of Object.keys(sub)) {
      if (nsLocal(k) !== 'Polygon') continue;
      const poly = sub[k];
      const rings = [];

      const exterior = poly['gml:exterior'] || poly['exterior'];
      if (exterior) {
        const lr = findLinearRing(exterior);
        if (lr) rings.push(lr);
      } else if (poly['gml:posList'] || poly['posList']) {
        const text = poly['gml:posList'] || poly['posList'];
        if (typeof text === 'string') rings.push(posListToXYZ(text));
      }

      const interiors = poly['gml:interior'] || poly['interior'];
      const intrArr = Array.isArray(interiors)
        ? interiors
        : interiors
          ? [interiors]
          : [];
      for (const intr of intrArr) {
        const lr = findLinearRing(intr);
        if (lr) rings.push(lr);
      }

      if (rings.length) polys.push(rings);
    }
  }
  return polys;
}

function extractLod0Footprint(node) {
  for (const sub of walk(node)) {
    for (const k of Object.keys(sub)) {
      if (nsLocal(k) !== 'lod0FootPrint') continue;
      const f = sub[k];
      const polys = extractPolygons(f);
      if (polys.length && polys[0][0]?.length >= 3) return polys[0][0];
    }
  }
  return null;
}

/**
 * Parse one GML file → array of buildings:
 * {
 *   id: string,
 *   footprint: [[x,y]...] in EPSG:3857 meters,
 *   height_m: number,
 *   mesh: { positions: Float32Array, indices: Uint32Array }  // present if built
 * }
 */
function processGMLSync(filePath, { lod2 }) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const root = parser.parse(xml);

  // Use a simpler approach: track the current building ID as we walk through the XML
  const buildings = [];
  const buildingGroups = new Map(); // building ID -> array of geometric elements
  let currentBuildingId = null;

  for (const node of walk(root)) {
    if (!node || typeof node !== 'object') continue;

    // Check if this is a building node - look specifically for bldg:Building elements
    if (node['gml:id'] && node['gml:id'].startsWith('gml_')) {
      // Check if this node represents a building by looking for building-specific tags
      const hasBuildingTag = Object.keys(node).some(
        (key) => key === 'bldg:Building'
      );
      const hasBuildingName =
        node['gml:name'] && node['gml:name'].startsWith('Bldg_');
      const hasBuildingAttributes = containsTag(node, 'gen:stringAttribute');

      if (hasBuildingTag || hasBuildingName || hasBuildingAttributes) {
        currentBuildingId = node['gml:id'];
        continue;
      }
    }

    // Check if this is a geometric element
    const looksBuilding =
      containsTag(node, 'Polygon') ||
      containsTag(node, 'RoofSurface') ||
      containsTag(node, 'WallSurface') ||
      containsTag(node, 'lod0FootPrint');

    if (!looksBuilding) continue;

    const polys = extractPolygons(node);
    if (!polys.length) continue;

    // Use current building ID or fallback to element's own ID
    // Fix: Use a unique counter that increments for each geometric element to avoid duplicates
    const buildingId =
      currentBuildingId ||
      node['gml:id'] ||
      `b_${buildingGroups.size}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    if (!buildingGroups.has(buildingId)) {
      buildingGroups.set(buildingId, []);
    }
    buildingGroups.get(buildingId).push({ node, polys });
  }

  // Process each building group and deduplicate by footprint
  const footprintToBuilding = new Map(); // footprint key -> building

  for (const [buildingId, elements] of buildingGroups) {
    // Calculate overall height from all elements
    let zmin = Infinity,
      zmax = -Infinity;
    let allFootprints = [];

    for (const element of elements) {
      for (const rings of element.polys) {
        for (const ring of rings) {
          for (const p of ring) {
            if (p[2] < zmin) zmin = p[2];
            if (p[2] > zmax) zmax = p[2];
          }
        }
      }

      // Extract footprint from each element
      let fpXYZ = extractLod0Footprint(element.node);
      if (!fpXYZ) {
        let lowest = null,
          low = Infinity;
        for (const rings of element.polys) {
          const ring = rings[0];
          if (!ring || ring.length < 3) continue;
          const z = Math.min(...ring.map((p) => p[2]));
          if (z < low) {
            low = z;
            lowest = ring;
          }
        }
        fpXYZ = lowest;
      }
      if (fpXYZ) {
        allFootprints.push(fpXYZ);
      }
    }

    const height_m = Math.max(0, (zmax - zmin) * FT_TO_M);

    // Use the largest footprint as the main footprint
    let mainFootprint = null;
    let maxArea = 0;
    for (const fpXYZ of allFootprints) {
      let footprint = fpXYZ.map(([x, y]) => reprojXY(x, y));
      // remove duplicated closing point if present
      if (footprint.length >= 2) {
        const a = footprint[0],
          b = footprint[footprint.length - 1];
        if (a[0] === b[0] && a[1] === b[1]) footprint.pop();
      }
      if (footprint.length < 3) continue;

      // Calculate area (simple polygon area)
      let area = 0;
      for (let i = 0; i < footprint.length; i++) {
        const j = (i + 1) % footprint.length;
        area += footprint[i][0] * footprint[j][1];
        area -= footprint[j][0] * footprint[i][1];
      }
      area = Math.abs(area) / 2;

      if (area > maxArea) {
        maxArea = area;
        mainFootprint = footprint;
      }
    }

    if (!mainFootprint) continue;

    // Create footprint key for deduplication
    const footprintKey = JSON.stringify(mainFootprint);

    // Check if we already have a building with this footprint
    if (footprintToBuilding.has(footprintKey)) {
      console.log(
        `Skipping duplicate building ${buildingId} (same footprint as ${footprintToBuilding.get(footprintKey).id})`
      );
      continue;
    }

    const b = {
      id: buildingId,
      footprint: mainFootprint,
      height_m: +height_m.toFixed(2),
    };

    if (lod2) {
      // Merge all LOD2 geometries for this building
      const pos = [];
      const idx = [];
      let offset = 0;

      for (const element of elements) {
        for (const rings of element.polys) {
          const rings3D = rings.map((r) =>
            r.map(([x, y, z]) => {
              const [mx, my] = reprojXY(x, y);
              return [mx, my, z * FT_TO_M];
            })
          );
          const { positions, indices } = triangulate3D(rings3D);
          for (let i = 0; i < positions.length; i++) pos.push(positions[i]);
          for (let i = 0; i < indices.length; i++)
            idx.push(indices[i] + offset);
          offset += positions.length / 3;
        }
      }

      if (pos.length >= 9 && idx.length >= 3) {
        b.mesh = {
          positions: new Float32Array(pos),
          indices: new Uint32Array(idx),
        };
      }
    } else {
      // extruded massing
      b.mesh = extrudeFootprint(mainFootprint, b.height_m);
    }

    // Store this building and its footprint
    footprintToBuilding.set(footprintKey, b);
    buildings.push(b);
  }

  return buildings;
}

/* =========================
   Outputs
   ========================= */
function writeFootprintsGeoJSON(buildings, outPath) {
  const features = buildings.map((b) => ({
    type: 'Feature',
    properties: { id: b.id, height_m: b.height_m },
    geometry: { type: 'Polygon', coordinates: [b.footprint] },
  }));
  fs.writeFileSync(
    outPath,
    JSON.stringify({ type: 'FeatureCollection', features })
  );
}

function writeFlatbushIndex(buildings, outBin, outIds) {
  const idx = new Flatbush(buildings.length);
  for (const b of buildings) {
    const [minX, minY, maxX, maxY] = bbox2D(b.footprint);
    idx.add(minX, minY, maxX, maxY);
  }
  idx.finish();

  // flatbush@4 exposes Uint8Array at idx.data
  const data = idx.data;
  // Ensure we serialize the right buffer bytes
  const buf =
    data.buffer instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data);
  fs.writeFileSync(outBin, buf);
  fs.writeFileSync(outIds, JSON.stringify(buildings.map((b) => b.id)));
}

function writeGLB(buildings, outGlb) {
  console.log(
    `Writing GLB with ${buildings.filter((b) => b.mesh).length} meshes`
  );
  console.log(`Output path: ${outGlb}`);

  try {
    const buildingsWithMeshes = buildings.filter((b) => b.mesh);
    if (buildingsWithMeshes.length === 0) {
      console.log('No buildings with meshes found');
      return;
    }

    console.log(`Creating GLB with ${buildingsWithMeshes.length} buildings`);

    // Calculate building centers and centered positions for proper positioning
    const buildingCenters = [];
    const centeredPositions = [];

    for (const building of buildingsWithMeshes) {
      const positions = building.mesh.positions;
      let centerX = 0,
        centerY = 0,
        centerZ = 0;

      for (let i = 0; i < positions.length; i += 3) {
        centerX += positions[i];
        centerY += positions[i + 1];
        centerZ += positions[i + 2];
      }

      const vertexCount = positions.length / 3;
      const center = {
        x: centerX / vertexCount,
        y: centerY / vertexCount,
        z: centerZ / vertexCount,
      };

      buildingCenters.push(center);

      // Center the geometry around origin for proper node positioning
      const centered = new Float32Array(positions.length);
      for (let j = 0; j < positions.length; j += 3) {
        centered[j] = positions[j] - center.x;
        centered[j + 1] = positions[j + 1] - center.y;
        centered[j + 2] = positions[j + 2] - center.z;
      }
      centeredPositions.push(centered);
    }

    // Create GLB structure for all buildings with proper transformations
    const gltf = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: buildingsWithMeshes.map((_, i) => i) }],
      nodes: buildingsWithMeshes.map((_, i) => {
        const center = buildingCenters[i];
        return {
          mesh: i,
          translation: [center.x, center.y, center.z],
        };
      }),
      meshes: buildingsWithMeshes.map(() => ({
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
          },
        ],
      })),
      accessors: [],
      bufferViews: [],
      buffers: [
        {
          byteLength: 0, // Will be calculated
        },
      ],
    };

    // Calculate total buffer size and create accessors/bufferViews
    let byteOffset = 0;
    let accessorIndex = 0;
    let bufferViewIndex = 0;

    for (let i = 0; i < buildingsWithMeshes.length; i++) {
      const building = buildingsWithMeshes[i];
      const centered = centeredPositions[i];
      const positionsLength = centered.length * 4;
      const indicesLength = building.mesh.indices.length * 4;

      // Update mesh to use correct accessor indices
      gltf.meshes[accessorIndex].primitives[0].attributes.POSITION =
        accessorIndex * 2;
      gltf.meshes[accessorIndex].primitives[0].indices = accessorIndex * 2 + 1;

      // Create position accessor with centered bounds
      gltf.accessors.push({
        bufferView: bufferViewIndex,
        componentType: 5126, // FLOAT
        count: centered.length / 3,
        type: 'VEC3',
        max: [
          Math.max(...centered.filter((_, i) => i % 3 === 0)),
          Math.max(...centered.filter((_, i) => i % 3 === 1)),
          Math.max(...centered.filter((_, i) => i % 3 === 2)),
        ],
        min: [
          Math.min(...centered.filter((_, i) => i % 3 === 0)),
          Math.min(...centered.filter((_, i) => i % 3 === 1)),
          Math.min(...centered.filter((_, i) => i % 3 === 2)),
        ],
      });

      // Create position bufferView
      gltf.bufferViews.push({
        buffer: 0,
        byteOffset: byteOffset,
        byteLength: positionsLength,
      });

      byteOffset += positionsLength;
      bufferViewIndex++;

      // Create indices accessor
      gltf.accessors.push({
        bufferView: bufferViewIndex,
        componentType: 5125, // UNSIGNED_INT
        count: building.mesh.indices.length,
        type: 'SCALAR',
      });

      // Create indices bufferView
      gltf.bufferViews.push({
        buffer: 0,
        byteOffset: byteOffset,
        byteLength: indicesLength,
      });

      byteOffset += indicesLength;
      bufferViewIndex++;
      accessorIndex++;
    }

    // Update buffer byteLength
    gltf.buffers[0].byteLength = byteOffset;

    // Convert to JSON
    const jsonString = JSON.stringify(gltf);
    const jsonBuffer = Buffer.from(jsonString, 'utf8');

    // Pad JSON to 4-byte boundary
    const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
    const paddedJsonBuffer = Buffer.concat([
      jsonBuffer,
      Buffer.alloc(jsonPadding),
    ]);

    // Create binary data for all buildings with centered geometry
    const binaryBuffers = [];
    for (let i = 0; i < buildingsWithMeshes.length; i++) {
      const building = buildingsWithMeshes[i];
      const centered = centeredPositions[i];

      binaryBuffers.push(Buffer.from(centered.buffer));
      binaryBuffers.push(Buffer.from(building.mesh.indices.buffer));
    }
    const binaryBuffer = Buffer.concat(binaryBuffers);

    // Pad binary to 4-byte boundary
    const binaryPadding = (4 - (binaryBuffer.length % 4)) % 4;
    const paddedBinaryBuffer = Buffer.concat([
      binaryBuffer,
      Buffer.alloc(binaryPadding),
    ]);

    // Create GLB header (12 bytes)
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); // "glTF"
    header.writeUInt32LE(2, 4); // version
    header.writeUInt32LE(
      12 + paddedJsonBuffer.length + paddedBinaryBuffer.length,
      8
    ); // total length

    // Create JSON chunk header (8 bytes)
    const jsonChunkHeader = Buffer.alloc(8);
    jsonChunkHeader.writeUInt32LE(paddedJsonBuffer.length, 0);
    jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

    // Create binary chunk header (8 bytes)
    const binaryChunkHeader = Buffer.alloc(8);
    binaryChunkHeader.writeUInt32LE(paddedBinaryBuffer.length, 0);
    binaryChunkHeader.writeUInt32LE(0x004e4942, 4); // "BIN"

    // Combine all parts
    const glbBuffer = Buffer.concat([
      header,
      jsonChunkHeader,
      paddedJsonBuffer,
      binaryChunkHeader,
      paddedBinaryBuffer,
    ]);

    fs.writeFileSync(outGlb, glbBuffer);
    console.log('GLB write completed successfully');
    console.log(`GLB file size: ${glbBuffer.length} bytes`);
  } catch (error) {
    console.log(`GLB write error details: ${error.stack}`);
    throw error;
  }
}

/* =========================
   Main
   ========================= */
(async () => {
  let files = [];

  // Check if IN_DIR is a file or directory
  if (fs.statSync(IN_DIR).isFile()) {
    // Single file input
    if (IN_DIR.endsWith('.gml')) {
      files = [IN_DIR];
    } else {
      console.error(`Input file ${IN_DIR} is not a .gml file`);
      process.exit(1);
    }
  } else {
    // Directory input
    files = fs
      .readdirSync(IN_DIR)
      .filter((f) => f.endsWith('.gml'))
      .sort();
    if (!files.length) {
      console.error(`No .gml in ${IN_DIR}`);
      process.exit(1);
    }
    // Convert to full paths
    files = files.map((f) => path.join(IN_DIR, f));
  }

  const all = [];
  for (const p of files) {
    const f = path.basename(p);
    console.log(`Parsing ${f} …`);
    const bs = processGMLSync(p, { lod2: LOD2 });
    console.log(`  +${bs.length} buildings`);
    all.push(...bs);
  }
  console.log(`Total buildings: ${all.length}`);

  const fpPath = path.join(OUT_DIR, 'footprints.geojson');
  writeFootprintsGeoJSON(all, fpPath);
  console.log(`Wrote ${fpPath}`);

  const idxPath = path.join(OUT_DIR, 'index.bin');
  const idsPath = path.join(OUT_DIR, 'ids.json');
  writeFlatbushIndex(all, idxPath, idsPath);
  console.log(`Wrote ${idxPath}, ${idsPath}`);

  try {
    const glbPath = path.join(OUT_DIR, 'buildings.glb');
    await writeGLB(all, glbPath);
    console.log(`Wrote ${glbPath}`);
  } catch (error) {
    console.log(`GLB generation failed: ${error.message}`);
    console.log('Continuing without 3D model...');
  }

  console.log(LOD2 ? 'Mode: LOD2 (roof/wall).' : 'Mode: Extruded massing.');
})();
