import { Box3, BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import { Brush, Evaluator, HOLLOW_SUBTRACTION, SUBTRACTION, computeMeshVolume } from 'three-bvh-csg';
import { elasticFits } from './elastic.js';
import { hierarchyRoot } from './hierarchy.js';

const evaluator = new Evaluator();
const results = new WeakMap();
const elasticResults = new WeakMap();
const hierarchyResults = new WeakMap();
const empty = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([], 3)).setIndex([]);
empty.setDrawRange(0, 0);
evaluator.useCDTClipping = true;
evaluator.removeUnusedMaterials = false;

function brushFor(geometry, material, matrix) {
  const brush = new Brush(geometry, material);
  if (matrix) brush.matrixWorld.copy(matrix);
  return brush;
}

export function releaseCut(object) {
  releaseCachedCut(results, object);
  releaseCachedCut(elasticResults, object);
  releaseCachedCut(hierarchyResults, object);
}

function releaseCachedCut(cache, object) {
  cache.get(object)?.geometry?.dispose();
  cache.delete(object);
}

function cutMesh(object, candidates, cache) {
  const inverse = object.matrixWorld.clone().invert();
  const sources = candidates.map(({ mesh }) => {
    const matrix = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
    const target = object.geometry.boundingBox;
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const stretch = new Vector3(1, 1, 1);
    for (const axis of ['x', 'y', 'z']) {
      const epsilon = Math.max(1e-7, (target.max[axis] - target.min[axis]) * 0.000002);
      if (size[axis] > epsilon && (
        Math.abs(bounds.max[axis] - target.max[axis]) <= epsilon ||
        Math.abs(bounds.min[axis] - target.min[axis]) <= epsilon
      )) stretch[axis] += 2 * epsilon / size[axis];
    }
    const transform = new Matrix4().makeScale(...stretch).setPosition(center.clone().multiply(stretch).negate().add(center));
    return { mesh, matrix: matrix.premultiply(transform) };
  });
  const geometryVersion = mesh => [mesh.geometry.uuid, mesh.geometry.attributes.position.version];
  const signature = [...geometryVersion(object), ...sources.flatMap(({ mesh, matrix }) => [
    ...geometryVersion(mesh), ...matrix.elements
  ])].join(':');
  const previous = cache.get(object);
  if (previous?.signature === signature) return previous;
  releaseCachedCut(cache, object);

  const materials = object.material;
  let geometry = object.geometry;
  const originalVolume = computeMeshVolume(geometry);
  let volume = originalVolume;
  const used = [];
  const measure = buffer => buffer.drawRange.count ? computeMeshVolume(buffer) : 0;
  const removedVolume = (before, after) => after < before - Math.max(before * 1e-6, 1e-9);
  const originalBrush = brushFor(object.geometry, materials);
  for (const { mesh, matrix } of sources) {
    const cutter = brushFor(mesh.geometry, Array.isArray(materials) ? materials[0] : materials, matrix);
    const output = volume ? evaluator.evaluate(brushFor(geometry, materials), cutter, SUBTRACTION) : undefined;
    const remaining = output ? measure(output.geometry) : 0;
    if (output && removedVolume(volume, remaining)) {
      if (Array.isArray(materials)) {
        for (const group of output.geometry.groups) {
          group.materialIndex = Math.max(0, materials.indexOf(output.material[group.materialIndex]));
        }
      }
      if (geometry !== object.geometry) geometry.dispose();
      geometry = output.geometry;
      volume = remaining;
      used.push(mesh);
    } else {
      output?.geometry.dispose();
      if (geometry !== object.geometry) {
        const independent = evaluator.evaluate(originalBrush, cutter, SUBTRACTION);
        if (removedVolume(originalVolume, measure(independent.geometry))) used.push(mesh);
        independent.geometry.dispose();
      }
    }
  }
  const result = { signature, geometry: used.length ? geometry : undefined, used };
  cache.set(object, result);
  return result;
}

