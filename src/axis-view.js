import { MathUtils, OrthographicCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const axisLabels = { x: 'Sağ · X', y: 'Üst · Y', z: 'Ön · Z' };

export function changeAxisView(previous, axis, perspective, target, element, changed) {
  const center = previous?.controls.target.clone() ?? target.clone();
  const distance = perspective.position.distanceTo(target);
  const height = previous
    ? previous.height / previous.camera.zoom
    : 2 * Math.max(1, distance) * Math.tan(MathUtils.degToRad(perspective.fov / 2));
  previous?.controls.dispose();
  if (previous?.axis === axis) return undefined;
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 400);
  if (axis === 'y') camera.up.set(0, 0, -1);
  camera.position.copy(center);
  camera.position[axis] += 150;
  camera.lookAt(center);
  const controls = new OrbitControls(camera, element);
  controls.target.copy(center);
  controls.enableRotate = false;
  controls.enableDamping = true;
  controls.minZoom = .02;
  controls.maxZoom = 400;
  controls.update();
  controls.addEventListener('change', changed);
  return { axis, camera, controls, height };
}

export function resizeAxisView(view, aspect) {
  if (!view) return;
  const half = view.height / 2;
  view.camera.left = -half * aspect;
  view.camera.right = half * aspect;
  view.camera.top = half;
  view.camera.bottom = -half;
  view.camera.updateProjectionMatrix();
}
