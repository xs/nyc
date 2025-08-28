#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import proj4 from 'proj4';
import { XMLParser } from 'fast-xml-parser';
import earcut from 'earcut';
import Flatbush from 'flatbush';
import { Document, NodeIO } from '@gltf-transform/core';
import { DracoMeshCompression } from '@gltf-transform/extensions';
import { dedup, weld, reorder, quantize } from '@gltf-transform/functions';

// ---------- CLI ----------
const argv = process.argv.slice(2);
function arg(name, def = undefined) {
  const a = argv.find(s => s === `--${name}` || s.startsWith(`--${name}=`));
  if (!a) return def;
  if (a.includes('=')) return a.split('=')[1];
  return true;
}
const IN_DIR = arg('in', './data/sample');
const OUT_DIR = arg('out', './out/sample');
const LOD2 = !!arg('lod2', false);

// make sure out dir exists
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------- CRS ----------
proj4.defs(
  'EPSG:2263',
  '+proj=lcc +lat_1=41.03333333333333 +lat_2=40.66666666666666 +lat_0=40.16666666666666 +lon_0=-74 +x_0=300000.0000000001 +y_0=0 +datum=NAD83 +units=us-ft +no_defs'
);
const toMerc = proj4('EPSG:2263', 'EPSG:3857');
const FT_TO_M = 0.3048;

// ---------- XML parsing helpers ----------
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', trimValues: true });
const nsLocal = (tag) => tag?.split(':').pop()?.split('}').pop() || '';
function* walk(node) {
  if (node && typeof node === 'object') {
    yield node;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) for (const c of v) yield* walk(c);
      else if (v && typeof v === 'object') yield* walk(v);
    }
  }
}
function posListToXYZ(text) {
  const a = text.trim().split(/\s+/).map(Number);
  const out = [];
  for (let i = 0; i + 2 < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]);
  return out;
}
const dot = (a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = (v)=>{const n=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/n,v[1]/n,v[2]/n];};
function planeBasis3D(points){ /* … same as before … */ }
function triangulate3D(rings3D){ /* … same as before … */ }
function extrudeFootprint(footprint, height){ /* … same as before … */ }
const reprojXY = (x,y)=>toMerc.forward([x,y]);
const bbox2D = (coords)=>{ let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const [x,y] of coords){ if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; }
  return [minX,minY,maxX,maxY];
};

// ---------- CityGML readers ----------
function containsTag(node, name){ /* … same as before … */ }
function findLinearRing(container){ /* … same as before … */ }
function extractPolygons(node){ /* … same as before … */ }
function extractLod0Footprint(node){ /* … same as before … */ }

function processGMLSync(filePath, { lod2 }){
  // … same as before: parse, build footprints, mesh (LOD2 or extrude) …
  return buildings;
}

// ---------- Outputs ----------
function writeFootprintsGeoJSON(buildings, outPath){
  const features = buildings.map(b=>({
    type:'Feature',
    properties:{ id:b.id, height_m:b.height_m },
    geometry:{ type:'Polygon', coordinates:[b.footprint] }
  }));
  fs.writeFileSync(outPath, JSON.stringify({ type:'FeatureCollection', features }));
}
function writeFlatbushIndex(buildings, outBin, outIds){
  const idx = new Flatbush(buildings.length);
  for (const b of buildings){
    const [minX,minY,maxX,maxY] = bbox2D(b.footprint);
    idx.add(minX,minY,maxX,maxY);
  }
  idx.finish();
  fs.writeFileSync(outBin, Buffer.from(idx.data.buffer));
  fs.writeFileSync(outIds, JSON.stringify(buildings.map(b=>b.id)));
}
async function writeGLB(buildings, outGlb){
  const doc = new Document();
  const scene = doc.createScene('Scene');
  for (const b of buildings){
    if (!b.mesh) continue;
    const mesh = doc.createMesh(b.id);
    const pos = doc.createAccessor().setType('VEC3').setArray(b.mesh.positions);
    const idx = doc.createAccessor().setType('SCALAR').setArray(b.mesh.indices);
    mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx));
    scene.addChild(doc.createNode(b.id).setMesh(mesh));
  }
  await doc.transform(weld(),dedup(),reorder({ target:'size' }),quantize({ quantizePosition:14 }));
  doc.createExtension(DracoMeshCompression).setRequired(true);
  const io = new NodeIO().registerExtensions([DracoMeshCompression]);
  await io.write(outGlb, doc);
}

// ---------- Main ----------
(async () => {
  const files = fs.readdirSync(IN_DIR).filter(f => f.endsWith('.gml')).sort();
  if (!files.length) { console.error(`No .gml in ${IN_DIR}`); process.exit(1); }

  const all=[];
  for (const f of files){
    console.log(`Parsing ${f} …`);
    const bs = processGMLSync(path.join(IN_DIR,f), { lod2: LOD2 });
    console.log(`  +${bs.length} buildings`);
    all.push(...bs);
  }
  console.log(`Total buildings: ${all.length}`);

  writeFootprintsGeoJSON(all, path.join(OUT_DIR,'footprints.geojson'));
  console.log(`Wrote ${OUT_DIR}/footprints.geojson`);

  writeFlatbushIndex(all, path.join(OUT_DIR,'index.bin'), path.join(OUT_DIR,'ids.json'));
  console.log(`Wrote index.bin + ids.json`);

  await writeGLB(all, path.join(OUT_DIR,'buildings.draco.glb'));
  console.log(`Wrote ${OUT_DIR}/buildings.draco.glb`);

  console.log(LOD2 ? 'Mode: LOD2 (roof/wall).' : 'Mode: Extruded massing.');
})();
