import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Group, Vector3 } from 'three';
import {
  clearSolidOverlap,
  initializeCollisions,
  separate,
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

test('solid overlap pushes a rotated object out and a swept move cannot cross it', async () => {
  assert(await initializeCollisions());
  const root = new Group();
  const obstacle = makeObject('box');
  const guest = makeObject('box');
  root.add(obstacle, guest);
  guest.rotation.y = 0.5;
  guest.position.x = 0.3;
  obstacle.userData.solid = true;
  assert.deepEqual(clearSolidOverlap(root, obstacle), [guest]);
  close(guest.position.x, 0.5 + (Math.cos(0.5) + Math.sin(0.5)) * 0.5);
  close(guest.rotation.y, 0.5);
  assert.equal(separate(root, guest), false);
  guest.position.set(-3, 0, 0);
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
