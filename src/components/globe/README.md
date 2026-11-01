# src/components/globe

`GlobeScene.tsx` renders the Earth with three.js through @react-three/fiber: textured sphere, atmosphere, routes drawn with a dark casing so they stay readable on colour, chokepoint and hazard markers, and a camera rig.

`camera.ts` holds the camera targets and easing helpers. Textures in `public/tex` are resized by `scripts/tex.mjs` from third-party Earth texture sets (see `public/README.md`).
