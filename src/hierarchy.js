import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { posesOf } from './clips.js';

export function hierarchyRoot(object) {
  let root;
  for (let node = object; node; node = node.parent) {
    if (node.isMesh && node.children.length) root = node;
  }
  return root;
}

export function relatedHierarchy(a, b) {
  const root = hierarchyRoot(a);
  return root != null && root === hierarchyRoot(b);
}

export function reparentPlans(objects, parent) {
  parent.updateWorldMatrix(true, false);
  const inverse = new Matrix4().copy(parent.matrixWorld).invert();
  let parentDepth = -1;
  for (let node = parent; node; node = node.parent) {
    if (objects.includes(node)) throw new Error('Bir nesne kendi altına bağlanamaz.');
    parentDepth++;
  }
  return objects.map(object => {
    function checkDepth(node, depth) {
      if (depth > 30) throw new Error('Bu bağlantı sahnenin hiyerarşi sınırını aşıyor.');
      node.children.forEach(child => checkDepth(child, depth + 1));
    }
    checkDepth(object, parentDepth);
    object.updateWorldMatrix(true, false);
    const change = new Matrix4().multiplyMatrices(inverse, object.parent.matrixWorld);
    const rebase = pose => {
      const matrix = new Matrix4().compose(new Vector3().fromArray(pose.position),
        new Quaternion().setFromEuler(new Euler(...pose.rotation)), new Vector3().fromArray(pose.scale)).premultiply(change);
      const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
      matrix.decompose(position, rotation, scale);
      const restored = new Matrix4().compose(position, rotation, scale);
      if (scale.toArray().some(value => !Number.isFinite(value) || value <= 0) ||
          restored.elements.some((value, index) => Math.abs(value - matrix.elements[index]) > 1e-6)) {
        throw new Error(object.name + ' bağlantısında eşit olmayan eksen boyutları eğrilme oluşturuyor. Üst nesnenin boyut oranlarını eşitleyip tekrar dene.');
      }
      const angles = new Euler().setFromQuaternion(rotation).toArray().slice(0, 3);
      const turn = Math.PI * 2;
      return { position: position.toArray(), scale: scale.toArray(),
        rotation: angles.map((angle, axis) => angle + Math.round((pose.rotation[axis] - angle) / turn) * turn) };
    };
    return { object, parent, current: rebase({
      position: object.position.toArray(), rotation: object.rotation.toArray().slice(0, 3), scale: object.scale.toArray()
    }), keys: posesOf(object).map(pose => ({ pose, next: rebase(pose) })) };
  });
}

export function applyReparenting(plans) {
  for (const { object, parent, current, keys } of plans) {
    parent.add(object);
    object.position.fromArray(current.position);
    object.rotation.fromArray(current.rotation);
    object.scale.fromArray(current.scale);
    for (const { pose, next } of keys) Object.assign(pose, next);
  }
}
