import { ExtrudeGeometry, MathUtils, Shape } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const defaultTriangleAngles = [60, 60];
export const minimumTriangleAngle = 1;

export function remainingTriangleAngle([a, b]) {
  return 180 - (a + b);
}

export function validTriangleAngles(angles) {
  return Array.isArray(angles) && angles.length === 2 &&
    angles.every(angle => Number.isFinite(angle) && angle >= minimumTriangleAngle) &&
    remainingTriangleAngle(angles) >= minimumTriangleAngle;
}

export function triangleGeometry(angles) {
  const [a, b, c] = [...angles, remainingTriangleAngle(angles)].map(MathUtils.degToRad);
  const length = Math.sin(b) / Math.sin(c);
  const x = length * Math.cos(a);
  const y = length * Math.sin(a);
  const width = Math.max(1, x) - Math.min(0, x);
  const size = Math.max(width, y);
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(1 / size, 0);
  shape.lineTo(x / size, y / size);
  shape.closePath();
  const extrusion = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  extrusion.center();
  const geometry = mergeVertices(extrusion, 1e-6);
  extrusion.dispose();
  return geometry;
}
