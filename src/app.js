import { Box3, Color, Group, MathUtils, Quaternion, Vector3 } from 'three';
import { createViewport } from './viewport.js';
import { icon } from './icons.js';
import {
  applyPose,
  defaultAtmosphere,
  capture,
  decodeProject,
  disposeObject,
  dissolveGroup,
  encodeObject,
  encodeProject,
  groupObjects,
  joinMeshes,
  makeObject,
  materialsOf,
  poseAt,
  projectVersion,
  types,
  writeKey
} from './model.js';
import {
  anchorScale,
  localBounds,
  groundObject,
  hasVolumeAtOrigin,
  translateWorld,
  fitPivot,
  fitParentPivots
} from './spatial.js';
import { settingsMarkup, bindSettings } from './inspector-settings.js';
import { createHistory } from './history.js';
import { installPresets } from './presets.js';
import { snapToGrid, snapToSurfaces } from './snapping.js';
import { angularTrajectory, trajectory } from './dynamics.js';
import { chooseTrack, hasKeys, keysFor, mainClip, posesOf } from './clips.js';
import { cameraAt, writeCameraKey } from './camera-track.js';
import { applySelectionTransform, selectionTransforms } from './multi-transform.js';
import { defaultRenderSize, renderAspectLabel, renderSizes, validRenderSize } from './render-settings.js';
import { bindColor, fogColorMarkup } from './color-editor.js';
import {
  axes,
  axisHeading,
  axisRow,
  constrainDimensions
} from './inspector-grid.js';

const $ = (id) => document.getElementById(id);
const all = (selector) => [...document.querySelectorAll(selector)];
const root = new Group();
const modes = ['select', 'translate', 'rotate', 'scale'];
const fps = 30;
const selected = new Set();
let duration = 120;
let frame = 0;
let playing = false;
let recording = false;
let wireframe = false;
let mode = 'select';
let startedAt = 0;
let view;
let collisions;
let history = createHistory();
let savedRevision = history.revision;
let documentDirty = false;
let savingProject = false;
let drag;
let presetScene;
let presets;
let atmosphere = { ...defaultAtmosphere };
let renderSize = { ...defaultRenderSize };
let renderGuide = false;
let physicsCache = new WeakMap();
let angularCache = new WeakMap();
let sequence;
let toastEnd;
let animations = {
  clips: [{ ...mainClip }],
  active: 'main',
  enabled: ['main']
};
const openInspectorSections = new Set(['Dönüşüm']);
const inspectorPositions = new WeakMap();
let paintedInspector;
let previewCamera = false;
let cameraOverride;
let measuring = false;
let freeViewLabel;
let sceneName = 'Yeni sahne';
let sceneExpanded = false;
let previewStart;
let timelineTarget;
let movingKey;
let copiedKey;
let activePicker;

function status(message) {
  $('status').textContent = message;
  $('status').title = message;
}

function toast(message, kind = 'edit') {
  const notice = $('edit-toast');
  notice.className = 'edit-toast ' + kind;
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(toastEnd);
  toastEnd = setTimeout(
    () => notice.classList.add('fading'),
    kind === 'warning' ? 5200 : 1800
  );
}

function warnOverlap(objects) {
  const names = [...new Set(objects.map((object) => object.name))];
  const message =
    'Cisim şu cisimlerle iç içe: [' +
    names.join(', ') +
    ']. Devam etmek için önce cisimleri birbirinden ayırın.';
  status(message);
  toast(message, 'warning');
}

function single() {
  return selected.size === 1 ? selected.values().next().value : undefined;
}

function forObjects(callback) {
  root.traverse((object) => {
    if (object !== root) callback(object);
  });
}

function captureScene() {
  const objects = [];
  forObjects((object) => objects.push(object));
  return {
    project: JSON.stringify(
      encodeProject(root, duration, animations, atmosphere, undefined, sceneName, renderSize)
    ),
    frame,
    selection: [...selected].map((object) => objects.indexOf(object))
  };
}

function replaceScene(state) {
  const project = decodeProject(JSON.parse(state.project));
  const freeCameraId = freeViewLabel?.userData.cameraId;
  [...root.children].forEach(disposeObject);
  project.objects.forEach((object) => root.add(object));
  freeViewLabel = freeCameraId ? getCamera(freeCameraId) : undefined;
  duration = project.duration;
  animations = project.animations;
  atmosphere = project.atmosphere;
  sceneName = project.name;
  renderSize = project.renderSize;
  updateRenderGuide();
  resetPhysics();
  frame = state.frame;
  selected.clear();
  const objects = [];
  forObjects((object) => objects.push(object));
  for (const index of state.selection) {
    if (objects[index]) selected.add(objects[index]);
  }
  setWireframe(wireframe);
  refresh();
}

function updateHistory() {
  $('undo').disabled = !history.canUndo;
  $('redo').disabled = !history.canRedo;
  const dirty = presetScene
    ? presetScene.history.revision !== savedRevision || history.revision !== presetScene.initialRevision
    : history.revision !== savedRevision;
  if (dirty !== documentDirty) {
    documentDirty = dirty;
    window.rendercardDesktop?.setDocumentDirty(dirty);
  }
}

if (!window.rendercardDesktop) {
  window.addEventListener('beforeunload', event => {
    if (!documentDirty) return;
    event.preventDefault();
    event.returnValue = true;
  });
}

function resetPhysics() {
  physicsCache = new WeakMap();
  angularCache = new WeakMap();
}

function describeEdit(before, after) {
  const a = JSON.parse(before.project);
  const b = JSON.parse(after.project);
  if (JSON.stringify(a.renderSize) !== JSON.stringify(b.renderSize)) return 'Render çözünürlüğünü değiştir';
  if (a.name !== b.name) return 'Sahnenin adını değiştir';
  if (JSON.stringify(a.atmosphere) !== JSON.stringify(b.atmosphere))
    return 'Sisi düzenle';
  if (a.duration !== b.duration) return 'Animasyon süresini değiştir';
  if (a.animations.clips.length !== b.animations.clips.length)
    return a.animations.clips.length < b.animations.clips.length
      ? 'Animasyon ekle'
      : 'Animasyonu sil';
  if (
    a.animations.clips.some(
      (clip, index) => clip.name !== b.animations.clips[index]?.name
    )
  )
    return 'Animasyonun adını değiştir';
  const flatten = (objects) =>
    objects.flatMap((object) => [object, ...flatten(object.children)]);
  const left = flatten(a.objects);
  const right = flatten(b.objects);
  if (right.length > left.length) {
    const fresh = right.find(
      (object) => !left.some((previous) => previous.name === object.name)
    );
    return (types[fresh?.type] || 'Cisim') + ' ekle';
  }
  if (right.length < left.length) return 'Cismi sil';
  const fields = {
    name: 'Adı değiştir',
    solid: 'Katılığı değiştir',
    edgeRadii: 'Kenarları yuvarla',
    polygonRoundness: 'Kenarları yumuşat',
    segments: 'Geometriyi düzenle',
    detail: 'Yüzey ayrıntısını değiştir',
    color: 'Rengi değiştir',
    finish: 'Yüzey türünü değiştir',
    tile: 'Döşemeyi değiştir',
    tileScale: 'Döşeme ölçeğini değiştir',
    pivot: 'Merkez noktasını değiştir',
    hidden: 'Görünürlüğü değiştir',
    keys: 'Kareyi düzenle',
    tracks: 'Kareyi düzenle',
    restitution: 'Sekme oranını değiştir',
    initialVelocity: 'Başlangıç hızını değiştir',
    physicsAcceleration: 'İvmeyi değiştir',
    positionMode: 'Konum hareketini değiştir',
    speedProfile: 'Hız grafiğini değiştir',
    rotationPath: 'Dönüş yolunu değiştir',
    sceneClip: 'Nesnenin sahnesini değiştir',
    emitsLight: 'Işık yaymayı değiştir',
    emissionColor: 'Yayılan ışığın rengini değiştir',
    emissionPower: 'Işık gücünü değiştir',
    intensity: 'Işık gücünü değiştir',
    scale: 'Boyutu değiştir',
    rotation: 'Cismi döndür',
    position: 'Cismi taşı'
  };
  for (const [field, label] of Object.entries(fields)) {
    if (
      left.some(
        (object, index) =>
          JSON.stringify(object[field]) !==
          JSON.stringify(right[index]?.[field])
      )
    )
      return label;
  }
  return 'Sahneyi düzenle';
}

function commitEdit(before, description) {
  updateSceneVisibility();
  updateFollowers();
  if (selected.size > 1 && !drag) setMode(mode);
  const after = captureScene();
  if (before.project !== after.project) {
    resetPhysics();
    history.remember(before, after, description ?? describeEdit(before, after));
  }
  updateHistory();
}

function edit(callback, description) {
  setPlaying(false);
  if (sequence) {
    animations.enabled = sequence.ids;
    sequence = undefined;
    updateSceneVisibility();
  }
  const before = captureScene();
  resetPhysics();
  if (callback() === false) {
    replaceScene(before);
    return;
  }
  commitEdit(before, description);
}

function stepHistory(direction) {
  if (recording || drag || $('preset-dialog').open) return;
  const state = history.step(direction);
  if (!state) return;
  setPlaying(false);
  sequence = undefined;
  replaceScene(state);
  const message =
    (direction < 0 ? 'Geri al: ' : 'Yinele: ') + history.lastLabel;
  status(message);
  toast(message);
}

function settleObject(object, from) {
  const hit = from && collisions?.sweep(root, object, from);
  if (hit) warnOverlap([hit]);
  const overlap = collisions?.overlaps(root, object);
  if (overlap?.length) {
    warnOverlap(overlap);
    return false;
  }
  if (from && object.isCamera) {
    const target = getObjectById(object.userData.followTarget);
    if (target) captureFollowOffset(object, target);
  }
  updateExistingKey(object);
  fitParentPivots(object);
}

function positionPhysics(object, source, startFrame, atFrame = frame) {
  if (!source) return;
  let run = physicsCache.get(object);
  if (!run || run.source !== source) {
    const current = capture(object);
    applyPose(object, source);
    const origin = object.getWorldPosition(new Vector3());
    const bottom = new Box3().setFromObject(object, true).min.y;
    const castSolid = collisions?.staticContacts(root, object);
    const cast = (position, delta) => {
      let hit = castSolid?.(position, delta);
      if (
        object.userData.reactsToGround &&
        Number.isFinite(bottom) &&
        bottom >= -0.00001 &&
        delta.y < 0
      ) {
        const gap = bottom + position.y - origin.y;
        const floorTime = Math.max(0, -gap / delta.y);
        if (gap + delta.y <= 0 && floorTime <= (hit?.time ?? 1)) {
          hit = { time: floorTime, normal: new Vector3(0, 1, 0) };
        }
      }
      return hit;
    };
    const data = object.userData;
    run = {
      source,
      at: trajectory(
        origin,
        data.initialVelocity,
        data.physicsAcceleration,
        data.restitution,
        cast
      )
    };
    physicsCache.set(object, run);
    applyPose(object, current);
  }
  object.position.copy(
    object.parent.worldToLocal(run.at(Math.round(atFrame - startFrame)).clone())
  );
}

