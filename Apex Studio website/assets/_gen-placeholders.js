/* Generates premium chrome sunglasses placeholder SVGs (studio-lit, with reflection).
   Run: node assets/_gen-placeholders.js
   Replace the output files in assets/products + assets/lookbook with real photos later. */
const fs = require('fs');
const path = require('path');

const OUT_PRODUCTS = path.join(__dirname, 'products');
const OUT_LOOK = path.join(__dirname, 'lookbook');
const OUT_ROOT = __dirname;

function rrect(cx, cy, w, h, r) {
  const k = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : r;
  const x = cx - w / 2, y = cy - h / 2;
  return [
    `M${x + k.tl},${y}`, `H${x + w - k.tr}`,
    `Q${x + w},${y} ${x + w},${y + k.tr}`, `V${y + h - k.br}`,
    `Q${x + w},${y + h} ${x + w - k.br},${y + h}`, `H${x + k.bl}`,
    `Q${x},${y + h} ${x},${y + h - k.bl}`, `V${y + k.tl}`,
    `Q${x},${y} ${x + k.tl},${y}`, 'Z',
  ].join(' ');
}
function aviatorLens(cx, cy, w, h) {
  const x = cx - w / 2, y = cy - h / 2;
  return [
    `M${x + 26},${y}`, `H${x + w - 26}`, `Q${x + w},${y} ${x + w},${y + 30}`,
    `Q${x + w - 6},${y + h - 40} ${cx + 18},${y + h}`, `Q${cx},${y + h + 8} ${cx - 22},${y + h}`,
    `Q${x + 6},${y + h - 40} ${x},${y + 30}`, `Q${x},${y} ${x + 26},${y} Z`,
  ].join(' ');
}
function shieldLens(cx, cy, w, h) {
  const x = cx - w / 2, y = cy - h / 2;
  return [
    `M${x + 40},${y}`, `H${x + w - 40}`, `Q${x + w},${y} ${x + w},${y + 40}`,
    `Q${x + w - 10},${y + h} ${cx},${y + h + 18}`, `Q${x + 10},${y + h} ${x},${y + 40}`,
    `Q${x},${y} ${x + 40},${y} Z`,
  ].join(' ');
}

const STYLES = {
  blade:   { type: 'shield' },
  rect:    { type: 'pair', lens: (cx, cy) => rrect(cx, cy, 300, 196, 34), w: 300, h: 196 },
  aviator: { type: 'pair', lens: (cx, cy) => aviatorLens(cx, cy, 290, 215), w: 290, h: 215 },
  round:   { type: 'pair', lens: (cx, cy) => rrect(cx, cy, 268, 268, 134), w: 268, h: 268 },
  cateye:  { type: 'pair', lens: (cx, cy) => rrect(cx, cy, 305, 192, { tl: 36, tr: 130, br: 30, bl: 60 }), w: 305, h: 192 },
  square:  { type: 'pair', lens: (cx, cy) => rrect(cx, cy, 312, 224, 22), w: 312, h: 224 },
};

function defs(id) {
  return `
  <defs>
    <radialGradient id="bg-${id}" cx="50%" cy="34%" r="80%">
      <stop offset="0%" stop-color="#2c2c30"/>
      <stop offset="42%" stop-color="#161618"/>
      <stop offset="100%" stop-color="#070708"/>
    </radialGradient>
    <radialGradient id="spot-${id}" cx="50%" cy="22%" r="42%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="chrome-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="20%" stop-color="#d6d9dd"/>
      <stop offset="40%" stop-color="#83868c"/>
      <stop offset="51%" stop-color="#42444a"/>
      <stop offset="62%" stop-color="#a3a6ac"/>
      <stop offset="80%" stop-color="#eef0f3"/>
      <stop offset="100%" stop-color="#75777c"/>
    </linearGradient>
    <linearGradient id="rim-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="lens-${id}" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0%" stop-color="#42474f"/>
      <stop offset="44%" stop-color="#16181c"/>
      <stop offset="100%" stop-color="#040405"/>
    </linearGradient>
    <linearGradient id="sheen-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="32%" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="fade-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0a0b" stop-opacity="0"/>
      <stop offset="78%" stop-color="#0a0a0b" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#0a0a0b" stop-opacity="1"/>
    </linearGradient>
    <filter id="soft-${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="11"/></filter>
  </defs>`;
}

function lensBlock(id, d, idx) {
  const clip = `clip-${id}-${idx}`;
  return `
    <clipPath id="${clip}"><path d="${d}"/></clipPath>
    <path d="${d}" fill="url(#lens-${id})"/>
    <g clip-path="url(#${clip})">
      <ellipse cx="0" cy="0" rx="300" ry="150" fill="#ffffff" opacity="0.13" transform="translate(330,330) rotate(-22)"/>
      <ellipse cx="0" cy="0" rx="120" ry="46" fill="#ffffff" opacity="0.16" transform="translate(420,560) rotate(-22)"/>
      <rect x="0" y="0" width="1000" height="1000" fill="url(#sheen-${id})"/>
    </g>
    <path d="${d}" fill="none" stroke="url(#chrome-${id})" stroke-width="14"/>
    <path d="${d}" fill="none" stroke="#000000" stroke-opacity="0.4" stroke-width="2.5"/>`;
}

