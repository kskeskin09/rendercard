import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  MathUtils,
  Vector3
} from 'three';
import {
  mergeGeometries,
  mergeVertices
} from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { applyTile, tiles } from './tiles.js';
import { fitPivot, translateWorld } from './spatial.js';
import { mainClip, keysFor, posesOf } from './clips.js';
import {
  easedTime,
  travelTime,
  interpolateRotation,
  rotationPaths
} from './motion.js';
import { profileTime, accelerationOffset } from './motion.js';
import { roundedEdges } from './edge-geometry.js';

export const defaultAtmosphere = {
  enabled: false,
  color: '#26322b',
  near: 5,
  far: 20
};

export const types = {
  box: 'Kutu',
  sphere: 'Küre',
  group: 'Grup',
  mesh: 'Ağ',
  light: 'Işık'
};
export const levels = [12, 24, 48];
export const projectVersion = 5;
const channels = ['position', 'rotation', 'scale'];

const settingsDefaults = {
  radius: 0,
  segments: 4,
  solid: false,
  hidden: false,
  easeIn: 0,
  easeOut: 0,
  acceleration: 0,
  physicsAcceleration: [0, 0, 0],
  initialVelocity: [0, 0, 0],
  restitution: 0,
  emitsLight: false,
  emissionColor: '#fff1d9',
  emissionPower: 35,
  edgeRadii: null,
  positionMode: 'keys',
  physicsClip: 'main',
  sceneClip: null,
  speedProfile: null,
  rotationPath: 'short',
  finish: 'color',
  tile: 'checker',
  tileScale: 1,
  pivot: [0, 0, 0],
  offset: [0, 0, 0]
};

function settingsOf(data = {}) {
  return Object.fromEntries(
    Object.entries(settingsDefaults).map(([key, value]) => [
      key,
      structuredClone(data[key] ?? value)
    ])
  );
}

export function geometry(type, detail = 24, settings = settingsDefaults) {
  let result;
  if (type === 'sphere') result = new SphereGeometry(0.5, detail, detail / 2);
  else if (settings.edgeRadii?.some(Boolean))
    result = roundedEdges(
      settings.edgeRadii.map((value) => Math.min(0.499, value)),
      settings.segments
    );
  else if (settings.radius > 0) {
    const rounded = new RoundedBoxGeometry(
      1,
      1,
      1,
      settings.segments,
      settings.radius
    );
    result = mergeVertices(rounded);
    rounded.dispose();
  } else result = new BoxGeometry(1, 1, 1);
  if (settings.offset) result.translate(...settings.offset);
  return result;
}

function material(color, settings) {
  const result = new MeshStandardMaterial({
    color,
    roughness: 0.62,
    metalness: 0.07
  });
  applyTile(result, settings);
  return result;
}

export function materialsOf(object) {
  return Array.isArray(object.material) ? object.material : [object.material];
}

function configureMesh(object) {
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

export function configurePointLight(light) {
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = 35;
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.025;
  return light;
}

export function makeObject(
  type,
  name = types[type],
  color = type === 'light' ? '#fff1d9' : type === 'box' ? '#b8a8f3' : '#dcf878',
  detail = 24,
  data
) {
  const settings = settingsOf(data);
  const object =
    type === 'group'
      ? new Group()
      : type === 'light'
        ? new PointLight(color, data?.intensity ?? 18)
        : configureMesh(
            new Mesh(
              geometry(type, detail, settings),
              material(color, settings)
            )
          );
  if (object.isLight) {
    configurePointLight(object);
  }
  object.name = name;
  object.userData = { type, detail, keys: [], ...settings };
  object.userData.tracks = {};
  object.visible = !settings.hidden;
  return object;
}

function makeJoinedMesh(parts, name = 'Birleşik ağ', data) {
  const settings = settingsOf(data);
  const matrix = new Matrix4();
  const geometries = parts.map((part) =>
    geometry(part.type, part.detail, part).applyMatrix4(
      matrix.fromArray(part.matrix)
    )
  );
  const merged = mergeGeometries(geometries, true);
  geometries.forEach((part) => part.dispose());
  const mesh = configureMesh(
    new Mesh(
      merged.translate(...settings.offset),
      parts.map((part) => {
        const surface = material(part.color, part);
        surface.visible = !part.hidden;
        return surface;
      })
    )
  );
  mesh.name = name;
  mesh.userData = { type: 'mesh', keys: [], tracks: {}, parts, ...settings };
  mesh.visible = !settings.hidden;
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
      matrix.multiply(new Matrix4().makeTranslation(...object.userData.offset));
      return object.userData.parts.map((part) => ({
        ...part,
        hidden: object.userData.hidden || part.hidden === true,
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
        ...settingsOf(object.userData),
        color: '#' + object.material.color.getHexString(),
        matrix: matrix.toArray()
      }
    ];
  });
  const hidden = parts.every((part) => part.hidden);
  if (hidden)
    parts.forEach((part) => {
      part.hidden = false;
    });
  const merged = makeJoinedMesh(parts, undefined, { hidden });
  merged.userData.solid = objects.some((object) => object.userData.solid);
  merged.position.copy(center);
  objects.forEach(disposeObject);
  parent.add(merged);
  fitPivot(merged);
  return merged;
}

