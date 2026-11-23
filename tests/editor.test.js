import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Group, Vector3 } from 'three';
import {
  overlaps,
  followCamera,
  initializeCollisions,
  snapContact,
  sweep
} from '../src/collisions.js';
import {
  decodeProject,
  applyAcceleration,
  encodeProject,
  groupObjects,
  joinMeshes,
  makeObject,
  poseAt,
  setDetail,
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
import { profileTime } from '../src/motion.js';
import { chooseTrack, keysFor } from '../src/clips.js';
import { trajectory } from '../src/dynamics.js';
import { constrainDimensions } from '../src/inspector-grid.js';
import { cameraAt, writeCameraKey } from '../src/camera-track.js';
import { updateOpacity } from '../src/opacity.js';
import { setTileSize } from '../src/tiles.js';

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
  assert.equal(loadedLight.castShadow, true);
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

test('profile speed is normalized and physical acceleration uses world axes and seconds', () => {
  close(profileTime(0.5, [0, 100, 100]), 1 / 3);
  close(profileTime(1, [25, 180, 35]), 1);
  const group = new Group();
  const box = makeObject('box', 'Düşen', '#ffffff', 24, {
    physicsAcceleration: [0, -10, 0]
  });
  group.rotation.z = Math.PI / 2;
  group.position.y = 10;
  group.add(box);
  applyAcceleration(box, 30);
  close(box.getWorldPosition(new Vector3()).y, 5);
  close(box.getWorldPosition(new Vector3()).x, 0);
});

test('independent clip keys and playback selection survive a project round trip', () => {
  const box = makeObject('box');
  const id = 'clip-a';
  writeKey(box, 0);
  box.position.x = 10;
  writeKey(box, 60);
  box.position.x = 7;
  writeKey(box, 0, id);
  box.position.x = 9;
  writeKey(box, 60, id);
  const animations = {
    clips: [
      { id: 'main', name: 'A' },
      { id, name: 'B' }
    ],
    active: id,
    enabled: ['main', id]
  };
  const loaded = decodeProject(
    JSON.parse(
      JSON.stringify(encodeProject(new Group().add(box), 60, animations))
    )
  );
  assert.deepEqual(loaded.animations, animations);
  const [copy] = loaded.objects;
  assert.equal(keysFor(copy, 'main')[0].position[0], 0);
  assert.equal(keysFor(copy, id)[0].position[0], 7);
  poseAt(copy, 30, chooseTrack(copy, ['main', id], 30));
  close(copy.position.x, 8);
});

test('a bounce preserves the chosen normal speed fraction and gravity continues afterwards', () => {
  const floor = (position, delta) => {
    if (delta.y >= 0 || position.y + delta.y > 0) return undefined;
    return {
      time: Math.max(0, -position.y / delta.y),
      normal: new Vector3(0, 1, 0)
    };
  };
  const replay = trajectory(
    new Vector3(0, 5, 0),
    [2, 0, 0],
    [0, -10, 0],
    0.6,
    floor
  );
  close(replay(30).y, 0);
  close(replay(45).y, 1.75);
  close(replay(48).y, 1.8);
  close(replay(45).x, 3);
  close(replay(45).y, 1.75);
  const stopped = trajectory(
    new Vector3(0, 5, 0),
    [0, 0, 0],
    [0, -10, 0],
    0,
    floor
  );
  close(stopped(150).y, 0);
});

test('one-axis edge rounding keeps the full thickness of that axis', () => {
  const object = makeObject('box', 'Düşey kenarlar', '#fff000', 24, {
    edgeRadii: [0, 0.4, 0]
  });
  const surface = object.geometry.attributes.position;
  close(bounds(object).min.y, -0.5);
  close(bounds(object).max.y, 0.5);
  assert(
    [...Array(surface.count).keys()].some(
      (i) =>
        Math.abs(surface.getY(i) - 0.5) < 0.0001 &&
        surface.getX(i) > 0.3 &&
        surface.getX(i) < 0.49 &&
        surface.getZ(i) > 0.3 &&
        surface.getZ(i) < 0.49
    )
  );
});

test('restoring a sharp solid edge detects the neighboring object before accepting the edit', async () => {
  assert(await initializeCollisions());
  const solid = makeObject('box', 'Yuvarlak', '#ffeeaa', 24, {
    solid: true,
    edgeRadii: [0, 0.45, 0]
  });
  const neighbor = makeObject('box', 'Köşe komşusu');
  neighbor.scale.setScalar(0.095);
  neighbor.position.set(0.465, 0, 0.465);
  const root = new Group().add(solid, neighbor);
  assert.deepEqual(overlaps(root, solid), []);
  solid.userData.edgeRadii[1] = 0;
  setDetail(solid, 24);
  assert.deepEqual(overlaps(root, solid), [neighbor]);
});

test('linked dimensions preserve their initial proportions on the snapped edited axis', () => {
  const base = new Vector3(1, 2, 1);
  const size = new Vector3(1, 1, 1);
  const linked = constrainDimensions(
    base,
    new Vector3(1, 3.85, 1),
    size,
    ['y'],
    true,
    1
  );
  assert.deepEqual(linked.toArray(), [2, 4, 2]);
  assert.deepEqual(
    constrainDimensions(
      base,
      new Vector3(1, 3.85, 1),
      size,
      ['y'],
      false,
      1
    ).toArray(),
    [1, 4, 1]
  );
});

test('camera cuts return to the default view and survive saving as discrete keys', () => {
  const camera = makeObject('camera', 'Yakın');
  camera.position.set(3, 4, 5);
  const animations = {
    clips: [{ id: 'main', name: 'Animasyon 1' }],
    enabled: ['main'],
    active: 'main'
  };
  writeCameraKey(animations, 10, camera.userData.cameraId);
  writeCameraKey(animations, 30, null);
  const defaultView = { position: [6, 5, 10], target: [0, 0, 0] };
  const loaded = decodeProject(
    JSON.parse(
      JSON.stringify(
        encodeProject(
          new Group().add(camera),
          60,
          animations,
          undefined,
          defaultView
        )
      )
    )
  );
  assert.deepEqual(loaded.defaultView, defaultView);
  assert.equal(loaded.objects[0].isCamera, true);
  assert.equal(cameraAt(loaded.animations, 9), null);
  assert.equal(
    cameraAt(loaded.animations, 10),
    loaded.objects[0].userData.cameraId
  );
  assert.equal(cameraAt(loaded.animations, 30), null);
});

test('fully rounding every axis creates a sphere for equal dimensions', () => {
  const object = makeObject('box', 'Tam yuvarlak', '#ffffff', 24, {
    edgeRadii: [0.5, 0.5, 0.5]
  });
  const position = object.geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    close(new Vector3().fromBufferAttribute(position, i).length(), 0.5);
  }
});

