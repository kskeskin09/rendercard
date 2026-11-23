import { Quaternion, Vector3 } from 'three';

const axes = ['x', 'y', 'z'];

export function selectionTransforms(items, center, transform, mode, symmetric, step = 0) {
  const distance = transform.position.clone().sub(center);
  if (step && mode === 'translate') {
    for (const axis of axes) distance[axis] = Math.round(distance[axis] / step) * step;
  }
  const factors = transform.scale.clone().max(new Vector3(.001, .001, .001));
  const translations = items.map((item, index) => {
    if (!symmetric || mode !== 'translate') return distance.clone();
    const result = distance.clone();
    for (const axis of axes) {
      const side = item.position[axis] - center[axis];
      result[axis] *= Math.abs(side) > 1e-8 ? Math.sign(side) : index < items.length / 2 ? 1 : -1;
    }
    return result;
  });
  const correction = new Vector3();
  if (symmetric && mode === 'translate') {
    for (const translation of translations) correction.add(translation);
    correction.divideScalar(items.length);
  }
  return items.map((item, index) => {
    const position = item.position.clone();
    const rotation = item.rotation.clone();
    const scale = item.scale.clone();
    if (mode === 'translate') position.add(translations[index]).sub(correction);
    if (mode === 'rotate') {
      rotation.premultiply(transform.quaternion);
      if (symmetric) position.sub(center).applyQuaternion(transform.quaternion).add(center);
    }
    if (mode === 'scale') {
      if (symmetric) position.sub(center).multiply(factors).add(center);
      if (item.resizable) {
        for (const [index, axis] of axes.entries()) {
          const direction = new Vector3().setComponent(index, 1).applyQuaternion(item.rotation);
          scale[axis] = Math.max(.001, scale[axis] * direction.multiply(factors).length());
        }
      }
    }
    return { position, rotation, scale };
  });
}

export function applySelectionTransform(object, pose, mode) {
  object.position.copy(object.parent.worldToLocal(pose.position));
  if (mode === 'rotate') {
    const parentRotation = object.parent.getWorldQuaternion(new Quaternion());
    object.quaternion.copy(parentRotation.invert().multiply(pose.rotation));
  }
  if (mode === 'scale') object.scale.copy(pose.scale);
  object.updateWorldMatrix(false, true);
}
