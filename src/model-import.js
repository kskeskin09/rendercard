import { Color, LoadingManager, Vector2, MirroredRepeatWrapping, RepeatWrapping, DoubleSide } from 'three';
import { makeImportedMesh } from './model.js';

const wrapName = value => value === MirroredRepeatWrapping ? 'mirror' : value === RepeatWrapping ? 'repeat' : 'clamp';

function textureData(map, cache) {
  const image = map.image;
  if (!image?.width || !image.height) return null;
  let packed = cache.get(image);
  if (!packed) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let bytes = '';
    for (let offset = 0; offset < pixels.length; offset += 16384)
      bytes += String.fromCharCode(...pixels.subarray(offset, offset + 16384));
    packed = { width: canvas.width, height: canvas.height, data: btoa(bytes) };
    cache.set(image, packed);
  }
  return { ...packed, flipY: map.flipY, wrapS: wrapName(map.wrapS), wrapT: wrapName(map.wrapT) };
}

export function importMeshParts(scene) {
  scene.updateMatrixWorld(true);
  const parts = [];
  const cache = new WeakMap();
  const point = new Vector2();
  scene.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    if (!position) return;
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const normal = geometry.attributes.normal;
    const count = geometry.index?.count ?? position.count;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    const flip = mesh.matrixWorld.determinant() < 0;
    for (const group of groups) {
      const source = materials[group.materialIndex];
      if (!source?.visible) continue;
      const map = source.map;
      if (map?.matrixAutoUpdate) map.updateMatrix();
      const uv = geometry.attributes[map?.channel ? 'uv' + map.channel : 'uv'];
      const part = {
        type: 'baked', color: '#' + (source.color ?? new Color('#ffffff')).getHexString(),
        opacity: source.transparent ? source.opacity * 100 : 100,
        alphaBlend: source.transparent, alphaTest: source.alphaTest,
        roughness: source.roughness, metalness: source.metalness, doubleSided: source.side === DoubleSide,
        matrix: mesh.matrixWorld.toArray(), vertices: [], normals: [], uvs: [], indices: []
      };
      if (map && uv) part.texture = textureData(map, cache);
      const assigned = new Map();
      const start = Math.max(geometry.drawRange.start, group.start);
      const end = Math.min(count, group.start + group.count, geometry.drawRange.start + geometry.drawRange.count);
      for (let i = start; i + 2 < end; i += 3) {
        for (const offset of flip ? [0, 2, 1] : [0, 1, 2]) {
          const index = geometry.index?.getX(i + offset) ?? i + offset;
          if (!assigned.has(index)) {
            assigned.set(index, part.vertices.length / 3);
            part.vertices.push(position.getX(index), position.getY(index), position.getZ(index));
            part.normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
            point.set(uv?.getX(index) ?? 0, uv?.getY(index) ?? 0);
            if (part.texture) point.applyMatrix3(map.matrix);
            part.uvs.push(point.x, point.y);
          }
          part.indices.push(assigned.get(index));
        }
      }
      if (part.indices.length) parts.push(part);
    }
  });
  return parts;
}

export async function importModelFiles(files) {
  const model = files.find(file => /\.(glb|obj)$/i.test(file.name));
  if (!model) throw new Error('Bir GLB veya OBJ dosyası seç.');
  const manager = new LoadingManager();
  const resources = new Map();
  let missing = false;
  manager.setURLModifier(url => {
    if (/^(blob:|data:)/i.test(url)) return url;
    const name = decodeURIComponent(url.split(/[?#]/)[0].replaceAll('\\', '/').split('/').at(-1)).toLowerCase();
    const file = files.find(item => item.name.toLowerCase() === name);
    if (!file) {
      missing = true;
      return 'data:,';
    }
    if (!resources.has(file)) resources.set(file, URL.createObjectURL(file));
    return resources.get(file);
  });
  manager.onError = () => { missing = true; };
  let scene;
  try {
    if (/\.glb$/i.test(model.name)) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      scene = (await new GLTFLoader(manager).parseAsync(await model.arrayBuffer(), '')).scene;
    } else {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      const text = await model.text();
      const loader = new OBJLoader(manager);
      const library = text.match(/^\s*mtllib\s+([^\r\n]+)\s*$/m)?.[1].trim().split(/[\\/]/).at(-1);
      const file = files.find(item => item.name.toLowerCase() === library?.toLowerCase());
      if (library && !file) missing = true;
      if (file) {
        const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
        loader.setMaterials(new MTLLoader(manager).parse(await file.text(), ''));
      }
      const textures = new Promise(resolve => { manager.onLoad = resolve; });
      manager.itemStart('model');
      try { scene = loader.parse(text); }
      finally { manager.itemEnd('model'); }
      await textures;
    }
    const parts = importMeshParts(scene);
    if (!parts.length) throw new Error('Dosyada içe aktarılacak bir yüzey yok.');
    return { object: makeImportedMesh(parts, model.name.replace(/\.(glb|obj)$/i, '').slice(0, 80)), missing };
  } finally {
    scene?.traverse(object => {
      object.geometry?.dispose();
      if (!object.material) return;
      for (const material of [object.material].flat()) {
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
    for (const url of resources.values()) URL.revokeObjectURL(url);
  }
}
