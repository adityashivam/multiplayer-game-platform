// Rebuild public/games/driftline/assets/cars/concept-car.glb from the Khronos
// CarConcept sample (CC BY 4.0). The tools are not project dependencies;
// install them in a throwaway folder and run this script from there:
//   npm install --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
//   node scripts/prepare-driftline-car.mjs CarConcept.glb concept-car.glb
// See public/games/driftline/assets/cars/CREDITS.md for what is changed and why.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, quantize, reorder, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const REMOVED_NODE_PREFIXES = ["Interior", "Engine", "License Plate", "BodyWindshieldWipers", "BodyHoodInterior", "BodyHoodUnder"];
const REMOVED_EXTENSIONS = ["KHR_materials_variants", "KHR_materials_transmission", "KHR_materials_iridescence"];

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node prepare-driftline-car.mjs <CarConcept.glb> <concept-car.glb>");
await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const document = await io.read(inputPath);
const root = document.getRoot();

// Hidden parts cost triangles without ever being seen from the chase camera.
for (const node of root.listNodes().filter((candidate) => REMOVED_NODE_PREFIXES.some((prefix) => (candidate.getName() || "").startsWith(prefix)))) {
  node.traverse((child) => { if (child !== node) child.dispose(); });
  node.dispose();
}

// The licence-plate image is the Khronos logo, reused as an emissive map on
// rims, calipers, mirrors and trim; the tyre sidewall texture prints logos too.
const logoTexture = root.listMaterials().find((material) => material.getName() === "License")?.getBaseColorTexture() ?? null;
for (const material of root.listMaterials()) {
  if (logoTexture && material.getEmissiveTexture() === logoTexture) {
    material.setEmissiveTexture(null);
    material.setEmissiveFactor([0, 0, 0]);
  }
  if (material.getName() === "Tireside") {
    material.setBaseColorTexture(null);
    material.setBaseColorFactor([0.013, 0.013, 0.013, 1]);
  }
  if (material.getName() === "Glass") {
    material.setExtension("KHR_materials_transmission", null);
    material.setBaseColorFactor([0.012, 0.016, 0.022, 1]);
    material.setMetallicFactor(0.1);
    material.setRoughnessFactor(0.04);
  }
  material.setExtension("KHR_materials_iridescence", null);
}
for (const extension of root.listExtensionsUsed()) {
  if (REMOVED_EXTENSIONS.includes(extension.extensionName)) extension.dispose();
}

// No flatten or join: the wheel nodes must stay separate to spin and steer.
await document.transform(
  prune(),
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.35, error: 0.002 }),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }),
  reorder({ encoder: MeshoptEncoder }),
  quantize(),
);
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
root.getAsset().generator = "Driftline asset pipeline (from Khronos CarConcept, CC BY 4.0)";
await io.write(outputPath, document);
