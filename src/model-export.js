import {
  AnimationClip, BufferGeometry, Float32BufferAttribute, Group, Mesh, Scene, Vector3,
  QuaternionKeyframeTrack, VectorKeyframeTrack
} from 'three';
import { sceneCuts } from './boolean-cuts.js';
import { collisionExportName, createCollisionExport } from './godot-collision-export.js';

function materialsFor(object) {
  const source = Array.isArray(object.material) ? object.material : [object.material];
  let opacity = 1;
  for (let node = object; node; node = node.parent) opacity *= (node.userData.opacity ?? 100) / 100;
  return source.map((material, index) => {
    const result = material.clone();
    result.userData = {};
    result.opacity = opacity * ((object.userData.parts?.[index]?.opacity ?? 100) / 100);
    result.visible = result.opacity > 0;
    result.transparent = material.transparent || result.opacity < 1;
    result.wireframe = false;
    if (material.map) {
      const tint = material.userData.tileMapping;
      if (tint?.useDefault.value) result.color.copy(tint.tint.value);
      result.map = material.map.clone();
      result.map.repeat.set(1, 1);
    }
    return result;
  });
}

function exportGeometry(object, source, materials) {
  const slots = Array.isArray(object.material) ? object.material : [object.material];
  const geometry = new BufferGeometry();
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const vertices = new Map();
  const points = [new Vector3(), new Vector3(), new Vector3()];
  const normal = new Vector3();
  const side = new Vector3();
  const uvPoint = new Vector3();
  const size = new Vector3();
  const { position, normal: sourceNormal, uv } = source.attributes;
  const count = source.index?.count ?? position.count;
  const start = source.drawRange.start;
  const end = Math.min(count, start + source.drawRange.count);
  const groups = slots.length === 1 ? [{ start, count: end - start, materialIndex: 0 }] : source.groups;
  if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
  const bounds = object.geometry.boundingBox;
  const scale = new Vector3(...[0, 1, 2].map(axis => new Vector3().setFromMatrixColumn(object.matrixWorld, axis).length()));
  bounds.getSize(size).max(new Vector3(.000001, .000001, .000001));

  for (const group of groups) {
    const slot = group.materialIndex;
    if (materials[slot].opacity <= 0) continue;
    const groupStart = indices.length;
    const tile = slots[slot].map && slots[slot].userData.tileMapping;
    const tileSide = slots[slot].userData.tileSize?.value ?? 1;
    for (let i = Math.max(start, group.start); i + 2 < Math.min(end, group.start + group.count); i += 3) {
      const ids = points.map((point, offset) => {
        const index = source.index?.getX(i + offset) ?? i + offset;
        point.fromBufferAttribute(position, index);
        return index;
      });
      let axis = -1;
      if (tile) {
        normal.subVectors(points[1], points[0]).cross(side.subVectors(points[2], points[0]));
        const magnitudes = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
        axis = magnitudes.indexOf(Math.max(...magnitudes));
      }
      for (const [offset, id] of ids.entries()) {
        const key = id + ':' + (tile ? slot : -1) + ':' + axis;
        if (!vertices.has(key)) {
          vertices.set(key, positions.length / 3);
          const point = points[offset];
          positions.push(...point);
          normals.push(sourceNormal.getX(id), sourceNormal.getY(id), sourceNormal.getZ(id));
          if (tile) {
            uvPoint.copy(point);
            if (tile.fit.value) uvPoint.sub(bounds.min).divide(size);
            else uvPoint.multiply(scale).divideScalar(tileSide);
            if (axis === 0) uvs.push(uvPoint.z, uvPoint.y);
            else if (axis === 1) uvs.push(uvPoint.x, uvPoint.z);
            else uvs.push(uvPoint.x, uvPoint.y);
          } else uvs.push(uv?.getX(id) ?? 0, uv?.getY(id) ?? 0);
        }
        indices.push(vertices.get(key));
      }
    }
    if (indices.length > groupStart) geometry.addGroup(groupStart, indices.length - groupStart, slot);
  }
  return geometry
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new Float32BufferAttribute(normals, 3))
    .setAttribute('uv', new Float32BufferAttribute(uvs, 2))
    .setIndex(indices);
}