function glassesBody(id, style) {
  const cy = 500;
  let body = '';
  if (style.type === 'shield') {
    const d = shieldLens(500, cy, 560, 240);
    body += `<path d="M250,${cy - 118} Q500,${cy - 150} 750,${cy - 118}" fill="none" stroke="url(#chrome-${id})" stroke-width="15" stroke-linecap="round"/>`;
    body += lensBlock(id, d, 0);
    body += `<line x1="500" y1="${cy - 110}" x2="500" y2="${cy + 100}" stroke="#000" stroke-opacity="0.28" stroke-width="3"/>`;
    body += `<path d="M222,${cy - 96} Q150,${cy - 120} 120,${cy - 150}" fill="none" stroke="url(#chrome-${id})" stroke-width="16" stroke-linecap="round"/>`;
    body += `<path d="M778,${cy - 96} Q850,${cy - 120} 880,${cy - 150}" fill="none" stroke="url(#chrome-${id})" stroke-width="16" stroke-linecap="round"/>`;
  } else {
    const lx = 332, rx = 668;
    const by = cy - style.h / 2 + 18;
    body += `<path d="M${lx + style.w / 2 - 14},${by} Q500,${by - 34} ${rx - style.w / 2 + 14},${by}" fill="none" stroke="url(#chrome-${id})" stroke-width="15" stroke-linecap="round"/>`;
    body += lensBlock(id, style.lens(lx, cy), 0);
    body += lensBlock(id, style.lens(rx, cy), 1);
    body += `<path d="M${lx - style.w / 2 + 8},${cy - style.h / 2 + 26} Q150,${cy - style.h / 2 - 4} 120,${cy - style.h / 2 - 40}" fill="none" stroke="url(#chrome-${id})" stroke-width="16" stroke-linecap="round"/>`;
    body += `<path d="M${rx + style.w / 2 - 8},${cy - style.h / 2 + 26} Q850,${cy - style.h / 2 - 4} 880,${cy - style.h / 2 - 40}" fill="none" stroke="url(#chrome-${id})" stroke-width="16" stroke-linecap="round"/>`;
  }
  return body;
}

// glasses centered at (500,500); we scale up and reposition per scene
function scene(id, style, { scale = 1.18, cy = 470 } = {}) {
  const g = glassesBody(id, style);
  const tf = `transform="translate(500,${cy}) scale(${scale}) translate(-500,-500)"`;
  const ground = cy + 200 * scale; // approx bottom of glasses
  return `
  <rect width="1000" height="1000" fill="url(#bg-${id})"/>
  <rect width="1000" height="1000" fill="url(#spot-${id})"/>
  <ellipse cx="500" cy="${ground + 28}" rx="${300 * scale}" ry="34" fill="#000" opacity="0.6" filter="url(#soft-${id})"/>
  <g ${tf}>${g}</g>
  <g transform="translate(0,${2 * (ground + 18)}) scale(1,-1)" opacity="0.16"><g ${tf}>${g}</g></g>
  <rect x="0" y="${ground + 18}" width="1000" height="${1000 - (ground + 18)}" fill="url(#fade-${id})"/>`;
}

function productSvg(id, style, label) {
  return `<svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label} sunglasses">
${defs(id)}${scene(id, style, { scale: 1.2, cy: 470 })}
</svg>`;
}

[['blade','blade'],['rect','rect'],['aviator','aviator'],['round','round'],['cateye','cateye'],['square','square']]
  .forEach(([file, style]) => fs.writeFileSync(path.join(OUT_PRODUCTS, `${file}.svg`), productSvg(file, STYLES[style], file)));

function lookSvg(id, style, h) {
  return `<svg viewBox="0 0 1000 ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="lookbook">
${defs(id)}
  <rect width="1000" height="${h}" fill="url(#bg-${id})"/>
  <rect width="1000" height="${h}" fill="url(#spot-${id})"/>
  <g transform="translate(0,${(h - 1000) / 2})">
    <ellipse cx="500" cy="690" rx="320" ry="32" fill="#000" opacity="0.55" filter="url(#soft-${id})"/>
    <g transform="translate(500,470) scale(1.18) translate(-500,-500)">${glassesBody(id, style)}</g>
  </g>
</svg>`;
}
fs.writeFileSync(path.join(OUT_LOOK, 'look-1.svg'), lookSvg('l1', STYLES.blade, 1300));
fs.writeFileSync(path.join(OUT_LOOK, 'look-2.svg'), lookSvg('l2', STYLES.aviator, 1000));
fs.writeFileSync(path.join(OUT_LOOK, 'look-3.svg'), lookSvg('l3', STYLES.cateye, 1300));

fs.writeFileSync(path.join(OUT_ROOT, 'hero-glasses.svg'),
  `<svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="hero sunglasses">
${defs('hero')}${scene('hero', STYLES.blade, { scale: 1.34, cy: 460 })}
</svg>`);

// Faint silhouettes for collection cards (transparent background)
function silhouette(id, style) {
  return `<svg viewBox="0 0 1000 600" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
${defs(id)}
  <g transform="translate(500,300) scale(1.1) translate(-500,-500)" opacity="0.9">${glassesBody(id, style)}</g>
</svg>`;
}
fs.writeFileSync(path.join(OUT_PRODUCTS, 'sil-street.svg'), silhouette('ss', STYLES.rect));
fs.writeFileSync(path.join(OUT_PRODUCTS, 'sil-sport.svg'), silhouette('sp', STYLES.blade));
fs.writeFileSync(path.join(OUT_PRODUCTS, 'sil-luxe.svg'), silhouette('sl', STYLES.cateye));

console.log('Generated premium placeholders.');
