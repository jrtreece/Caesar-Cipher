# AETHERION — a three.js cosmos

An interactive 3D galaxy rendered in the browser with [three.js](https://threejs.org).

![scene](https://img.shields.io/badge/three.js-r160-8ecbff)

## What's in the scene

- **Procedural spiral galaxy** — up to 140,000 GPU-animated particles with
  differential rotation (the core spins faster than the rim) and per-star twinkle
- **Pulsing energy star** at the core, surface driven by 3D simplex noise, with a
  halo and a rotating lens flare
- **Swirling accretion ring** of shader-animated energy
- **10 iridescent crystals** orbiting the core — faceted shading from
  screen-space derivatives, thin-film color from the fresnel angle
- **A comet** on a tilted orbit dragging a 90-particle fading trail
- **Shooting stars**, drifting nebula clouds, interstellar dust haze, and a
  twinkling background starfield
- **Unreal bloom** post-processing with ACES filmic tone mapping
- **Tap anywhere for a supernova** — expanding shockwave + 600-particle burst

## Viewing it

Everything is vendored — no CDN, no build step, no network needed. Serve the
folder with any static file server and open it:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Or enable GitHub Pages for this repo and open the page on your phone.

## Mobile

The scene detects phones and scales itself: fewer particles, capped pixel
ratio, half-resolution bloom, and an automatic quality step-down if the frame
rate dips. One-finger drag orbits, pinch zooms, tap fires a supernova.