export function snapshotModel(root, selection, aspect, collisionMode = 'none') {
  const scene = new Scene();
  const included = new Set();
  const ancestors = new Set();
  const pairs = new Map();
  let meshes = 0;
  for (const item of selection) {
    item.traverse(object => included.add(object));
    for (let node = item.parent; node && node !== root; node = node.parent) ancestors.add(node);
  }
  root.updateWorldMatrix(true, true);
  const collision = collisionMode === 'none' ? null :
    createCollisionExport(collisionMode, sceneCuts(root, undefined, false).cuts);
  const { cuts, cutters } = sceneCuts(root);
  function build(object, parent) {
    if ((!included.has(object) && !ancestors.has(object)) || object.clipActive === false) return;
    let copy;
    if (included.has(object)) {
      collision?.add(object);
      if (object.isMesh && !cutters.has(object)) {
        const materials = materialsFor(object);
        const geometry = exportGeometry(object, cuts.get(object) ?? object.geometry, materials);
        if (geometry.index.count) {
          copy = new Mesh(geometry, materials.length === 1 ? materials[0] : materials);
          meshes++;
        } else {
          geometry.dispose();
          for (const material of materials) {
            material.map?.dispose();
            material.dispose();
          }
        }
      } else if (object.isLight || object.isCamera) {
        copy = object.clone(false);
        copy.userData = {};
        if (copy.isPerspectiveCamera) {
          copy.aspect = aspect;
          copy.updateProjectionMatrix();
        }
      }
    }
    if (!copy && (object.isGroup || object.children.length || ancestors.has(object))) copy = new Group();
    if (!copy) return;
    copy.name = collision ? collisionExportName(object.name) : object.name;
    copy.position.copy(object.position);
    copy.quaternion.copy(object.quaternion);
    copy.scale.copy(object.scale);
    parent.add(copy);
    pairs.set(object, copy);
    object.children.forEach(child => build(child, copy));
  }
  root.children.forEach(object => build(object, scene));
  if (collision?.group.children.length) scene.add(collision.group);
  return { scene, pairs, meshes };
}

export function sampleTracks(pairs, fps) {
  const times = [];
  const tracks = [...pairs].map(([source, node]) => ({
    source, node, position: [], quaternion: [], scale: []
  }));
  return {
    add(frame) {
      times.push(frame / fps);
      for (const item of tracks) {
        const { source, position, quaternion, scale } = item;
        position.push(...source.position);
        scale.push(...source.scale);
        const q = source.quaternion;
        const last = quaternion.length - 4;
        const sign = last >= 0 && quaternion[last] * q.x + quaternion[last + 1] * q.y +
          quaternion[last + 2] * q.z + quaternion[last + 3] * q.w < 0 ? -1 : 1;
        quaternion.push(...q.toArray().map(value => value * sign));
      }
    },
    clip(name) {
      const channels = tracks.flatMap(item => ['position', 'quaternion', 'scale'].flatMap(property => {
        const values = item[property];
        const reference = item.node[property].toArray();
        if (!values.some((value, index) => Math.abs(value - reference[index % reference.length]) > 1e-7)) return [];
        const Track = property === 'quaternion' ? QuaternionKeyframeTrack : VectorKeyframeTrack;
        return [new Track(item.node.uuid + '.' + property, times, values).optimize()];
      }));
      return channels.length ? new AnimationClip(name, times.at(-1), channels) : null;
    }
  };
}

export function disposeModel(scene) {
  const disposed = new Set();
  scene.traverse(object => {
    if (object.isLight) object.dispose();
    if (!object.isMesh) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (disposed.has(material)) continue;
      disposed.add(material);
      material.map?.dispose();
      material.dispose();
    }
  });
}

export async function writeModel(scene, format, animations) {
  let data;
  if (format === 'obj') {
    const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
    scene.updateMatrixWorld(true);
    data = new OBJExporter().parse(scene);
  } else if (format === 'stl') {
    const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
    scene.updateMatrixWorld(true);
    data = new STLExporter().parse(scene, { binary: true });
  } else {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    data = await new GLTFExporter().parseAsync(scene, { binary: format === 'glb', animations, trs: true });
    if (format === 'gltf') data = JSON.stringify(data, null, 2);
  }
  const types = { obj: 'text/plain', stl: 'model/stl', gltf: 'model/gltf+json', glb: 'model/gltf-binary' };
  return new Blob([data], { type: types[format] });
}