test('a following camera slides along a wall and regains its offset when the wall clears', async () => {
  await initializeCollisions();
  const root = new Group();
  const camera = makeObject('camera');
  const wall = makeObject('box');
  wall.userData.solid = true;
  wall.position.set(2.25, 0, 0);
  wall.scale.set(0.5, 10, 10);
  root.add(camera, wall);

  const desired = new Vector3(4, 2, 0);
  const position = followCamera(root, camera, desired);
  assert.ok(position.x > 1.8 && position.x < 2);
  close(position.y, 2);
  camera.position.copy(position);
  camera.userData.affectsSolids = false;
  close(followCamera(root, camera, desired).distanceTo(desired), 0);
  camera.userData.affectsSolids = true;
  root.remove(wall);
  close(followCamera(root, camera, desired).distanceTo(desired), 0);
});

test('opacity and absolute tile size survive saving independently of the preview eye', () => {
  const root = new Group();
  const box = makeObject('box', 'Asfalt', '#ffffff', 24, {
    hidden: true, opacity: 40, finish: 'tile', tile: 'asphalt', tileScale: 2
  });
  root.add(box);
  const restored = decodeProject(encodeProject(root, 120)).objects[0];
  assert.equal(restored.userData.hidden, true);
  assert.equal(restored.userData.opacity, 40);
  assert.equal(restored.userData.tile, 'asphalt');
  assert.equal(restored.material.userData.tileSize.value, 2);
  updateOpacity(restored, true);
  assert.equal(restored.material.transparent, true);
  assert.equal(restored.material.opacity, 0.4);
  assert.equal(restored.shadowCoverage.value, 0.4);
  setTileSize(restored.material, 1);
  assert.equal(restored.material.userData.tileSize.value, 1);
});

