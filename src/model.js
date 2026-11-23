import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DataTexture,
  ClampToEdgeWrapping,
  MirroredRepeatWrapping,
  RepeatWrapping,
  LinearFilter,
  SRGBColorSpace,
  DoubleSide,
  FrontSide,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  PerspectiveCamera,
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
import { roundedPolygon } from './rounded-polygon.js';
import { defaultRenderSize, validRenderSize } from './render-settings.js';
import { updateOpacity } from './opacity.js';
import { releaseCut, sceneCuts } from './boolean-cuts.js';
import { skyTiles } from './sky-texture.js';
import { defaultOrbit, orbitPlanes } from './orbit-motion.js';

export const defaultAtmosphere = {
  defaultLight: false,
  enabled: false,
  color: '#26322b',
  near: 5,
  far: 20,
  skyMode: 'auto',
  skyColor: '#26322b',
  skyTile: 'clearSky'
};

export const types = {
  box: 'Kutu',
  sphere: 'Küre',
  prism: 'Üçgen prizma',
  pyramid: 'Piramit',
  group: 'Grup',
  mesh: 'Ağ',
  light: 'Işık',
  camera: 'Kamera'
};
export const levels = [12, 24, 48];
export const projectVersion = 13;
export const shapeSides = [3, 4, 5, 6, 8, 16, 32, 64];
export const isPrimitive = type => ['box', 'sphere', 'prism', 'pyramid'].includes(type);
const channels = ['position', 'rotation', 'scale'];

const settingsDefaults = {
  radius: 0,
  segments: 4,
  solid: false,
  negative: false,
  sides: null,
  polygonRoundness: 0,
  reactsToGround: true,
  linkedSize: false,
  mergeMidpoint: false,
  cameraId: null,
  objectId: null,
  affectsSolids: true,
  followTarget: null,
  followOffset: null,
  opacity: 100,
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
  orbit: defaultOrbit,
  sceneClip: null,
  speedProfile: null,
  sizeSpeedProfile: null,
  rotationMode: 'keys',
  angularVelocity: [0, 0, 0],
  angularAcceleration: [0, 0, 0],
  angularRestitution: 0,
  angularSpeedProfile: null,
  angularClip: 'main',
  rotationPath: 'short',
  finish: 'color',
  tile: 'checker',
  tileScale: 1,
  tileFit: false,
  tileColorMode: 'default',
  surfaceColor: '#b8a8f3',
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
  const radii = settings.edgeRadii;
  const equalRadii = radii && radii.every((value) => value === radii[0]);
  const uniformRadius = equalRadii ? radii[0] : settings.radius;
  if (type === 'sphere') result = new SphereGeometry(0.5, detail, detail / 2);
  else if (type === 'prism' || type === 'pyramid' || (type === 'box' && (settings.sides ?? 4) !== 4)) {
    const sides = settings.sides ?? (type === 'prism' ? 3 : 4);
    const pointed = type === 'pyramid';
    const bevelSegments = Math.max(2, Math.min(6, settings.segments ?? settingsDefaults.segments));
    result = settings.polygonRoundness
      ? roundedPolygon(sides, pointed, settings.polygonRoundness, bevelSegments)
      : new CylinderGeometry(pointed ? 0 : 0.5, 0.5, 1, sides, 1, false, Math.PI / sides);
    result.computeBoundingBox();
    const size = result.boundingBox.getSize(new Vector3());
    result.center().scale(1 / size.x, 1 / size.y, 1 / size.z);
  }
  else if (uniformRadius === 0.5 && (equalRadii || !radii)) {
    const resolution = Math.max(24, settings.segments * 8);
    result = new SphereGeometry(0.5, resolution, resolution / 2);
  } else if (radii?.some(Boolean) && !equalRadii)
    result = roundedEdges(
      settings.edgeRadii.map((value) => Math.min(0.499, value)),
      settings.segments
    );
  else if (uniformRadius > 0) {
    const rounded = new RoundedBoxGeometry(
      1,
      1,
      1,
      settings.segments,
      uniformRadius
    );
    result = mergeVertices(rounded);
    rounded.dispose();
  } else result = new BoxGeometry(1, 1, 1);
  if (settings.offset) result.translate(...settings.offset);
  return result;
}

