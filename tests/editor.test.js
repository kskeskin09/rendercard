import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Group, Vector3 } from 'three';
import {
  overlaps,
  initializeCollisions,
  snapContact,
  sweep
} from '../src/collisions.js';
import {
  decodeProject,
  encodeProject,
  groupObjects,
  joinMeshes,
  makeObject,
  poseAt,
  writeKey
} from '../src/model.js';
import {
  anchorScale,
  changePivot,
  fitParentPivots,
  groundObject,
  localBounds
} from '../src/spatial.js';
import { createHistory } from '../src/history.js';
import { snapToGrid, surfaceOffset } from '../src/snapping.js';
import { readColor } from '../src/color-editor.js';

const close = (actual, expected) =>
  assert(Math.abs(actual - expected) < 0.0001, `${actual} != ${expected}`);
const bounds = (object) => new Box3().setFromObject(object, true);

test('one-sided scale keeps the opposite edge and Shift keeps both changes equal', () => {
  const box = makeObject('box');
  changePivot(box, 'x', 1);
  const position = box.position.clone();
  const scale = box.scale.clone();
  const boxBounds = localBounds(box);
  box.scale.x = 3;
  anchorScale(box, position, scale, boxBounds, false);
  close(bounds(box).min.x, -0.5);
  close(bounds(box).max.x, 2.5);
  anchorScale(box, position, scale, boxBounds, false, new Vector3(-1, 0, 0));
  close(bounds(box).min.x, -2.5);
  close(bounds(box).max.x, 0.5);
  anchorScale(box, position, scale, boxBounds, true);
  close(bounds(box).min.x, -1.5);
  close(bounds(box).max.x, 1.5);
});

test('changing a pivot keeps visible positions at existing keys and grounding uses geometry', () => {
  const box = makeObject('box', 'Oval', '#62b49a', 24, { radius: 0.3 });
  box.position.y = 2;
  box.rotation.z = 0.7;
  writeKey(box, 0);
  box.position.y = 4;
  box.scale.x = 1.9;
  writeKey(box, 30);
  const end = bounds(box);
  poseAt(box, 0);
  const start = bounds(box);
  changePivot(box, 'x', 1);
  changePivot(box, 'y', -1);
  close(bounds(box).min.distanceTo(start.min), 0);
  poseAt(box, 30);
  close(bounds(box).max.distanceTo(end.max), 0);
  groundObject(box);
  close(bounds(box).min.y, 0);
});

test('a group pivot follows resized children without moving their surfaces', () => {
  const root = new Group();
  const left = makeObject('box');
  const right = makeObject('box');
  right.position.x = 2;
  root.add(left, right);
  const group = groupObjects([left, right]);
  changePivot(group, 'x', 1);
  const previous = group.position.x;
  right.scale.x = 4;
  const resized = bounds(group);
  fitParentPivots(right);
  assert(group.position.x > previous);
  close(group.position.x, resized.max.x);
  close(bounds(group).max.x, resized.max.x);
  close(bounds(group).min.x, resized.min.x);
});

test('overlap detection leaves poses intact and a swept move cannot cross a solid', async () => {
  assert(await initializeCollisions());
  const root = new Group();
  const obstacle = makeObject('box');
  const guest = makeObject('box');
  root.add(obstacle, guest);
  guest.rotation.y = 0.5;
  guest.position.x = 0.3;
  assert.deepEqual(overlaps(root, obstacle, true), [guest]);
  close(guest.position.x, 0.3);
  close(guest.rotation.y, 0.5);
  guest.position.set(-3, 0, 0);
  assert.deepEqual(overlaps(root, obstacle, true), []);
  obstacle.userData.solid = true;
  const from = guest.position.clone();
  guest.position.x = 3;
  sweep(root, guest, from);
  close(guest.position.x, -0.5 - (Math.cos(0.5) + Math.sin(0.5)) * 0.5);
});

