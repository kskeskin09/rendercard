import { Box3, Vector3 } from 'three';
import { translateWorld } from './spatial.js';

export function snapToGrid(object, axes, step) {
  const point = object.getWorldPosition(new Vector3());
  translateWorld(object, snapPointToGrid(point, step, axes).sub(point));
}

export function snapPointToGrid(point, step, axes = ['x', 'y', 'z']) {
  const result = point.clone();
  for (const axis of axes) result[axis] = Math.round(point[axis] / step) * step;
  return result;
}

export function surfaceOffset(moving, targets, active, threshold) {
  const axes = ['x', 'y', 'z'];
  const delta = new Vector3();
  let primary;
  for (const target of targets) {
    for (const axis of axes) {
      const lateral = axes.filter((side) => side !== axis);
      if (
        !lateral.every(
          (side) =>
            moving.min[side] <= target.max[side] + threshold &&
            moving.max[side] >= target.min[side] - threshold
        )
      )
        continue;
      for (const offset of [
        target.min[axis] - moving.max[axis],
        target.max[axis] - moving.min[axis]
      ]) {
        if (!Number.isFinite(target.min.x) && !active.includes(axis)) continue;
        if (
          Math.abs(offset) <= threshold &&
          (!primary || Math.abs(offset) < Math.abs(primary.offset))
        ) {
          primary = { axis, offset, target };
        }
      }
    }
  }
  if (!primary) return null;
  delta[primary.axis] = primary.offset;
  for (const axis of axes) {
    if (axis === primary.axis || !active.includes(axis)) continue;
    const offsets = [
      primary.target.min[axis] - moving.min[axis],
      primary.target.max[axis] - moving.max[axis]
    ];
    const closest =
      Math.abs(offsets[0]) < Math.abs(offsets[1]) ? offsets[0] : offsets[1];
    if (Math.abs(closest) <= threshold) delta[axis] = closest;
  }
  return delta;
}

export function snapToSurfaces(root, object, axes, threshold, collisions) {
  const moving = new Box3().setFromObject(object, true);
  if (moving.isEmpty()) return false;
  const before = object.position.clone();
  const excluded = new Set();
  object.traverse((child) => excluded.add(child));
  const targets = [];
  root.traverseVisible((child) => {
    if (child.isMesh && !excluded.has(child))
      targets.push(new Box3().setFromObject(child, true));
  });
  targets.push(
    new Box3(
      new Vector3(-Infinity, 0, -Infinity),
      new Vector3(Infinity, 0, Infinity)
    )
  );
  const offset = surfaceOffset(moving, targets, axes, threshold);
  if (offset) {
    translateWorld(object, offset);
    const onFloor =
      axes.includes('y') && Math.abs(moving.min.y + offset.y) <= 0.00001;
    if (!collisions || onFloor || collisions.touches(root, object)) return true;
    object.position.copy(before);
  }
  return collisions?.snapContact(root, object, axes, threshold) ?? false;
}

export function combinedBounds(objects) {
  const bounds = new Box3();
  for (const object of objects) bounds.union(new Box3().setFromObject(object, true));
  return bounds;
}

export function snapResize(root, objects, axes, proposed, apply, touches, threshold = .25) {
  if (!axes.length) return false;
  const moving = combinedBounds(objects);
  if (moving.isEmpty()) return false;
  const vicinity = moving.clone().expandByScalar(threshold);
  const directions = ['x', 'y', 'z'];
  const excluded = new Set();
  for (const object of objects) {
    object.traverse(child => excluded.add(child));
    for (let node = object.parent; node && node !== root; node = node.parent) excluded.add(node);
  }
  const targets = [];
  root.traverseVisible(object => {
    if (!object.isMesh || excluded.has(object)) return;
    object.updateWorldMatrix(true, false);
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (!vicinity.intersectsBox(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld))) return;
    const position = object.geometry.attributes.position;
    const bounds = new Box3(), point = new Vector3();
    for (let i = 0; i < position.count; i++)
      bounds.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld));
    if (!bounds.isEmpty()) targets.push(bounds);
  });
  const faces = [];
  for (const target of targets) {
    for (const axis of directions) {
      if (!directions.every(lateral => lateral === axis ||
        moving.min[lateral] <= target.max[lateral] + 1e-6 && moving.max[lateral] >= target.min[lateral] - 1e-6)) continue;
      faces.push({ axis, edge: 'max', at: target.min[axis] }, { axis, edge: 'min', at: target.max[axis] });
      if (directions.some(side => side !== axis && (
        Math.abs(moving.min[side] - target.max[side]) < 1e-5 ||
        Math.abs(moving.max[side] - target.min[side]) < 1e-5))) {
        faces.push({ axis, edge: 'max', at: target.max[axis] }, { axis, edge: 'min', at: target.min[axis] });
      }
    }
  }
  faces.push({ axis: 'y', edge: 'min', at: 0, floor: true });
  const close = faces.map(face => ({ ...face, delta: face.at - moving[face.edge][face.axis] }))
    .filter(face => Math.abs(face.delta) > 1e-7 && Math.abs(face.delta) <= threshold);
  if (!close.length) return false;
  const candidates = [];
  for (const axis of axes) {
    const probe = Math.max(.001, proposed[axis] * .01);
    const scale = proposed.clone();
    scale[axis] += probe;
    apply(scale);
    const changed = combinedBounds(objects);
    for (const face of close) {
      const slope = (changed[face.edge][face.axis] - moving[face.edge][face.axis]) / probe;
      if (Math.abs(slope) < 1e-6) continue;
      const value = proposed[axis] + face.delta / slope;
      if (value >= .001) candidates.push({ face, axis, value, distance: Math.abs(face.delta) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const { face, axis, value } of candidates) {
    const scale = proposed.clone();
    scale[axis] = value;
    apply(scale);
    const final = combinedBounds(objects);
    if (Math.abs(final[face.edge][face.axis] - face.at) > 1e-5) continue;
    if (!directions.every(direction => ['min', 'max'].every(side =>
      Math.abs(final[side][direction] - moving[side][direction]) <= 2 * threshold + 1e-6))) continue;
    if (face.floor || !touches || objects.some(touches)) return true;
  }
  apply(proposed);
  return false;
}

export function snapSelectionSize(objects, axes, proposed, apply, step) {
  const snapped = proposed.clone();
  if (combinedBounds(objects).isEmpty()) return snapped;
  for (const axis of axes) {
    const size = combinedBounds(objects).getSize(new Vector3())[axis];
    const desired = Math.max(step, Math.round(size / step) * step);
    const probe = Math.max(.001, snapped[axis] * .01);
    const attempt = snapped.clone();
    attempt[axis] += probe;
    apply(attempt);
    const rate = (combinedBounds(objects).getSize(new Vector3())[axis] - size) / probe;
    if (rate > 1e-6) snapped[axis] = Math.max(.001, snapped[axis] + (desired - size) / rate);
    apply(snapped);
  }
  return snapped;
}