function rotationPhysics(object, source, keys, startFrame, linear) {
  if (!source) return;
  let run = angularCache.get(object);
  const data = object.userData;
  if (!run || run.source !== source || run.linear !== linear) {
    const current = capture(object);
    applyPose(object, source);
    const floor = data.reactsToGround && new Box3().setFromObject(object, true).min.y >= -0.00001;
    const apply = (angles, sample) => {
      if (keys) poseAt(object, startFrame + sample, keys);
      else applyPose(object, source);
      if (linear) positionPhysics(object, source, startFrame, startFrame + sample);
      object.rotation.fromArray(angles);
      const grounded = floor && new Box3().setFromObject(object, true).min.y < -0.00001;
      return grounded || Boolean(collisions?.overlaps(root, object, false, true).length);
    };
    run = {
      source, linear,
      at: angularTrajectory(source.rotation, data.angularVelocity.map(MathUtils.degToRad),
        data.angularAcceleration.map(MathUtils.degToRad), data.angularRestitution, apply)
    };
    angularCache.set(object, run);
    applyPose(object, current);
  }
  const current = capture(object);
  const angles = run.at(frame - startFrame);
  applyPose(object, current);
  object.rotation.fromArray(angles);
}

function poseScene(continuous = false) {
  const animated = [];
  forObjects((object) => {
    if (!inActiveScene(object)) return;
    const data = object.userData;
    if (object.isCamera && data.followTarget && data.followOffset) return;
    const keys = chooseTrack(object, animations.enabled, frame);
    const physical =
      data.positionMode === 'physics' &&
      (keys || animations.enabled.includes(data.physicsClip));
    const angular = data.rotationMode === 'physics' &&
      (keys || animations.enabled.includes(data.angularClip));
    if (
      keys ||
      (data.restPose && (hasKeys(object) || data.positionMode === 'physics' || data.rotationMode === 'physics'))
    ) {
      const before = collisions ? capture(object) : undefined;
      if (keys) poseAt(object, frame, keys);
      else if (data.restPose) applyPose(object, data.restPose);
      if (physical) {
        const source = keys?.[0] ?? data.restPose;
        positionPhysics(object, source, keys?.[0].frame ?? 0);
      }
      if (angular) rotationPhysics(object, keys?.[0] ?? data.restPose, keys, keys?.[0].frame ?? 0, Boolean(physical));
      if (!physical) animated.push({ object, before });
    }
  });
  if (collisions && animated.length) {
    for (const { object, before } of animated) {
      if (continuous)
        collisions.sweep(
          root,
          object,
          new Vector3().fromArray(before.position)
        );
      if (collisions.overlaps(root, object).length) applyPose(object, before);
    }
  }
}

function select(object, extend = false) {
  if (!extend) selected.clear();
  if (object) {
    if (selected.has(object)) selected.delete(object);
    else selected.add(object);
  }
  refresh();
}

function setMode(next) {
  if (next === 'scale' && (single()?.isCamera || single()?.isLight))
    next = 'select';
  mode = next;
  all('[data-mode]').forEach((button) =>
    button.setAttribute('aria-pressed', button.dataset.mode === mode)
  );
  view?.updateSelection(single(), mode, independentSelection());
}

for (const element of all('[data-icon]'))
  element.innerHTML = icon(element.dataset.icon);

function frameTo(next, continuous = false) {
  frame = Math.min(duration, Math.max(0, Math.round(next)));
  cameraOverride = undefined;
  poseScene(continuous);
  refreshFrame();
  refreshTransform();
  if (selected.size > 1 && !drag) setMode(mode);
}

function refreshFrame() {
  if (document.activeElement !== $('frame') || !playing)
    $('frame').value = frame;
  $('scrub').value = frame;
  $('playhead').style.left = (frame / duration) * 100 + '%';
  $('remove-key').disabled = ![...selected].some((object) =>
    keysFor(object, animations.active).some((key) => key.frame === frame)
  );
  $('camera-choice').value = cameraAt(animations, frame) ?? '';
  $('remove-camera-key').disabled = !animations.cameraTracks?.[
    animations.active
  ]?.some((key) => key.frame === frame);
  updateCameraView();
}

function setPlaying(value) {
  if (value && animations.enabled.length === 0) return;
  if (value && measuring) setMeasure(false);
  if (playing && !value && previewStart === undefined) {
    const camera = getCamera(cameraAt(animations, frame));
    if (camera) jumpToCamera(camera);
    else if (freeViewLabel) jumpToCamera();
  }
  playing = value;
  $('play').innerHTML = icon(playing ? 'pause' : 'play');
  $('play').setAttribute('aria-label', playing ? 'Duraklat' : 'Oynat');
  $('play').title = playing ? 'Duraklat (Boşluk)' : 'Oynat (Boşluk)';
  $('preview-play').innerHTML = icon(playing ? 'pause' : 'play');
  $('preview-play').setAttribute('aria-label', playing ? 'Duraklat' : 'Oynat');
  if (playing) {
    if (frame >= duration) frameTo(0);
    startedAt = performance.now() - (frame * 1000) / fps;
  }
  updateCameraView();
}

function stopAt(next) {
  setPlaying(false);
  frameTo(next);
}

function updateTimeline() {
  paintAtmosphere();
  paintCameraChoices();
  $('scrub').max = duration;
  $('frame').max = duration;
  $('duration').value = duration;
  paintClips();
  const clips = animations.clips.filter((clip) =>
    animations.enabled.includes(clip.id)
  );
  const tracks = [];
  const objects = [];
  forObjects(object => objects.push(object));
  for (const clip of clips) {
    const cameras = animations.cameraTracks?.[clip.id] ?? [];
    if (cameras.length || clip.id === animations.active) tracks.push({ clip, keys: cameras, camera: true });
    for (const object of objects) {
      const keys = keysFor(object, clip.id);
      if (keys.length || (clip.id === animations.active && selected.has(object)))
        tracks.push({ clip, keys, object });
    }
  }
  const labels = tracks.map(({ clip, object, camera }) => {
    const label = document.createElement(object ? 'button' : 'span');
    const name = camera ? 'Kamera geçişleri' : object.name;
    label.textContent = clips.length > 1 ? clip.name + ' · ' + name : name;
    label.title = clip.name + ' · ' + name;
    if (object) {
      label.classList.toggle('selected', selected.has(object));
      label.onclick = event => select(object, event.shiftKey);
    }
    return label;
  });
  $('track-name').replaceChildren(...labels);
  $('track').style.minHeight = Math.max(48, 19 + 20 * tracks.length) + 'px';
  $('paste-key').hidden = !copiedKey;
  $('paste-key').disabled = !single();
  const tickCount = Math.min(duration, 8);
  $('ticks').replaceChildren(
    ...Array.from({ length: tickCount + 1 }, (_, index) => {
      const tick = document.createElement('span');
      const value = Math.round((index / tickCount) * duration);
      tick.className = 'tick';
      tick.style.left = (value / duration) * 100 + '%';
      tick.textContent = value;
      return tick;
    })
  );
  $('key-markers').replaceChildren(
    ...tracks.flatMap(({ clip, keys, object, camera }, lane) => keys
        .filter((key) => key.frame <= duration)
        .map((key) => {
          const marker = document.createElement('button');
          marker.className = 'key-dot' + (camera ? ' camera-dot' : '');
          marker.style.top = 23 + lane * 20 + 'px';
          marker.style.left = (key.frame / duration) * 100 + '%';
          marker.title = (camera ? (getCamera(key.camera)?.name ?? 'Varsayılan') : object.name) + ' · ' + key.frame;
          bindTimelineMarker(marker, { clip: clip.id, frame: key.frame, lane, camera, object });
          return marker;
        }))
  );
  refreshFrame();
}

function timelineKeys(target) {
  return target.camera ? animations.cameraTracks?.[target.clip] ?? [] : keysFor(target.object, target.clip);
}

function bindTimelineMarker(marker, target) {
  marker.setAttribute('aria-label', (target.camera ? 'Kamera geçişi · ' : 'Anahtar kare · ') + marker.title);
  marker.onclick = () => {
    stopAt(target.frame);
    if (target.object && !selected.has(target.object)) select(target.object);
  };
  marker.oncontextmenu = event => {
    event.preventDefault();
    cancelKeyMove();
    timelineTarget = target;
    const menu = $('timeline-menu');
    $('timeline-camera-field').hidden = !target.camera;
    $('timeline-copy').hidden = Boolean(target.camera);
    if (target.camera) {
      const select = $('timeline-camera-change');
      select.replaceChildren(new Option('Varsayılan', ''));
      forObjects(object => {
        if (object.isCamera) select.add(new Option(object.name, object.userData.cameraId));
      });
      select.value = timelineKeys(target).find(key => key.frame === target.frame)?.camera ?? '';
    }
    menu.hidden = false;
    menu.style.left = Math.max(0, Math.min(event.clientX, innerWidth - menu.offsetWidth - 5)) + 'px';
    menu.style.top = Math.max(0, Math.min(event.clientY, innerHeight - menu.offsetHeight - 5)) + 'px';
    $('timeline-move').focus();
  };
}

function cancelKeyMove() {
  if (!movingKey) return;
  movingKey.marker.remove();
  $('track').classList.remove('moving-key');
  movingKey = undefined;
}

function pointerFrame(clientX) {
  const bounds = $('track').getBoundingClientRect();
  const fraction = MathUtils.clamp((clientX - bounds.left) / bounds.width, 0, 1);
  return Math.round(fraction * duration);
}

