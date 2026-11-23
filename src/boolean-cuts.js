import { Box3, Matrix4, Vector3 } from 'three';
import { Brush, Evaluator, SUBTRACTION, computeMeshVolume } from 'three-bvh-csg';

const evaluator = new Evaluator();
const results = new WeakMap();
evaluator.useCDTClipping = true;
evaluator.removeUnusedMaterials = false;

function brushFor(geometry, material, matrix) {
  const brush = new Brush(geometry, material);
  if (matrix) brush.matrixWorld.copy(matrix);
  return brush;
}

export function releaseCut(object) {
  results.get(object)?.geometry?.dispose();
  results.delete(object);
}

function cutMesh(object, candidates) {
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
  const previous = results.get(object);
  if (previous?.signature === signature) return previous;
  releaseCut(object);

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
  results.set(object, result);
  return result;
}

export function sceneCuts(root, selection) {
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
  if (!meshObjects.some(mesh => mesh.userData.negative)) {
    meshObjects.forEach(releaseCut);
    return { cuts, cutters };
  }
  root.updateWorldMatrix(true, true);
  const boxes = meshObjects.map(mesh => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return { mesh, bounds: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld) };
  });
  const negatives = boxes.filter(({ mesh }) => mesh.userData.negative);
  const intersection = new Box3();
  for (const { mesh, bounds } of boxes) {
    const candidates = mesh.userData.negative ? [] : negatives.filter(negative => {
      intersection.copy(bounds).intersect(negative.bounds);
      return ['x', 'y', 'z'].every(axis => intersection.max[axis] - intersection.min[axis] > 1e-7);
    });
    if (!candidates.length) {
      releaseCut(mesh);
      continue;
    }
    const result = cutMesh(mesh, candidates);
    if (result.geometry) cuts.set(mesh, result.geometry);
    for (const cutter of result.used) cutters.add(cutter);
  }
  return { cuts, cutters };
}

export function withSceneCuts(root, draw) {
  const { cuts, cutters } = sceneCuts(root);
  const originals = [...cuts].map(([mesh, geometry]) => {
    const original = mesh.geometry;
    mesh.geometry = geometry;
    return [mesh, original];
  });
  const suppressed = [...cutters, ...[...cuts].filter(([, geometry]) => !geometry.drawRange.count).map(([mesh]) => mesh)];
  const visibility = suppressed.map(mesh => [mesh, mesh.visible]);
  suppressed.forEach(mesh => { mesh.visible = false; });
  try {
    return draw();
  } finally {
    for (const [mesh, geometry] of originals) mesh.geometry = geometry;
    for (const [mesh, visible] of visibility) mesh.visible = visible;
  }
}
