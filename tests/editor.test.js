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
  makeTextGroup,
  poseAt,
  setDetail,
  writeKey,
  updateMeshSurface
} from '../src/model.js';
import {
  anchorScale,
  changePivot,
  fitParentPivots,
  groundObject,
  hasVolumeAtOrigin,
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

test('camera focus aims at the world pivot without moving the camera and survives saving', async () => {
  const { aimCameraAt } = await import('../src/camera-follow.js');
  const root = new Group();
  const group = makeObject('group');
  const target = makeObject('box');
  const camera = makeObject('camera');
  root.add(camera, group);
  group.add(target);
  group.position.set(3, 1, 0);
  target.position.x = 1;
  camera.position.set(1, 2, 5);
  camera.userData.focusTarget = target.userData.objectId;
  const [copy] = decodeProject(encodeProject(root, 120)).objects;
  assert.equal(copy.userData.focusTarget, target.userData.objectId);
  assert.equal(copy.userData.followTarget, null);
  const original = camera.position.clone();
  assert(aimCameraAt(camera, target));
  close(camera.position.distanceTo(original), 0);
  const expected = new Vector3(3, -1, -5).normalize();
  close(camera.getWorldDirection(new Vector3()).distanceTo(expected), 0);
  const previous = camera.quaternion.clone();
  target.position.copy(group.worldToLocal(original.clone()));
  assert.equal(aimCameraAt(camera, target), false);
  close(camera.quaternion.angleTo(previous), 0);
});

test('scale snapping brings a dragged extended face to contact without shifting the fixed edge', async () => {
  const { snapResize, snapSelectionSize } = await import('../src/snapping.js');
  const { touches } = await import('../src/collisions.js');
  assert(await initializeCollisions());
  const root = new Group();
  const box = makeObject('box');
  const wall = makeObject('box');
  wall.position.x = 2;
  root.add(box, wall);
  const basis = box.scale.clone();
  const pivot = box.position.clone();
  const local = localBounds(box);
  const apply = scale => {
    box.scale.copy(scale);
    anchorScale(box, pivot, basis, local, false, new Vector3(1, 0, 0));
  };
  const proposed = new Vector3(1.86, 1, 1);
  apply(proposed);
  assert(snapResize(root, [box], ['x'], proposed, apply, object => touches(root, object)));
  close(bounds(box).min.x, -.5);
  close(bounds(box).max.x, 1.5);
  close(box.scale.x, 2);
  apply(proposed);
  snapSelectionSize([box], ['x'], proposed, apply, .5);
  close(box.scale.x, 2);
});

test('joining discards an opaque enclosed shell but preserves a shell visible through transparency', () => {
  function join(opacity) {
    const root = new Group();
    const inner = makeObject('box', 'İç', '#d94242');
    const outer = makeObject('box', 'Dış', '#4069d8', 24, { opacity });
    outer.scale.setScalar(3);
    root.add(inner, outer);
    return joinMeshes([inner, outer]);
  }
  const opaque = join(100);
  assert.equal(opaque.material.length, 1);
  assert.equal(opaque.material[0].color.getHexString(), '4069d8');
  assert.equal(opaque.geometry.index.count, 36);
  assert.equal(join(50).material.length, 2);
});

test('rubber is a repeatable dark tread preset with visible grooves', () => {
  const object = makeObject('box', 'Lastik', undefined, undefined, { finish: 'tile', tile: 'rubber' });
  const { data } = object.material.map.image;
  assert(data[31 * 4] < 110);
  assert(data[(8 * 64 + 25) * 4] > 180);
  assert.equal(object.material.userData.tileMapping.tint.value.getHexString(), '48494c');
});

test('Godot export builds separate scaled colliders for solid meshes including invisible obstacles', async () => {
  const { snapshotModel, disposeModel } = await import('../src/model-export.js');
  const root = new Group();
  const solid = makeObject('group', 'Duvar');
  solid.userData.solid = true;
  solid.position.set(2, 1, 0);
  solid.scale.set(2, 3, 1);
  const visible = makeObject('box', 'Taş-col');
  const invisible = makeObject('box', 'Cam', undefined, undefined, { opacity: 0 });
  invisible.position.x = 3;
  const cutter = makeObject('box', 'Kesici', undefined, undefined, { negative: true });
  cutter.position.x = 10;
  solid.add(visible, invisible, cutter);
  const decoration = makeObject('box', 'Dekor');
  root.add(solid, decoration);
  const output = snapshotModel(root, root.children, 1, 'static');
  const colliders = output.scene.getObjectByName('Rendercard_Collisions').children;
  assert.deepEqual(colliders.map(item => item.name), ['Taş_Collision_1-colonly', 'Cam_Collision_2-colonly']);
  assert(output.scene.getObjectByName('Taş')?.isMesh);
  assert(!output.scene.getObjectByName('Cam'));
  assert.deepEqual(colliders[0].scale.toArray(), [1, 1, 1]);
  assert.deepEqual(bounds(colliders[0]).getSize(new Vector3()).toArray(), [2, 3, 1]);
  assert.deepEqual(colliders[1].position.toArray(), [8, 1, 0]);
  assert.equal(visible.name, 'Taş-col');
  disposeModel(output.scene);

  const selection = snapshotModel(root, [invisible], 1, 'convex');
  assert.deepEqual(selection.scene.getObjectByName('Rendercard_Collisions').children.map(item => item.name),
    ['Cam_Collision_1-convcolonly']);
  disposeModel(selection.scene);
  const standard = snapshotModel(root, [visible], 1);
  assert(standard.scene.getObjectByName('Taş-col'));
  assert(!standard.scene.getObjectByName('Rendercard_Collisions'));
  disposeModel(standard.scene);
});

test('triangle geometry keeps its entered angles and survives saving and joining', () => {
  const root = new Group();
  const triangle = makeObject('triangle');
  root.add(triangle);
  triangle.userData.triangleAngles = [120, 25];
  setDetail(triangle, 24);
  const { position } = triangle.geometry.attributes;
  const corners = new Map();
  for (let i = 0; i < position.count; i++) {
    const point = new Vector3().fromBufferAttribute(position, i);
    if (point.z > 0) corners.set([point.x, point.y].join(','), point);
  }
  assert.equal(corners.size, 3);
  const ordered = [...corners.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  ordered.forEach((point, index) => {
    const vectors = ordered.filter(other => other !== point).map(other => other.clone().sub(point));
    close(vectors[0].angleTo(vectors[1]) * 180 / Math.PI, [120, 25, 35][index]);
  });
  assert.equal(triangle.geometry.index.count, 24);
  const project = encodeProject(root, 120);
  const [saved] = decodeProject(project).objects;
  assert.deepEqual(saved.userData.triangleAngles, [120, 25]);
  project.objects[0].triangleAngles = [120, 60];
  assert.throws(() => decodeProject(project), /Geçersiz nesne/);
  const box = makeObject('box');
  box.position.x = 2;
  root.add(box);
  const merged = joinMeshes([triangle, box]);
  assert.deepEqual(decodeProject(encodeProject(root, 120)).objects[0].userData.parts[0].triangleAngles, [120, 25]);
  assert.equal(merged.geometry.index.count, 60);
});

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

test('a flush negative removes both coplanar caps and the baked opening stays clear', async () => {
  const { sceneCuts } = await import('../src/boolean-cuts.js');
  const { Mesh, Raycaster } = await import('three');
  const root = new Group();
  const box = makeObject('box');
  const negative = makeObject('box', 'Kesici', '#ffffff', 24, { negative: true });
  negative.scale.set(.5, 1, .5);
  root.add(box, negative);
  const cut = sceneCuts(root).cuts.get(box);
  const down = new Raycaster(new Vector3(0, 3, 0), new Vector3(0, -1, 0));
  const up = new Raycaster(new Vector3(0, -3, 0), new Vector3(0, 1, 0));
  const view = new Mesh(cut, box.material);
  assert.equal(down.intersectObject(view).length, 0);
  assert.equal(up.intersectObject(view).length, 0);
  const merged = joinMeshes([box, negative]);
  merged.updateWorldMatrix(true, true);
  assert.equal(root.children.length, 1);
  assert.equal(down.intersectObject(merged).length, 0);
  assert.equal(up.intersectObject(merged).length, 0);
  assert.equal(merged.userData.negative, false);
});

test('joining an entirely removed volume leaves no mesh and other joins stay positive', () => {
  const root = new Group();
  const positive = makeObject('box');
  const negative = makeObject('box', undefined, undefined, 24, { negative: true });
  root.add(positive, negative);
  assert.equal(joinMeshes([positive, negative]), null);
  assert.equal(root.children.length, 0);

  const left = makeObject('box', 'Sol', '#ff4400', 24, { negative: true });
  const right = makeObject('box', 'Sağ', '#2244ff', 24, { negative: true });
  right.position.x = 2;
  root.add(left, right);
  const joined = joinMeshes([left, right]);
  assert.equal(joined.userData.negative, false);
  joined.userData.finish = 'tile';
  joined.userData.tile = 'brick';
  updateMeshSurface(joined);
  const restored = decodeProject(encodeProject(root, 120)).objects[0];
  assert.equal(restored.userData.finish, 'tile');
  assert(restored.material.every(material => material.map));
  restored.userData.finish = 'parts';
  updateMeshSurface(restored);
  assert.deepEqual(restored.material.map(material => material.color.getHexString()), ['ff4400', '2244ff']);
});

test('the angular curve and physical acceleration are independent from position', async () => {
  const { angularTrajectory } = await import('../src/dynamics.js');
  const object = makeObject('box', undefined, undefined, 24, {
    angularSpeedProfile: [10, 25, 200], speedProfile: [100, 100, 100],
    rotationPath: 'axes'
  });
  writeKey(object, 0);
  object.position.x = 4;
  object.rotation.x = Math.PI;
  writeKey(object, 40);
  poseAt(object, 20);
  close(object.position.x, 2);
  assert(object.rotation.x < Math.PI / 4);
  const free = angularTrajectory([0, 0, 0], [1, 0, 0], [2, 0, 0], 0, () => false);
  close(free(30)[0], 2);
  const bounce = angularTrajectory([0, 0, 0], [1, 0, 0], [0, 0, 0], .5, angles => angles[0] > .4);
  assert(bounce(12)[0] > .39);
  assert(bounce(24)[0] > .18 && bounce(24)[0] < .23);
  close(bounce(0)[0], 0);
});

test('symmetric multi-transforms preserve the shared center for translation, rotation and scale', async () => {
  const { selectionTransforms } = await import('../src/multi-transform.js');
  const { Quaternion } = await import('three');
  const center = new Vector3(2, 0, 0);
  const points = [0, 4].map(x => ({
    position: new Vector3(x, 0, 0),
    rotation: new Quaternion(), scale: new Vector3(1, 1, 1), resizable: true
  }));
  const control = {
    position: new Vector3(3, 0, 0),
    quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
    scale: new Vector3(2, 1, 1)
  };
  const moved = selectionTransforms(points, center, control, 'translate', true);
  assert.deepEqual(moved.map(item => item.position.x), [-1, 5]);
  const scaled = selectionTransforms(points, center, control, 'scale', true);
  assert.deepEqual(scaled.map(item => item.position.x), [-2, 6]);
  assert.deepEqual(scaled.map(item => item.scale.x), [2, 2]);
  const rotated = selectionTransforms(points, center, control, 'rotate', true);
  close(rotated[0].position.x, 2);
  close(rotated[0].position.y, -2);
  close(rotated[1].position.y, 2);
});

test('changing the box base sides produces matching top and bottom rings', () => {
  const box = makeObject('box', 'Beşgen', '#ffffff', 24, { sides: 5 });
  const buffer = box.geometry;
  const group = buffer.groups[0];
  const bottom = new Set();
  const top = new Set();
  for (let i = group.start; i < group.start + group.count; i++) {
    const point = new Vector3().fromBufferAttribute(buffer.attributes.position, buffer.index.getX(i));
    const ring = point.y > 0 ? top : bottom;
    ring.add([point.x, point.z].map(value => value.toFixed(6)).join(','));
  }
  assert.equal(top.size, 5);
  assert.deepEqual(top, bottom);
  const size = bounds(box).getSize(new Vector3());
  for (const dimension of size) close(dimension, 1);
});

test('rounded pyramids and prisms have closed, outward-facing meshes and persist', async () => {
  const { computeMeshVolume } = await import('three-bvh-csg');
  for (const [type, sides] of [['pyramid', 4], ['pyramid', 16], ['box', 5]]) {
    const sharp = makeObject(type, undefined, undefined, 24, { sides });
    const round = makeObject(type, undefined, undefined, 24, { sides, polygonRoundness: .28 });
    const { index, attributes } = round.geometry;
    assert(index.count > sharp.geometry.index.count);
    const edges = new Map();
    const a = new Vector3();
    const b = new Vector3();
    const point = i => new Vector3().fromBufferAttribute(attributes.position, index.getX(i));
    const hash = vertex => vertex.toArray().map(value => Math.round(value * 1e5)).join(',');
    for (let i = 0; i < index.count; i += 3) {
      const corners = [point(i), point(i + 1), point(i + 2)];
      const normal = new Vector3().fromBufferAttribute(attributes.normal, index.getX(i));
      assert(a.subVectors(corners[1], corners[0]).cross(b.subVectors(corners[2], corners[0])).dot(normal) > 0);
      const labels = corners.map(hash);
      labels.forEach((label, j) => {
        const edge = [label, labels[(j + 1) % 3]].sort().join(':');
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      });
    }
    assert([...edges.values()].every(count => count === 2));
    assert(computeMeshVolume(round.geometry) > .1);
    for (const dimension of bounds(round).getSize(new Vector3())) close(dimension, 1);
    const root = new Group();
    root.add(round);
    const [restored] = decodeProject(encodeProject(root, 120)).objects;
    assert.equal(restored.userData.sides, sides);
    assert.equal(restored.userData.polygonRoundness, .28);
    close(computeMeshVolume(restored.geometry), computeMeshVolume(round.geometry));
  }
});

test('disjoint meshes join without moving their geometry and keep their shared midpoint', () => {
  const root = new Group();
  const small = makeObject('box');
  const large = makeObject('box');
  small.position.set(-2, 0, 0);
  large.position.set(6, 0, 0);
  large.scale.x = 3;
  root.add(small, large);
  const before = bounds(root);
  const joined = joinMeshes([small, large]);
  assert.deepEqual(root.children, [joined]);
  close(joined.position.x, 2);
  assert.equal(hasVolumeAtOrigin(joined.geometry), false);
  assert.equal(hasVolumeAtOrigin(makeObject('box').geometry), true);
  close(before.min.distanceTo(bounds(joined).min), 0);
  close(before.max.distanceTo(bounds(joined).max), 0);
  changePivot(joined, 'x', 1);
  close(joined.position.x, 7.5);
  const [restored] = decodeProject(encodeProject(root, 120)).objects;
  changePivot(restored, 'x', 0);
  close(restored.position.x, 2);
  close(before.max.distanceTo(bounds(restored).max), 0);
});

test('measurement points use grid precision and snap to visible shape edges', async () => {
  const { measurementPoint } = await import('../src/measurement.js');
  const { OrthographicCamera, Raycaster, Vector2 } = await import('three');
  const root = new Group();
  const camera = new OrthographicCamera(-4, 4, 4, -4, .01, 100);
  camera.position.y = 8;
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const target = new Vector3();
  const viewport = { width: 1000, height: 1000 };
  const pick = (x, y, snap, anchor) => measurementPoint(
    root, camera, new Vector2(x, y), viewport, target, anchor, snap, new Raycaster(), new Raycaster()
  );
  assert.deepEqual(pick(.585, .225, { step: .5 }).toArray(), [2.5, 0, -1]);

  const box = makeObject('box');
  box.scale.set(4, 1, 4);
  box.position.y = .5;
  root.add(box);
  close(pick(.485, 0, {}).x, 1.94);
  const edge = pick(.485, 0, { surface: true });
  close(edge.x, 2);
  close(edge.y, 1);
  box.visible = false;
  close(pick(.485, 0, { surface: true }).y, 0);

  camera.position.set(8, 0, 0);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  const point = pick(0, .25, {}, new Vector3(2, 0, 0));
  close(point.x, 2);
  close(point.y, 1);
});

test('history revisions recognize returning to the saved state and diverging again', () => {
  const history = createHistory();
  const initial = history.revision;
  history.remember({ project: 'A' }, { project: 'B' });
  const saved = history.revision;
  history.remember({ project: 'B' }, { project: 'C' });
  assert.notEqual(history.revision, saved);
  history.step(-1);
  assert.equal(history.revision, saved);
  history.step(-1);
  assert.equal(history.revision, initial);
  history.step(1);
  assert.equal(history.revision, saved);
  history.remember({ project: 'B' }, { project: 'D' });
  assert.notEqual(history.revision, saved);
  assert.equal(history.canRedo, false);
});

test('render presets fit the editing area and custom resolution survives serialization', async () => {
  const { fitRenderFrame, renderAspectLabel, validRenderSize, defaultRenderSize } = await import('../src/render-settings.js');
  const resolution = { width: 1080, height: 1920 };
  assert(validRenderSize(resolution));
  assert.equal(renderAspectLabel(1920, 1080), '16:9');
  assert.equal(renderAspectLabel(1080, 1920), '9:16');
  assert.equal(renderAspectLabel(320, 480), '2:3');
  assert.equal(validRenderSize({ width: 9000, height: 720 }), false);
  assert.deepEqual(fitRenderFrame(960, 540, 9 / 16), { width: 303.75, height: 540 });
  const root = new Group();
  assert.deepEqual(decodeProject(encodeProject(root, 120)).renderSize, defaultRenderSize);
  assert.deepEqual(decodeProject(encodeProject(root, 120, undefined, undefined, undefined, 'Sahne', resolution)).renderSize, resolution);
});

test('a model snapshot preserves selected hierarchy and carries sampled transform-only tracks', async () => {
  const { snapshotModel, sampleTracks, writeModel, disposeModel } = await import('../src/model-export.js');
  const root = new Group();
  const group = makeObject('group', 'Ebeveyn');
  const object = makeObject('box', 'Gösterim kutusu', '#ffffff', 24, { hidden: true, opacity: 50, finish: 'tile', tile: 'brick' });
  const other = makeObject('box', 'Kapsam dışı');
  group.add(object, other);
  root.add(group);
  const snapshot = snapshotModel(root, [object], 16 / 9);
  assert.equal(snapshot.meshes, 1);
  assert.equal(snapshot.scene.children[0].name, 'Ebeveyn');
  assert.deepEqual(snapshot.scene.children[0].children.map(child => child.name), [object.name]);
  assert.equal(snapshot.pairs.get(object).material.opacity, .5);
  assert(snapshot.pairs.get(object).material.map);
  const samples = sampleTracks(snapshot.pairs, 30);
  samples.add(0);
  group.position.x = 4;
  object.rotation.y = 1;
  samples.add(30);
  const clip = samples.clip('Hareket');
  assert.equal(clip.duration, 1);
  assert.equal(clip.tracks.length, 2);
  assert(clip.tracks.some(track => track.name.endsWith('.position')));
  assert(clip.tracks.some(track => track.name.endsWith('.quaternion')));
  const obj = await (await writeModel(snapshot.scene, 'obj', [])).text();
  assert.match(obj, /o Gösterim kutusu/);
  assert.doesNotMatch(obj, /Kapsam dışı/);
  const stl = await (await writeModel(snapshot.scene, 'stl', [])).arrayBuffer();
  assert.equal(new DataView(stl).getUint32(80, true), 12);
  disposeModel(snapshot.scene);
});

test('stopping a damped orbit keeps the current camera pose without residual movement', async () => {
  const { stopOrbitMotion } = await import('../src/axis-view.js');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { PerspectiveCamera } = await import('three');
  const camera = new PerspectiveCamera();
  camera.position.set(5, 3, 8);
  const controls = new OrbitControls(camera);
  controls.enableDamping = true;
  const original = camera.position.clone();
  controls.rotateLeft(0.75);
  assert(original.distanceTo(camera.position) > 0.01);
  const stopped = camera.position.clone();
  const target = controls.target.clone();
  stopOrbitMotion(controls);
  for (let i = 0; i < 20; i++) controls.update();
  close(stopped.distanceTo(camera.position), 0);
  close(target.distanceTo(controls.target), 0);
  assert.equal(controls.enableDamping, true);
});

test('orbital distance, angle profile and repeat period are independent', async () => {
  const { defaultOrbit, orbitPosition, orderedOrbits } = await import('../src/orbit-motion.js');
  const center = new Vector3(3, 2, -4);
  const ellipse = { ...defaultOrbit, period: 4, mode: 'ellipse', near: 2, far: 6 };
  close(orbitPosition(center, 0, 30, ellipse).distanceTo(center), 2);
  close(orbitPosition(center, 60, 30, ellipse).distanceTo(center), 6);
  close(orbitPosition(center, 120, 30, ellipse).distanceTo(orbitPosition(center, 0, 30, ellipse)), 0);
  const circular = { ...ellipse, mode: 'fixed', plane: 'xy', direction: -1 };
  const quarter = orbitPosition(center, 30, 30, circular);
  close(quarter.x, center.x);
  close(quarter.y, center.y - 2);
  close(quarter.z, center.z);
  const accelerated = orbitPosition(center, 60, 30, { ...ellipse, speed: [0, 100, 200] });
  close(accelerated.x, center.x);
  close(accelerated.z, center.z + 3);

  const root = new Group();
  const a = makeObject('box'), b = makeObject('box'), c = makeObject('box');
  root.add(a,b,c);
  assert.deepEqual(orderedOrbits(new Map([[a,b],[b,c]])).map(([item])=>item), [b,a]);
  assert.deepEqual(orderedOrbits(new Map([[a,b],[b,a]])), []);
  a.userData.positionMode = 'orbit';
  a.userData.orbit = { ...ellipse, target: b.userData.objectId };
  const project = encodeProject(root, 180, undefined, { skyMode: 'tile', skyTile: 'stars' });
  const loaded = decodeProject(project);
  assert.equal(loaded.objects[0].userData.orbit.target, loaded.objects[1].userData.objectId);
  assert.equal(loaded.objects[0].userData.orbit.far, 6);
  assert.equal(loaded.atmosphere.skyMode, 'tile');
  assert.equal(loaded.atmosphere.skyTile, 'stars');
});

test('the timeline keeps 240 frames or fewer visible and bounds panning', async () => {
  const { stepTimelineZoom, timelineWindow } = await import('../src/timeline-window.js');
  assert.deepEqual(timelineWindow(120, 0, 32), { start: 0, end: 120, span: 120 });
  assert.deepEqual(timelineWindow(480, 0, 900), { start: 240, end: 480, span: 240 });
  assert.deepEqual(timelineWindow(120, 100, 30), { start: 30, end: 36, span: 6 });
  assert.equal(stepTimelineZoom(120, 0, 1), 20);
  assert.equal(stepTimelineZoom(120, 100, -1), 80);
  const zoomed = stepTimelineZoom(7, 0, 1);
  assert.equal(timelineWindow(7, zoomed, 0).span, 6);
  assert.equal(timelineWindow(7, stepTimelineZoom(7, zoomed, -1), 0).span, 7);
});

test('extruded Turkish text keeps editable letters, geometry and independent keyframes', () => {
  const root = new Group();
  const word = makeTextGroup('Işık\nÇığ', 0.2, 0.015);
  root.add(word);
  groundObject(word);
  close(bounds(word).min.y, 0);
  assert.deepEqual(word.children.map(letter => letter.name), [...'IşıkÇığ']);
  assert(word.children[0].position.y > word.children[4].position.y);
  const [letter, second] = word.children;
  assert.notEqual(letter.userData.objectId, second.userData.objectId);
  assert(letter.geometry.index.count > 0);
  close(bounds(letter).getSize(new Vector3()).z, 0.2);
  letter.userData.letterDepth = 0.45;
  setDetail(letter, letter.userData.detail);
  close(bounds(letter).getSize(new Vector3()).z, 0.45);
  const startX = word.position.x;
  writeKey(word, 0);
  writeKey(letter, 0);
  word.position.x += 2;
  letter.rotation.z = Math.PI / 2;
  letter.scale.setScalar(2);
  writeKey(word, 40);
  writeKey(letter, 40);
  const [saved] = decodeProject(encodeProject(root, 120)).objects;
  const [savedLetter, savedSecond] = saved.children;
  poseAt(saved, 20);
  poseAt(savedLetter, 20);
  close(saved.position.x, startX + 1);
  close(savedLetter.rotation.z, Math.PI / 4);
  close(savedLetter.scale.x, 1.5);
  close(savedSecond.scale.x, 1);
  assert.equal(savedLetter.userData.letterDepth, 0.45);
  const merged = joinMeshes([savedLetter, savedSecond]);
  assert.equal(merged.userData.parts.length, 2);
  root.clear();
  root.add(saved);
  assert.equal(decodeProject(encodeProject(root, 120)).objects[0].children.length, 6);
});

test('size and position curves are independent and old projects keep their shared timing', () => {
  const root = new Group();
  const box = makeObject('box');
  box.userData.speedProfile = [0, 100, 200];
  root.add(box);
  writeKey(box, 0);
  box.position.x = 4;
  box.scale.setScalar(3);
  writeKey(box, 40);
  const old = encodeProject(root, 120);
  old.version = 11;
  delete old.objects[0].sizeSpeedProfile;
  const [loaded] = decodeProject(old).objects;
  poseAt(loaded, 20);
  close(loaded.position.x, 1);
  close(loaded.scale.x, 1.5);

  loaded.userData.sizeSpeedProfile = [200, 100, 0];
  poseAt(loaded, 20);
  close(loaded.position.x, 1);
  close(loaded.scale.x, 2.5);
  loaded.userData.speedProfile = [100, 100, 100];
  poseAt(loaded, 20);
  close(loaded.position.x, 2);
  close(loaded.scale.x, 2.5);

  root.clear();
  root.add(loaded);
  const [saved] = decodeProject(encodeProject(root, 120)).objects;
  assert.deepEqual(saved.userData.sizeSpeedProfile, [200, 100, 0]);
  assert.deepEqual(saved.userData.speedProfile, [100, 100, 100]);
});

test('imported OBJ material groups survive project serialization', async () => {
  const { importMeshParts } = await import('../src/model-import.js');
  const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
  const { makeImportedMesh } = await import('../src/model.js');
  const parsed = new OBJLoader().parse('o Üçgen\nv 0 0 0\nv 2 0 0\nv 0 1 0\nf 1 2 3');
  parsed.children[0].material.color.set('#637ec4');
  const root = new Group();
  root.add(makeImportedMesh(importMeshParts(parsed), 'Üçgen'));
  const loaded = decodeProject(encodeProject(root, 120)).objects[0];
  assert.equal(loaded.name, 'Üçgen');
  assert.equal(loaded.geometry.index.count, 3);
  assert.equal(loaded.material[0].color.getHexString(), '637ec4');
});

test('editing text preserves letter identities, animated offsets and title customization', async () => {
  const { applyTextEdit, planTextEdit } = await import('../src/text-editing.js');
  const root = new Group();
  const word = makeTextGroup('ABA');
  root.add(word);
  word.name = 'Başlık';
  const [first, middle, last] = word.children;
  middle.material.color.set('#ff0000');
  writeKey(middle, 2);
  middle.position.y += 1;
  middle.rotation.z = 0.8;
  writeKey(middle, 12);
  writeKey(last, 0);
  const plan = planTextEdit(word, 'XAB');
  assert.deepEqual(plan.animated, [last]);
  applyTextEdit(word, plan);
  assert.equal(word.name, 'Başlık');
  assert.deepEqual(word.children.map(letter => letter.userData.glyph), [...'XAB']);
  assert.equal(word.children[1], first);
  assert.equal(word.children[2], middle);
  assert.equal(middle.material.color.getHexString(), 'ff0000');
  assert.equal(middle.userData.keys[1].rotation[2], 0.8);
  close(middle.userData.keys[1].position[1] - middle.userData.keys[0].position[1], 1);
  const [saved] = decodeProject(encodeProject(root, 120)).objects;
  assert.equal(saved.userData.textLayout.text, 'XAB');
  assert.deepEqual(saved.children[2].userData.textSlot, middle.userData.textSlot);
});

test('staggered entrance writes independent times and detects occupied frames', async () => {
  const { planLetterEntrance } = await import('../src/text-editing.js');
  const word = makeTextGroup('Çay');
  const settings = { clip: 'main', start: 10, gap: 3, span: 8, mode: 'grow', amount: 20 };
  const { entries, end } = planLetterEntrance(word, settings);
  assert.equal(end, 24);
  assert.deepEqual(entries.map(entry => [entry.from, entry.to]), [[10,18], [13,21], [16,24]]);
  entries.forEach(({ letter, from, to, entrance, rest }) => {
    assert.deepEqual(entrance.scale, [0.2, 0.2, 0.2]);
    writeKey(letter, from, 'main', entrance);
    writeKey(letter, to, 'main', rest);
  });
  assert.throws(() => planLetterEntrance(word, settings), /aralığında kare var/);
});

test('timing changes are atomic and allow simultaneous keys on separate tracks', async () => {
  const { applyKeyTiming, planKeyTiming } = await import('../src/key-timing.js');
  const a = { frame: 10, scale: [2, 1, 1] }, b = { frame: 15 }, c = { frame: 20 }, d = { frame: 35 };
  const track = [a,b,d], otherTrack = [c];
  const entries = [{ key: a, track }, { key: b, track }, { key: c, track: otherTrack }];
  assert.throws(() => planKeyTiming(entries, frame => frame + 20, 60), /aynı konuma/);
  assert.deepEqual(track.map(key => key.frame), [10,15,35]);
  assert.throws(() => planKeyTiming(entries, frame => frame - 11, 60), /aralığının dışına/);
  applyKeyTiming(planKeyTiming(entries, frame => frame + 10, 60));
  assert.deepEqual(track.map(key => key.frame), [20,25,35]);
  applyKeyTiming(planKeyTiming(entries, frame => 20 + (frame - 20) * 2, 60));
  assert.deepEqual(track.map(key => key.frame), [20,30,35]);
  assert.equal(c.frame, 40);
  assert.deepEqual(a.scale, [2,1,1]);
});

test('a solid elastic mesh admits a narrow shaft and preserves its outside bounds', async () => {
  const { sceneCuts } = await import('../src/boolean-cuts.js');
  const root = new Group();
  const sponge = makeObject('box', 'Sünger', '#eeee99', 24, { solid: true, elastic: true });
  sponge.scale.set(2, 2, 2);
  const shaft = makeObject('box');
  shaft.scale.set(3, 0.35, 0.35);
  shaft.position.set(1.4, 0, 0);
  root.add(sponge, shaft);
  const from = new Vector3(3.5, 0, 0);
  assert.equal(sweep(root, shaft, from), undefined);
  assert.equal(overlaps(root, shaft).length, 0);
  const { cuts, cutters } = sceneCuts(root);
  assert(cuts.has(sponge));
  assert(!cutters.has(shaft));
  const cut = cuts.get(sponge);
  cut.computeBoundingBox();
  assert.deepEqual(cut.boundingBox.getSize(new Vector3()).toArray(), [1, 1, 1]);
  assert.deepEqual(sponge.scale.toArray(), [2, 2, 2]);
  assert.equal(decodeProject(encodeProject(root, 120)).objects[0].userData.elastic, true);

  shaft.position.copy(from);
  assert.equal(sceneCuts(root).cuts.size, 0);
  shaft.scale.set(3, 2.2, 0.35);
  shaft.position.x = 0.8;
  assert.equal(sweep(root, shaft, from), sponge);
  assert(shaft.position.x >= 2.49);
  assert.equal(sceneCuts(root).cuts.size, 0);
});

test('bone bridge follows mesh surfaces, blends their materials and disappears inside an endpoint', async () => {
  const { boneDefaults, boneMaterial, boneSurface, rigLinks } = await import('../src/rig.js');
  const root = new Group();
  const larger = makeObject('box', 'Büyük', '#ff3030', 24, { skeletonJoint: true });
  larger.scale.setScalar(2);
  const smaller = makeObject('box', 'Küçük', '#3070ff', 24, { skeletonJoint: true });
  smaller.scale.setScalar(.5);
  smaller.position.x = 3;
  root.add(larger, smaller);
  root.updateMatrixWorld(true);
  const bone = { ...boneDefaults, skin: true, target: smaller.userData.objectId };
  larger.userData.bones.push(bone);
  const broad = boneSurface(larger, smaller, 100);
  const slender = boneSurface(larger, smaller, 50);
  broad.geometry.computeBoundingBox();
  slender.geometry.computeBoundingBox();
  assert(broad.geometry.boundingBox.getSize(new Vector3()).y > slender.geometry.boundingBox.getSize(new Vector3()).y);
  close(broad.geometry.boundingBox.min.x, 1);
  close(broad.geometry.boundingBox.max.x, 2.75);
  assert.deepEqual(broad.materials, [larger.material, smaller.material]);
  const blend = boneMaterial(bone, broad);
  const colors = blend.map.image.data;
  assert(colors[0] > colors[2]);
  assert(colors.at(-2) > colors.at(-4));
  smaller.position.x = 0.4;
  root.updateMatrixWorld(true);
  assert.equal(boneSurface(larger, smaller, 100), null);
  const reloaded = new Group();
  reloaded.add(...decodeProject(encodeProject(root, 120)).objects);
  assert.equal(rigLinks(reloaded).links[0].bone.skin, true);
});

test('a bent box joint closes both triangular side gaps and clips overlapping faces', async () => {
  const { Mesh, MeshBasicMaterial, DoubleSide, Raycaster } = await import('three');
  const { boneSurface } = await import('../src/rig.js');
  const base = makeObject('box');
  const angled = makeObject('box');
  base.scale.setScalar(2);
  angled.scale.setScalar(2);
  angled.position.set(.7, 2.25, 0);
  angled.rotation.z = -Math.PI / 6;
  base.updateMatrixWorld(true);
  angled.updateMatrixWorld(true);
  const surface = boneSurface(base, angled, 100);
  assert(surface);
  const bridge = new Mesh(surface.geometry, new MeshBasicMaterial({ side: DoubleSide }));
  bridge.updateMatrixWorld();
  for (const side of [-1, 1]) {
    for (const [x, y] of [[-.3, 1.4], [.1, 1.2], [.4, 1.12]]) {
      const ray = new Raycaster(new Vector3(x, y, 5 * side), new Vector3(0, 0, -side));
      assert(ray.intersectObject(bridge).some(hit => Math.abs(hit.point.z - side) < 1e-4));
    }
  }
  const vertices = surface.geometry.attributes.position;
  for (let i = 0; i < vertices.count; i += 3) {
    const point = new Vector3().fromBufferAttribute(vertices, i)
      .add(new Vector3().fromBufferAttribute(vertices, i + 1))
      .add(new Vector3().fromBufferAttribute(vertices, i + 2)).divideScalar(3);
    for (const mesh of [base, angled]) {
      const local = mesh.worldToLocal(point.clone());
      assert(Math.max(Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)) >= .49999);
    }
  }
});

test('a deeply bent overlapping box joint finds an exposed side bridge', async () => {
  const { boneSurface } = await import('../src/rig.js');
  const base = makeObject('box');
  const beam = makeObject('box');
  base.scale.set(1.25, 1.5, 1);
  beam.scale.set(3.5, 1, 1);
  beam.position.set(.35, .25, 0);
  beam.rotation.z = -65 * Math.PI / 180;
  base.updateMatrixWorld(true);
  beam.updateMatrixWorld(true);
  const bridge = boneSurface(base, beam, 100);
  assert(bridge?.geometry.attributes.position.count >= 6);
  for (const array of [bridge.geometry.attributes.position.array, bridge.geometry.attributes.normal.array])
    assert(array.every(Number.isFinite));
});

test('mesh hierarchy preserves placement and keys, follows parent rotation and clips lower coplanar faces', async () => {
  const { applyReparenting, reparentPlans } = await import('../src/hierarchy.js');
  const { sceneCuts } = await import('../src/boolean-cuts.js');
  const { Mesh, MeshBasicMaterial, Raycaster } = await import('three');
  const root = new Group();
  const parent = makeObject('box', 'Üst');
  const child = makeObject('box', 'Alt');
  parent.scale.setScalar(2);
  child.scale.set(1, 2, 2);
  child.position.x = 1;
  root.add(parent, child);
  writeKey(child, 5);
  applyReparenting(reparentPlans([child], parent));
  assert.equal(child.parent, parent);
  close(child.getWorldPosition(new Vector3()).x, 1);
  close(child.userData.keys[0].position[0], .5);
  assert.throws(() => reparentPlans([parent], child), /kendi altına/);
  const { cuts } = sceneCuts(root);
  assert(!cuts.has(parent));
  const outside = new Mesh(cuts.get(child), new MeshBasicMaterial());
  outside.matrix.copy(child.matrixWorld);
  outside.matrixAutoUpdate = false;
  outside.updateMatrixWorld(true);
  const hits = x => new Raycaster(new Vector3(x, 0, 5), new Vector3(0, 0, -1)).intersectObject(outside);
  assert.equal(hits(.75).length, 0);
  assert(hits(1.25).length > 0);
  parent.rotation.z = Math.PI / 2;
  close(child.getWorldPosition(new Vector3()).y, 1);
  child.rotation.z += .1;
  close(parent.rotation.z, Math.PI / 2);
  assert.equal(decodeProject(encodeProject(root, 120)).objects[0].children[0].name, 'Alt');
  const before = child.getWorldPosition(new Vector3());
  applyReparenting(reparentPlans([child], root));
  close(child.getWorldPosition(new Vector3()).distanceTo(before), 0);
  assert.equal(child.parent, root);
});
