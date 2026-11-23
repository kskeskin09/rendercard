import { MeshDepthMaterial, MeshDistanceMaterial } from 'three';

function attenuatedShadow(material, coverage) {
  material.onBeforeCompile = shader => {
    shader.uniforms.rendercardCoverage = coverage;
    shader.fragmentShader = 'uniform float rendercardCoverage;\n' + shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n' +
      'vec2 shadowPixel = floor(gl_FragCoord.xy);\n' +
      'float shadowNoise = fract(52.9829189 * fract(dot(shadowPixel, vec2(0.06711056, 0.00583715))));\n' +
      'if (shadowNoise > rendercardCoverage) discard;'
    );
  };
  return material;
}

export function updateOpacity(object, includeHidden = false) {
  if (!object.isMesh) return;
  const surfaces = Array.isArray(object.material) ? object.material : [object.material];
  let overall = (object.previewOpacity ?? object.userData.opacity) / 100;
  for (let parent = object.parent; parent; parent = parent.parent) {
    overall *= (parent.previewOpacity ?? parent.userData.opacity ?? 100) / 100;
  }
  let maximum = 0;
  for (const [index, material] of surfaces.entries()) {
    const part = object.userData.parts?.[index];
    const alpha = overall * ((part?.opacity ?? 100) / 100);
    material.visible = alpha > 0 && (includeHidden || !part?.hidden);
    if (material.visible) maximum = Math.max(maximum, alpha);
    const transparent = alpha < 1 || Boolean(material.map && part?.alphaBlend);
    if (material.transparent !== transparent) {
      material.transparent = transparent;
      material.depthWrite = !transparent;
      material.needsUpdate = true;
    }
    material.opacity = alpha;
  }
  if (maximum > 0 && maximum < 1) {
    if (!object.shadowCoverage) {
      object.shadowCoverage = { value: maximum };
      object.customDepthMaterial = attenuatedShadow(new MeshDepthMaterial(), object.shadowCoverage);
      object.customDistanceMaterial = attenuatedShadow(new MeshDistanceMaterial(), object.shadowCoverage);
    }
    object.shadowCoverage.value = maximum;
  } else {
    if (object.shadowCoverage) object.shadowCoverage.value = 1;
  }
}
