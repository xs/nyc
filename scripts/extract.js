#!/usr/bin/env node
// scripts/extract.js
import fs from 'fs';
import path from 'path';
import proj4 from 'proj4';
import { XMLParser } from 'fast-xml-parser';
import earcut from 'earcut';
import Flatbush from 'flatbush';
import { Document, NodeIO, WebIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { dedup, weld, reorder, quantize } from '@gltf-transform/functions';

// Ensure Buffer is available globally
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

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
  console.log('  npm run extract                                    # Use defaults (data/sample -> out/sample)');
  console.log('  npm run extract -- --in data/sample --out out/sample');
  console.log('  npm run extract -- --in data/complete --out out/complete --lod2');
  console.log('  npm run extract -- --in data/sample/DA1_3D_Buildings_Merged_Sample.gml --out out/single');
  console.log('');
  console.log('Arguments:');
  console.log('  --in <directory>    Input directory containing CityGML files (default: data/sample)');
  console.log('  --out <directory>   Output directory for glTF files (default: out/sample)');
  console.log('  --lod2              Use LOD2 geometry instead of LOD1 (default: LOD1)');
  console.log('  --single            Process only the first file found (useful for testing)');
  console.log('  -h, --help          Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npm run extract                                    # Process data/sample with defaults');
  console.log('  npm run extract -- --in data/complete --out out/complete --lod2');
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
const toMerc = proj4('EPSG:2263', 'EPSG:3857');
const FT_TO_M = 0.3048;
const reprojXY = (x, y) => toMerc.forward([x, y]); // -> [x_m, y_m]

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
  for (let i = 0; i + 2 < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]);
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
  // sides
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const aT = i,
      bT = j,
      aB = botBase + i,
      bB = botBase + j;
    indices.push(aT, aB, bT, bT, aB, bB);
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
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
      for (const c of v) if (c && typeof c === 'object' && containsTag(c, name)) return true;
    } else if (v && typeof v === 'object') {
      if (containsTag(v, name)) return true;
    }
  }
  return false;
}

function findLinearRing(container) {
  const lr = container['gml:LinearRing'] || container['LinearRing'] || container;
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
      const intrArr = Array.isArray(interiors) ? interiors : interiors ? [interiors] : [];
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

  const buildings = [];

  for (const node of walk(root)) {
    if (!node || typeof node !== 'object') continue;

    const looksBuilding =
      containsTag(node, 'Polygon') ||
      containsTag(node, 'RoofSurface') ||
      containsTag(node, 'WallSurface') ||
      containsTag(node, 'lod0FootPrint');

    if (!looksBuilding) continue;

    const polys = extractPolygons(node);
    if (!polys.length) continue;

    // height from z range (feet → m)
    let zmin = Infinity,
      zmax = -Infinity;
    for (const rings of polys) {
      for (const ring of rings) {
        for (const p of ring) {
          if (p[2] < zmin) zmin = p[2];
          if (p[2] > zmax) zmax = p[2];
        }
      }
    }
    const height_m = Math.max(0, (zmax - zmin) * FT_TO_M);

    // footprint: lod0FootPrint preferred, else lowest ring
    let fpXYZ = extractLod0Footprint(node);
    if (!fpXYZ) {
      let lowest = null,
        low = Infinity;
      for (const rings of polys) {
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
    if (!fpXYZ) continue;

    let footprint = fpXYZ.map(([x, y]) => reprojXY(x, y));
    // remove duplicated closing point if present
    if (footprint.length >= 2) {
      const a = footprint[0],
        b = footprint[footprint.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) footprint.pop();
    }
    if (footprint.length < 3) continue;

    const id = node['gml:id'] || node['id'] || `b_${buildings.length}`;
    const b = { id, footprint, height_m: +height_m.toFixed(2) };

    if (lod2) {
      // true LOD2 geometry
      const pos = [];
      const idx = [];
      let offset = 0;
      for (const rings of polys) {
        const rings3D = rings.map((r) =>
          r.map(([x, y, z]) => {
            const [mx, my] = reprojXY(x, y);
            return [mx, my, z * FT_TO_M];
          })
        );
        const { positions, indices } = triangulate3D(rings3D);
        for (let i = 0; i < positions.length; i++) pos.push(positions[i]);
        for (let i = 0; i < indices.length; i++) idx.push(indices[i] + offset);
        offset += positions.length / 3;
      }
      if (pos.length >= 9 && idx.length >= 3) {
        b.mesh = { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
      }
    } else {
      // extruded massing
      b.mesh = extrudeFootprint(footprint, b.height_m);
    }

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
  fs.writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', features }));
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
  const buf = data.buffer instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data);
  fs.writeFileSync(outBin, buf);
  fs.writeFileSync(outIds, JSON.stringify(buildings.map((b) => b.id)));
}

async function writeGLB(buildings, outGlb) {
  const doc = new Document();
  const scene = doc.createScene('Scene');

  for (const b of buildings) {
    if (!b.mesh) continue;
    const mesh = doc.createMesh(b.id);
    const pos = doc.createAccessor().setType('VEC3').setArray(b.mesh.positions);
    const idx = doc.createAccessor().setType('SCALAR').setArray(b.mesh.indices);
    const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx);
    mesh.addPrimitive(prim);
    const node = doc.createNode(b.id).setMesh(mesh);
    scene.addChild(node);
  }

  await doc.transform(
    weld(),
    dedup(),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 })
  );

  // doc.createExtension(KHRDracoMeshCompression).setRequired(true);

  // Try NodeIO with explicit buffer handling
  const io = new NodeIO(); // .registerExtensions([KHRDracoMeshCompression]);
  
  // Add logging to debug the issue
  console.log(`Writing GLB with ${buildings.filter(b => b.mesh).length} meshes`);
  console.log(`Output path: ${outGlb}`);
  
  try {
    // Try writing to a temporary buffer first
    const glbBuffer = await io.writeBinary(doc);
    fs.writeFileSync(outGlb, glbBuffer);
    console.log('GLB write completed successfully');
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
    files = fs.readdirSync(IN_DIR).filter((f) => f.endsWith('.gml')).sort();
    if (!files.length) {
      console.error(`No .gml in ${IN_DIR}`);
      process.exit(1);
    }
    // Convert to full paths
    files = files.map(f => path.join(IN_DIR, f));
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
