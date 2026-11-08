# Riftball athlete assets

The athlete surfaces, facial features, uniforms, hairstyles, skeleton and animation keyframes in this directory are original procedural content authored for this repository. No downloaded character model, motion capture clip, texture, likeness or external character asset is included.

Both identities share one 21-bone athletic rig and canonical proportions. The teal athlete wears jersey 01, dark cropped curls and warm brown skin; the coral athlete wears jersey 02, swept hair with a tied braid and a lighter warm complexion. Team colors come from the shared game configuration. Their identities remain consistent across every move.

The `surface.js` builder produces normalized skin weights around the spine, shoulders, elbows, knees and ankles. Gloves, shoe panels, jersey details and hair follow the same skeleton. Faces add ball gaze, blinks, brows, mouth expressions and fatigue breathing without altering simulation state.

The animation library has twelve authored clips: ready/breathing, run, charge, quick strike, power strike, jump, dash, feint, landing, hit, victory and defeat. Quick and power contacts occur at approximately 0.105 seconds, matching the shared strike windup. The two strikes have different hand paths and torso rotations. Clip playback is visual and never changes authoritative timing, reach, contacts or scoring.

Feet use the server's `y` as the collider bottom. A bounded visual pelvis adjustment places the lowest grounded shoe support on that plane. Running turns toward travel; striking immediately uses authoritative aim. The action identity and render clock keep moves advancing between network snapshots, and a goal serial owns each celebration clock.

The module consumes Three.js 0.187 already supplied by the project. Three.js remains subject to its own MIT license in `node_modules/three/LICENSE`; these original athlete assets introduce no additional third-party asset license or attribution requirement.
