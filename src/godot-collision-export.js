import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { solidInHierarchy } from './hierarchy.js';

const suffixes = { static: 'colonly', convex: 'convcolonly' };
const manualSuffix = /(?:[-_$](?:convcolonly|colonly|convcol|col))+$/i;

export function collisionExportName(name) {
  return name.trimEnd().replace(manualSuffix, '').trimEnd() || 'Nesne';
}

function collisionGeometry(source, matrix, origin) {
  const attribute = source.attributes.position;
  const end = Math.min(source.index?.count ?? attribute.count, source.drawRange.start + source.drawRange.count);
  const vertices = new Map();
  const point = new Vector3();
  const positions = [], indices = [];
  for (let index = source.drawRange.start; index < end; index++) {
    const vertex = source.index?.getX(index) ?? index;
    if (!vertices.has(vertex)) {
      vertices.set(vertex, positions.length / 3);
      positions.push(...point.fromBufferAttribute(attribute, vertex).applyMatrix4(matrix).sub(origin));
    }
    indices.push(vertices.get(vertex));
  }
  if (indices.length < 3) return null;
  if (matrix.determinant() < 0) {
    for (let i = 0; i + 2 < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createCollisionExport(mode, cuts) {
  if (!Object.hasOwn(suffixes, mode)) return null;
  const group = new Group();
  group.name = 'Rendercard_Collisions';
  let material;
  return {
    group,
    add(object) {
      if (!object.isMesh || object.userData.negative || !solidInHierarchy(object)) return;
      const origin = new Vector3().setFromMatrixPosition(object.matrixWorld);
      const geometry = collisionGeometry(cuts.get(object) ?? object.geometry, object.matrixWorld, origin);
      if (!geometry) return;
      material ??= new MeshBasicMaterial({ color: 0x777777 });
      const mesh = new Mesh(geometry, material);
      mesh.name = collisionExportName(object.name) + '_Collision_' + (group.children.length + 1) + '-' + suffixes[mode];
      mesh.position.copy(origin);
      group.add(mesh);
    }
  };
}
