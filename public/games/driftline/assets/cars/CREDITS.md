# Car model credits

`concept-car.glb` is a modified version of **Car Concept** from the Khronos
[glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept).

- © 2024, Darmstadt Graphics Group GmbH. Model and textures by Eric Chadwick,
  based on a public-domain model by Unity Fan.
- License: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
- The original license excludes logos and trademarks. All Khronos and
  3D Commerce logo textures were removed from this copy.

## Changes made for Driftline

- Removed: the interior, engine, wipers, licence plate, logo emissive maps and
  the logo-printed tyre sidewall texture.
- Removed the material variants, iridescence and glass transmission, and
  replaced the glass with an opaque tinted finish.
- Simplified the meshes to about 35% of their triangles.
- Resized textures to at most 1024 px and converted them to WebP.
- Applied meshopt geometry compression.

The size went from 11.8 MB to about 0.9 MB. The node hierarchy is preserved so
the wheels can spin and steer. Regenerate with `scripts/prepare-driftline-car.mjs`.
