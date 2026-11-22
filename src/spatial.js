import { Box3, Euler, Matrix4, Vector3 } from 'three';

export function localBounds(object) {
  object.updateWorldMatrix(true, true);
  const local = object.matrixWorld.clone().invert();
  const matrix = new Matrix4();
  const result = new Box3();
  const point = new Vector3();
  object.traverse((child) => {
    if (!child.isMesh) return;
    matrix.multiplyMatrices(local, child.matrixWorld);
    const positions = child.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      result.expandByPoint(
        point.fromBufferAttribute(positions, i).applyMatrix4(matrix)
      );
    }
  });
  return result;
}

const axes = ['x', 'y', 'z'];

export function changePivot(object, axis, value) {
  const index = axes.indexOf(axis);
  object.userData.pivot[index] = value;
  fitPivot(object);
}

export function fitPivot(object) {
  const bounds = localBounds(object);
  if (bounds.isEmpty()) return;
  const delta = bounds.getCenter(new Vector3());
  const half = bounds.getSize(new Vector3()).multiplyScalar(0.5);
  delta.add(half.multiply(new Vector3().fromArray(object.userData.pivot)));
  if (delta.lengthSq() < 1e-12) return;
  object.position.add(
    delta.clone().multiply(object.scale).applyQuaternion(object.quaternion)
  );
  for (const key of object.userData.keys) {
    const displacement = delta
      .clone()
      .multiply(new Vector3().fromArray(key.scale))
      .applyEuler(new Euler(...key.rotation));
    key.position = new Vector3()
      .fromArray(key.position)
      .add(displacement)
      .toArray();
  }
  if (object.isMesh) {
    object.geometry.translate(-delta.x, -delta.y, -delta.z);
    object.userData.offset = new Vector3()
      .fromArray(object.userData.offset)
      .sub(delta)
      .toArray();
  } else {
    for (const child of object.children) {
      child.position.sub(delta);
      for (const key of child.userData.keys) {
        key.position = new Vector3()
          .fromArray(key.position)
          .sub(delta)
          .toArray();
      }
    }
  }
}

export function fitParentPivots(object) {
  for (
    let parent = object.parent;
    parent?.userData.pivot;
    parent = parent.parent
  ) {
    fitPivot(parent);
  }
}

export function anchorScale(
  object,
  originalPosition,
  originalScale,
  bounds,
  symmetric,
  direction
) {
  object.position.copy(originalPosition);
  if (bounds.isEmpty()) return;
  const anchor = symmetric
    ? bounds.getCenter(new Vector3())
    : bounds.min.clone();
  if (!symmetric && direction) {
    for (const axis of axes)
      if (direction[axis] < 0) anchor[axis] = bounds.max[axis];
  }
  const displacement = originalScale.clone().sub(object.scale).multiply(anchor);
  object.position.add(displacement.applyQuaternion(object.quaternion));
}

export function translateWorld(object, delta) {
  if (!object.parent) {
    object.position.add(delta);
    return;
  }
  const currentWorld = object.getWorldPosition(new Vector3());
  object.position.copy(object.parent.worldToLocal(currentWorld.add(delta)));
  object.updateWorldMatrix(true, true);
}

export function groundObject(object) {
  object.updateWorldMatrix(true, true);
  const point = new Vector3();
  let low = Infinity;
  object.traverse((child) => {
    if (!child.isMesh) return;
    const vertices = child.geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      low = Math.min(
        low,
        point.fromBufferAttribute(vertices, i).applyMatrix4(child.matrixWorld).y
      );
    }
  });
  if (Number.isFinite(low)) translateWorld(object, new Vector3(0, -low, 0));
}