$('timeline-move').onclick = () => {
  if (!timelineTarget) return;
  $('timeline-menu').hidden = true;
  setPlaying(false);
  const { lane, camera, frame } = timelineTarget;
  const marker = document.createElement('span');
  marker.className = 'key-dot moving-dot' + (camera ? ' camera-dot' : '');
  marker.style.top = 23 + lane * 20 + 'px';
  marker.style.left = (frame / duration) * 100 + '%';
  $('track').append(marker);
  $('track').classList.add('moving-key');
  movingKey = { target: timelineTarget, marker };
  status('Kareyi taşımak için zaman çizelgesinde bir yere tıkla. Esc iptal eder.');
};
$('timeline-delete').onclick = () => {
  const target = timelineTarget;
  $('timeline-menu').hidden = true;
  if (!target) return;
  edit(() => {
    const keys = timelineKeys(target);
    const index = keys.findIndex(key => key.frame === target.frame);
    if (index >= 0) keys.splice(index, 1);
    frameTo(frame);
    updateTimeline();
  }, target.camera ? 'Kamera geçişini sil' : 'Anahtar kareyi sil');
};
$('timeline-copy').onclick = () => {
  const target = timelineTarget;
  $('timeline-menu').hidden = true;
  if (!target?.object) return;
  const key = timelineKeys(target).find(item => item.frame === target.frame);
  if (!key) return;
  copiedKey = structuredClone(key);
  $('paste-key').hidden = false;
  $('paste-key').disabled = !single();
  status(target.object.name + ' · ' + target.frame + '. kare kopyalandı.');
};
$('paste-key').onclick = () => {
  const object = single();
  if (!object || !copiedKey) return;
  edit(() => {
    writeKey(object, frame, animations.active, structuredClone(copiedKey));
    frameTo(frame);
    updateTimeline();
  }, 'Anahtar kareyi yapıştır');
  status(object.name + ' · ' + frame + '. kareye yapıştırıldı.');
};
$('timeline-camera-change').onchange = event => {
  const target = timelineTarget;
  const camera = event.currentTarget.value || null;
  $('timeline-menu').hidden = true;
  if (!target?.camera) return;
  edit(() => {
    const key = timelineKeys(target).find(entry => entry.frame === target.frame);
    if (key) key.camera = camera;
    updateTimeline();
  }, 'Geçilecek kamerayı değiştir');
};
document.addEventListener('pointermove', event => {
  if (movingKey) movingKey.marker.style.left = (pointerFrame(event.clientX) / duration) * 100 + '%';
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#timeline-menu')) $('timeline-menu').hidden = true;
  if (!movingKey || event.button !== 0) return;
  if (!event.target.closest('#track')) {
    cancelKeyMove();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const target = movingKey.target;
  const destination = pointerFrame(event.clientX);
  const keys = timelineKeys(target);
  if (destination !== target.frame && keys.some(key => key.frame === destination)) {
    status('Bu konumda zaten bir kare var. Başka bir kare seç.');
    return;
  }
  cancelKeyMove();
  if (destination === target.frame) return;
  edit(() => {
    const key = keys.find(key => key.frame === target.frame);
    if (key) key.frame = destination;
    keys.sort((a, b) => a.frame - b.frame);
    frameTo(destination);
    updateTimeline();
  }, target.camera ? 'Kamera geçişini taşı' : 'Anahtar kareyi taşı');
}, { capture: true });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  $('timeline-menu').hidden = true;
  cancelKeyMove();
});

function getCamera(id) {
  if (!id) return undefined;
  let result;
  forObjects((object) => {
    if (object.isCamera && object.userData.cameraId === id) result = object;
  });
  return result;
}

function getObjectById(id) {
  if (!id) return undefined;
  let result;
  forObjects(object => { if (object.userData.objectId === id) result = object; });
  return result;
}

function followTargets(camera) {
  const targets = [];
  forObjects(object => {
    if (!object.isMesh && object.userData.type !== 'group') return;
    for (let node = camera; node; node = node.parent) if (node === object) return;
    targets.push(object);
  });
  return targets;
}

function captureFollowOffset(camera, target) {
  const offset = camera.getWorldPosition(new Vector3()).sub(target.getWorldPosition(new Vector3()));
  if (offset.lengthSq() < 0.000001) offset.set(0, 0, 1).applyQuaternion(camera.getWorldQuaternion(camera.quaternion.clone()));
  camera.userData.followOffset = offset.toArray();
}

function updateFollowers() {
  forObjects(camera => {
    const data = camera.userData;
    if (!camera.isCamera || !data.followTarget || !data.followOffset || !inActiveScene(camera)) return;
    const target = getObjectById(data.followTarget);
    if (!target || !inActiveScene(target)) return;
    const center = target.getWorldPosition(new Vector3());
    const desired = new Vector3().fromArray(data.followOffset).add(center);
    const position = data.affectsSolids && collisions ? collisions.followCamera(root, camera, desired) : desired;
    camera.position.copy(camera.parent.worldToLocal(position.clone()));
    camera.lookAt(center);
  });
}

function paintCameraChoices() {
  const options = [new Option('Varsayılan', '')];
  forObjects((object) => {
    if (object.isCamera)
      options.push(new Option(object.name, object.userData.cameraId));
  });
  $('camera-choice').replaceChildren(...options);
}

function updateCameraView() {
  updateFollowers();
  const preview = previewCamera || playing || recording;
  const useOverride =
    previewCamera && !playing && !recording && cameraOverride !== undefined;
  const outputCamera = getCamera(cameraAt(animations, frame));
  const camera = useOverride ? getCamera(cameraOverride) : outputCamera;
  view?.setShot(camera, preview, outputCamera);
  $('viewport-camera-name').textContent =
    preview ? (camera?.name ?? 'Varsayılan') : (view?.axisLabel ?? freeViewLabel?.name ?? 'Varsayılan');
}

function jumpToCamera(camera) {
  previewCamera = false;
  cameraOverride = undefined;
  freeViewLabel = camera;
  $('preview-camera').setAttribute('aria-pressed', 'false');
  view?.useCameraView(camera);
}

$('camera-choice').onchange = (event) => {
  cameraOverride = event.target.value || null;
  updateCameraView();
};
$('preview-camera').onclick = () => {
  previewCamera = !previewCamera;
  $('preview-camera').setAttribute('aria-pressed', String(previewCamera));
  cameraOverride = previewCamera ? $('camera-choice').value || null : undefined;
  updateCameraView();
};
$('add-camera-key').onclick = () =>
  edit(() => {
    writeCameraKey(animations, frame, $('camera-choice').value || null);
    cameraOverride = undefined;
    updateTimeline();
  }, 'Kamera karesi ekle');
$('remove-camera-key').onclick = () =>
  edit(() => {
    const track = animations.cameraTracks?.[animations.active];
    if (track)
      animations.cameraTracks[animations.active] = track.filter(
        (key) => key.frame !== frame
      );
    cameraOverride = undefined;
    updateTimeline();
  }, 'Kamera karesini sil');

function paintClips() {
  const active = $('clip-active');
  active.replaceChildren(
    ...animations.clips.map((clip) => new Option(clip.name, clip.id))
  );
  active.value = animations.active;
  $('clip-name').value = animations.clips.find(
    (clip) => clip.id === animations.active
  ).name;
  $('clip-list').replaceChildren(
    ...animations.clips.map((clip) => {
      const label = document.createElement('label');
      label.className = 'check-field';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = animations.enabled.includes(clip.id);
      checkbox.onchange = () => {
        const checked = new Set(animations.enabled);
        if (checkbox.checked) checked.add(clip.id);
        else checked.delete(clip.id);
        edit(() => useClips(
          animations.clips
            .filter((item) => checked.has(item.id))
            .map((item) => item.id)
        ), 'Etkin animasyonları değiştir');
      };
      label.append(checkbox, clip.name);
      const row = document.createElement('div');
      row.className = 'clip-row';
      const remove = document.createElement('button');
      remove.className = 'quiet';
      remove.title = clip.name + ' animasyonunu sil';
      remove.setAttribute('aria-label', remove.title);
      remove.innerHTML = icon('trash');
      remove.onclick = () => edit(() => removeClip(clip.id), 'Animasyonu sil');
      row.append(label, remove);
      return row;
    })
  );
  $('clip-play-selected').disabled = animations.enabled.length === 0;
  $('clip-play-sequence').disabled = animations.enabled.length === 0;
  $('play').disabled = animations.enabled.length === 0;
}

function removeClip(id) {
  if (animations.cameraTracks) delete animations.cameraTracks[id];
  const replacement = animations.clips.find((clip) => clip.id !== id) ?? {
    ...mainClip
  };
  forObjects((object) => {
    const data = object.userData;
    if (id === 'main') data.keys = [];
    else delete data.tracks[id];
    if (data.sceneClip === id) data.sceneClip = null;
    if (data.physicsClip === id) data.physicsClip = replacement.id;
    if (data.angularClip === id) data.angularClip = replacement.id;
  });
  animations.clips = animations.clips.filter((clip) => clip.id !== id);
  if (!animations.clips.length) animations.clips.push(replacement);
  if (animations.active === id) animations.active = replacement.id;
  const retained = animations.enabled.filter((item) => item !== id);
  useClips(retained.length ? retained : [replacement.id]);
}

function useClips(ids) {
  sequence = undefined;
  resetPhysics();
  animations.enabled = ids;
  updateSceneVisibility();
  stopAt(frame);
  updateTimeline();
  paintInspector();
}

function inActiveScene(object) {
  for (let node = object; node; node = node.parent) {
    if (node.clipActive === false) return false;
  }
  return true;
}

function updateSceneVisibility() {
  forObjects((object) => {
    const { sceneClip, hidden, opacity } = object.userData;
    object.clipActive = !sceneClip || animations.enabled.includes(sceneClip);
    object.visible = object.clipActive && !hidden && (opacity ?? 100) > 0;
  });
}

$('clip-active').onchange = (event) => edit(() => {
  const wasSolo =
    animations.enabled.length === 1 &&
    animations.enabled[0] === animations.active;
  animations.active = event.target.value;
  if (wasSolo) useClips([animations.active]);
  else {
    updateTimeline();
    paintInspector();
  }
}, 'Düzenlenen animasyonu değiştir');
$('clip-name').onchange = (event) =>
  edit(() => {
    const clip = animations.clips.find((item) => item.id === animations.active);
    clip.name = event.target.value.trim() || clip.name;
    updateTimeline();
    paintInspector();
  });
$('clip-add').onclick = () =>
  edit(() => {
    const clip = {
      id: 'clip-' + crypto.randomUUID(),
      name: 'Animasyon ' + (animations.clips.length + 1)
    };
    animations.clips.push(clip);
    animations.active = clip.id;
    useClips([clip.id]);
  });
$('clip-select-all').onclick = () =>
  edit(() => useClips(animations.clips.map((clip) => clip.id)), 'Etkin animasyonları değiştir');
function playClips() {
  if (!animations.enabled.length) return;
  $('clip-name').closest('details').open = false;
  sequence = undefined;
  stopAt(0);
  setPlaying(true);
}
$('clip-play-selected').onclick = playClips;
$('clip-play-all').onclick = () => {
  edit(() => useClips(animations.clips.map((clip) => clip.id)), 'Etkin animasyonları değiştir');
  playClips();
};
$('clip-play-sequence').onclick = () => {
  const ids = animations.clips
    .filter((clip) => animations.enabled.includes(clip.id))
    .map((clip) => clip.id);
  if (!ids.length) return;
  $('clip-name').closest('details').open = false;
  sequence = { ids, remaining: ids.slice(), end: duration };
  nextClip();
};

