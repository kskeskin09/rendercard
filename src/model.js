import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  MathUtils,
  Euler,
  Quaternion,
  Vector3
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const types = { box: 'Kutu', sphere: 'Küre', group: 'Grup', mesh: 'Ağ' };
export const levels = [12, 24, 48];
const channels = ['position', 'rotation', 'scale'];

export function geometry(type, detail = 24) {
  return type === 'box'
    ? new BoxGeometry(1, 1, 1)
    : new SphereGeometry(0.5, detail, detail / 2);
}

function material(color) {
  return new MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.07 });
}

export function materialsOf(object) {
  return Array.isArray(object.material) ? object.material : [object.material];
}

function configureMesh(object) {
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

export function makeObject(
  type,
  name = types[type],
  color = type === 'box' ? '#b8a8f3' : '#dcf878',
  detail = 24
) {
  const object =
    type === 'group'
      ? new Group()
      : configureMesh(new Mesh(geometry(type, detail), material(color)));
  object.name = name;
  object.userData = { type, detail, keys: [] };
  return object;
}

function makeJoinedMesh(parts, name = 'Birleşik ağ') {
  const matrix = new Matrix4();
  const geometries = parts.map((part) =>
    geometry(part.type, part.detail).applyMatrix4(matrix.fromArray(part.matrix))
  );
  const merged = mergeGeometries(geometries, true);
  geometries.forEach((part) => part.dispose());
  const mesh = configureMesh(
    new Mesh(
      merged,
      parts.map((part) => material(part.color))
    )
  );
  mesh.name = name;
  mesh.userData = { type: 'mesh', keys: [], parts };
  return mesh;
}

export function joinMeshes(objects) {
  const parent = objects[0].parent;
  const center = centerOf(objects);
  const offset = new Matrix4().makeTranslation(-center.x, -center.y, -center.z);
  const parts = objects.flatMap((object) => {
    object.updateMatrix();
    const matrix = new Matrix4().multiplyMatrices(offset, object.matrix);
    if (object.userData.type === 'mesh') {
      return object.userData.parts.map((part) => ({
        ...part,
        matrix: new Matrix4()
          .fromArray(part.matrix)
          .premultiply(matrix)
          .toArray()
      }));
    }
    return [
      {
        type: object.userData.type,
        detail: object.userData.detail,
        color: '#' + object.material.color.getHexString(),
        matrix: matrix.toArray()
      }
    ];
  });
  const merged = makeJoinedMesh(parts);
  merged.position.copy(center);
  objects.forEach(disposeObject);
  parent.add(merged);
  return merged;
}

export function setDetail(object, detail) {
  object.geometry.dispose();
  object.geometry = geometry(object.userData.type, detail);
  object.userData.detail = detail;
}

export function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    materialsOf(child).forEach((material) => material.dispose());
  });
  object.removeFromParent();
}

export function capture(object) {
  return {
    position: object.position.toArray(),
    rotation: object.rotation.toArray().slice(0, 3),
    scale: object.scale.toArray()
  };
}

export function applyPose(object, pose) {
  for (const channel of channels) object[channel].fromArray(pose[channel]);
}

export function writeKey(object, frame) {
  const keys = object.userData.keys;
  const previous = keys.findIndex((key) => key.frame === frame);
  const key = { frame, ...capture(object) };
  if (previous >= 0) keys.splice(previous, 1, key);
  else keys.push(key);
  keys.sort((a, b) => a.frame - b.frame);
}

export function poseAt(object, frame) {
  const keys = object.userData.keys;
  if (keys.length === 0) return;
  const next = keys.findIndex((key) => key.frame >= frame);
  if (next <= 0 || keys[next].frame === frame) {
    applyPose(object, next < 0 ? keys.at(-1) : keys[next]);
    return;
  }
  const a = keys[next - 1];
  const b = keys[next];
  const t = (frame - a.frame) / (b.frame - a.frame);
  const interpolate = (channel) =>
    a[channel].map((value, axis) => MathUtils.lerp(value, b[channel][axis], t));
  object.position.fromArray(interpolate('position'));
  object.scale.fromArray(interpolate('scale'));
  const start = new Quaternion().setFromEuler(new Euler(...a.rotation));
  const end = new Quaternion().setFromEuler(new Euler(...b.rotation));
  object.quaternion.slerpQuaternions(start, end, t);
}

