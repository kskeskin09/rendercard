import {
  DataTexture,
  RepeatWrapping,
  LinearFilter,
  SRGBColorSpace
} from 'three';

export const tiles = { checker: 'Dama', ceramic: 'Seramik', brick: 'Tuğla' };

export function applyTile(material, settings) {
  material.map?.dispose();
  material.map = null;
  if (settings.finish === 'tile') {
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cellX = (x + (y < 32 ? 16 : 0)) % 32;
        const value =
          settings.tile === 'checker'
            ? x < 32 === y < 32
              ? 248
              : 126
            : settings.tile === 'brick'
              ? cellX < 2 || y % 32 < 2
                ? 99
                : 220 + ((x * 7 + y * 13) % 30)
              : x < 3 || y < 3
                ? 118
                : 238 + ((x + 2 * y) % 13);
        pixels.set([value, value, value, 255], (y * size + x) * 4);
      }
    }
    const map = new DataTexture(pixels, size, size);
    map.colorSpace = SRGBColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping;
    map.magFilter = map.minFilter = LinearFilter;
    map.repeat.setScalar(1 / settings.tileScale);
    map.needsUpdate = true;
    material.map = map;
  }
  material.needsUpdate = true;
}
