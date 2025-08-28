1. Start with raw CityGML

download the .gml files (NYC has ~20 of them, ~400k buildings total).
Inside, each building is described as a bunch of polygons (walls, roofs, footprints) with coordinates.

2. Extract the useful parts

pull out:

Footprints (the outline of each building on the ground).

Heights (from the Z values of the roof polygons).

Optionally the full 3D walls/roofs

next, run extract-citygml.ts on the files in data/sample/, and have them output to files in a new directory out/sample/.

before we do that, make sure that extract-citygml.ts uses the streaming approach we decided on before

3. Convert coordinates

The .gml coordinates are in NYC’s mapping system (EPSG:2263 = feet).

Convert them to something friendlier (Web Mercator meters, EPSG:3857) so they line up with GPS/lat-lon data from Strava or a drone.

4. Build geometry files for the browser

Turn the polygons into meshes and export them as glTF/GLB — the compact 3D model format that Three.js loads fast.

Instead of one giant GLB with 400k meshes, merge them into tiles or borough-sized chunks.

5. Build a lightweight spatial index

For each building footprint, compute a bounding box.

Store all boxes in a spatial index (R-tree, e.g. Flatbush).

Save that index + footprint coordinates in a compact binary/JSON so the browser can quickly answer: “Which buildings are near this point?”

6. Pack everything as pre-processed assets

At the end:

Tiles of GLBs → the actual meshes Three.js renders (hidden by default).
Index/footprint blobs → tiny lookup files that tell which building is where.

7. Browser playback

Website loads just the GLBs + index for the area in (say, Manhattan).

As GPS dot (from Strava/drone) moves, query the index:
“Which buildings are within 50 m?”

Flip those buildings visible (or fade them in) in Three.js.

👉 So the flow is:

CityGML → extract geometry + footprints → reproject coords → GLB meshes + R-tree index → load in browser → reveal on GPS path