export function encodeProject(root, duration) {
  function encode(object) {
    return {
      name: object.name,
      ...object.userData,
      ...capture(object),
      color:
        object.isMesh && object.userData.type !== 'mesh'
          ? '#' + object.material.color.getHexString()
          : undefined,
      children: object.children.map(encode)
    };
  }
  return { version: 1, duration, objects: root.children.map(encode) };
}

export function decodeProject(project) {
  const numericTuple = (value) =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  const validPose = (value) =>
    value &&
    channels.every((channel) => numericTuple(value[channel])) &&
    value.scale.every((x) => x > 0);
  const validFrame = (value) =>
    Number.isInteger(value) && value >= 0 && value <= 1800;
  const validPrimitive = (data) =>
    data &&
    (data.type === 'box' || data.type === 'sphere') &&
    /^#[0-9a-f]{6}$/i.test(data.color) &&
    levels.includes(data.detail);
  const validPart = (part) =>
    validPrimitive(part) &&
    Array.isArray(part.matrix) &&
    part.matrix.length === 16 &&
    part.matrix.every(Number.isFinite);
  function validate(data, depth) {
    if (
      !data ||
      depth > 30 ||
      !Object.hasOwn(types, data.type) ||
      typeof data.name !== 'string' ||
      !validPose(data) ||
      !Array.isArray(data.keys) ||
      !Array.isArray(data.children) ||
      data.keys.some(
        (key, index) =>
          !validPose(key) ||
          !validFrame(key.frame) ||
          (index > 0 && data.keys[index - 1].frame >= key.frame)
      ) ||
      (data.type !== 'group' && data.children.length > 0) ||
      (data.type === 'mesh' &&
        (!Array.isArray(data.parts) ||
          data.parts.length < 2 ||
          !data.parts.every(validPart))) ||
      ((data.type === 'box' || data.type === 'sphere') && !validPrimitive(data))
    ) {
      throw new Error('Geçersiz nesne');
    }
    data.children.forEach((child) => validate(child, depth + 1));
  }
  function decode(data) {
    const object =
      data.type === 'mesh'
        ? makeJoinedMesh(structuredClone(data.parts), data.name)
        : makeObject(data.type, data.name, data.color, data.detail);
    applyPose(object, data);
    object.userData.keys = structuredClone(data.keys);
    for (const child of data.children) object.add(decode(child));
    return object;
  }
  if (
    project?.version !== 1 ||
    !validFrame(project.duration) ||
    project.duration < 1 ||
    !Array.isArray(project.objects)
  ) {
    throw new Error('Geçersiz proje');
  }
  project.objects.forEach((object) => validate(object, 0));
  return { duration: project.duration, objects: project.objects.map(decode) };
}

function centerOf(objects) {
  const center = new Vector3();
  for (const object of objects) center.add(object.position);
  return center.divideScalar(objects.length);
}

export function groupObjects(objects) {
  const parent = objects[0].parent;
  const center = centerOf(objects);
  const group = makeObject('group');
  group.position.copy(center);
  parent.add(group);
  for (const object of objects) {
    object.position.sub(center);
    for (const key of object.userData.keys)
      key.position = key.position.map(
        (value, index) => value - center.getComponent(index)
      );
    group.add(object);
  }
  return group;
}

export function dissolveGroup(group) {
  const parent = group.parent;
  const children = [...group.children];
  group.updateMatrix();
  const proxy = new Group();
  for (const child of children) {
    for (const key of child.userData.keys) {
      applyPose(proxy, key);
      proxy.applyMatrix4(group.matrix);
      Object.assign(key, capture(proxy));
    }
    child.applyMatrix4(group.matrix);
    parent.add(child);
  }
  group.removeFromParent();
  return children;
}
