import RAPIER from '@dimforge/rapier3d-compat';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { geometry } from './model.js';
import { hasKeys } from './clips.js';
import { translateWorld } from './spatial.js';

const tolerance = 0.00001;
const stationary = new Vector3();
const aligned = new Quaternion();
const partGeometry = new WeakMap();
let ready = false;

export async function initializeCollisions() {
  try {
    await RAPIER.init();
    ready = true;
  } catch (error) {
    console.error('Katılık başlatılamadı.', error);
  }
  return ready;
}

function solidInHierarchy(object) {
  for (let node = object; node; node = node.parent)
    if (node.userData.solid) return true;
  return false;
}

function shapeFor(buffer, matrix, settings) {
  const position = new Vector3().setFromMatrixPosition(matrix);
  const bounds = new Box3();
  const linear = matrix.clone().setPosition(0, 0, 0);
  let shape;
  let rotation = aligned;
  const axes = [0, 1, 2].map((index) =>
    new Vector3().setFromMatrixColumn(matrix, index)
  );
  const lengths = axes.map((axis) => axis.length());
  axes.forEach((axis) => axis.normalize());
  const orthogonal =
    Math.abs(axes[0].dot(axes[1])) < tolerance &&
    Math.abs(axes[0].dot(axes[2])) < tolerance &&
    Math.abs(axes[1].dot(axes[2])) < tolerance;
  if (
    orthogonal &&
    settings.type === 'box' &&
    !settings.radius &&
    !settings.edgeRadii?.some(Boolean)
  ) {
    const half = new Vector3(...lengths).multiplyScalar(0.5);
    const center = new Vector3().fromArray(settings.offset ?? [0, 0, 0]);
    position.add(center.applyMatrix4(linear));
    rotation = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(...axes)
    );
    shape = new RAPIER.Cuboid(half.x, half.y, half.z);
    bounds.min.copy(half).negate();
    bounds.max.copy(half);
    bounds.applyMatrix4(
      new Matrix4().compose(position, rotation, new Vector3(1, 1, 1))
    );
  } else if (
    orthogonal &&
    settings.type === 'sphere' &&
    Math.max(...lengths) - Math.min(...lengths) < tolerance
  ) {
    const radius = lengths[0] * 0.5;
    position.add(
      new Vector3().fromArray(settings.offset ?? [0, 0, 0]).applyMatrix4(linear)
    );
    shape = new RAPIER.Ball(radius);
    bounds.min.copy(position).addScalar(-radius);
    bounds.max.copy(position).addScalar(radius);
  } else {
    const attribute = buffer.attributes.position;
    const point = new Vector3();
    const vertices = new Float32Array(attribute.count * 3);
    for (let i = 0; i < attribute.count; i++) {
      point
        .fromBufferAttribute(attribute, i)
        .applyMatrix4(linear)
        .toArray(vertices, i * 3);
      bounds.expandByPoint(point.add(position));
    }
    shape = new RAPIER.ConvexPolyhedron(vertices);
  }
  return { shape, position, rotation, bounds };
}

function collect(object, excluded) {
  const shapes = [];
  object.updateWorldMatrix(true, true);
  object.traverse((mesh) => {
    if (!mesh.isMesh || excluded.has(mesh)) return;
    for (let node = mesh; node; node = node.parent)
      if (node.clipActive === false) return;
    const data = mesh.userData;
    const solid = solidInHierarchy(mesh);
    if (data.type !== 'mesh') {
      shapes.push({
        ...shapeFor(mesh.geometry, mesh.matrixWorld, data),
        solid,
        object: mesh
      });
      return;
    }
    const matrix = new Matrix4();
    const parent = mesh.matrixWorld
      .clone()
      .multiply(new Matrix4().makeTranslation(...data.offset));
    for (const part of data.parts) {
      if (!partGeometry.has(part))
        partGeometry.set(part, geometry(part.type, part.detail, part));
      matrix.fromArray(part.matrix).premultiply(parent);
      shapes.push({
        ...shapeFor(partGeometry.get(part), matrix, part),
        solid,
        object: mesh
      });
    }
  });
  return shapes;
}

function pairs(root, moving, any = false) {
  const excluded = new Set();
  moving.traverse((object) => excluded.add(object));
  let hasSolid = solidInHierarchy(moving);
  root.traverse((object) => {
    hasSolid ||= Boolean(object.userData.solid);
  });
  if (!ready || (!hasSolid && !any)) return [];
  const movingShapes = collect(moving, new Set());
  const others = collect(root, excluded);
  return movingShapes.flatMap((a) =>
    others.filter((b) => any || b.solid || a.solid).map((b) => ({ a, b }))
  );
}

function contact(a, b) {
  return a.shape.contactShape(
    a.position,
    a.rotation,
    b.shape,
    b.position,
    b.rotation,
    tolerance
  );
}

