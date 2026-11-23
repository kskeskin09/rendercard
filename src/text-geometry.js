import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import fontData from 'three/examples/fonts/droid/droid_sans_bold.typeface.json' with { type: 'json' };

const font = new FontLoader().parse(fontData);
export const defaultLetterDepth = 0.2;
export const maximumLetterRadius = 0.04;
export const maximumTextLength = 120;

export function isLetter(glyph) {
  return typeof glyph === 'string' && Object.hasOwn(fontData.glyphs, glyph) &&
    Boolean(fontData.glyphs[glyph].o?.trim());
}

export function letterLayout(text) {
  const characters = Array.from(text.replace(/\r\n?/g, '\n').normalize('NFC').trim());
  if (!characters.length || characters.length > maximumTextLength)
    throw new Error('1–' + maximumTextLength + ' karakter arasında metin yaz.');
  const entries = [];
  let x = 0;
  let y = 0;
  for (const glyph of characters) {
    if (glyph === '\n') {
      x = 0;
      y -= 1.35;
      continue;
    }
    if (/^\s$/u.test(glyph)) {
      x += (glyph === '\t' ? 4 : 1) * fontData.glyphs[' '].ha / fontData.resolution;
      continue;
    }
    if (!isLetter(glyph))
      throw new Error('Bu yazı tipi şu karakteri desteklemiyor: ' + glyph);
    entries.push({ glyph, x, y });
    x += fontData.glyphs[glyph].ha / fontData.resolution;
  }
  return entries;
}

export function letterGeometry(glyph, depth, radius) {
  const bevel = Math.min(radius, (depth - 0.001) / 2);
  const shape = new TextGeometry(glyph, {
    font,
    size: 1,
    depth: depth - bevel * 2,
    curveSegments: 6,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3
  });
  const geometry = mergeVertices(shape);
  shape.dispose();
  return geometry.translate(0, 0, -(depth - bevel * 2) / 2);
}