function nextClip() {
  const next = sequence.remaining.shift();
  if (!next) {
    const ids = sequence.ids;
    useClips(ids);
    return;
  }
  resetPhysics();
  animations.enabled = [next];
  updateSceneVisibility();
  let end = 0;
  let physics = false;
  forObjects((object) => {
    if (!inActiveScene(object)) return;
    const keys = keysFor(object, next);
    end = Math.max(end, keys.at(-1)?.frame ?? 0);
    physics ||=
      (object.userData.positionMode === 'physics' &&
      (keys.length > 0 || object.userData.physicsClip === next)) ||
      (object.userData.rotationMode === 'physics' &&
      (keys.length > 0 || object.userData.angularClip === next));
  });
  sequence.end = physics || end === 0 ? duration : Math.min(duration, end);
  stopAt(0);
  updateTimeline();
  setPlaying(true);
  status(
    animations.clips.find((clip) => clip.id === next).name + ' oynatılıyor.'
  );
}

const dismissMenus = (target) => {
  for (const menu of all(
    '.clip-menu-wrap, .fog-menu-wrap, .camera-menu-wrap, .color-editor'
  )) {
    if (!target || !menu.contains(target)) menu.open = false;
  }
  if (!target || !$('view-camera-menu').contains(target)) $('view-camera-menu').hidden = true;
};
document.addEventListener(
  'pointerdown',
  (event) => dismissMenus(event.target),
  { capture: true }
);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') dismissMenus();
});
document.addEventListener('rendercard-color-mode', (event) => {
  if (activePicker)
    activePicker.setAttribute('aria-pressed', String(event.detail));
  if (!event.detail) activePicker = undefined;
});

function pickSceneColor(callback, button) {
  setPlaying(false);
  if (measuring) setMeasure(false);
  if (activePicker && activePicker !== button) view?.pickColor(undefined);
  activePicker = button;
  const active = view?.toggleColor(callback);
  status(
    active
      ? 'Sahnede renk almak istediğin noktaya tıkla.'
      : 'Renk seçimi iptal edildi.'
  );
  return active;
}

function setMeasure(active) {
  if (!view) return;
  if (active) {
    setPlaying(false);
    if (previewCamera) jumpToCamera(getCamera(cameraOverride ?? cameraAt(animations, frame)));
  }
  measuring = active;
  view.setMeasuring(active);
  $('measure').setAttribute('aria-pressed', String(active));
  updateCameraView();
  status(active ? 'Ölçmek için ilk noktayı seç. Esc ölçümü kapatır.' : 'Mesafe ölçümü kapatıldı.');
}
$('measure').onclick = () => setMeasure(!measuring);

const fogPalette = $('fog-palette');
fogPalette.innerHTML = fogColorMarkup();
const fogColor = new Color(atmosphere.color);
const refreshFogColor = bindColor(fogPalette, fogColor, {
  prefix: 'fog-',
  edit: (callback) => edit(callback, 'Sis rengini değiştir'),
  pick: pickSceneColor,
  status,
  changed: () => {
    atmosphere.color = '#' + fogColor.getHexString();
    view?.setAtmosphere(atmosphere);
  }
});

function paintAtmosphere() {
  $('fog-enabled').checked = atmosphere.enabled;
  fogColor.set(atmosphere.color);
  refreshFogColor();
  $('fog-near').value = atmosphere.near;
  $('fog-far').value = atmosphere.far;
  $('default-light').setAttribute(
    'aria-pressed',
    String(atmosphere.defaultLight)
  );
  view?.setAtmosphere(atmosphere);
}
for (const field of ['enabled', 'near', 'far']) {
  $('fog-' + field).onchange = (event) =>
    edit(() => {
      const input = event.currentTarget;
      if (field === 'enabled') atmosphere.enabled = input.checked;
      else if (Number.isFinite(input.valueAsNumber)) {
        atmosphere[field] =
          field === 'near'
            ? MathUtils.clamp(input.valueAsNumber, 0, atmosphere.far - 0.1)
            : Math.max(atmosphere.near + 0.1, input.valueAsNumber);
      }
      paintAtmosphere();
    }, 'Sisi düzenle');
}
$('default-light').onclick = () =>
  edit(() => {
    atmosphere.defaultLight = !atmosphere.defaultLight;
    paintAtmosphere();
  }, 'Varsayılan ışığı değiştir');

function paintList() {
  const rows = [];
  let triangles = 0;
  let objectCount = 0;
  const alignmentAnchor = independentSelection()[0];
  function rowFor(object, depth) {
    objectCount++;
    if (object.isMesh) triangles += object.geometry.index.count / 3;
    if (!sceneExpanded && !selected.has(object)) {
      object.children.forEach(child => rowFor(child, depth + 1));
      return;
    }
    const type = object.userData.type;
    const row = document.createElement('button');
    row.className = 'object-row' + (selected.has(object) ? ' selected' : '');
    if (selected.size > 1 && object === alignmentAnchor) row.classList.add('alignment-reference');
    row.setAttribute('aria-pressed', selected.has(object));
    row.title = object === alignmentAnchor && selected.size > 1
      ? object.name + ' · Hizalama referansı' : object.name;
    row.innerHTML =
      '<span class="object-icon">' +
      icon(type) +
      '</span><span class="row-name"></span><span class="row-type">' +
      types[type] +
      '</span><span class="object-badges"></span>';
    row.querySelector('.row-name').textContent = object.name;
    row.querySelector('.object-badges').innerHTML =
      (object.userData.negative
        ? '<span class="negative-badge" title="Negatif · Delik aç" aria-label="Negatif">−</span>'
        : '') +
      (object.userData.solid
        ? '<span class="solid-badge" title="Katı" aria-label="Katı">S</span>'
        : '');
    row.onclick = (event) => select(object, event.shiftKey);
    row.oncontextmenu = (event) => presets.openContext(event, object);
    const entry = document.createElement('div');
    entry.className = 'object-entry';
    entry.style.paddingLeft = (sceneExpanded ? depth * 10 : 0) + 'px';
    const visibility = document.createElement('button');
    visibility.className = 'object-eye';
    visibility.title = object.userData.hidden ? 'Önizlemede göster' : 'Önizlemede gizle';
    visibility.setAttribute('aria-label', visibility.title + ' · ' + object.name);
    visibility.setAttribute('aria-pressed', String(!object.userData.hidden));
    visibility.innerHTML = icon(object.userData.hidden ? 'eyeOff' : 'eye');
    visibility.onclick = () => edit(() => {
      object.userData.hidden = !object.userData.hidden;
      updateSceneVisibility();
      paintList();
    }, 'Önizleme görünürlüğünü değiştir');
    visibility.oncontextmenu = (event) => presets.openContext(event, object);
    entry.append(visibility, row);
    rows.push(entry);
    object.children.forEach((child) => rowFor(child, depth + 1));
  }
  root.children.forEach((object) => rowFor(object, 0));
  $('object-list').replaceChildren(...rows);
  $('object-count').textContent = objectCount;
  $('object-list').hidden = !sceneExpanded && !selected.size;
  const toggle = $('toggle-scene');
  toggle.textContent = sceneExpanded ? '−' : '+';
  toggle.setAttribute('aria-expanded', String(sceneExpanded));
  toggle.title = sceneExpanded ? 'Sahne bölümünü daralt' : 'Tüm sahneyi genişlet';
  toggle.setAttribute('aria-label', toggle.title);
  $('mesh-count').textContent = triangles.toLocaleString('tr-TR') + ' üçgen';
}

const fields = { position: 'Konum', rotation: 'Dönüş (°)', scale: 'Boyut' };

function dimensionStep() {
  return $('snap-grid').checked
    ? MathUtils.clamp($('snap-step').valueAsNumber || 1, 0.001, 100)
    : 0;
}

