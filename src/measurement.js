import {
  BufferGeometry, EdgesGeometry, Float32BufferAttribute, Group, Plane, Points,
  PointsMaterial, Raycaster, Vector2, Vector3
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { snapPointToGrid } from './snapping.js';

const floor = new Plane(new Vector3(0, 1, 0), 0);
const edges = new WeakMap();
const format = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });

function firstSurface(root, ray) {
  return ray.intersectObjects(root.children, true).find(({ object, face }) => {
    if (!object.isMesh) return false;
    for (let item = object; item; item = item.parent) if (!item.visible) return false;
    const material = Array.isArray(object.material) ? object.material[face.materialIndex] : object.material;
    return material?.visible !== false;
  });
}

function projectedEdge(root, hit, cursor, camera, width, height, check) {
  const candidates = [];
  const a = new Vector3();
  const b = new Vector3();
  const worldA = new Vector3();
  const worldB = new Vector3();
  const pixel = new Vector2();
  const segment = new Vector2();
  const along = new Vector3();
  const screen = new Vector2();
  const search = object => {
    if (!object.isMesh) return;
    const geometry = object.geometry;
    const version = geometry.attributes.position.version;
    let item = edges.get(geometry);
    if (item?.version !== version) {
      const objectEdges = new EdgesGeometry(geometry, 8);
      item = { version, points: objectEdges.attributes.position };
      edges.set(geometry, item);
      objectEdges.dispose();
    }
    for (let i = 0; i < item.points.count; i += 2) {
      worldA.fromBufferAttribute(item.points, i).applyMatrix4(object.matrixWorld);
      worldB.fromBufferAttribute(item.points, i + 1).applyMatrix4(object.matrixWorld);
      a.copy(worldA).project(camera);
      b.copy(worldB).project(camera);
      if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue;
      pixel.set((a.x - cursor.x) * width / 2, (a.y - cursor.y) * height / 2);
      segment.set((b.x - a.x) * width / 2, (b.y - a.y) * height / 2);
      const length = segment.lengthSq();
      if (!length) continue;
      const t = Math.min(1, Math.max(0, -pixel.dot(segment) / length));
      const end = pixel.lengthSq() < 49 ? 0 : pixel.clone().add(segment).lengthSq() < 49 ? 1 : t;
      const distance = pixel.addScaledVector(segment, end).lengthSq();
      if (distance > 144) continue;
      screen.set(a.x + (b.x - a.x) * end, a.y + (b.y - a.y) * end);
      check.setFromCamera(screen, camera);
      check.ray.distanceSqToSegment(worldA, worldB, undefined, along);
      candidates.push({ screen: screen.clone(), point: along.clone(), distance });
    }
  };
  if (hit) search(hit.object);
  else root.traverseVisible(search);
  candidates.sort((left, right) => left.distance - right.distance);
  for (const candidate of candidates) {
    check.setFromCamera(candidate.screen, camera);
    const front = firstSurface(root, check);
    if (!front || candidate.point.distanceTo(check.ray.origin) <= front.distance + .015)
      return candidate.point;
  }
}

export function measurementPoint(root, camera, cursor, size, target, anchor, snap, ray, edgeRay) {
  root.updateWorldMatrix(true, true);
  camera.updateMatrixWorld();
  ray.setFromCamera(cursor, camera);
  const hit = firstSurface(root, ray);
  if (snap.surface) {
    const edge = projectedEdge(root, hit, cursor, camera, size.width, size.height, edgeRay);
    if (edge) return edge;
  }
  const point = new Vector3();
  const direction = ray.ray.direction;
  const ground = Math.abs(direction.y) > .00001 && ray.ray.intersectPlane(floor, point);
  const fallback = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), anchor ?? target);
  const result = hit?.point ?? (ground || ray.ray.intersectPlane(fallback, point));
  if (!result) return undefined;
  return snap.step ? snapPointToGrid(result, snap.step) : result;
}

export function createMeasurement(root, scene, canvas, label, settings) {
  const guide = new Group();
  guide.visible = false;
  scene.add(guide);
  const lineData = new LineSegmentsGeometry().setPositions(new Float32Array(6));
  const line = new LineSegments2(lineData, new LineMaterial({
    color: '#f6e17a', linewidth: 2.5, depthTest: false, depthWrite: false, toneMapped: false
  }));
  const dots = new Points(new BufferGeometry(), new PointsMaterial({
    color: '#fff3a8', size: 8, sizeAttenuation: false, depthTest: false, depthWrite: false, toneMapped: false
  }));
  const points = new Float32BufferAttribute(6, 3);
  dots.geometry.setAttribute('position', points);
  line.renderOrder = 20;
  dots.renderOrder = 21;
  line.frustumCulled = dots.frustumCulled = false;
  guide.add(line, dots);

  const ray = new Raycaster();
  const edgeRay = new Raycaster();
  const cursor = new Vector2();
  const projected = new Vector3();
  let active = false;
  let first;
  let second;
  let position;
  let preview;
  let dirty = false;
  function invalidate() { dirty = true; }
  function pick(camera, target) {
    const rect = canvas.getBoundingClientRect();
    cursor.set((2 * (position[0] - rect.left)) / rect.width - 1,
      1 - (2 * (position[1] - rect.top)) / rect.height);
    return measurementPoint(root, camera, cursor, rect, target, first, settings(), ray, edgeRay);
  }
  return {
    get active() { return active; },
    setActive(value) {
      active = value;
      first = second = position = preview = undefined;
      guide.visible = false;
      label.hidden = true;
      canvas.classList.toggle('measuring', active);
    },
    invalidate,
    move(x, y) {
      position = x == null ? undefined : [x, y];
      invalidate();
    },
    place(x, y, camera, target) {
      position = [x, y];
      const point = pick(camera, target);
      if (!point) return;
      if (first && !second) second = point;
      else {
        first = point;
        second = undefined;
      }
      invalidate();
      return second ? format.format(first.distanceTo(second)) + ' m' : '';
    },
    render(camera, target, clean) {
      guide.visible = active && !clean;
      if (clean) return;
      label.hidden = true;
      if (!active) return;
      if (dirty) {
        preview = position && !second ? pick(camera, target) : undefined;
        dirty = false;
      }
      const start = first ?? preview;
      const end = first && (second ?? preview);
      dots.visible = Boolean(start);
      line.visible = Boolean(end);
      if (!start) return;
      start.toArray(points.array);
      if (end) end.toArray(points.array, 3);
      dots.geometry.setDrawRange(0, end ? 2 : 1);
      points.needsUpdate = true;
      if (!end) return;
      const positions = lineData.attributes.instanceStart.data;
      start.toArray(positions.array);
      end.toArray(positions.array, 3);
      positions.needsUpdate = true;
      projected.copy(start).lerp(end, .5).project(camera);
      if (Math.abs(projected.x) >= 1 || Math.abs(projected.y) >= 1 || Math.abs(projected.z) >= 1) return;
      label.style.left = (projected.x + 1) * 50 + '%';
      label.style.top = (1 - projected.y) * 50 + '%';
      label.textContent = format.format(start.distanceTo(end)) + ' m';
      label.hidden = false;
    }
  };
}