test('a negative mesh carves a recoverable hole and becomes visible again outside the positive', async () => {
  const { sceneCuts } = await import('../src/boolean-cuts.js');
  const { computeMeshVolume } = await import('three-bvh-csg');
  const root = new Group();
  const block = makeObject('box');
  const hole = makeObject('box', 'Delik', '#ffffff', 24, { negative: true });
  block.scale.set(4, 2, 4);
  hole.scale.set(2, 3, 2);
  root.add(block, hole);
  const first = sceneCuts(root);
  close(computeMeshVolume(first.cuts.get(block)), 0.75);
  assert(first.cutters.has(hole));
  assert(sceneCuts(root).cuts.get(block) === first.cuts.get(block));
  hole.position.x = 5;
  assert.equal(sceneCuts(root).cuts.size, 0);
  assert.equal(sceneCuts(root).cutters.size, 0);
  hole.position.set(0, 0, 0);
  hole.scale.set(6, 6, 6);
  assert.equal(sceneCuts(root).cuts.get(block).drawRange.count, 0);
});

test('project name, prism variants, cut polarity and tile preferences survive saving', () => {
  const root = new Group();
  const prism = makeObject('prism', 'Altıgen', '#ffffff', 24, {
    negative: true, sides: 6, tileFit: true, tileColorMode: 'custom', tileScale: 2
  });
  const pyramid = makeObject('pyramid');
  root.add(prism, pyramid);
  const restored = decodeProject(encodeProject(root, 120, undefined, undefined, undefined, 'Avlu'));
  assert.equal(restored.name, 'Avlu');
  assert.equal(restored.objects[0].userData.sides, 6);
  assert.equal(restored.objects[0].userData.negative, true);
  assert.equal(restored.objects[0].userData.tileFit, true);
  assert.equal(restored.objects[0].userData.tileColorMode, 'custom');
  assert.equal(restored.objects[0].userData.tileScale, 2);
  close(bounds(restored.objects[0]).getSize(new Vector3()).x, 1);
  assert.equal(restored.objects[1].userData.type, 'pyramid');
});

test('joining a positive and negative permanently stores the cut and consumes the cutter', async () => {
  const { sceneCuts } = await import('../src/boolean-cuts.js');
  const { computeMeshVolume } = await import('three-bvh-csg');
  const root = new Group();
  const positive = makeObject('box');
  positive.scale.set(4, 2, 4);
  const cutter = makeObject('prism', 'Delik', '#ffffff', 24, { negative: true });
  cutter.scale.set(2, 3, 2);
  root.add(positive, cutter);
  const result = sceneCuts(root);
  const expected = computeMeshVolume(result.cuts.get(positive)) * 32;
  const joined = joinMeshes([positive, cutter]);
  assert.equal(root.children.length, 1);
  assert.equal(joined.userData.parts[0].type, 'baked');
  assert.equal(joined.userData.negative, false);
  close(computeMeshVolume(joined.geometry), expected);
  const saved = decodeProject(encodeProject(root, 120)).objects[0];
  close(computeMeshVolume(saved.geometry), expected);
  assert.equal(sceneCuts(root).cutters.size, 0);
});

test('a camera can pass through a baked opening and stops against the remaining solid wall', async () => {
  await initializeCollisions();
  const root = new Group();
  const wall = makeObject('box', 'Duvar', '#ffffff', 24, { solid: true });
  wall.scale.set(4, 4, 1);
  const opening = makeObject('box', 'Geçit', '#ffffff', 24, { negative: true });
  opening.scale.set(1.5, 2.5, 2);
  root.add(wall, opening);
  const camera = makeObject('camera');
  camera.position.set(0, 0, -3);
  root.add(camera);
  const target = new Vector3(0, 0, 3);
  close(followCamera(root, camera, target).distanceTo(target), 0);
  joinMeshes([wall, opening]);
  close(followCamera(root, camera, target).distanceTo(target), 0);
  camera.position.x = 1.2;
  const blocked = followCamera(root, camera, new Vector3(1.2, 0, 3));
  assert.ok(blocked.z < -0.5 && blocked.z > -1);
});
