import {
  Color,
  DataTexture,
  RepeatWrapping,
  LinearFilter,
  SRGBColorSpace,
  Vector3
} from 'three';
import { skyTexture, skyTiles } from './sky-texture.js';

export const tiles = { checker: 'Dama', ceramic: 'Seramik', brick: 'Tuğla', grass: 'Çim', asphalt: 'Asfalt', ...skyTiles };
const tileColors = { checker: '#eeeeee', ceramic: '#e0cdb1', brick: '#b3553e', grass: '#527f35', asphalt: '#515256', clearSky: '#ffffff', stars: '#ffffff' };

export function updateTileBounds(material, buffer) {
  const mapping = material.userData.tileMapping;
  if (!mapping?.fit.value) return;
  if (!buffer.boundingBox) buffer.computeBoundingBox();
  const { min, max } = buffer.boundingBox;
  mapping.origin.value.copy(min);
  mapping.size.value.subVectors(max, min).max(new Vector3(1e-6, 1e-6, 1e-6));
}

export function setTileOptions(material, settings) {
  const mapping = material.userData.tileMapping;
  if (!mapping) return;
  mapping.fit.value = settings.tileFit === true;
  mapping.useDefault.value = settings.tileColorMode !== 'custom';
  mapping.tint.value.set(tileColors[settings.tile] ?? tileColors.checker);
}

export function setTileSize(material, value) {
  material.map?.repeat.setScalar(1 / value);
  if (material.userData.tileSize) material.userData.tileSize.value = value;
}

function applyWorldMapping(material) {
  material.customProgramCacheKey = () => 'rendercard-tile-mapping';
  material.onBeforeCompile = shader => {
    const { fit, origin, size, useDefault, tint } = material.userData.tileMapping;
    shader.uniforms.rendercardTileSize = material.userData.tileSize;
    Object.assign(shader.uniforms, { tileFit: fit, tileOrigin: origin, tileBoundsSize: size, tileDefault: useDefault, tileTint: tint });
    shader.vertexShader = 'uniform bool tileFit;\nuniform vec3 tileOrigin;\nuniform vec3 tileBoundsSize;\nvarying vec3 vTileMetres;\nvarying vec3 vTileNormal;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' +
        'vTileMetres = tileFit ? (position - tileOrigin) / tileBoundsSize : position * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));\n' +
        'vTileNormal = normal;');
    shader.fragmentShader = 'uniform float rendercardTileSize;\nuniform bool tileFit;\nuniform bool tileDefault;\nuniform vec3 tileTint;\nvarying vec3 vTileMetres;\nvarying vec3 vTileNormal;\n' +
      shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec3 metricUV = tileFit ? clamp(vTileMetres, vec3(0.0001), vec3(0.9999)) : vTileMetres / rendercardTileSize;
          vec3 weights = pow(abs(normalize(vTileNormal)), vec3(6.0));
          weights /= max(weights.x + weights.y + weights.z, 0.00001);
          vec4 tileColor = texture2D(map, metricUV.zy) * weights.x
            + texture2D(map, metricUV.xz) * weights.y
            + texture2D(map, metricUV.xy) * weights.z;
          if (tileDefault) diffuseColor.rgb = tileTint;
          diffuseColor *= tileColor;
        #endif
      `);
  };
}

function surfaceTexture(tile) {
    if (Object.hasOwn(skyTiles, tile)) return skyTexture(tile, 128, 128);
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const noise = (((x * 1640531513) ^ (y * 1013904223) ^ (x * y * 7919)) >>> 8) & 63;
        const cellX = (x + (y < 32 ? 16 : 0)) % 32;
        const value =
          tile === 'grass' ? 177 + noise * 1.18
            : tile === 'asphalt' ? 201 + noise * .85
            : tile === 'checker'
            ? x < 32 === y < 32
              ? 248
              : 126
            : tile === 'brick'
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
    return map;
}

export function applyTile(material, settings) {
  material.map?.dispose();
  material.map = settings.finish === 'tile' ? surfaceTexture(settings.tile) : null;
  if (material.map) {
    material.userData.tileSize ??= { value: settings.tileScale };
    material.userData.tileMapping ??= {
      fit: { value: false }, origin: { value: new Vector3() }, size: { value: new Vector3(1, 1, 1) },
      useDefault: { value: true }, tint: { value: new Color() }
    };
    setTileSize(material, settings.tileScale);
    setTileOptions(material, settings);
    applyWorldMapping(material);
  } else if (material.userData.tileMapping) {
    delete material.userData.tileMapping;
    delete material.userData.tileSize;
    delete material.onBeforeCompile;
    delete material.customProgramCacheKey;
  }
  material.needsUpdate = true;
}
