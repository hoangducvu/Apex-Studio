#!/usr/bin/env node
/**
 * LUMLA GLASSES — On-model image generator
 * --------------------------------------
 * Takes your real studio product photos in ./Products and uses Google's
 * Gemini 2.5 Flash Image model ("Nano Banana") in IMAGE-TO-IMAGE mode to
 * place each pair of glasses on a real-looking model. Because the actual
 * product photo is fed in as a reference, the generated glasses stay true
 * to the real product instead of being invented — that's the trick to
 * avoiding "AI slop".
 *
 * SETUP
 *   1. Get a key: https://aistudio.google.com/apikey  (free tier works)
 *   2. Add to .env:  GEMINI_API_KEY=your_key_here
 *   3. npm i        (dotenv is already a dependency)
 *   4. node generate-model-shots.js
 *
 * OPTIONS (env or CLI)
 *   STYLE=editorial | street          (default: editorial)
 *   node generate-model-shots.js 1 5 7   -> only generate items #1, #5, #7
 *
 * Output: "Apex Studio website/assets/lookbook/model-<slug>.png"
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-image';
const STYLE = (process.env.STYLE || 'editorial').toLowerCase();

const SRC_DIR = path.join(__dirname, 'Products');
const OUT_DIR = path.join(__dirname, 'Apex Studio website', 'assets', 'lookbook');

// ---- Shared style direction -------------------------------------------------
const SCENES = {
  editorial: `Clean high-end editorial e-commerce photo. Neutral seamless studio
backdrop (soft warm grey or off-white), soft diffused beauty lighting, shallow
depth of field. Tight head-and-shoulders crop. The look should match a premium
DTC eyewear brand campaign.`,
  street: `Candid urban streetwear lifestyle photo. Blurred city street background
(concrete, glass, golden-hour light), natural daylight, slight film grain.
Head-and-shoulders to chest crop, relaxed confident pose.`,
};

const STYLE_BLOCK = SCENES[STYLE] || SCENES.editorial;

// ---- Reusable model variety (rotated so the catalog isn't one face) ---------
const MODELS = [
  'a young woman in her early 20s with warm light-brown skin and dark hair pulled back',
  'a young man in his mid-20s with a short fade, medium-deep skin tone and a defined jawline',
  'a woman in her late 20s with fair skin, freckles and tousled auburn hair',
  'a man in his 20s with olive skin, dark curly hair and light stubble',
  'an androgynous model in their 20s with deep skin, sharp cheekbones and a buzz cut',
];

// ---- Per-product catalog ----------------------------------------------------
// `look` describes the frame so the prompt reinforces the reference image.
const PRODUCTS = [
  { file: 'file_000000000620720a91b360cc8e30a447.png', slug: 'iridescent-sport',
    look: 'matte black wraparound sport sunglasses with pink-and-green iridescent mirror lenses' },
  { file: 'file_000000006ff4720a8b1306b75d414049.png', slug: 'gunmetal-moto',
    look: 'gunmetal/silver padded wraparound moto sport sunglasses with dark smoke lenses' },
  { file: 'file_000000007cc871f4bc968c568f1998d0.png', slug: 'slate-retro-rect',
    look: 'translucent slate-blue rectangular retro sunglasses with tortoise accents and grey gradient lenses' },
  { file: 'file_00000000b1e472439c84064bf1a6cd0e.png', slug: 'black-cateye-wrap',
    look: 'glossy black cat-eye sport wrap sunglasses with solid black lenses' },
  { file: 'file_00000000b210720a877422a4c5e66013.png', slug: 'blue-mirror-wrap',
    look: 'glossy black sport wrap sunglasses with bright blue mirror lenses' },
  { file: 'file_00000000b2e4720a9ba8ca370d6813f9.png', slug: 'black-oval-y2k',
    look: 'glossy black oval Y2K wraparound sunglasses with dark smoke lenses' },
  { file: 'file_00000000ccbc71f4afae2392a3c5f3f7.png', slug: 'orange-square',
    look: 'bold glossy black square frame sunglasses with orange-red mirror lenses' },
  { file: 'file_00000000cfc8720a861bee61331ad767.png', slug: 'black-square-optical',
    look: 'bold thick glossy black square optical glasses with clear lenses' },
  { file: 'file_00000000dd1c7246837f933fe4b8f969.png', slug: 'matte-slim-sport',
    look: 'matte black slim oval sport wrap sunglasses with dark smoke lenses' },
  { file: 'file_00000000e660720a83dd562da814e8f1.png', slug: 'blue-gradient-square',
    look: 'bold glossy black square frame sunglasses with blue gradient mirror lenses' },
  { file: 'file_00000000e97c720a97959d4298346218.png', slug: 'clear-square',
    look: 'transparent/clear bold square frame sunglasses with solid black lenses' },
  { file: 'ChatGPT Image Jun 21, 2026, 07_29_21 PM.png', slug: 'black-blade-visor',
    look: 'glossy black slim futuristic blade/visor wraparound sunglasses with black lenses' },
];

function buildPrompt(product, idx) {
  const model = MODELS[idx % MODELS.length];
  return `Use the attached product photo as the exact reference for the eyewear.
Generate a photorealistic image of ${model} wearing THESE EXACT ${product.look}
shown in the reference image. Keep the frame shape, colour, lens tint and
proportions identical to the reference — do not redesign the glasses. The glasses
must sit naturally on the face, correctly aligned on the nose and ears, with
realistic reflections and shadows.

${STYLE_BLOCK}

Photorealistic, sharp focus on the eyewear, natural skin texture, professional
color grading. No text, no watermark, no logo, no extra graphics. Vertical 4:5
portrait composition.`;
}

// ---- Gemini call ------------------------------------------------------------
async function generate(product, idx) {
  const srcPath = path.join(SRC_DIR, product.file);
  if (!fs.existsSync(srcPath)) {
    console.warn(`  ! source missing, skipping: ${product.file}`);
    return false;
  }
  const b64 = fs.readFileSync(srcPath).toString('base64');

  const body = {
    contents: [{
      parts: [
        { text: buildPrompt(product, idx) },
        { inline_data: { mime_type: 'image/png', data: b64 } },
      ],
    }],
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error(`  x API ${res.status}: ${txt.slice(0, 300)}`);
    return false;
  }

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData || p.inline_data);
  const data = imgPart?.inlineData?.data || imgPart?.inline_data?.data;

  if (!data) {
    const textPart = parts.find(p => p.text)?.text;
    console.error(`  x no image returned${textPart ? ` (model said: ${textPart.slice(0, 160)})` : ''}`);
    return false;
  }

  const outPath = path.join(OUT_DIR, `model-${product.slug}.png`);
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log(`  ✓ ${path.relative(__dirname, outPath)}`);
  return true;
}

async function main() {
  if (!API_KEY) {
    console.error('ERROR: GEMINI_API_KEY not set. Add it to your .env file.');
    console.error('Get a key at https://aistudio.google.com/apikey');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Optional CLI filter: node generate-model-shots.js 1 5 7  (1-based indexes)
  const wanted = process.argv.slice(2).map(Number).filter(n => !isNaN(n));
  const list = wanted.length
    ? wanted.map(n => PRODUCTS[n - 1]).filter(Boolean)
    : PRODUCTS;

  console.log(`LUMLA GLASSES model-shot generator — style: ${STYLE} — ${list.length} item(s)\n`);

  let ok = 0;
  for (let i = 0; i < list.length; i++) {
    const product = list[i];
    const idx = PRODUCTS.indexOf(product);
    console.log(`[${i + 1}/${list.length}] ${product.slug}`);
    try {
      if (await generate(product, idx)) ok++;
    } catch (e) {
      console.error(`  x ${e.message}`);
    }
    // Gentle pacing to stay under free-tier rate limits.
    if (i < list.length - 1) await new Promise(r => setTimeout(r, 2500));
  }

  console.log(`\nDone. ${ok}/${list.length} generated into ${path.relative(__dirname, OUT_DIR)}/`);
}

main();
