# Studio Linea

Demo website for **Studio Linea**, a (fictional) interior architecture atelier designing quiet, light-led luxury residences.

The homepage is a **scroll-driven WebGL walkthrough of Casa Linea**: a contemporary villa in Puglia. Each room is a pair of 3D pivot doors that swing open as you scroll, with a warm line of light at the seam, light guides running into the next room, and dust in the air. The route is façade → threshold → gallery → living → kitchen → dining → stair → suite → bath → horizon pool.

## Stack

No build step. Static HTML/CSS/JS:

- [three.js](https://threejs.org) 0.186 (import map) for the walkthrough, with custom shaders: cover-fit, door split, shared colour grade, velocity chroma
- [GSAP](https://gsap.com) 3.15 + ScrollTrigger for section animations, horizontal projects and the "Where…" rotation
- [Lenis](https://lenis.darkroom.engineering) for smooth scroll
- Cormorant Garamond + Inter Tight (Google Fonts)

## Run locally

```bash
python3 -m http.server 5178
```

Then open http://localhost:5178. The site can also be deployed as-is to GitHub Pages (Settings → Pages → `main` / root).

## Notes

- All imagery in `assets/img/` was AI-generated with Higgsfield (GPT Image 2.5) as one coherent villa: charcoal plaster, travertine, smoked oak, Nero Marquina, blackened bronze, dusk light, coastal hills.
- The design tokens and rationale live in `design-system/studio-linea/MASTER.md`. Layout was inspired by [merise.ae](https://www.merise.ae).
- `prefers-reduced-motion` and no-WebGL visitors get a static image crossfade instead of the 3D walkthrough.
- The contact form is a demo and sends nothing.