function unscaledSize(object) {
  if (object.isMesh) {
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    return object.geometry.boundingBox.getSize(new Vector3());
  }
  return localBounds(object).getSize(new Vector3());
}
function paintInspector() {
  const object = single();
  const panel = $('inspector-content');
  const scroller = panel.closest('.inspector');
  if (paintedInspector)
    inspectorPositions.set(paintedInspector, scroller.scrollTop);
  paintedInspector = object;
  if (!object) {
    panel.innerHTML = '<p class="empty"></p>';
    panel.firstChild.textContent = selected.size
      ? selected.size + ' nesne seçili. Birlikte düzenlemek için grupla.'
      : 'Düzenlemek için bir nesne seç.';
    scroller.scrollTop = 0;
    return;
  }
  panel.innerHTML =
    '<div class="inspector-block"><label class="field">Nesne adı<input id="object-name" maxlength="80"></label></div>' +
    '<div class="inspector-block"><h3>Dönüşüm</h3><div class="axis-table">' +
    axisHeading(
      !object.isLight && !object.isCamera
        ? '<button id="link-size" class="quiet" aria-label="Boyut oranlarını bağla" title="Boyut oranlarını bağla">' +
            icon('link') +
            '</button>'
        : ''
    ) +
    Object.entries(fields)
      .filter(([channel]) =>
        object.isLight
          ? channel === 'position'
          : !object.isCamera || channel !== 'scale'
      )
      .map(([channel, title]) =>
        axisRow(
          title,
          axes.map(
            (axis) =>
              '<input type="number" inputmode="decimal" step="any" aria-label="' +
              title +
              ' ' +
              axis.toUpperCase() +
              '" data-transform="' +
              channel +
              '" data-axis="' +
              axis +
              '">'
          )
        )
      )
      .join('') +
    '</div></div>' +
    settingsMarkup(object) +
    '<button id="inspector-delete" class="danger-button">Cismi sil</button>';
  for (const block of panel.querySelectorAll('.inspector-block')) {
    const heading = block.querySelector('h3');
    if (!heading) continue;
    const name = heading.textContent;
    let header = heading.closest('.setting-heading');
    if (!header) {
      header = document.createElement('div');
      header.className = 'setting-heading';
      block.prepend(header);
      header.append(heading);
    }
    const content = document.createElement('div');
    const toggle = document.createElement('button');
    toggle.className = 'inspector-toggle quiet';
    for (const node of [...block.children])
      if (node !== header) content.append(node);
    header.append(toggle);
    block.append(content);
    const update = () => {
      const open = openInspectorSections.has(name);
      content.hidden = !open;
      toggle.textContent = open ? '−' : '+';
      toggle.setAttribute(
        'aria-label',
        name + (open ? ' bölümünü daralt' : ' bölümünü genişlet')
      );
      toggle.setAttribute('aria-expanded', open);
    };
    toggle.onclick = () => {
      if (openInspectorSections.has(name)) openInspectorSections.delete(name);
      else openInspectorSections.add(name);
      update();
    };
    update();
  }
  $('inspector-delete').onclick = () => edit(deleteSelection);
  if ($('link-size')) {
    const button = $('link-size');
    const paint = () =>
      button.setAttribute('aria-pressed', String(object.userData.linkedSize));
    button.onclick = () =>
      edit(() => {
        object.userData.linkedSize = !object.userData.linkedSize;
        paint();
      }, 'Boyut oranı kilidini değiştir');
    paint();
  }
  const name = $('object-name');
  name.value = object.name;
  name.onchange = () =>
    edit(() => {
      object.name = name.value.trim() || types[object.userData.type];
      name.value = object.name;
      paintList();
      updateTimeline();
    });
  for (const input of all('[data-transform="scale"]')) {
    input.onfocus = input.onpointerenter = () =>
      view?.highlightEdges(object, input.dataset.axis);
    input.onblur = input.onpointerleave = () => view?.highlightEdges();
    input.onkeydown = (event) => {
      if (event.key === 'Enter' && !event.ctrlKey) input.blur();
    };
  }
  for (const input of all('[data-transform]')) {
    input.onchange = () => {
      const { transform: channel, axis } = input.dataset;
      const value = input.valueAsNumber;
      if (!Number.isFinite(value) || (channel === 'scale' && value < 0.001)) {
        status(
          channel === 'scale'
            ? 'Boyut en az 0,001 olmalı.'
            : 'Geçerli bir sayı gir.'
        );
      } else {
        edit(() => {
          const position = object.position.clone();
          const scale = object.scale.clone();
          const bounds = channel === 'scale' ? localBounds(object) : undefined;
          object[channel][axis] =
            channel === 'scale'
              ? bounds.getSize(new Vector3())[axis]
                ? value / bounds.getSize(new Vector3())[axis]
                : object.scale[axis]
              : channel === 'rotation'
                ? MathUtils.degToRad(value)
                : value;
          if (bounds) {
            object.scale.copy(
              constrainDimensions(
                scale,
                object.scale,
                bounds.getSize(new Vector3()),
                [axis],
                object.userData.linkedSize,
                dimensionStep()
              )
            );
          }
          return settleObject(
            object,
            channel === 'position' ? position : undefined
          );
        });
      }
      refreshTransform();
    };
  }
  bindSettings(panel, object, {
    edit,
    scenes: animations.clips,
    sceneChanged: updateSceneVisibility,
    setMotion: (update, kind = 'linear') =>
      edit(() => {
        if (
          !object.userData.restPose ||
          (!hasKeys(object) && object.userData.positionMode !== 'physics' && object.userData.rotationMode !== 'physics')
        ) {
          object.userData.restPose = capture(object);
        }
        object.userData[kind === 'angular' ? 'angularClip' : 'physicsClip'] = animations.active;
        update();
        frameTo(frame);
      }),
    status,
    highlight: (axis) => view?.highlightEdges(axis ? object : undefined, axis),
    pick: pickSceneColor,
    followOptions: object.isCamera ? followTargets(object) : [],
    collisionChanged: paintList,
    setFollow: (id) => edit(() => {
      const target = followTargets(object).find(item => item.userData.objectId === id);
      object.userData.followTarget = target?.userData.objectId ?? null;
      object.userData.followOffset = null;
      if (target) captureFollowOffset(object, target);
      updateCameraView();
      refreshTransform();
    }, 'Kamera takibini değiştir'),
    collisionReady: Boolean(collisions),
    changed: (changedObject, from) => {
      if (changedObject && settleObject(changedObject, from) === false)
        return false;
      paintList();
      refreshTransform();
    },
    toggleSolid: (solid, value) => {
      const intersections = value
        ? collisions?.overlaps(root, solid, true)
        : [];
      if (intersections?.length) {
        warnOverlap(intersections);
        return;
      }
      solid.userData.solid = value;
      paintList();
      status(value ? 'Katılık açıldı.' : 'Katılık kapatıldı.');
      refreshTransform();
    }
  });
  refreshTransform();
  scroller.scrollTop = inspectorPositions.get(object) ?? 0;
}

function refreshTransform() {
  const object = single();
  if (!object) return;
  const size =
    object.isLight || object.isCamera ? undefined : unscaledSize(object);
  for (const input of all('[data-transform]')) {
    if (input === document.activeElement && input.value !== '' && playing)
      continue;
    const { transform: channel, axis } = input.dataset;
    const value =
      channel === 'scale'
        ? size[axis] * object.scale[axis]
        : object[channel][axis];
    input.value = Number(
      (channel === 'rotation' ? MathUtils.radToDeg(value) : value).toFixed(3)
    );
  }
}

function updateExistingKey(object) {
  if (keysFor(object, animations.active).some((key) => key.frame === frame))
    writeKey(object, frame, animations.active);
  else if ((object.userData.positionMode === 'physics' || object.userData.rotationMode === 'physics') && !hasKeys(object))
    object.userData.restPose = capture(object);
}

function canGroup() {
  const objects = [...selected];
  return (
    objects.length >= 2 &&
    objects.every((object) => object.parent === objects[0].parent)
  );
}

function independentSelection() {
  return [...selected].filter((object) => {
    for (let parent = object.parent; parent; parent = parent.parent) {
      if (selected.has(parent)) return false;
    }
    return true;
  });
}

function refresh() {
  updateSceneVisibility();
  view?.pickColor(undefined);
  paintList();
  $('scene-name').value = sceneName;
  paintInspector();
  updateTimeline();
  setMode(mode);
  $('group').disabled = !canGroup();
  $('join').disabled = !canGroup() || ![...selected].every(object => object.isMesh);
  $('ungroup').disabled = single()?.userData.type !== 'group';
  $('delete').disabled = selected.size === 0;
  $('add-key').disabled = selected.size === 0;
  $('save-preset').disabled = root.children.length === 0;
  const cannotAlign = independentSelection().length < 2;
  for (const button of all('[data-align]')) button.disabled = cannotAlign;
  updateHistory();
}

function showPresetScene(show) {
  $('preset-editor').hidden = !show;
  $('create-preset').disabled = show;
  $('save').disabled = show;
  $('open').disabled = show;
}

presets = installPresets({
  begin() {
    if (presetScene) return;
    setPlaying(false);
    presetScene = {
      scene: captureScene(),
      history,
      mode,
      camera: view?.captureCamera()
    };
    history = createHistory();
    presetScene.initialRevision = history.revision;
    mode = 'select';
    replaceScene({
      project: JSON.stringify({
        version: projectVersion,
        name: 'Preset sahnesi',
        duration: 120,
        objects: []
      }),
      frame: 0,
      selection: []
    });
    showPresetScene(true);
    view?.reset();
    status('Boş preset sahnesi açıldı.');
  },
  finish(saved) {
    if (!presetScene) return;
    const previous = presetScene;
    presetScene = undefined;
    history = previous.history;
    mode = previous.mode;
    setPlaying(false);
    replaceScene(previous.scene);
    if (previous.camera) view?.restoreCamera(previous.camera);
    showPresetScene(false);
    if (!saved) status('Preset oluşturma iptal edildi.');
  },
  current: () => encodeProject(root, duration, animations, atmosphere),
  fromObject: (object) => ({
    version: projectVersion,
    duration,
    animations: {
      clips: animations.clips,
      active: animations.active,
      enabled: animations.enabled
    },
    objects: [encodeObject(object)]
  }),
  renameObject(object, name) {
    edit(() => {
      object.name = name;
      refresh();
    }, 'Adı değiştir');
  },
  deleteObject(object) {
    edit(() => {
      select(object);
      deleteSelection();
    }, 'Cismi sil');
  },
  duplicateObject(object) {
    duplicateObjects(selected.has(object) ? independentSelection() : [object]);
  },
  focusObject(object) {
    focusObjects(selected.has(object) ? independentSelection() : [object]);
  },
  insert(record) {
    const project = decodeProject(record.project);
    if (!project.objects.length) return;
    edit(() => {
      for (const clip of project.animations.clips) {
        if (!animations.clips.some((existing) => existing.id === clip.id)) {
          animations.clips.push(clip);
          animations.enabled.push(clip.id);
        }
      }
      const idMap = new Map();
      for (const object of project.objects) {
        object.traverse((child) => {
          const oldId = child.userData.objectId;
          child.userData.objectId = crypto.randomUUID();
          idMap.set(oldId, child.userData.objectId);
          if (child.isCamera) child.userData.cameraId = crypto.randomUUID();
        });
      }
      for (const object of project.objects) {
        object.traverse(child => {
          if (child.isCamera) {
            child.userData.followTarget = idMap.get(child.userData.followTarget) ?? null;
            if (!child.userData.followTarget) child.userData.followOffset = null;
          }
        });
        root.add(object);
      }
      const object =
        project.objects.length === 1
          ? project.objects[0]
          : groupObjects(project.objects);
      object.name = record.name;
      const from = object.position.clone();
      object.position.x = 0;
      object.position.z = 1.7;
      groundObject(object);
      collisions?.separate(root, object);
      const offset = object.position.clone().sub(from).toArray();
      for (const key of posesOf(object)) {
        key.position = key.position.map((value, axis) => value + offset[axis]);
      }
      object.traverse((child) => {
        for (const key of posesOf(child))
          if (key.frame != null) duration = Math.max(duration, key.frame);
      });
      setWireframe(wireframe);
      select(object);
      setMode('translate');
      status(record.name + ' eklendi.');
    });
  },
  status
});

function addObject(type) {
  setPlaying(false);
  let index = 1;
  const names = new Set();
  forObjects((object) => names.add(object.name));
  while (names.has(types[type] + ' ' + index)) index++;
  const object = makeObject(type, types[type] + ' ' + index);
  if (animations.active !== 'main') {
    object.userData.sceneClip = animations.active;
    if (!animations.enabled.includes(animations.active)) {
      animations.enabled = animations.clips
        .map((clip) => clip.id)
        .filter(
          (id) => id === animations.active || animations.enabled.includes(id)
        );
    }
  }
  object.position.set(
    Math.min((index - 1) * 0.35, 2.1),
    type === 'light' ? 3 : type === 'camera' ? 1.5 : 0.5,
    type === 'camera' ? 5 : 1.7
  );
  if (object.isMesh) object.material.wireframe = wireframe;
  root.add(object);
  updateSceneVisibility();
  collisions?.separate(root, object);
  if (settleObject(object) === false) return false;
  select(object);
  setMode('translate');
  status(object.name + ' eklendi.');
}

