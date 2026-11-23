import {
  Box3, BufferGeometry, Color, DataTexture, DoubleSide, Float32BufferAttribute,
  LinearFilter, Mesh, MeshStandardMaterial, Raycaster, SRGBColorSpace, Vector3
} from 'three';
import { applyTile } from './tiles.js';

export const boneDefaults = { skin: false, finish: 'blend', color: '#b8a8f3', tile: 'checker', ratio: 100, tileScale: 1 };

export function rigLinks(root) {
  const joints = new Map();
  root.traverse(object => {
    if (object.userData.skeletonJoint) joints.set(object.userData.objectId, object);
  });
  const links = [];
  for (const source of joints.values()) {
    for (const bone of source.userData.bones) {
      const target = joints.get(bone.target);
      if (target && target !== source) links.push({ source, target, bone });
    }
  }
  return { joints: [...joints.values()], links };
}

export function rigActive(object) {
  for (let node = object; node; node = node.parent)
    if (node.clipActive === false) return false;
  return true;
}

export function skinMeshes(object) {
  const meshes = [];
  object.traverseVisible(child => {
    if (child.isMesh && !child.userData.negative) meshes.push(child);
  });
  return meshes;
}

const sides = 24;
const rows = 8;
const tolerance = 1e-5;
const ray = new Raycaster();

function ringFor(meshes, pivot, facing, radial, ratio) {
  const bounds = new Box3();
  for (const mesh of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  if (bounds.isEmpty()) return null;
  const span = bounds.getSize(new Vector3()).length();
  const planar = bounds.getCenter(new Vector3()).sub(pivot);
  planar.addScaledVector(facing, -planar.dot(facing)).add(pivot);
  const origin = planar.clone().addScaledVector(facing, span * 2 + planar.distanceTo(pivot));
  function sample(direction, dist) {
    ray.set(origin.clone().addScaledVector(direction, dist), facing.clone().negate());
    return ray.intersectObjects(meshes, false)[0];
  }
  let center = sample(radial[0], 0);
  if (!center) {
    for (const fraction of [.12, .25, .38, .5]) {
      for (const direction of radial) {
        center = sample(direction, span * fraction);
        if (!center) continue;
        origin.addScaledVector(direction, span * fraction);
        break;
      }
      if (center) break;
    }
  }
  if (!center) return null;
  const ring = radial.map(direction => {
    let far = 0;
    let near = span;
    for (let i = 0; i < 7; i++) {
      const middle = (near + far) / 2;
      if (sample(direction, middle)) far = middle;
      else near = middle;
    }
    return sample(direction, far * ratio)?.point ?? center.point;
  });
  const { material } = center.object;
  return { ring, material: Array.isArray(material) ? material[center.face.materialIndex] : material };
}

export function boneSurface(source, target, ratio, endpoints = [skinMeshes(source), skinMeshes(target)]) {
  const [left, right] = endpoints;
  if (!left.length || !right.length) return null;
  const a = source.getWorldPosition(new Vector3());
  const b = target.getWorldPosition(new Vector3());
  const axis = b.clone().sub(a);
  if (axis.lengthSq() < tolerance ** 2) return null;
  axis.normalize();
  const major = new Vector3(0, 1, 0);
  if (Math.abs(major.dot(axis)) > 0.95) major.set(1, 0, 0);
  major.cross(axis).normalize();
  const minor = axis.clone().cross(major);
  const radial = Array.from({ length: sides }, (_, index) => {
    const angle = index / sides * Math.PI * 2;
    return major.clone().multiplyScalar(Math.cos(angle)).addScaledVector(minor, Math.sin(angle));
  });
  const start = ringFor(left, a, axis, radial, ratio / 100);
  const end = ringFor(right, b, axis.clone().negate(), radial, ratio / 100);
  if (!start || !end) return null;
  const openings = start.ring.map((point, i) => end.ring[i].clone().sub(point).dot(axis) > tolerance);
  const position = [], uv = [], indices = [];
  const rowSize = sides + 1;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    for (let i = 0; i <= sides; i++) {
      const angle = i % sides;
      position.push(...start.ring[angle].clone().lerp(end.ring[angle], t));
      uv.push(i / sides, t);
      if (row === rows || i === sides || !openings[angle] || !openings[(angle + 1) % sides]) continue;
      const first = row * rowSize + i;
      indices.push(first, first + 1, first + rowSize, first + 1, first + rowSize + 1, first + rowSize);
    }
  }
  if (!indices.length) return null;
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(position, 3))
    .setAttribute('uv', new Float32BufferAttribute(uv, 2))
    .setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, materials: [start.material, end.material], length: a.distanceTo(b) };
}

const rgb = new Color();
function pixel(material, u, v, length, axis) {
  const map = material?.map;
  const tint = material?.userData.tileMapping;
  rgb.copy((tint?.useDefault.value ? tint.tint.value : material?.color) ?? new Color(1, 1, 1));
  const { data, width, height } = map?.image ?? {};
  if (data && width && height) {
    const scale = material.userData.tileSize?.value || 1;
    const wrap = value => value - Math.floor(value);
    const x = Math.floor(wrap(u * (tint && !tint.fit.value ? length / scale : 1)) * width);
    const y = Math.floor(wrap((v - axis) * (tint && !tint.fit.value ? length / scale : 1)) * height);
    const offset = (y * width + x) * 4;
    const sample = new Color(data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255);
    rgb.multiply(map.colorSpace === SRGBColorSpace ? sample.convertSRGBToLinear() : sample);
  }
  return rgb.clone();
}

export function boneMaterial(bone, { materials, length }) {
  const [a, b] = materials;
  const material = new MeshStandardMaterial({ color: bone.color, side: DoubleSide, roughness: 0.7 });
  if (bone.finish === 'tile') {
    applyTile(material, { ...bone, tileColorMode: 'default' });
  } else if (bone.finish === 'blend') {
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      const v = y / (size - 1);
      const blend = v * v * (3 - 2 * v);
      for (let x = 0; x < size; x++) {
        const u = x / (size - 1);
        const color = pixel(a, u, v, length, 0).lerp(pixel(b, u, v, length, 1), blend).convertLinearToSRGB();
        const opacity = (a?.opacity ?? 1) * (1 - blend) + (b?.opacity ?? 1) * blend;
        pixels.set([color.r * 255, color.g * 255, color.b * 255, opacity * 255], 4 * (y * size + x));
      }
    }
    material.color.set('#ffffff');
    material.map = new DataTexture(pixels, size, size);
    material.map.colorSpace = SRGBColorSpace;
    material.map.magFilter = material.map.minFilter = LinearFilter;
    material.map.needsUpdate = true;
    material.transparent = (a?.opacity ?? 1) < 1 || (b?.opacity ?? 1) < 1;
  }
  return material;
}

export function makeBoneMesh(bone, surface) {
  const mesh = new Mesh(surface.geometry, boneMaterial(bone, surface));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
