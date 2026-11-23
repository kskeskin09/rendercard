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