function clipHierarchy(boxes, cuts, cutters) {
  const earlier = new Map();
  for (const { mesh, bounds } of boxes) {
    const root = hierarchyRoot(mesh);
    const previous = hierarchyResults.get(mesh);
    if (!root || mesh.userData.negative || cutters.has(mesh)) {
      if (previous) releaseCachedCut(hierarchyResults, mesh);
      continue;
    }
    if (!earlier.has(root)) earlier.set(root, []);
    const family = earlier.get(root);
    const overlap = family.filter(item => item.bounds.clone().expandByScalar(1e-6).intersectsBox(bounds));
    family.push({ mesh, bounds });
    if (!overlap.length) {
      if (previous) releaseCachedCut(hierarchyResults, mesh);
      continue;
    }
    const source = cuts.get(mesh) ?? mesh.geometry;
    const inverse = new Matrix4().copy(mesh.matrixWorld).invert();
    const blockers = overlap.map(item => {
      const geometry = item.mesh.geometry;
      const center = geometry.boundingBox.getCenter(new Vector3());
      const expansion = new Matrix4().makeScale(1.00001, 1.00001, 1.00001).setPosition(center.multiplyScalar(-.00001));
      const matrix = new Matrix4().multiplyMatrices(inverse, item.mesh.matrixWorld).multiply(expansion);
      return { geometry, matrix };
    });
    const signature = [source.uuid, source.attributes.position.version,
      ...blockers.flatMap(({ geometry, matrix }) => [geometry.uuid, geometry.attributes.position.version, ...matrix.elements])].join(':');
    if (previous?.signature === signature) {
      cuts.set(mesh, previous.geometry);
      continue;
    }
    releaseCachedCut(hierarchyResults, mesh);
    let geometry = source;
    for (const blocker of blockers) {
      if (!geometry.drawRange.count) break;
      const materials = mesh.material;
      const obstacle = brushFor(blocker.geometry, Array.isArray(materials) ? materials[0] : materials, blocker.matrix);
      const output = evaluator.evaluate(brushFor(geometry, materials), obstacle, HOLLOW_SUBTRACTION);
      if (Array.isArray(materials)) {
        for (const group of output.geometry.groups)
          group.materialIndex = Math.max(0, materials.indexOf(output.material[group.materialIndex]));
      }
      if (geometry !== source) geometry.dispose();
      geometry = output.geometry;
    }
    if (geometry !== source) {
      hierarchyResults.set(mesh, { signature, geometry });
      cuts.set(mesh, geometry);
    }
  }
}

export function sceneCuts(root, selection, includeElastic = !selection) {
  const cuts = new Map();
  const cutters = new Set();
  const meshObjects = selection ?? [];
  if (!selection) {
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      for (let node = mesh; node; node = node.parent)
        if (node.clipActive === false) return;
      meshObjects.push(mesh);
    });
  }
  const hierarchy = includeElastic && !selection && meshObjects.some(mesh => hierarchyRoot(mesh));
  if (!hierarchy && !meshObjects.some(mesh => mesh.userData.negative || (includeElastic && mesh.userData.elastic))) {
    for (const mesh of meshObjects) {
      releaseCachedCut(results, mesh);
      if (includeElastic) {
        releaseCachedCut(elasticResults, mesh);
        releaseCachedCut(hierarchyResults, mesh);
      }
    }
    return { cuts, cutters };
  }
  root.updateWorldMatrix(true, true);
  const boxes = meshObjects.map(mesh => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return { mesh, bounds: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld) };
  });
  const negatives = boxes.filter(({ mesh }) => mesh.userData.negative);
  const positives = boxes.filter(({ mesh }) => !mesh.userData.negative);
  const intersection = new Box3();
  for (const { mesh, bounds } of boxes) {
    if (includeElastic && !hierarchy) releaseCachedCut(hierarchyResults, mesh);
    if (includeElastic && !mesh.userData.elastic) releaseCachedCut(elasticResults, mesh);
    const intruders = includeElastic && mesh.userData.elastic
      ? positives.filter(item => item.mesh !== mesh && item.bounds.intersectsBox(bounds) &&
          elasticFits(mesh, item.mesh) && (!item.mesh.userData.elastic || !elasticFits(item.mesh, mesh)))
      : [];
    const cache = includeElastic && mesh.userData.elastic ? elasticResults : results;
    const candidates = mesh.userData.negative ? [] : [...negatives, ...intruders].filter(other => {
      intersection.copy(bounds).intersect(other.bounds);
      return ['x', 'y', 'z'].every(axis => intersection.max[axis] - intersection.min[axis] > 1e-7);
    });
    if (!candidates.length) {
      releaseCachedCut(cache, mesh);
      continue;
    }
    const result = cutMesh(mesh, candidates, cache);
    if (result.geometry) cuts.set(mesh, result.geometry);
    for (const cutter of result.used) if (cutter.userData.negative) cutters.add(cutter);
  }
  if (hierarchy) clipHierarchy(boxes, cuts, cutters);
  return { cuts, cutters };
}

export function withSceneCuts(root, draw) {
  const { cuts, cutters } = sceneCuts(root);
  const replacements = new Map(cuts);
  for (const mesh of cutters) if (mesh.children.length) replacements.set(mesh, empty);
  const originals = [...replacements].map(([mesh, geometry]) => {
    const original = mesh.geometry;
    if (geometry === hierarchyResults.get(mesh)?.geometry && original.type === 'BoxGeometry')
      mesh.rigBoxGeometry = original;
    mesh.geometry = geometry;
    return [mesh, original];
  });
  const suppressed = [...cutters, ...[...cuts].filter(([, geometry]) => !geometry.drawRange.count).map(([mesh]) => mesh)]
    .filter(mesh => !mesh.children.length);
  const visibility = suppressed.map(mesh => [mesh, mesh.visible]);
  suppressed.forEach(mesh => { mesh.visible = false; });
  try {
    return draw();
  } finally {
    for (const [mesh, geometry] of originals) {
      mesh.geometry = geometry;
      delete mesh.rigBoxGeometry;
    }
    for (const [mesh, visible] of visibility) mesh.visible = visible;
  }
}
