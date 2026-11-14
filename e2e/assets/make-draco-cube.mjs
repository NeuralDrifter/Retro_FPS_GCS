/**
 * Generates e2e/assets/draco-cube.glb: a 1 m cube compressed with KHR_draco_mesh_compression.
 * The e2e suite uses it to check that the editor loads the Draco decoder from its own base path.
 *
 * These packages are not project dependencies. To regenerate, copy this file into an empty
 * folder and run:
 *   npm install @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 draco3dgltf@1.5.9
 *   node make-draco-cube.mjs <path to e2e/assets/draco-cube.glb>
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const outPath = process.argv[2];
if (!outPath) throw new Error('usage: node make-draco-cube.mjs <out.glb>');

// 6 faces x 4 corners, so each face has its own normal
const faces = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const positions = [];
const normals = [];
const indices = [];
for (const { n, u, v } of faces) {
  const base = positions.length / 3;
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    for (let i = 0; i < 3; i++) positions.push(0.5 * (n[i] + su * u[i] + sv * v[i]) + (i === 1 ? 0.5 : 0));
    normals.push(...n);
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

const doc = new Document();
const buffer = doc.createBuffer();
const primitive = doc
  .createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer))
  .setMaterial(doc.createMaterial('e2e-cube').setBaseColorFactor([0.2, 0.7, 0.9, 1]));
const mesh = doc.createMesh('DracoCube').addPrimitive(primitive);
doc.createScene().addChild(doc.createNode('DracoCube').setMesh(mesh));

doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
  method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
});

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({ 'draco3d.encoder': await draco3d.createEncoderModule() });
await io.write(outPath, doc);
console.log(`wrote ${outPath}`);