function visible(object) {
  for (let node = object; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}

export function touches(root, object) {
  return pairs(root, object, true).some(({ a, b }) => {
    if (!visible(b.object)) return false;
    const hit = contact(a, b);
    return hit && Math.abs(hit.distance) <= tolerance;
  });
}

export function snapContact(root, object, axes, threshold) {
  const candidates = pairs(root, object, true);
  let closest;
  for (const { a, b } of candidates) {
    if (
      !visible(b.object) ||
      !a.bounds.clone().expandByScalar(threshold).intersectsBox(b.bounds)
    )
      continue;
    const hit = contact(a, b);
    for (const axis of axes) {
      for (const sign of [-1, 1]) {
        const direction = new Vector3();
        direction[axis] = sign;
        let distance;
        if (hit && hit.distance < -tolerance) {
          const projected = direction.dot(hit.normal2);
          if (projected > tolerance) distance = -hit.distance / projected;
        } else {
          const impact = a.shape.castShape(
            a.position,
            a.rotation,
            direction,
            b.shape,
            b.position,
            b.rotation,
            stationary,
            0,
            threshold,
            false
          );
          distance = impact?.time_of_impact;
        }
        if (
          Number.isFinite(distance) &&
          distance >= 0 &&
          distance <= threshold &&
          (!closest || distance < closest.distance)
        )
          closest = { direction, distance };
      }
    }
  }
  if (!closest) return false;
  translateWorld(object, closest.direction.multiplyScalar(closest.distance));
  return true;
}

export function separate(root, moving) {
  const candidates = pairs(root, moving);
  if (!candidates.length) return false;
  const total = new Vector3();
  const offset = new Vector3();
  for (let iteration = 0; iteration < 32; iteration++) {
    let deepest;
    for (const { a, b } of candidates) {
      if (!a.bounds.intersectsBox(b.bounds)) continue;
      const hit = contact(a, b);
      if (
        hit?.distance < -tolerance &&
        (!deepest || hit.distance < deepest.distance)
      )
        deepest = hit;
    }
    if (!deepest) break;
    offset.copy(deepest.normal2).multiplyScalar(-deepest.distance + tolerance);
    total.add(offset);
    const shifted = new Set();
    for (const { a } of candidates) {
      if (shifted.has(a)) continue;
      shifted.add(a);
      a.position.add(offset);
      a.bounds.translate(offset);
    }
  }
  if (total.lengthSq() === 0) return false;
  translateWorld(moving, total);
  return true;
}

export function sweep(root, moving, from) {
  const to = moving.position.clone();
  if (from.distanceToSquared(to) <= tolerance ** 2) return;
  moving.position.copy(from);
  const candidates = pairs(root, moving);
  if (!candidates.length) {
    moving.position.copy(to);
    return;
  }
  const parent = moving.parent;
  const travel = parent
    .localToWorld(to.clone())
    .sub(parent.localToWorld(from.clone()));
  const hit = castPairs(candidates, travel);
  const time = hit ? Math.max(0, hit.time - tolerance / travel.length()) : 1;
  moving.position.lerpVectors(from, to, time);
  return hit?.object;
}

function castPairs(candidates, travel) {
  let nearest;
  let time = 1;
  for (const { a, b } of candidates) {
    const swept = a.bounds.clone().union(a.bounds.clone().translate(travel));
    if (!swept.intersectsBox(b.bounds)) continue;
    const touching = contact(a, b);
    if (touching && travel.dot(touching.normal2) >= -tolerance) continue;
    const hit = a.shape.castShape(
      a.position,
      a.rotation,
      travel,
      b.shape,
      b.position,
      b.rotation,
      stationary,
      0,
      time,
      false
    );
    if (Number.isFinite(hit?.time_of_impact) && hit.time_of_impact <= time) {
      const normal = new Vector3()
        .copy(hit.normal2)
        .applyQuaternion(b.rotation)
        .normalize();
      if (travel.dot(normal) < -tolerance) {
        time = Math.max(0, hit.time_of_impact);
        nearest = { time, normal, object: b.object };
      }
    }
  }
  return nearest;
}

export function staticContacts(root, moving) {
  const origin = moving.getWorldPosition(new Vector3());
  const candidates = pairs(root, moving).filter(({ b }) => {
    for (let node = b.object; node && node !== root; node = node.parent) {
      if (hasKeys(node) || node.userData.positionMode === 'physics')
        return false;
    }
    return true;
  });
  return (position, travel) => {
    const offset = position.clone().sub(origin);
    return castPairs(
      candidates.map(({ a, b }) => ({
        a: {
          ...a,
          position: a.position.clone().add(offset),
          bounds: a.bounds.clone().translate(offset)
        },
        b
      })),
      travel
    );
  };
}

export function overlaps(root, object, any = false) {
  const objects = new Set();
  for (const { a, b } of pairs(root, object, any)) {
    if (
      a.bounds.intersectsBox(b.bounds) &&
      contact(a, b)?.distance < -tolerance
    )
      objects.add(b.object);
  }
  return [...objects];
}
