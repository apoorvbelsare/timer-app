import { type Garden, type Plant, GROWN } from './garden';

/** Draws the garden as an SVG scene. Shapes are simple on purpose: calm, not busy. */

const NS = 'http://www.w3.org/2000/svg';
const WIDTH = 1000;
const HEIGHT = 260;
const GROUND = 226;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: SVGElement[]) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.append(...children);
  return node;
}

const COLORS = {
  soil: '#8a6a4f',
  stem: '#6a9f62',
  leaf: '#7fae7d',
  leafDark: '#5b8f66',
  pine: '#41725f',
  pineDark: '#335c4c',
  birchLeaf: '#a9c98a',
  birchBark: '#ece6da',
  trunk: '#7a5a43',
  blossom: '#eaa3b5',
  blossomLight: '#f6ccd6',
  bush: '#5f8f5a',
  berry: '#c4524a',
};

/** Same random numbers for the same tree every time, so details don't flicker. */
function jitter(seed: number, i: number) {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function sprout(stage: number): SVGElement[] {
  const height = stage === 1 ? 14 : 30;
  const parts: SVGElement[] = [el('path', { d: `M0 0 Q2 ${-height / 2} 0 ${-height}`, stroke: COLORS.stem, 'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round' })];
  const pairs = stage === 1 ? [height] : [height * 0.45, height * 0.72, height];
  pairs.forEach((y, i) => {
    const size = stage === 1 ? 5 : 4 + i;
    parts.push(
      el('ellipse', { cx: -size, cy: -y, rx: size, ry: size / 2, fill: COLORS.leaf, transform: `rotate(-28 ${-size} ${-y})` }),
      el('ellipse', { cx: size, cy: -y - 1, rx: size, ry: size / 2, fill: COLORS.leafDark, transform: `rotate(28 ${size} ${-y - 1})` }),
    );
  });
  return parts;
}

function canopy(p: Plant, r: number, top: number): SVGElement[] {
  const grown = p.stage === GROWN;
  switch (p.species) {
    case 'pine': {
      const tiers = [0, 1, 2].map((t) => {
        const w = r * (1.25 - t * 0.3);
        const y = top + r * 0.5 - t * r * 0.75;
        return el('path', { d: `M${-w} ${y} L0 ${y - r * 1.15} L${w} ${y} Z`, fill: t % 2 ? COLORS.pine : COLORS.pineDark });
      });
      return tiers;
    }
    case 'birch':
      return [
        el('ellipse', { cx: 0, cy: top - r * 0.5, rx: r * 0.7, ry: r * 1.15, fill: COLORS.birchLeaf }),
        el('ellipse', { cx: r * 0.25, cy: top - r * 0.8, rx: r * 0.4, ry: r * 0.6, fill: COLORS.leaf, opacity: 0.6 }),
      ];
    case 'bush': {
      const parts: SVGElement[] = [
        el('ellipse', { cx: 0, cy: top - r * 0.35, rx: r * 1.2, ry: r * 0.75, fill: COLORS.bush }),
        el('ellipse', { cx: -r * 0.45, cy: top - r * 0.55, rx: r * 0.6, ry: r * 0.45, fill: COLORS.leaf, opacity: 0.7 }),
      ];
      if (grown) {
        for (let i = 0; i < 7; i++) {
          parts.push(el('circle', { cx: (jitter(p.index, i) - 0.5) * r * 1.8, cy: top - r * 0.2 - jitter(p.index, i + 9) * r * 0.8, r: 2.6, fill: COLORS.berry }));
        }
      }
      return parts;
    }
    default: {
      // Oak and cherry share a cloud of leaves; cherries bloom pink
      const [main, light] = p.species === 'cherry' ? [COLORS.blossom, COLORS.blossomLight] : [COLORS.leafDark, COLORS.leaf];
      const parts: SVGElement[] = [
        el('circle', { cx: -r * 0.6, cy: top - r * 0.1, r: r * 0.7, fill: main }),
        el('circle', { cx: r * 0.6, cy: top - r * 0.1, r: r * 0.7, fill: main }),
        el('circle', { cx: 0, cy: top - r * 0.55, r: r * 0.85, fill: light }),
      ];
      if (grown && p.species === 'cherry') {
        for (let i = 0; i < 9; i++) {
          parts.push(el('circle', { cx: (jitter(p.index, i) - 0.5) * r * 1.8, cy: top - jitter(p.index, i + 9) * r * 1.2, r: 2.2, fill: '#fff', opacity: 0.85 }));
        }
      }
      return parts;
    }
  }
}

const TRUNK: Record<number, { h: number; w: number; k: number }> = {
  3: { h: 40, w: 3, k: 0.45 },
  4: { h: 62, w: 5, k: 0.7 },
  5: { h: 82, w: 7, k: 1 },
};

function tree(p: Plant): SVGElement[] {
  const { h, w, k } = TRUNK[p.stage];
  const r = 38 * k;
  const height = p.species === 'bush' ? h * 0.15 : p.species === 'pine' ? h * 0.55 : h;
  const bark = p.species === 'birch' ? COLORS.birchBark : COLORS.trunk;
  const parts: SVGElement[] = [el('rect', { x: -w / 2, y: -height, width: w, height, rx: w / 2, fill: bark })];
  if (p.species === 'birch' && p.stage >= 4) {
    for (let i = 1; i < 4; i++) parts.push(el('rect', { x: -w / 2, y: -height * (i / 4), width: w * 0.6, height: 1.6, fill: '#3d3530', opacity: 0.6 }));
  }
  return [...parts, ...canopy(p, r, -height)];
}

function plant(p: Plant, depth: number): SVGElement {
  // Trees further back sit higher and a little smaller, which gives the forest depth
  const scale = 1 - depth * 0.12;
  const y = GROUND - depth * 14;
  const shapes =
    p.stage === 0
      ? [el('ellipse', { cx: 0, cy: 0, rx: 10, ry: 4, fill: COLORS.soil }), el('ellipse', { cx: 0, cy: -3, rx: 3.5, ry: 2.2, fill: '#5e4532' })]
      : [el('ellipse', { cx: 0, cy: 1, rx: p.stage < 3 ? 9 : 14, ry: 3, fill: COLORS.soil, opacity: 0.55 }), ...(p.stage < 3 ? sprout(p.stage) : tree(p))];
  const g = el('g', { class: `plant stage-${p.stage}`, transform: `translate(${p.x * WIDTH} ${y}) scale(${scale})` }, ...shapes);
  const title = el('title');
  title.textContent = `${p.species} · stage ${p.stage + 1} of 6`;
  g.append(title);
  return g;
}

export interface SceneOptions {
  /** Draw sky and ground; off when the page already has its own background */
  backdrop?: boolean;
}

export function renderGarden(g: Garden, opts: SceneOptions = {}): SVGSVGElement {
  const svg = el('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: `garden-scene${g.sleepy ? ' sleepy' : ''}`, role: 'img', 'aria-label': describe(g) });
  if (opts.backdrop) {
    svg.append(
      el('path', { d: `M0 ${GROUND - 40} C 250 ${GROUND - 70} 450 ${GROUND - 20} 700 ${GROUND - 45} S 950 ${GROUND - 60} 1000 ${GROUND - 40} V${HEIGHT} H0 Z`, class: 'ground-back' }),
      el('path', { d: `M0 ${GROUND - 6} C 300 ${GROUND - 26} 600 ${GROUND + 4} 1000 ${GROUND - 12} V${HEIGHT} H0 Z`, class: 'ground' }),
    );
  }
  const placed = g.plants.map((p) => ({ p, depth: p.generation === 0 ? 0 : Math.round(jitter(p.index, 3) * Math.min(3, p.generation)) }));
  placed.sort((a, b) => b.depth - a.depth || a.p.x - b.p.x);
  for (const { p, depth } of placed) svg.append(plant(p, depth));
  g.flowers.forEach((f, i) => {
    const x = f.x * WIDTH;
    const y = GROUND + 6 + jitter(i, 5) * 18;
    svg.append(
      el('line', { x1: x, y1: y, x2: x, y2: y - 7, stroke: COLORS.stem, 'stroke-width': 1.2 }),
      el('circle', { cx: x, cy: y - 8, r: 3, fill: `hsl(${Math.round(f.hue * 360)} 65% 72%)` }),
    );
  });
  return svg;
}

function describe(g: Garden): string {
  if (g.forestComplete) return `A full forest of ${g.plants.length} trees`;
  return `A garden with ${g.grownCount} grown tree${g.grownCount === 1 ? '' : 's'} and ${g.growing.length} growing`;
}