function deleteSelection() {
  if (!selected.size) return;
  setPlaying(false);
  const targets = independentSelection();
  const removedCameras = new Set();
  const removedObjects = new Set();
  for (const target of targets)
    target.traverse((object) => {
      removedObjects.add(object.userData.objectId);
      if (object.isCamera) removedCameras.add(object.userData.cameraId);
    });
  for (const [clip, keys] of Object.entries(animations.cameraTracks ?? {}))
    animations.cameraTracks[clip] = keys.filter(key => !removedCameras.has(key.camera));
  if (removedCameras.has(cameraOverride)) cameraOverride = undefined;
  if (removedCameras.has(freeViewLabel?.userData.cameraId)) freeViewLabel = undefined;
  const parents = new Set(targets.map((object) => object.parent));
  targets.forEach(disposeObject);
  forObjects(object => {
    if (removedObjects.has(object.userData.followTarget)) {
      object.userData.followTarget = null;
      object.userData.followOffset = null;
    }
  });
  for (const parent of parents) {
    if (parent === root) continue;
    fitPivot(parent);
    fitParentPivots(parent);
  }
  select();
  status('Seçim silindi.');
}

function addKeys() {
  if (!selected.size) return;
  setPlaying(false);
  for (const object of selected) writeKey(object, frame, animations.active);
  updateTimeline();
  status(frame + '. kare kaydedildi.');
}

function duplicateObjects(objects = independentSelection()) {
  if (!objects.length) return;
  edit(() => {
    const copies = decodeProject({
      version: projectVersion, duration, objects: objects.map(encodeObject)
    }).objects;
    const ids = new Map();
    const names = new Set();
    forObjects(object => names.add(object.name));
    copies.forEach(copy => copy.traverse(child => {
      const id = crypto.randomUUID();
      ids.set(child.userData.objectId, id);
      child.userData.objectId = id;
      if (child.isCamera) child.userData.cameraId = crypto.randomUUID();
      const base = child.name.slice(0, 65) + ' kopya';
      let name = base;
      let index = 2;
      while (names.has(name)) name = base + ' ' + index++;
      child.name = name;
      names.add(name);
    }));
    copies.forEach((copy, index) => {
      copy.traverse(child => {
        const target = ids.get(child.userData.followTarget);
        if (target) child.userData.followTarget = target;
      });
      objects[index].parent.add(copy);
      const from = copy.position.clone();
      translateWorld(copy, new Vector3(.4, 0, .4));
      updateSceneVisibility();
      collisions?.separate(root, copy);
      const offset = copy.position.clone().sub(from);
      for (const pose of posesOf(copy))
        pose.position = pose.position.map((value, axis) => value + offset.getComponent(axis));
      fitParentPivots(copy);
    });
    selected.clear();
    copies.forEach(object => selected.add(object));
    setWireframe(wireframe);
    refresh();
    status(copies.length === 1 ? copies[0].name + ' oluşturuldu.' : 'Seçili cisimler çoğaltıldı.');
  }, 'Cisimleri çoğalt');
}

function focusObjects(objects = independentSelection()) {
  if (!objects.length) return;
  setPlaying(false);
  if (previewCamera) jumpToCamera(getCamera(cameraAt(animations, frame)));
  view?.focus(objects);
  updateCameraView();
}

function setWireframe(value) {
  wireframe = value;
  $('wireframe').setAttribute('aria-pressed', wireframe);
  forObjects((object) => {
    if (object.isMesh)
      materialsOf(object).forEach((material) => {
        material.wireframe = wireframe;
      });
  });
}

$('undo').onclick = () => stepHistory(-1);
$('redo').onclick = () => stepHistory(1);
for (const button of all('[data-align]')) {
  button.onclick = () =>
    edit(() => {
      const axis = button.dataset.align;
      const targets = independentSelection();
      const anchor = targets.shift()?.getWorldPosition(new Vector3())[axis];
      let blocked = false;
      for (const target of targets) {
        const from = target.position.clone();
        const delta = new Vector3();
        delta[axis] = anchor - target.getWorldPosition(new Vector3())[axis];
        translateWorld(target, delta);
        if (settleObject(target, from) === false) {
          target.position.copy(from);
          blocked = true;
        }
        blocked ||=
          Math.abs(target.getWorldPosition(new Vector3())[axis] - anchor) >
          0.0001;
      }
      status(
        blocked
          ? 'Katı yüzey, bazı nesnelerin hizalanmasını engelledi.'
          : axis.toUpperCase() + ' ekseninde merkez noktaları hizalandı.'
      );
    });
}
$('add-box').onclick = () => edit(() => addObject('box'));
$('add-pyramid').onclick = () => edit(() => addObject('pyramid'));
$('add-light').onclick = () => edit(() => addObject('light'));
$('add-camera').onclick = () => edit(() => addObject('camera'));
$('toggle-objects').onclick = () => {
  const tools = $('object-tools');
  tools.hidden = !tools.hidden;
  const button = $('toggle-objects');
  button.textContent = tools.hidden ? '+' : '−';
  button.setAttribute('aria-expanded', String(!tools.hidden));
  button.setAttribute('aria-label', tools.hidden ? 'Nesneler bölümünü genişlet' : 'Nesneler bölümünü daralt');
};
$('toggle-scene').onclick = () => {
  sceneExpanded = !sceneExpanded;
  paintList();
};
$('scene-name').onchange = event => {
  const input = event.currentTarget;
  const name = input.value.trim();
  if (name && name !== sceneName) edit(() => { sceneName = name; });
  input.value = sceneName;
};
$('scene-name').onkeydown = event => {
  if (event.key === 'Escape') event.currentTarget.value = sceneName;
  if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
};
$('group').onclick = () => {
  if (!canGroup()) return;
  setPlaying(false);
  edit(() => select(groupObjects([...selected])), 'Cisimleri grupla');
  status('Nesneler gruplandı.');
};
$('join').onclick = () => {
  const objects = [...selected];
  if ($('join').disabled) return;
  if (objects.some(hasKeys)) {
    const message = 'Ağları birleştirmek için seçili nesnelerin anahtar karelerini kaldır.';
    status(message);
    toast(message, 'warning');
    return;
  }
  setPlaying(false);
  edit(() => {
    const merged = joinMeshes(objects);
    if (!merged) {
      const erased = new Set(objects.map(object => object.userData.objectId));
      forObjects(object => {
        if (!erased.has(object.userData.followTarget)) return;
        object.userData.followTarget = null;
        object.userData.followOffset = null;
      });
      select();
      status('Negatif hacim seçili cisimleri tamamen çıkardı.');
      return;
    }
    const mergedIds = new Set(objects.map(object => object.userData.objectId));
    forObjects(object => {
      if (!mergedIds.has(object.userData.followTarget)) return;
      object.userData.followTarget = merged.userData.objectId;
      captureFollowOffset(object, merged);
    });
    select(merged);
    setWireframe(wireframe);
    if (merged.userData.mergeMidpoint && !hasVolumeAtOrigin(merged.geometry)) {
      const message = 'Nesneler birleştirildi. Ortak merkez boşlukta kaldı. Dönüş tutamacı bu noktayı kullanır.';
      status(message);
      toast(message, 'warning');
    } else status('Geometri tek bir ağda birleştirildi.');
  }, 'Ağları birleştir');
};
$('ungroup').onclick = () => {
  const group = single();
  if (group?.userData.type !== 'group') return;
  if (hasKeys(group)) {
    status('Önce grubun anahtar karelerini kaldır.');
    return;
  }
  const scale = group.scale;
  if (
    Math.abs(scale.x - scale.y) > 0.000001 ||
    Math.abs(scale.y - scale.z) > 0.000001
  ) {
    status('Grubu çözmek için grubun X, Y ve Z ölçeklerini eşitle.');
    return;
  }
  setPlaying(false);
  edit(() => {
    const children = dissolveGroup(group);
    selected.clear();
    children.forEach((object) => selected.add(object));
    refresh();
  }, 'Grubu çöz');
  status('Grup çözüldü.');
};
$('delete').onclick = () => edit(deleteSelection);
$('wireframe').onclick = () => setWireframe(!wireframe);
$('reset-view').onclick = () => {
  $('view-camera-menu').hidden = true;
  setPlaying(false);
  previewCamera = false;
  cameraOverride = undefined;
  freeViewLabel = undefined;
  $('preview-camera').setAttribute('aria-pressed', 'false');
  view?.reset();
  updateCameraView();
  status('Kamera sıfırlandı.');
};
$('reset-view').oncontextmenu = (event) => {
  event.preventDefault();
  const menu = $('view-camera-menu');
  const choices = [null];
  forObjects(object => { if (object.isCamera) choices.push(object); });
  menu.replaceChildren(...choices.map(object => {
    const button = document.createElement('button');
    button.textContent = object?.name ?? 'Varsayılan';
    button.onclick = () => {
      menu.hidden = true;
      setPlaying(false);
      jumpToCamera(object);
      updateCameraView();
    };
    return button;
  }));
  menu.hidden = false;
  menu.style.left = Math.max(0, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 5)) + 'px';
  menu.style.top = Math.max(0, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 5)) + 'px';
};
$('show-pivots').onclick = () => {
  const show = $('show-pivots').getAttribute('aria-pressed') !== 'true';
  $('show-pivots').setAttribute('aria-pressed', String(show));
  view?.showPivots(show);
};
for (const button of all('[data-mode]')) {
  button.onclick = () => {
    setPlaying(false);
    if (measuring) setMeasure(false);
    setMode(button.dataset.mode);
  };
}
$('first').onclick = () => stopAt(0);
$('last').onclick = () => stopAt(duration);
$('play').onclick = () => setPlaying(!playing);
$('add-key').onclick = () => edit(addKeys);
$('remove-key').onclick = () =>
  edit(() => {
    setPlaying(false);
    let removed = false;
    for (const object of selected) {
      const keys = keysFor(object, animations.active);
      const index = keys.findIndex((key) => key.frame === frame);
      if (index < 0) continue;
      keys.splice(index, 1);
      removed = true;
    }
    if (removed) frameTo(frame);
    updateTimeline();
    status(
      removed
        ? frame + '. karedeki poz silindi.'
        : 'Bu karede seçili nesnelere ait kayıt yok.'
    );
  });