const wraps = { clamp: ClampToEdgeWrapping, repeat: RepeatWrapping, mirror: MirroredRepeatWrapping };

function applySurface(material, settings) {
  material.roughness = settings.roughness ?? .62;
  material.metalness = settings.metalness ?? .07;
  material.side = settings.doubleSided ? DoubleSide : FrontSide;
  material.alphaTest = settings.alphaTest ?? 0;
  applyTile(material, settings);
  if (!material.map && settings.texture) {
    const { data, width, height, flipY, wrapS, wrapT } = settings.texture;
    const pixels = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const texture = new DataTexture(pixels, width, height);
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = flipY;
    texture.wrapS = wraps[wrapS];
    texture.wrapT = wraps[wrapT];
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    material.map = texture;
    material.needsUpdate = true;
  }
}

function material(color, settings) {
  const result = new MeshStandardMaterial({
    color,
    roughness: 0.62,
    metalness: 0.07
  });
  applySurface(result, settings);
  return result;
}

export function materialsOf(object) {
  return Array.isArray(object.material) ? object.material : [object.material];
}

function partSurface(object, part) {
  const { finish, tile, tileScale, tileFit, tileColorMode, surfaceColor } = object.userData;
  return finish === 'parts' ? part : { ...part, finish, tile, tileScale, tileFit, tileColorMode,
    color: surfaceColor, texture: null, alphaTest: 0 };
}

export function updateMeshSurface(object) {
  const data = object.userData;
  for (const [index, surface] of object.material.entries()) {
    const settings = partSurface(object, data.parts[index]);
    surface.color.set(settings.color);
    applySurface(surface, settings);
  }
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
        : type === 'camera'
          ? new PerspectiveCamera(35, 1, 0.08, 160)
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
  object.userData.objectId ??= crypto.randomUUID();
  if (object.isCamera && !settings.cameraId)
    object.userData.cameraId = crypto.randomUUID();
  object.userData.tracks = {};
  if (object.isCamera && !object.userData.affectsSolids) object.userData.solid = false;
  object.visible = !settings.hidden;
  updateOpacity(object);
  return object;
}

export function partBuffer(part) {
  if (part.type !== 'baked') return geometry(part.type, part.detail, part);
  const buffer = new BufferGeometry();
  buffer.setAttribute('position', new Float32BufferAttribute(part.vertices, 3));
  buffer.setAttribute('normal', new Float32BufferAttribute(part.normals, 3));
  buffer.setAttribute('uv', new Float32BufferAttribute(part.uvs, 2));
  buffer.setIndex(part.indices);
  return buffer;
}

function bakedParts(object, buffer, matrix) {
  if (!buffer.drawRange.count) return [];
  const settings = Array.isArray(object.material) ? object.userData.parts : [object.userData];
  const surfaces = materialsOf(object);
  const groups = surfaces.length === 1 ? [{ start: 0, count: buffer.drawRange.count, materialIndex: 0 }] : buffer.groups;
  const parts = new Map();
  for (const { start, count, materialIndex } of groups) {
    const source = settings[materialIndex];
    const appearance = source === object.userData ? source : partSurface(object, source);
    let record = parts.get(materialIndex);
    if (!record) {
      record = {
        part: {
          ...settingsOf(appearance),
          texture: appearance.texture,
          roughness: appearance.roughness,
          metalness: appearance.metalness,
          doubleSided: appearance.doubleSided,
          alphaBlend: appearance.alphaBlend,
          alphaTest: appearance.alphaTest,
          type: 'baked',
          color: '#' + surfaces[materialIndex].color.getHexString(),
          matrix: matrix.toArray(),
          opacity: (source.opacity ?? 100) * (source === object.userData ? 1 : object.userData.opacity / 100),
          hidden: object.userData.hidden || source.hidden,
          vertices: [],
          normals: [],
          uvs: [],
          indices: []
        },
        mapped: new Map()
      };
      parts.set(materialIndex, record);
    }
    const { part, mapped } = record;
    for (let i = start; i < start + count; i++) {
      const index = buffer.index.getX(i);
      if (!mapped.has(index)) {
        mapped.set(index, part.vertices.length / 3);
        for (const [key, attribute] of [
          ['vertices', buffer.attributes.position], ['normals', buffer.attributes.normal], ['uvs', buffer.attributes.uv]
        ]) {
          const offset = index * attribute.itemSize;
          part[key].push(...attribute.array.subarray(offset, offset + attribute.itemSize));
        }
      }
      part.indices.push(mapped.get(index));
    }
  }
  return [...parts.values()].map(({ part }) => part);
}

