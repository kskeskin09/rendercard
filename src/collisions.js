import RAPIER from '@dimforge/rapier3d-compat';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { partBuffer } from './model.js';
import { hasKeys } from './clips.js';
import { slideMovement } from './camera-follow.js';
import { translateWorld } from './spatial.js';
import { sceneCuts } from './boolean-cuts.js';
import { elasticFits } from './elastic.js';
import { relatedHierarchy, solidInHierarchy } from './hierarchy.js';

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

function shapeFor(buffer, matrix, settings, cut = false) {
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
    !cut && orthogonal &&
    settings.type === 'box' &&
    (settings.sides ?? 4) === 4 &&
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
    !cut && orthogonal &&
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
    if (cut) {
      const count = Math.min(buffer.index.count, buffer.drawRange.count);
      shape = new RAPIER.TriMesh(vertices, new Uint32Array(buffer.index.array.slice(0, count)));
    } else shape = new RAPIER.ConvexPolyhedron(vertices);
  }
  return { shape, position, rotation, bounds };
}

function collect(object, excluded, { cuts, cutters }) {
  const shapes = [];
  object.updateWorldMatrix(true, true);
  object.traverse((mesh) => {
    if ((!mesh.isMesh && !mesh.isCamera) || excluded.has(mesh)) return;
    for (let node = mesh; node; node = node.parent)
      if (node.clipActive === false) return;
    const data = mesh.userData;
    const solid = solidInHierarchy(mesh);
    if (mesh.isCamera) {
      if (!data.affectsSolids) return;
      const position = mesh.getWorldPosition(new Vector3());
      const radius = 0.14;
      shapes.push({
        position, rotation: aligned, shape: new RAPIER.Ball(radius), solid: data.solid,
        bounds: new Box3(position.clone().addScalar(-radius), position.clone().addScalar(radius)), object: mesh
      });
      return;
    }
    if (cutters.has(mesh)) return;
    const cut = cuts.get(mesh);
    if (cut || data.parts?.some(part => part.type === 'baked')) {
      const surface = cut ?? mesh.geometry;
      if (surface.drawRange.count) shapes.push({
        ...shapeFor(surface, mesh.matrixWorld, data, true), solid, object: mesh
      });
      return;
    }
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
        partGeometry.set(part, partBuffer(part));
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

function pairs(root, moving, any = false, ignored = []) {
  const excluded = new Set(ignored);
  moving.traverse((object) => excluded.add(object));
  let hasSolid = solidInHierarchy(moving);
  root.traverse((object) => {
    hasSolid ||= Boolean(object.userData.solid);
  });
  if (!ready || (!hasSolid && !any)) return [];
  const cuts = sceneCuts(root, undefined, false);
  const movingShapes = collect(moving, new Set(), cuts);
  const others = collect(root, excluded, cuts);
  return movingShapes.flatMap((a) =>
    others.filter((b) => {
      if (relatedHierarchy(a.object, b.object)) return false;
      if (a.object.isMesh && b.object.isMesh &&
          Boolean(a.object.userData.negative) !== Boolean(b.object.userData.negative)) return false;
      return any || b.solid || a.solid;
    }).map((b) => ({ a, b }))
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

function elasticContact(a, b, travel) {
  if (!a.object.userData.elastic && !b.object.userData.elastic) return false;
  const offset = a.elasticOffset?.clone() ?? new Vector3();
  if (travel) offset.add(travel);
  return elasticFits(a.object, b.object, offset.clone().negate()) !==
    elasticFits(b.object, a.object, offset);
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
      if (!a.bounds.intersectsBox(b.bounds) || elasticContact(a, b)) continue;
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
      (a.elasticOffset ??= new Vector3()).add(offset);
    }
  }
  if (total.lengthSq() === 0) return false;
  translateWorld(moving, total);
  return true;
}

export function sweep(root, moving, from, ignored) {
  const to = moving.position.clone();
  if (from.distanceToSquared(to) <= tolerance ** 2) return;
  moving.position.copy(from);
  const candidates = pairs(root, moving, false, ignored);
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
      if (elasticContact(a, b, travel.clone().multiplyScalar(hit.time_of_impact))) continue;
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
  const candidates = pairs(root, moving).filter(({ b }) => isStatic(b.object, root));
  return (position, travel) => {
    const offset = position.clone().sub(origin);
    return castPairs(
      candidates.map(({ a, b }) => ({
        a: {
          ...a,
          position: a.position.clone().add(offset),
          bounds: a.bounds.clone().translate(offset),
          elasticOffset: offset
        },
        b
      })),
      travel
    );
  };
}

export function followCamera(root, camera, desired) {
  const origin = camera.getWorldPosition(new Vector3());
  const candidates = pairs(root, camera);
  if (!candidates.length) return desired;
  return slideMovement(origin, desired, (at, travel) => {
    const offset = at.clone().sub(origin);
    return castPairs(candidates.map(({ a, b }) => ({
      a: { ...a, position: a.position.clone().add(offset), bounds: a.bounds.clone().translate(offset), elasticOffset: offset }, b
    })), travel);
  });
}

function isStatic(object, root) {
  for (let node = object; node && node !== root; node = node.parent) {
    if (hasKeys(node) || ['physics', 'orbit'].includes(node.userData.positionMode) || node.userData.rotationMode === 'physics')
      return false;
  }
  return true;
}

export function overlaps(root, object, any = false, staticOnly = false) {
  const objects = new Set();
  for (const { a, b } of pairs(root, object, any)) {
    if (
      (!staticOnly || isStatic(b.object, root)) &&
      a.bounds.intersectsBox(b.bounds) && (any || !elasticContact(a, b)) &&
      contact(a, b)?.distance < -tolerance
    )
      objects.add(b.object);
  }
  return [...objects];
}