$('scrub').oninput = (event) => stopAt(event.target.valueAsNumber);
$('frame').onchange = (event) => stopAt(event.target.valueAsNumber || 0);
$('duration').onchange = (event) =>
  edit(() => {
    duration = Math.max(
      1,
      Math.min(1800, Math.round(event.target.valueAsNumber || duration))
    );
    stopAt(frame);
    updateTimeline();
  });

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') view?.pickColor(undefined);
  const key = event.key.toLowerCase();
  if ($('render-settings-dialog').open || $('model-dialog').open) return;
  if ($('render-preview').open) {
    if (key === ' ' && document.activeElement?.tagName !== 'BUTTON') {
      event.preventDefault();
      setPlaying(!playing);
    }
    return;
  }
  const focused = document.activeElement;
  const textField = /SELECT|TEXTAREA/.test(focused?.tagName) ||
    (focused?.tagName === 'INPUT' && !['radio', 'checkbox', 'range'].includes(focused.type));
  if (!recording && !textField && !$('preset-dialog').open && event.ctrlKey && !event.altKey && key === 'd') {
    event.preventDefault();
    duplicateObjects();
    return;
  }
  if (
    !recording &&
    event.ctrlKey &&
    !event.altKey &&
    (key === 'z' || key === 'y') &&
    !$('preset-dialog').open
  ) {
    event.preventDefault();
    stepHistory(key === 'y' || event.shiftKey ? 1 : -1);
    return;
  }
  if (
    recording ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    textField ||
    $('preset-dialog').open
  )
    return;
  if (key === 'escape' && measuring) {
    setMeasure(false);
    return;
  }
  if (['x', 'y', 'z'].includes(key)) {
    if (event.repeat) return;
    event.preventDefault();
    setPlaying(false);
    previewCamera = false;
    cameraOverride = undefined;
    $('preview-camera').setAttribute('aria-pressed', 'false');
    view?.toggleAxis(key);
    updateCameraView();
    return;
  }
  if (key === 'm') {
    if (!event.repeat) setMeasure(!measuring);
    return;
  }
  const modeKey =
    'qgrs'.indexOf(key) !== -1 && key.length === 1
      ? modes['qgrs'.indexOf(key)]
      : undefined;
  if (modeKey) {
    setPlaying(false);
    if (measuring) setMeasure(false);
    setMode(modeKey);
  }
  if (key === 'delete') edit(deleteSelection);
  if (key === 'k') edit(addKeys);
  if (key === 'f' && !$('preset-dialog').open) focusObjects();
  if (key === ' ' && document.activeElement?.tagName !== 'BUTTON') {
    event.preventDefault();
    setPlaying(!playing);
  }
});

async function saveOutput(blob, name, label) {
  if (window.rendercardDesktop) {
    try {
      const saved = await window.rendercardDesktop.saveFile(
        name,
        await blob.arrayBuffer()
      );
      status(saved ? label + ' kaydedildi.' : 'Kaydetme iptal edildi.');
      return saved;
    } catch (error) {
      console.error('Dosya kaydedilemedi.', error);
      status('Dosya kaydedilemedi.');
      return false;
    }
  }
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
  status(label + ' indirildi.');
  return true;
}

$('save').onclick = async () => {
  if (savingProject) return;
  const revision = history.revision;
  const viewPose = view?.captureCamera();
  const content = JSON.stringify(
    encodeProject(
      root,
      duration,
      sequence ? { ...animations, enabled: sequence.ids } : animations,
      atmosphere,
      viewPose && {
        position: viewPose.position.toArray(),
        target: viewPose.target.toArray()
      },
      sceneName,
      renderSize
    ),
    null,
    2
  );
  savingProject = true;
  try {
    if (await saveOutput(new Blob([content], { type: 'application/json' }), 'sahne.rendercard.json', 'Proje')) {
      savedRevision = revision;
      updateHistory();
    }
  } finally {
    savingProject = false;
  }
};
$('open').onclick = () => $('project-file').click();
$('project-file').onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const project = decodeProject(JSON.parse(await file.text()));
    edit(() => {
      if (measuring) setMeasure(false);
      [...root.children].forEach(disposeObject);
      project.objects.forEach((object) => root.add(object));
      duration = project.duration;
      animations = project.animations;
      atmosphere = project.atmosphere;
      sceneName = project.name;
      renderSize = project.renderSize;
      updateRenderGuide();
      jumpToCamera();
      if (project.defaultView) view?.restoreCamera(project.defaultView);
      cameraOverride = undefined;
      sequence = undefined;
      updateSceneVisibility();
      selected.clear();
      setWireframe(wireframe);
      frameTo(0);
      refresh();
    });
    savedRevision = history.revision;
    updateHistory();
    status('Proje açıldı.');
  } catch {
    status('Proje açılamadı. Geçerli bir Rendercard JSON dosyası seç.');
  }
};

function showExport(show) {
  $('export-menu').hidden = !show;
  $('export').setAttribute('aria-expanded', show);
}
$('export').onclick = () => showExport($('export-menu').hidden);
function updateRenderGuide() {
  view?.setFrameGuide(renderGuide ? renderSize.width / renderSize.height : undefined);
}
const renderDialog = $('render-settings-dialog');
const renderPreset = $('render-preset');
const customPreset = new Option('Özel', 'custom');
renderPreset.replaceChildren(...renderSizes.map(([width, height]) =>
  new Option(width + ' × ' + height + ' (' + renderAspectLabel(width, height) + ')', width + 'x' + height)), customPreset);
function chooseRenderPreset() {
  const width = $('render-width').valueAsNumber;
  const height = $('render-height').valueAsNumber;
  customPreset.text = validRenderSize({ width, height }) ? 'Özel (' + renderAspectLabel(width, height) + ')' : 'Özel';
  renderPreset.value = renderSizes.some(([w, h]) => width === w && height === h) ? width + 'x' + height : 'custom';
}
$('render-settings').onclick = () => {
  showExport(false);
  $('render-width').value = renderSize.width;
  $('render-height').value = renderSize.height;
  $('render-guide').checked = renderGuide;
  chooseRenderPreset();
  renderDialog.showModal();
};
$('close-render-settings').onclick = () => renderDialog.close();
renderPreset.onchange = () => {
  if (renderPreset.value === 'custom') return;
  const [width, height] = renderPreset.value.split('x');
  $('render-width').value = width;
  $('render-height').value = height;
};
$('render-width').oninput = $('render-height').oninput = chooseRenderPreset;
$('render-settings-form').onsubmit = event => {
  event.preventDefault();
  const size = { width: $('render-width').valueAsNumber, height: $('render-height').valueAsNumber };
  if (!validRenderSize(size)) return;
  renderGuide = $('render-guide').checked;
  if (size.width !== renderSize.width || size.height !== renderSize.height)
    edit(() => { renderSize = size; }, 'Render çözünürlüğünü değiştir');
  updateRenderGuide();
  renderDialog.close();
  status('Render boyutu ' + size.width + ' × ' + size.height + ' piksel (' + renderAspectLabel(size.width, size.height) + ').');
};
const preview = $('render-preview');
const previewCanvas = $('render-preview-image');
const previewContext = previewCanvas.getContext('2d');
let previewPainted;
$('watch-render').onclick = () => {
  showExport(false);
  if (!view || recording || preview.open) return;
  setPlaying(false);
  if (sequence) useClips(sequence.ids);
  previewStart = frame;
  previewPainted = undefined;
  $('preview-scrub').max = duration;
  const cutFrames = new Set(animations.enabled.flatMap(id =>
    (animations.cameraTracks?.[id] ?? []).map(key => key.frame)));
  const animatedFrames = new Set();
  forObjects(object => {
    if (!inActiveScene(object)) return;
    for (const id of animations.enabled)
      for (const key of keysFor(object, id)) animatedFrames.add(key.frame);
  });
  $('preview-cuts').replaceChildren(...[...new Set([...animatedFrames, ...cutFrames])].map(at => {
    const mark = document.createElement('span');
    mark.classList.toggle('preview-camera-cut', cutFrames.has(at));
    mark.style.left = Math.min(100, at * 100 / duration) + '%';
    return mark;
  }));
  preview.showModal();
};
$('preview-play').onclick = () => setPlaying(!playing);
$('preview-scrub').oninput = event => stopAt(event.currentTarget.valueAsNumber);
preview.onclose = () => {
  setPlaying(false);
  frameTo(previewStart ?? frame);
  previewStart = undefined;
  $('export').focus();
};

function paintRenderPreview() {
  const { width, height } = renderSize;
  const signature = [frame, width, height].join(':');
  if (previewPainted === signature) return;
  previewPainted = signature;
  if (previewCanvas.width !== width || previewCanvas.height !== height) {
    previewCanvas.width = width;
    previewCanvas.height = height;
  }
  previewContext.drawImage(view.renderOutput(width, height), 0, 0);
  $('preview-scrub').value = frame;
  $('preview-time').textContent = frame + ' / ' + duration + ' kare';
}
document.addEventListener('click', (event) => {
  if (!event.target.closest('.export-wrap')) showExport(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('export-menu').hidden) {
    showExport(false);
    $('export').focus();
  }
});
$('png').onclick = () => {
  showExport(false);
  if (!view) return;
  view.renderOutput(renderSize.width, renderSize.height).toBlob((blob) => {
    if (blob) void saveOutput(blob, 'rendercard.png', 'PNG');
    else status('Görsel oluşturulamadı.');
  }, 'image/png');
};

async function recordVideo() {
  showExport(false);
  if (!view || recording) return;
  if (!window.VideoEncoder) {
    status('Bu tarayıcı video kodlamayı desteklemiyor.');
    return;
  }
  if (renderSize.width % 2 || renderSize.height % 2) {
    status('Video için Çözünürlük ve kadraj menüsünde iki boyutu da çift sayı yap.');
    return;
  }
  const oldFrame = frame;
  const poses = new Map();
  forObjects((object) => poses.set(object, capture(object)));
  setPlaying(false);
  recording = true;
  updateCameraView();
  const workspace = document.querySelector('.workspace');
  const actions = document.querySelector('.topbar');
  workspace.inert = true;
  actions.inert = true;
  try {
    const { encodeVideo } = await import('./video.js');
    const { blob, name } = await encodeVideo(view, renderSize, duration, fps, (next) => {
      frame = next;
      poseScene(frame > 0);
      updateCameraView();
      if (frame % 10 === 0)
        status('Animasyon hazırlanıyor · ' + frame + ' / ' + duration);
    });
    await saveOutput(blob, name, 'Animasyon');
  } catch (error) {
    console.error('Video dışa aktarılamadı.', error);
    status(
      error.message?.startsWith('Bu tarayıcı')
        ? error.message
        : 'Animasyon kaydedilemedi.'
    );
  } finally {
    recording = false;
    workspace.inert = false;
    actions.inert = false;
    frameTo(oldFrame);
    for (const [object, pose] of poses) applyPose(object, pose);
    refreshTransform();
  }
}
$('video').onclick = () => {
  if (!recording && view) status('Animasyon kaydediliyor…');
  void recordVideo();
};

