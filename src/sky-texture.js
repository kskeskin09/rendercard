import { DataTexture, EquirectangularReflectionMapping, LinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';

export const skyTiles = { clearSky: 'Açık gökyüzü', stars: 'Yıldızlar' };
const loop = Math.PI * 2;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(value, max));
}

export function skyTexture(tile, width, height, background = false) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const latitude = background ? (y / (height - 1) - .5) * Math.PI : (y / (height - 1) - .15) * Math.PI / 2;
    const elevation = Math.sin(latitude);
    const blue = clamp(elevation * 1.5) ** .55;
    for (let x = 0; x < width; x++) {
      const angle = x * loop / width;
      const index = (y * width + x) * 4;
      if (tile === 'stars') {
        const glow = 4 * (1 - Math.abs(elevation)) + 3 * Math.sin(elevation * 5 + Math.cos(angle));
        pixels.set([7 + glow, 10 + glow, 25 + 2 * glow, 255], index);
        continue;
      }
      const cloud = clamp((Math.sin(angle * 4 + latitude * 31) + Math.cos(angle * 7 - latitude * 24) +
        .35 * Math.sin(angle * 21 + latitude * 83) - .48) * .36) *
        Math.exp(-((elevation - .26) ** 2) / .035) * .63;
      const sun = clamp(Math.cos(angle - 2.8) * Math.cos(latitude) * .94 + elevation * .342) ** 870;
      const mix = clamp(cloud + sun);
      const shade = [172 - 131 * blue, 214 - 91 * blue, 244 - 17 * blue];
      pixels.set(shade.map((value, channel) => value * (1 - mix) + [255, 248, 227][channel] * mix), index);
      pixels[index + 3] = 255;
    }
  }
  if (tile === 'stars') {
    let state = 67591;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const stars = Math.max(26, Math.round(width * height / 525));
    for (let i = 0; i < stars; i++) {
      const x = Math.floor(random() * width);
      const y = Math.floor(random() * height);
      const intensity = 65 + random() ** .7 * 190;
      const radius = width >= 512 && intensity > 219 ? 1 : 0;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const level = intensity / (1 + 5 * (dx * dx + dy * dy));
          const index = (((y + dy + height) % height) * width + (x + dx + width) % width) * 4;
          for (const [channel, color] of [.84, .9, 1].entries())
            pixels[index + channel] = Math.max(pixels[index + channel], level * color);
        }
      }
    }
  }
  const texture = new DataTexture(pixels, width, height);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  if (background) texture.mapping = EquirectangularReflectionMapping;
  else texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