export function setDetail(object, detail) {
  object.geometry.dispose();
  object.geometry = geometry(object.userData.type, detail, object.userData);
  object.userData.detail = detail;
  fitPivot(object);
}

export function disposeObject(object) {
  object.traverse((child) => {
    if (child.isLight) child.dispose();
    if (!child.isMesh) return;
    child.geometry.dispose();
    materialsOf(child).forEach((material) => {
      material.map?.dispose();
      material.dispose();
    });
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

export function writeKey(object, frame, clip = 'main') {
  const keys = keysFor(object, clip, true);
  object.userData.restPose ??= capture(object);
  const previous = keys.findIndex((key) => key.frame === frame);
  const key = { frame, ...capture(object) };
  if (previous >= 0) keys.splice(previous, 1, key);
  else keys.push(key);
  keys.sort((a, b) => a.frame - b.frame);
}

export function poseAt(object, frame, keys = object.userData.keys) {
  if (keys.length === 0) return;
  const next = keys.findIndex((key) => key.frame >= frame);
  if (next <= 0 || keys[next].frame === frame) {
    applyPose(object, next < 0 ? keys.at(-1) : keys[next]);
    return;
  }
  const a = keys[next - 1];
  const b = keys[next];
  const clock = (frame - a.frame) / (b.frame - a.frame);
  const { easeIn, easeOut, acceleration, rotationPath, speedProfile } =
    object.userData;
  const progress = (clock) =>
    speedProfile
      ? profileTime(clock, speedProfile)
      : easedTime(clock, easeIn, easeOut);
  const t = progress(clock);
  const interpolate = (channel, t) =>
    a[channel].map((value, axis) => MathUtils.lerp(value, b[channel][axis], t));
  object.position.fromArray(
    interpolate(
      'position',
      speedProfile ? t : progress(travelTime(clock, acceleration))
    )
  );
  object.scale.fromArray(interpolate('scale', t));
  interpolateRotation(object, a.rotation, b.rotation, t, rotationPath);
}

export function applyAcceleration(object, frame, startFrame = 0) {
  const acceleration = object.userData.physicsAcceleration;
  if (acceleration.some(Boolean) && frame > startFrame) {
    translateWorld(
      object,
      new Vector3().fromArray(
        accelerationOffset(acceleration, frame - startFrame)
      )
    );
  }
}

export function encodeObject(object) {
  return {
    name: object.name,
    ...object.userData,
    ...capture(object),
    color: object.isLight
      ? '#' + object.color.getHexString()
      : object.isMesh && object.userData.type !== 'mesh'
        ? '#' + object.material.color.getHexString()
        : undefined,
    intensity: object.isLight ? object.intensity : undefined,
    children: object.children.map(encodeObject)
  };
}

export function encodeProject(root, duration, animations, atmosphere) {
  return {
    version: projectVersion,
    duration,
    animations,
    atmosphere,
    objects: root.children.map(encodeObject)
  };
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
  const validKeys = (keys) =>
    Array.isArray(keys) &&
    keys.every(
      (key, index) =>
        validPose(key) &&
        validFrame(key.frame) &&
        (index === 0 || keys[index - 1].frame < key.frame)
    );
  const validClipId = (id) =>
    typeof id === 'string' && /^(main|clip-[0-9a-f-]{1,36})$/.test(id);
  const validSettings = (data) =>
    (data.radius == null ||
      (Number.isFinite(data.radius) &&
        data.radius >= 0 &&
        data.radius <= 0.5)) &&
    (data.segments == null ||
      (Number.isInteger(data.segments) &&
        data.segments >= 1 &&
        data.segments <= 12)) &&
    (data.solid == null || typeof data.solid === 'boolean') &&
    (data.initialVelocity == null ||
      (numericTuple(data.initialVelocity) &&
        data.initialVelocity.every((value) => Math.abs(value) <= 1000))) &&
    (data.restitution == null ||
      (Number.isFinite(data.restitution) &&
        data.restitution >= 0 &&
        data.restitution <= 1)) &&
    (data.emitsLight == null || typeof data.emitsLight === 'boolean') &&
    (data.emissionColor == null ||
      /^#[0-9a-f]{6}$/i.test(data.emissionColor)) &&
    (data.emissionPower == null ||
      (Number.isFinite(data.emissionPower) &&
        data.emissionPower >= 0 &&
        data.emissionPower <= 100)) &&
    (data.edgeRadii == null ||
      (numericTuple(data.edgeRadii) &&
        data.edgeRadii.every((value) => value >= 0 && value <= 0.5))) &&
    (data.physicsAcceleration == null ||
      (numericTuple(data.physicsAcceleration) &&
        data.physicsAcceleration.every((value) => Math.abs(value) <= 1000))) &&
    (data.positionMode == null ||
      ['keys', 'physics'].includes(data.positionMode)) &&
    (data.physicsClip == null || validClipId(data.physicsClip)) &&
    (data.sceneClip == null || validClipId(data.sceneClip)) &&
    (data.speedProfile == null ||
      (numericTuple(data.speedProfile) &&
        data.speedProfile.every((value) => value >= 0 && value <= 200) &&
        data.speedProfile.some(Boolean))) &&
    (data.hidden == null || typeof data.hidden === 'boolean') &&
    [data.easeIn, data.easeOut].every(
      (value) =>
        value == null || (Number.isFinite(value) && value >= 0 && value <= 1)
    ) &&
    (data.acceleration == null ||
      (Number.isFinite(data.acceleration) &&
        Math.abs(data.acceleration) <= 1)) &&
    (data.rotationPath == null ||
      Object.hasOwn(rotationPaths, data.rotationPath)) &&
    (data.finish == null || ['color', 'tile'].includes(data.finish)) &&
    (data.tile == null || Object.hasOwn(tiles, data.tile)) &&
    (data.tileScale == null ||
      (Number.isFinite(data.tileScale) &&
        data.tileScale >= 0.001 &&
        data.tileScale <= 20)) &&
    (data.pivot == null ||
      (numericTuple(data.pivot) &&
        data.pivot.every((value) => [-1, 0, 1].includes(value)))) &&
    (data.offset == null || numericTuple(data.offset));
  const validPrimitive = (data) =>
    data &&
    (data.type === 'box' || data.type === 'sphere') &&
    /^#[0-9a-f]{6}$/i.test(data.color) &&
    levels.includes(data.detail) &&
    validSettings(data);
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
      !validSettings(data) ||
      !validKeys(data.keys) ||
      !Array.isArray(data.children) ||
      (data.tracks != null &&
        (typeof data.tracks !== 'object' ||
          Array.isArray(data.tracks) ||
          !Object.entries(data.tracks).every(
            ([id, keys]) => id !== 'main' && validClipId(id) && validKeys(keys)
          ))) ||
      (data.restPose != null && !validPose(data.restPose)) ||
      (data.type !== 'group' && data.children.length > 0) ||
      (data.type === 'light' &&
        (!/^#[0-9a-f]{6}$/i.test(data.color) ||
          !Number.isFinite(data.intensity) ||
          data.intensity < 0 ||
          data.intensity > 10000)) ||
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
        ? makeJoinedMesh(structuredClone(data.parts), data.name, data)
        : makeObject(data.type, data.name, data.color, data.detail, data);
    applyPose(object, data);
    object.userData.keys = structuredClone(data.keys);
    object.userData.tracks = structuredClone(data.tracks ?? {});
    const rest = data.restPose ?? object.userData.keys[0];
    if (rest) object.userData.restPose = structuredClone(rest);
    for (const child of data.children) object.add(decode(child));
    return object;
  }
  if (
    ![1, 2, 3, 4, projectVersion].includes(project?.version) ||
    !validFrame(project.duration) ||
    project.duration < 1 ||
    !Array.isArray(project.objects)
  ) {
    throw new Error('Geçersiz proje');
  }
  project.objects.forEach((object) => validate(object, 0));
  const animations = project.animations ?? {
    clips: [mainClip],
    active: 'main',
    enabled: ['main']
  };
  if (
    !Array.isArray(animations.clips) ||
    !animations.clips.every(
      (clip) =>
        validClipId(clip?.id) &&
        typeof clip.name === 'string' &&
        clip.name.trim()
    )
  ) {
    throw new Error('Geçersiz animasyon listesi');
  }
  const ids = new Set(animations.clips.map((clip) => clip.id));
  if (
    !ids.size ||
    ids.size !== animations.clips.length ||
    !ids.has(animations.active) ||
    !Array.isArray(animations.enabled) ||
    !animations.enabled.every((id) => ids.has(id))
  )
    throw new Error('Geçersiz animasyon listesi');
  const atmosphere = project.atmosphere ?? defaultAtmosphere;
  if (
    typeof atmosphere.enabled !== 'boolean' ||
    !/^#[0-9a-f]{6}$/i.test(atmosphere.color) ||
    !Number.isFinite(atmosphere.near) ||
    !Number.isFinite(atmosphere.far) ||
    atmosphere.near < 0 ||
    atmosphere.far <= atmosphere.near
  ) {
    throw new Error('Geçersiz sis ayarı');
  }
  return {
    duration: project.duration,
    animations: structuredClone(animations),
    atmosphere: { ...atmosphere },
    objects: project.objects.map(decode)
  };
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
    for (const key of posesOf(object))
      key.position = key.position.map(
        (value, index) => value - center.getComponent(index)
      );
    group.add(object);
  }
  fitPivot(group);
  return group;
}

export function dissolveGroup(group) {
  const parent = group.parent;
  const children = [...group.children];
  group.updateMatrix();
  const proxy = new Group();
  for (const child of children) {
    for (const key of posesOf(child)) {
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