const modelDialog = $('model-dialog');
const modelHelp = {
  glb: 'Geometri, renk, dokular ve animasyonlar tek dosyada. Kamera geçişleri ve canlı kesimler aktarılmaz.',
  gltf: 'Düzenlenebilir JSON. Geometri, dokular ve animasyonlar dosyaya gömülür. Kamera geçişleri ve canlı kesimler aktarılmaz.',
  obj: 'Geçerli karenin geometrisi aktarılır. Animasyon ve malzeme aktarılmaz.',
  stl: 'Geçerli karenin üçgen yüzeyleri aktarılır. Animasyon ve malzeme aktarılmaz.'
};
function paintModelOptions() {
  const format = $('model-format').value;
  $('model-animations-field').hidden = format !== 'glb' && format !== 'gltf';
  $('model-format-help').textContent = modelHelp[format];
}
$('model-format').onchange = paintModelOptions;
$('export-model').onclick = () => {
  showExport(false);
  if (recording) return;
  const option = $('model-scope').querySelector('option[value="selection"]');
  option.disabled = !selected.size;
  if (!selected.size) $('model-scope').value = 'scene';
  paintModelOptions();
  modelDialog.showModal();
};
$('close-model-dialog').onclick = () => modelDialog.close();
$('model-form').onsubmit = event => {
  event.preventDefault();
  modelDialog.close();
  const format = $('model-format').value;
  const targets = $('model-scope').value === 'selection' ? independentSelection() : root.children.slice();
  const animated = (format === 'glb' || format === 'gltf') && $('model-animations').checked;
  void exportModel(format, targets, animated);
};

async function exportModel(format, targets, animated) {
  if (recording) return;
  setPlaying(false);
  const oldFrame = frame;
  const enabled = animations.enabled;
  const includedClips = sequence?.ids ?? enabled;
  const savedPoses = new Map();
  forObjects(object => savedPoses.set(object, capture(object)));
  const restorePoses = () => {
    for (const [object, pose] of savedPoses) applyPose(object, pose);
  };
  recording = true;
  const workspace = document.querySelector('.workspace');
  const topbar = document.querySelector('.topbar');
  workspace.inert = topbar.inert = true;
  status('3B model hazırlanıyor…');
  let snapshot;
  let exporter;
  try {
    exporter = await import('./model-export.js');
    animations.enabled = includedClips;
    updateSceneVisibility();
    snapshot = exporter.snapshotModel(root, targets, renderSize.width / renderSize.height);
    const geometryOnly = format === 'obj' || format === 'stl';
    if (geometryOnly ? !snapshot.meshes : !snapshot.scene.children.length) {
      status('Bu kapsamda dışa aktarılacak ' + (geometryOnly ? 'geometri' : 'nesne') + ' yok.');
      return;
    }
    const clips = [];
    if (animated) {
      for (const clip of animations.clips.filter(item => includedClips.includes(item.id))) {
        animations.enabled = [clip.id];
        restorePoses();
        updateSceneVisibility();
        resetPhysics();
        const track = exporter.sampleTracks(snapshot.pairs, fps);
        for (let next = 0; next <= duration; next++) {
          frame = next;
          poseScene(next > 0);
          updateFollowers();
          track.add(next);
          if (next % 30 === 0) {
            status(clip.name + ' hazırlanıyor · ' + next + ' / ' + duration);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
        const motion = track.clip(clip.name);
        if (motion) clips.push(motion);
      }
    }
    const blob = await exporter.writeModel(snapshot.scene, format, clips);
    await saveOutput(blob, 'rendercard.' + format, format.toUpperCase());
  } catch (error) {
    console.error('3B model dışa aktarılamadı.', error);
    status('3B model dışa aktarılamadı.');
  } finally {
    if (snapshot) exporter.disposeModel(snapshot.scene);
    restorePoses();
    animations.enabled = enabled;
    frame = oldFrame;
    updateSceneVisibility();
    resetPhysics();
    recording = false;
    workspace.inert = topbar.inert = false;
    refreshFrame();
    refreshTransform();
  }
}

function populate() {
  const platform = makeObject('box', 'Kaide', '#596c61');
  platform.position.set(0, 0.17, 0);
  platform.scale.set(4.65, 0.34, 3.25);
  const prism = makeObject('pyramid', 'Piramit', '#d5f47c');
  prism.position.set(-0.77, 1.15, 0.24);
  prism.scale.setScalar(1.62);
  const box = makeObject('box', 'Kutu', '#ad9de0');
  box.position.set(0.95, 0.96, -0.28);
  box.scale.set(1.17, 1.24, 1.12);
  box.rotation.y = -0.28;
  writeKey(box, 0);
  box.position.y = 1.85;
  box.rotation.y = 1.22;
  writeKey(box, 60);
  poseAt(box, 0);
  writeKey(box, 120);
  root.add(prism, box, platform);
  selected.add(box);
}

function showSnapMenu(show) {
  $('snap-menu').hidden = !show;
  $('snap-settings').setAttribute('aria-expanded', show);
}
$('snap-settings').onclick = () => showSnapMenu($('snap-menu').hidden);
document.addEventListener('click', (event) => {
  if (!event.target.closest('#snap-settings, #snap-menu')) showSnapMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') showSnapMenu(false);
});
$('snap-step').onchange = () => {
  const value = $('snap-step').valueAsNumber;
  $('snap-step').value = Number.isFinite(value)
    ? MathUtils.clamp(value, 0.001, 100)
    : 1;
};
for (const input of all('[name="snap-mode"]')) {
  input.onchange = () => {
    $('snap-precision').hidden = !$('snap-grid').checked;
  };
}

populate();
try {
  view = createViewport($('viewport'), root, {
    select,
    measurementSettings: () => ({ step: dimensionStep(), surface: $('snap-surface').checked }),
    measured: result => status(result
      ? 'Mesafe ' + result + ' · Yeni ölçüm için bir noktaya tıkla.'
      : 'İkinci noktayı seç. Mesafe imleci takip eder.'),
    context: (event, object) => presets.openContext(event, object),
    editing: (direction, axis, pivot) => {
      const object = single();
      if (pivot) {
        setPlaying(false);
        const targets = independentSelection();
        const ignored = new Set();
        for (const target of targets) target.traverse(child => ignored.add(child));
        drag = {
          before: captureScene(), targets, ignored,
          center: pivot.position.clone(),
          baseline: targets.map(target => ({
            position: target.getWorldPosition(new Vector3()),
            rotation: target.getWorldQuaternion(new Quaternion()),
            scale: target.scale.clone(),
            resizable: !target.isCamera && !target.isLight
          })),
          last: targets.map(capture)
        };
        return;
      }
      if (!object) return;
      setPlaying(false);
      drag = {
        before: captureScene(),
        position: object.position.clone(),
        scale: object.scale.clone(),
        last: object.position.clone(),
        lastPose: capture(object),
        axes: [...(axis ?? '').toLowerCase()].filter((letter) =>
          'xyz'.includes(letter)
        ),
        direction,
        bounds: mode === 'scale' ? localBounds(object) : undefined
      };
    },
    change: (symmetric, pivot) => {
      if (drag?.targets && pivot) {
        const { targets, baseline, center, last, ignored } = drag;
        const next = selectionTransforms(baseline, center, pivot, mode, symmetric, dimensionStep());
        targets.forEach((target, index) => applySelectionTransform(target, next[index], mode));
        const hits = new Set();
        for (const [index, target] of targets.entries()) {
          if (mode === 'translate') {
            const hit = collisions?.sweep(root, target, new Vector3().fromArray(last[index].position), ignored);
            if (hit) hits.add(hit);
          }
        }
        for (const target of targets)
          for (const hit of collisions?.overlaps(root, target) ?? []) hits.add(hit);
        if (hits.size) {
          targets.forEach((target, index) => applyPose(target, last[index]));
          warnOverlap([...hits]);
          return;
        }
        drag.last = targets.map(capture);
        for (const target of targets.filter(target => target.isCamera)) {
          const following = getObjectById(target.userData.followTarget);
          if (following) captureFollowOffset(target, following);
        }
        updateFollowers();
        return;
      }
      const object = single();
      if (!drag || !object) return;
      if (mode === 'scale') {
        object.scale.copy(
          constrainDimensions(
            drag.scale,
            object.scale,
            drag.bounds.getSize(new Vector3()),
            drag.axes,
            object.userData.linkedSize,
            dimensionStep()
          )
        );
        anchorScale(
          object,
          drag.position,
          drag.scale,
          drag.bounds,
          symmetric,
          drag.direction
        );
      }
      if (mode === 'translate') {
        const step = MathUtils.clamp(
          $('snap-step').valueAsNumber || 1,
          0.001,
          100
        );
        const attached =
          $('snap-surface').checked &&
          snapToSurfaces(root, object, drag.axes, 0.25, collisions);
        if (!attached && $('snap-grid').checked)
          snapToGrid(object, drag.axes, step);
        const hit = collisions?.sweep(root, object, drag.last);
        if (hit) warnOverlap([hit]);
      }
      const overlap = collisions?.overlaps(root, object);
      if (overlap?.length) {
        warnOverlap(overlap);
        applyPose(object, drag.lastPose);
      }
      drag.last.copy(object.position);
      drag.lastPose = capture(object);
      if (mode === 'translate' && object.isCamera) {
        const target = getObjectById(object.userData.followTarget);
        if (target) captureFollowOffset(object, target);
      }
      updateFollowers();
      refreshTransform();
    },
    moved: () => {
      if (!drag) return;
      if (drag.targets) {
        for (const target of drag.targets) {
          updateExistingKey(target);
          fitParentPivots(target);
        }
        setMode(mode);
      }
      if (single()) {
        updateExistingKey(single());
        fitParentPivots(single());
        refreshTransform();
      }
      commitEdit(drag.before);
      drag = undefined;
    }
  });
} catch {
  $('engine-error').hidden = false;
  $('engine-error').textContent =
    '3B görünüm açılamadı. WebGL 2 destekli bir tarayıcı kullan ve donanım hızlandırmayı kontrol et.';
  $('export').disabled = true;
  status('3B görünüm kullanılamıyor.');
}
refresh();
const hint = document.querySelector('.viewport-hint');
const introTimer = setTimeout(
  () => hint.classList.remove('hint-visible'),
  4200
);
let idleTimer = setTimeout(() => hint.classList.add('hint-visible'), 60000);
function activity() {
  clearTimeout(introTimer);
  hint.classList.remove('hint-visible');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => hint.classList.add('hint-visible'), 60000);
}
requestAnimationFrame(() => hint.classList.add('hint-visible'));
for (const type of [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'input'
]) {
  document.addEventListener(type, activity, { passive: true });
}
void import('./collisions.js')
  .then(async (engine) => {
    if (await engine.initializeCollisions()) {
      collisions = engine;
      resetPhysics();
      if ($('object-solid')) $('object-solid').disabled = false;
    }
  })
  .catch((error) => console.error('Katılık modülü yüklenemedi.', error));
function animate(now) {
  if (playing) {
    const next = Math.floor(((now - startedAt) * fps) / 1000);
    const end = sequence?.end ?? duration;
    if (next >= end) {
      frameTo(end, true);
      setPlaying(false);
      if (sequence) nextClip();
    } else if (next !== frame) frameTo(next, true);
  }
  if (!recording && view) {
    if (preview.open) paintRenderPreview();
    else view.render();
  }
  window.requestAnimationFrame(animate);
}
window.requestAnimationFrame(animate);