test('rounded geometry and tiles survive joining and project serialization', () => {
  const box = makeObject('box', 'Döşeme', '#b0ff86', 24, {
    radius: 0.5,
    solid: true,
    finish: 'tile',
    tile: 'brick',
    tileScale: 0.5
  });
  assert(box.geometry.attributes.uv.array.every(Number.isFinite));
  assert(box.geometry.index.count > 36);
  const sphere = makeObject('sphere');
  const root = new Group().add(box, sphere);
  const joined = joinMeshes([box, sphere]);
  const data = JSON.parse(JSON.stringify(encodeProject(root, 120)));
  const [decoded] = decodeProject(data).objects;
  assert.equal(decoded.geometry.index.count, joined.geometry.index.count);
  assert.equal(decoded.userData.solid, true);
  assert.equal(decoded.material[0].map.repeat.x, 2);
});

test('legacy projects get centered pivots and changing a scene clears redo', () => {
  const data = {
    version: 1,
    duration: 120,
    objects: [
      {
        type: 'box',
        name: 'Kutu',
        color: '#d0ea77',
        detail: 24,
        keys: [],
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        children: []
      }
    ]
  };
  assert.deepEqual(decodeProject(data).objects[0].userData.pivot, [0, 0, 0]);
  const history = createHistory();
  const before = { project: 'ilk' };
  const after = { project: 'son' };
  history.remember(before, after);
  assert.equal(history.step(-1), before);
  assert.equal(history.step(1), after);
  history.step(-1);
  history.remember(before, { project: 'yeni' });
  assert.equal(history.canRedo, false);
});

test('grid only rounds active axes and surface contact also aligns nearby lateral edges', async () => {
  const guest = makeObject('box');
  guest.position.set(1.37, 0.23, 0);
  snapToGrid(guest, ['x'], 0.5);
  close(guest.position.x, 1.5);
  close(guest.position.y, 0.23);
  const target = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 1, 1));
  const moving = new Box3(
    new Vector3(-0.8, 1.1, -0.5),
    new Vector3(0.2, 2.1, 0.5)
  );
  const offset = surfaceOffset(moving, [target], ['x', 'y'], 0.3);
  close(offset.x, -0.2);
  close(offset.y, -0.1);
  assert(await initializeCollisions());
  const stationary = makeObject('box');
  guest.position.set(1.2, 0, 0);
  const root = new Group().add(stationary, guest);
  assert(snapContact(root, guest, ['x'], 0.3));
  close(guest.position.x, 1);
});

test('visibility, lights, color formats and timing are preserved in the project', () => {
  const light = makeObject('light', 'Fener', '#caff80', 24, {
    color: '#caff80',
    intensity: 90,
    hidden: true
  });
  const mesh = makeObject('box', 'Hareket', '#ffffff', 24, {
    acceleration: 1,
    rotationPath: 'axes'
  });
  writeKey(mesh, 0);
  mesh.position.x = 10;
  mesh.rotation.y = 2 * Math.PI;
  writeKey(mesh, 60);
  const [loadedLight, loadedMesh] = decodeProject(
    JSON.parse(JSON.stringify(encodeProject(new Group().add(light, mesh), 60)))
  ).objects;
  assert.equal(loadedLight.visible, false);
  assert.equal(loadedLight.intensity, 90);
  assert.equal(loadedLight.color.getHexString(), 'caff80');
  poseAt(loadedMesh, 30);
  close(loadedMesh.position.x, 2.5);
  close(loadedMesh.rotation.y, Math.PI);
  loadedMesh.userData.rotationPath = 'long';
  loadedMesh.userData.keys[1].rotation[1] = Math.PI / 2;
  poseAt(loadedMesh, 30);
  close(
    new Vector3(1, 0, 0).applyQuaternion(loadedMesh.quaternion).x,
    -Math.SQRT1_2
  );
  assert.equal(readColor('255, 0, 0', 'RGB').getHexString(), 'ff0000');
  assert.equal(readColor('120, 100%, 50%', 'HSL').getHexString(), '00ff00');
});