function makeJoinedMesh(parts, name = 'Birleşik ağ', data) {
  const settings = settingsOf(data);
  settings.finish = data?.finish ?? 'parts';
  const matrix = new Matrix4();
  const geometries = parts.map((part) =>
    partBuffer(part).applyMatrix4(matrix.fromArray(part.matrix))
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
  mesh.userData.objectId ??= crypto.randomUUID();
  mesh.surfaceColor = new Color(settings.surfaceColor);
  if (settings.finish !== 'parts') updateMeshSurface(mesh);
  mesh.visible = !settings.hidden;
  updateOpacity(mesh);
  return mesh;
}

export function makeImportedMesh(parts, name) {
  const mesh = makeJoinedMesh(parts, name);
  fitPivot(mesh);
  return mesh;
}

export function joinMeshes(objects) {
  const parent = objects[0].parent;
  const center = centerOf(objects);
  const offset = new Matrix4().makeTranslation(-center.x, -center.y, -center.z);
  const mixed = objects.some(object => object.userData.negative) &&
    objects.some(object => !object.userData.negative);
  const { cuts } = mixed ? sceneCuts(parent, objects) : { cuts: new Map() };
  const parts = objects.flatMap((object) => {
    if (mixed && object.userData.negative) return [];
    object.updateMatrix();
    const matrix = new Matrix4().multiplyMatrices(offset, object.matrix);
    if (cuts.has(object)) return bakedParts(object, cuts.get(object), matrix);
    if (object.userData.type === 'mesh') {
      matrix.multiply(new Matrix4().makeTranslation(...object.userData.offset));
      return object.userData.parts.map((part) => ({
        ...partSurface(object, part),
        hidden: object.userData.hidden || part.hidden === true,
        opacity: ((part.opacity ?? 100) * object.userData.opacity) / 100,
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
  if (!parts.length) {
    objects.forEach(disposeObject);
    fitParentAfterJoin(parent);
    return null;
  }
  const hidden = parts.every((part) => part.hidden);
  if (hidden)
    parts.forEach((part) => {
      part.hidden = false;
    });
  const merged = makeJoinedMesh(parts, undefined, { hidden, mergeMidpoint: !mixed });
  merged.userData.solid = objects.some(object => (!mixed || !object.userData.negative) && object.userData.solid);
  merged.position.copy(center);
  objects.forEach(disposeObject);
  parent.add(merged);
  fitPivot(merged);
  fitParentAfterJoin(parent);
  return merged;
}

function fitParentAfterJoin(parent) {
  for (let node = parent; node?.userData.pivot; node = node.parent) fitPivot(node);
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
    releaseCut(child);
    child.geometry.dispose();
    materialsOf(child).forEach((material) => {
      material.map?.dispose();
      material.dispose();
    });
    child.customDepthMaterial?.dispose();
    child.customDistanceMaterial?.dispose();
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

export function writeKey(object, frame, clip = 'main', pose = capture(object)) {
  const keys = keysFor(object, clip, true);
  object.userData.restPose ??= capture(object);
  const previous = keys.findIndex((key) => key.frame === frame);
  const key = { ...pose, frame };
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
  const { easeIn, easeOut, acceleration, rotationPath, speedProfile, sizeSpeedProfile } =
    object.userData;
  const positionTime = speedProfile
    ? profileTime(clock, speedProfile)
    : easedTime(travelTime(clock, acceleration), easeIn, easeOut);
  const sizeTime = sizeSpeedProfile
    ? profileTime(clock, sizeSpeedProfile)
    : easedTime(clock, easeIn, easeOut);
  const interpolate = (channel, t) =>
    a[channel].map((value, axis) => MathUtils.lerp(value, b[channel][axis], t));
  object.position.fromArray(interpolate('position', positionTime));
  object.scale.fromArray(interpolate('scale', sizeTime));
  const angularTime = object.userData.angularSpeedProfile
    ? profileTime(clock, object.userData.angularSpeedProfile)
    : easedTime(clock, easeIn, easeOut);
  interpolateRotation(object, a.rotation, b.rotation, angularTime, rotationPath);
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

export function encodeProject(
  root,
  duration,
  animations,
  atmosphere,
  defaultView,
  name,
  renderSize
) {
  return {
    version: projectVersion,
    duration,
    animations,
    atmosphere,
    defaultView,
    name,
    renderSize,
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
  const validOrbit = value =>
    value && (value.target == null || (typeof value.target === 'string' && /^[a-z0-9-]{1,64}$/i.test(value.target))) &&
    validClipId(value.clip) &&
    Number.isFinite(value.period) && value.period >= .1 && value.period <= 3600 &&
    Object.hasOwn(orbitPlanes, value.plane) && [-1, 1].includes(value.direction) &&
    ['fixed', 'ellipse'].includes(value.mode) &&
    Number.isFinite(value.near) && Number.isFinite(value.far) &&
    value.near >= .01 && value.far >= value.near && value.far <= 1000 &&
    Number.isFinite(value.phase) && Math.abs(value.phase) <= 360 &&
    numericTuple(value.speed) && value.speed.every(speed => speed >= 0 && speed <= 200) && value.speed.some(Boolean);
  const validSettings = (data) =>
    (data.rotationMode == null || ['keys', 'physics'].includes(data.rotationMode)) &&
    [data.angularVelocity, data.angularAcceleration].every(tuple => tuple == null || (numericTuple(tuple) && tuple.every(value => Math.abs(value) <= 3600))) &&
    (data.angularRestitution == null || (Number.isFinite(data.angularRestitution) && data.angularRestitution >= 0 && data.angularRestitution <= 1)) &&
    (data.angularSpeedProfile == null || (numericTuple(data.angularSpeedProfile) && data.angularSpeedProfile.every(value => value >= 0 && value <= 200) && data.angularSpeedProfile.some(Boolean))) &&
    (data.surfaceColor == null || /^#[0-9a-f]{6}$/i.test(data.surfaceColor)) &&
    (data.negative == null || typeof data.negative === 'boolean') &&
    (data.mergeMidpoint == null || typeof data.mergeMidpoint === 'boolean') &&
    (data.polygonRoundness == null || (Number.isFinite(data.polygonRoundness) && data.polygonRoundness >= 0 && data.polygonRoundness <= 0.5)) &&
    (data.sides == null || shapeSides.includes(data.sides)) &&
    (data.tileFit == null || typeof data.tileFit === 'boolean') &&
    (data.tileColorMode == null || ['default', 'custom'].includes(data.tileColorMode)) &&
    (data.radius == null ||
      (Number.isFinite(data.radius) &&
        data.radius >= 0 &&
        data.radius <= 0.5)) &&
    (data.segments == null ||
      (Number.isInteger(data.segments) &&
        data.segments >= 1 &&
        data.segments <= 12)) &&
    (data.solid == null || typeof data.solid === 'boolean') &&
    (data.reactsToGround == null || typeof data.reactsToGround === 'boolean') &&
    (data.linkedSize == null || typeof data.linkedSize === 'boolean') &&
    (data.affectsSolids == null || typeof data.affectsSolids === 'boolean') &&
    (data.opacity == null || (Number.isFinite(data.opacity) && data.opacity >= 0 && data.opacity <= 100)) &&
    (data.followOffset == null || numericTuple(data.followOffset)) &&
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
      ['keys', 'physics', 'orbit'].includes(data.positionMode)) &&
    (data.orbit == null || validOrbit(data.orbit)) &&
    (data.physicsClip == null || validClipId(data.physicsClip)) &&
    (data.angularClip == null || validClipId(data.angularClip)) &&
    (data.sceneClip == null || validClipId(data.sceneClip)) &&
    [data.speedProfile, data.sizeSpeedProfile].every(profile =>
      profile == null || (numericTuple(profile) &&
        profile.every(value => value >= 0 && value <= 200) && profile.some(Boolean))) &&
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
    (data.finish == null || ['parts', 'color', 'tile'].includes(data.finish)) &&
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
    isPrimitive(data.type) &&
    /^#[0-9a-f]{6}$/i.test(data.color) &&
    levels.includes(data.detail) &&
    validSettings(data);
  const validTexture = texture => texture == null || (
    Number.isInteger(texture.width) && texture.width >= 1 && texture.width <= 1024 &&
    Number.isInteger(texture.height) && texture.height >= 1 && texture.height <= 1024 &&
    typeof texture.flipY === 'boolean' &&
    Object.hasOwn(wraps, texture.wrapS) && Object.hasOwn(wraps, texture.wrapT) &&
    typeof texture.data === 'string' &&
    texture.data.length === Math.ceil(texture.width * texture.height * 4 / 3) * 4 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(texture.data));
  const validBaked = part =>
    part?.type === 'baked' &&
    /^#[0-9a-f]{6}$/i.test(part.color) &&
    validSettings(part) &&
    validTexture(part.texture) &&
    [part.roughness, part.metalness, part.alphaTest].every(value => value == null || (Number.isFinite(value) && value >= 0 && value <= 1)) &&
    (part.alphaBlend == null || typeof part.alphaBlend === 'boolean') &&
    (part.doubleSided == null || typeof part.doubleSided === 'boolean') &&
    Array.isArray(part.vertices) && part.vertices.length >= 9 &&
    part.vertices.length % 3 === 0 && part.vertices.every(Number.isFinite) &&
    Array.isArray(part.normals) && part.normals.length === part.vertices.length &&
    part.normals.every(Number.isFinite) &&
    Array.isArray(part.uvs) && part.uvs.length === part.vertices.length / 3 * 2 &&
    part.uvs.every(Number.isFinite) &&
    Array.isArray(part.indices) && part.indices.length >= 3 && part.indices.length % 3 === 0 &&
    part.indices.every(index => Number.isInteger(index) && index >= 0 && index < part.vertices.length / 3);
  const validPart = (part) =>
    (validPrimitive(part) || validBaked(part)) &&
    Array.isArray(part.matrix) &&
    part.matrix.length === 16 &&
    part.matrix.every(Number.isFinite);
  const cameraIds = new Set();
  const objectIds = new Set();
  const validObjectId = id => typeof id === 'string' && /^[a-z0-9-]{1,64}$/i.test(id);
  function validate(data, depth) {
    if (
      !data ||
      depth > 30 ||
      !Object.hasOwn(types, data.type) ||
      typeof data.name !== 'string' ||
      !validPose(data) ||
      !validSettings(data) ||
      (data.objectId != null && (!validObjectId(data.objectId) || objectIds.has(data.objectId))) ||
      (data.followTarget != null && !validObjectId(data.followTarget)) ||
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
      (data.type === 'camera' &&
        (typeof data.cameraId !== 'string' ||
          !/^[a-z0-9-]{1,64}$/i.test(data.cameraId) ||
          cameraIds.has(data.cameraId))) ||
      (data.type === 'light' &&
        (!/^#[0-9a-f]{6}$/i.test(data.color) ||
          !Number.isFinite(data.intensity) ||
          data.intensity < 0 ||
          data.intensity > 10000)) ||
      (data.type === 'mesh' &&
        (!Array.isArray(data.parts) ||
          data.parts.length < 1 ||
          !data.parts.every(validPart))) ||
      (isPrimitive(data.type) && !validPrimitive(data))
    ) {
      throw new Error('Geçersiz nesne');
    }
    if (data.type === 'camera') cameraIds.add(data.cameraId);
    if (data.objectId != null) objectIds.add(data.objectId);
    data.children.forEach((child) => validate(child, depth + 1));
  }
  function decode(data) {
    const migratedTile = source =>
      project.version < 7 && source.finish === 'tile' && source.tileColorMode == null
        ? { ...source, tileColorMode: 'custom' }
        : source;
    const settings = { ...migratedTile(data) };
    if (project.version < 12) settings.sizeSpeedProfile = data.speedProfile;
    if (project.version < 8) {
      if (data.type === 'mesh') settings.finish = 'parts';
      settings.angularSpeedProfile = data.speedProfile;
    }
    const object =
      data.type === 'mesh'
        ? makeJoinedMesh(structuredClone(data.parts.map(migratedTile)), data.name, settings)
        : makeObject(data.type, data.name, data.color, data.detail, settings);
    applyPose(object, data);
    object.userData.keys = structuredClone(data.keys);
    object.userData.tracks = structuredClone(data.tracks ?? {});
    const rest = data.restPose ?? object.userData.keys[0];
    if (rest) object.userData.restPose = structuredClone(rest);
    for (const child of data.children) object.add(decode(child));
    return object;
  }
  if (
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, projectVersion].includes(project?.version) ||
    (project.renderSize != null && !validRenderSize(project.renderSize)) ||
    (project.name != null && (typeof project.name !== 'string' || project.name.length > 80 || !project.name.trim())) ||
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
  if (
    animations.cameraTracks != null &&
    (typeof animations.cameraTracks !== 'object' ||
      Array.isArray(animations.cameraTracks) ||
      !Object.entries(animations.cameraTracks).every(
        ([id, track]) =>
          ids.has(id) &&
          Array.isArray(track) &&
          track.every(
            (key, index) =>
              key &&
              validFrame(key.frame) &&
              (index === 0 || track[index - 1].frame < key.frame) &&
              (key.camera === null || cameraIds.has(key.camera))
          )
      ))
  )
    throw new Error('Geçersiz kamera kareleri');
  const atmosphere = { ...defaultAtmosphere, ...project.atmosphere };
  if (
    typeof atmosphere.enabled !== 'boolean' ||
    typeof atmosphere.defaultLight !== 'boolean' ||
    !/^#[0-9a-f]{6}$/i.test(atmosphere.color) ||
    !Number.isFinite(atmosphere.near) ||
    !Number.isFinite(atmosphere.far) ||
    atmosphere.near < 0 ||
    atmosphere.far <= atmosphere.near ||
    !['auto', 'color', 'tile'].includes(atmosphere.skyMode) ||
    !/^#[0-9a-f]{6}$/i.test(atmosphere.skyColor) ||
    !Object.hasOwn(skyTiles, atmosphere.skyTile)
  ) {
    throw new Error('Geçersiz sis ayarı');
  }
  const defaultView = project.defaultView;
  if (
    defaultView != null &&
    (!numericTuple(defaultView.position) || !numericTuple(defaultView.target))
  ) {
    throw new Error('Geçersiz varsayılan kamera');
  }
  return {
    duration: project.duration,
    name: project.name ?? 'Yeni sahne',
    animations: structuredClone(animations),
    atmosphere: { ...atmosphere },
    defaultView: defaultView && structuredClone(defaultView),
    renderSize: { ...(project.renderSize ?? defaultRenderSize) },
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
