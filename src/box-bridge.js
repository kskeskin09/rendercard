import { BufferGeometry, Float32BufferAttribute, Matrix3, Matrix4, Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

const epsilon = 1e-6;

export function isBoxEnd(meshes) {
  return meshes.length === 1 && (meshes[0].rigBoxGeometry ?? meshes[0].geometry).type === 'BoxGeometry';
}

function endFace(box, axis, side, ratio) {
  const { mesh, bounds, normalMatrix } = box;
  const center = bounds.getCenter(new Vector3());
  const half = bounds.getSize(new Vector3()).multiplyScalar(0.5);
  const across = [0, 1, 2].filter(index => index !== axis);
  center.setComponent(axis, center.getComponent(axis) + side * half.getComponent(axis));
  const corners = [-1, 1].flatMap(u => [-1, 1].map(v => {
    const point = center.clone();
    for (const [index, sign] of [[across[0], u], [across[1], v]])
      point.setComponent(index, point.getComponent(index) + half.getComponent(index) * ratio * sign);
    return point.applyMatrix4(mesh.matrixWorld);
  }));
  const material = Array.isArray(mesh.material) ? mesh.material[axis * 2 + Number(side < 0)] : mesh.material;
  return { corners, material, center: center.applyMatrix4(mesh.matrixWorld),
    normal: new Vector3().setComponent(axis, side).applyNormalMatrix(normalMatrix) };
}

function infoFor(mesh) {
  const geometry = mesh.rigBoxGeometry ?? mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  return { mesh, bounds, center: bounds.getCenter(new Vector3()).applyMatrix4(mesh.matrixWorld),
    inverse: new Matrix4().copy(mesh.matrixWorld).invert(),
    normalMatrix: new Matrix3().getNormalMatrix(mesh.matrixWorld) };
}

function insideBox(outer, inner) {
  const { min, max } = inner.bounds;
  const transform = new Matrix4().multiplyMatrices(outer.inverse, inner.mesh.matrixWorld);
  const bounds = outer.bounds.clone().expandByScalar(epsilon);
  return [min.x, max.x].every(x => [min.y, max.y].every(y => [min.z, max.z].every(z =>
    bounds.containsPoint(new Vector3(x, y, z).applyMatrix4(transform)))));
}

function outsideBox(polygon, { bounds, inverse }) {
  const outer = [];
  let inside = polygon;
  for (const axis of [0, 1, 2]) {
    for (const sign of [-1, 1]) {
      const limit = (sign > 0 ? bounds.max : bounds.min).getComponent(axis);
      const next = [], outside = [];
      const distance = vertex => {
        const margin = sign * (vertex.point.clone().applyMatrix4(inverse).getComponent(axis) - limit);
        return Math.abs(margin) <= epsilon ? 0 : margin;
      };
      let a = inside.at(-1);
      let d = distance(a);
      for (const b of inside) {
        const n = distance(b);
        if ((d > 0) !== (n > 0)) {
          const t = d / (d - n);
          const edge = { point: a.point.clone().lerp(b.point, t), v: a.v + (b.v - a.v) * t };
          outside.push(edge);
          next.push(edge);
        }
        (n > 0 ? outside : next).push(b);
        a = b;
        d = n;
      }
      if (outside.length >= 3) outer.push(outside);
      if (next.length < 3) return outer;
      inside = next;
    }
  }
  return outer;
}

function bridgeFaces(start, end, left, right, axis, length) {
  if (!end.corners.some(point => point.clone().sub(start.center).dot(start.normal) > epsilon) ||
      !start.corners.some(point => point.clone().sub(end.center).dot(end.normal) > epsilon)) return null;
  const points = [...start.corners, ...end.corners];
  const plane = new Vector3().subVectors(start.corners[1], points[0])
    .cross(new Vector3().subVectors(start.corners[2], points[0])).normalize();
  if (end.corners.every(point => Math.abs(plane.dot(point.clone().sub(points[0]))) <= epsilon)) return null;

  const hull = new ConvexHull().setFromPoints(points);
  const first = new Set(start.corners);
  const major = new Vector3(0, 1, 0);
  if (Math.abs(major.dot(axis)) > 0.95) major.set(1, 0, 0);
  major.cross(axis).normalize();
  const minor = axis.clone().cross(major);
  const position = [], uv = [];
  for (const face of hull.faces) {
    const vertices = [face.edge.head().point, face.edge.next.head().point, face.edge.prev.head().point]
      .map(point => ({ point, v: Number(!first.has(point)) }));
    if (vertices.every(({ v }) => v === vertices[0].v)) continue;
    const exposed = outsideBox(vertices, left).flatMap(polygon => outsideBox(polygon, right));
    for (const polygon of exposed) {
      for (let i = 1; i + 1 < polygon.length; i++) {
        const triangle = [polygon[0], polygon[i], polygon[i + 1]];
        const normal = triangle[1].point.clone().sub(triangle[0].point)
          .cross(triangle[2].point.clone().sub(triangle[0].point));
        if (normal.lengthSq() < epsilon ** 4) continue;
        const coords = triangle.map(({ point, v }) => {
          const radial = point.clone().sub(start.center.clone().lerp(end.center, v));
          return [Math.atan2(radial.dot(minor), radial.dot(major)) / (2 * Math.PI) + .5, v];
        });
        const wrap = Math.max(...coords.map(pair => pair[0])) - Math.min(...coords.map(pair => pair[0])) > .5;
        for (const [index, { point }] of triangle.entries()) {
          const [u, v] = coords[index];
          position.push(...point);
          uv.push(wrap && u < .5 ? u + 1 : u, v);
        }
      }
    }
  }
  if (!position.length) return null;
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(position, 3))
    .setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return { geometry, materials: [start.material, end.material], length };
}

export function boxBridge(leftMesh, rightMesh, ratio) {
  const left = infoFor(leftMesh), right = infoFor(rightMesh);
  if (insideBox(left, right) || insideBox(right, left)) return null;
  const axis = right.center.clone().sub(left.center);
  const length = axis.length();
  if (length <= epsilon) return null;
  axis.divideScalar(length);
  const faces = (box, direction) => [0, 1, 2].flatMap(index => [-1, 1].map(side =>
    endFace(box, index, side, ratio / 100))).sort((a, b) => b.normal.dot(direction) - a.normal.dot(direction));
  const leftFaces = faces(left, axis);
  const rightFaces = faces(right, axis.clone().negate());
  const direct = bridgeFaces(leftFaces[0], rightFaces[0], left, right, axis, length);
  if (direct) return direct;

  // At a deep bend the facing caps can be buried. Try the closest exposed sides.
  const distance = (a, b) => Math.min(...a.corners.flatMap(leftPoint =>
    b.corners.map(rightPoint => leftPoint.distanceToSquared(rightPoint))));
  const pairs = leftFaces.flatMap((start, i) => rightFaces.map((end, j) =>
    ({ start, end, i, j, distance: distance(start, end) }))).sort((a, b) => a.distance - b.distance);
  for (const { start, end, i, j } of pairs) {
    if (i === 0 && j === 0) continue;
    const bridge = bridgeFaces(start, end, left, right, axis, length);
    if (bridge) return bridge;
  }
  return null;
}
