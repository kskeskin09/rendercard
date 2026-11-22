import {
  DataTexture,
  RepeatWrapping,
  LinearFilter,
  SRGBColorSpace
} from 'three';

export const tiles = { checker: 'Dama', ceramic: 'Seramik', brick: 'Tuğla', grass: 'Çim', asphalt: 'Asfalt' };

export function setTileSize(material, value) {
  material.map?.repeat.setScalar(1 / value);
  if (material.userData.tileSize) material.userData.tileSize.value = value;
}

function applyWorldMapping(material) {
  material.customProgramCacheKey = () => 'rendercard-tile-metres';
  material.onBeforeCompile = shader => {
    shader.uniforms.rendercardTileSize = material.userData.tileSize;
    shader.vertexShader = 'varying vec3 vTileMetres;\nvarying vec3 vTileNormal;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' +
        'vTileMetres = position * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));\n' +
        'vTileNormal = normal;');
    shader.fragmentShader = 'uniform float rendercardTileSize;\nvarying vec3 vTileMetres;\nvarying vec3 vTileNormal;\n' +
      shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec3 metricUV = vTileMetres / rendercardTileSize;
          vec3 weights = pow(abs(normalize(vTileNormal)), vec3(6.0));
          weights /= max(weights.x + weights.y + weights.z, 0.00001);
          vec4 tileColor = texture2D(map, metricUV.zy) * weights.x
            + texture2D(map, metricUV.xz) * weights.y
            + texture2D(map, metricUV.xy) * weights.z;
          diffuseColor *= tileColor;
        #endif
      `);
  };
}

export function applyTile(material, settings) {
  material.map?.dispose();
  material.map = null;
  if (settings.finish === 'tile') {
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const noise = (((x * 1640531513) ^ (y * 1013904223) ^ (x * y * 7919)) >>> 8) & 63;
        if (settings.tile === 'grass' || settings.tile === 'asphalt') {
          const color = settings.tile === 'grass'
            ? [35 + noise * .41, 83 + noise * .83, 24 + noise * .35, 255]
            : [46 + noise * .56, 48 + noise * .56, 49 + noise * .57, 255];
          pixels.set(color, (y * size + x) * 4);
          continue;
        }
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
    map.needsUpdate = true;
    material.map = map;
    material.userData.tileSize ??= { value: settings.tileScale };
    setTileSize(material, settings.tileScale);
    applyWorldMapping(material);
  }
  material.needsUpdate = true;
}
