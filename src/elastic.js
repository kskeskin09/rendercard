import { Box3, Matrix4, Vector3 } from 'three';

const axes = ['x', 'y', 'z'];
const margin = 1e-5;

export function elasticFits(host, intruder, offset) {
  if (!host.isMesh || !host.userData.solid || !host.userData.elastic ||
      !intruder.isMesh || host.userData.negative || intruder.userData.negative) return false;
  if (!host.geometry.boundingBox) host.geometry.computeBoundingBox();
  if (!intruder.geometry.boundingBox) intruder.geometry.computeBoundingBox();
  const relative = new Matrix4().copy(intruder.matrixWorld);
  if (offset) relative.setPosition(new Vector3().setFromMatrixPosition(relative).add(offset));
  relative.premultiply(new Matrix4().copy(host.matrixWorld).invert());
  const outer = host.geometry.boundingBox;
  const inner = new Box3().copy(intruder.geometry.boundingBox).applyMatrix4(relative);
  return axes.some(axis => axes.every(side => side === axis || (
    inner.max[side] - inner.min[side] < outer.max[side] - outer.min[side] - margin &&
    inner.min[side] >= outer.min[side] - margin && inner.max[side] <= outer.max[side] + margin
  )));
}
