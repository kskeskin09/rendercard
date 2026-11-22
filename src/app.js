import { Group, MathUtils, Vector3 } from 'three';
import { createViewport } from './viewport.js';
import { icon } from './icons.js';
import {
  applyPose,
  applyAcceleration,
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
  translateWorld,
  fitPivot,
  fitParentPivots
} from './spatial.js';
import { settingsMarkup, bindSettings } from './inspector-settings.js';
import { createHistory } from './history.js';
import { installPresets } from './presets.js';
import { snapToGrid, snapToSurfaces } from './snapping.js';
import { chooseTrack, hasKeys, keysFor, mainClip, posesOf } from './clips.js';

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
let drag;
let shiftPressed = false;
let presetScene;
let presets;
let animations = {
  clips: [{ ...mainClip }],
  active: 'main',
  enabled: ['main']
};
const openInspectorSections = new Set(['Dönüşüm']);

function status(message) {
  $('status').textContent = message;
  $('status').title = message;
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
    project: JSON.stringify(encodeProject(root, duration, animations)),
    frame,
    selection: [...selected].map((object) => objects.indexOf(object))
  };
}

function replaceScene(state) {
  const project = decodeProject(JSON.parse(state.project));
  [...root.children].forEach(disposeObject);
  project.objects.forEach((object) => root.add(object));
  duration = project.duration;
  animations = project.animations;
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
}

function commitEdit(before) {
  history.remember(before, captureScene());
  updateHistory();
}

function edit(callback) {
  setPlaying(false);
  const before = captureScene();
  if (callback() === false) {
    replaceScene(before);
    return;
  }
  commitEdit(before);
}

function stepHistory(direction) {
  if (recording || drag || $('preset-dialog').open) return;
  const state = history.step(direction);
  if (!state) return;
  setPlaying(false);
  replaceScene(state);
  status(direction < 0 ? 'Düzenleme geri alındı.' : 'Düzenleme yinelendi.');
}

function settleObject(object, from) {
  if (from) collisions?.sweep(root, object, from);
  if (collisions?.overlaps(root, object).length) {
    status('Katı yüzey bu düzenlemeyi engelledi.');
    return false;
  }
  updateExistingKey(object);
  fitParentPivots(object);
}

function poseScene(continuous = false) {
  const animated = [];
  forObjects((object) => {
    if (!inActiveScene(object)) return;
    const data = object.userData;
    const keys = chooseTrack(object, animations.enabled, frame);
    const physical =
      data.positionMode === 'physics' &&
      (keys || animations.enabled.includes(data.physicsClip));
    if (
      keys ||
      (data.restPose && (hasKeys(object) || data.positionMode === 'physics'))
    ) {
      const before = collisions ? capture(object) : undefined;
      if (keys) poseAt(object, frame, keys);
      else if (data.restPose) applyPose(object, data.restPose);
      if (physical) {
        const source = keys?.[0] ?? data.restPose;
        if (source) object.position.fromArray(source.position);
        applyAcceleration(object, frame, keys?.[0].frame ?? 0);
      }
      animated.push({ object, before });
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
  mode = next;
  all('[data-mode]').forEach((button) =>
    button.setAttribute('aria-pressed', button.dataset.mode === mode)
  );
  view?.updateSelection(single(), mode);
}

for (const element of all('[data-icon]'))
  element.innerHTML = icon(element.dataset.icon);

function frameTo(next, continuous = false) {
  frame = Math.min(duration, Math.max(0, Math.round(next)));
  poseScene(continuous);
  refreshFrame();
  refreshTransform();
}

function refreshFrame() {
  if (document.activeElement !== $('frame') || !playing)
    $('frame').value = frame;
  $('scrub').value = frame;
  $('playhead').style.left = (frame / duration) * 100 + '%';
  $('remove-key').disabled = ![...selected].some((object) =>
    keysFor(object, animations.active).some((key) => key.frame === frame)
  );
}

function setPlaying(value) {
  if (value && animations.enabled.length === 0) return;
  playing = value;
  $('play').innerHTML = icon(playing ? 'pause' : 'play');
  $('play').setAttribute('aria-label', playing ? 'Duraklat' : 'Oynat');
  $('play').title = playing ? 'Duraklat (Boşluk)' : 'Oynat (Boşluk)';
  if (playing) {
    if (frame >= duration) frameTo(0);
    startedAt = performance.now() - (frame * 1000) / fps;
  }
}

function stopAt(next) {
  setPlaying(false);
  frameTo(next);
}

function updateTimeline() {
  $('scrub').max = duration;
  $('frame').max = duration;
  $('duration').value = duration;
  paintClips();
  const tracks = animations.clips.filter((clip) =>
    animations.enabled.includes(clip.id)
  );
  const labels = tracks.map((clip) => {
    const label = document.createElement('span');
    label.textContent = clip.name;
    label.title = clip.name;
    return label;
  });
  $('track-name').replaceChildren(...labels);
  $('track').style.minHeight = Math.max(48, 22 + 20 * tracks.length) + 'px';
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
    ...tracks.flatMap((clip, lane) => {
      const frames = new Set();
      forObjects((object) =>
        keysFor(object, clip.id).forEach((key) => frames.add(key.frame))
      );
      return [...frames]
        .filter((value) => value <= duration)
        .map((value) => {
          const marker = document.createElement('span');
          marker.className = 'key-dot';
          marker.style.top = 25 + lane * 20 + 'px';
          marker.title = clip.name + ' · ' + value;
          marker.style.left = (value / duration) * 100 + '%';
          return marker;
        });
    })
  );
  refreshFrame();
}

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
        useClips(
          animations.clips
            .filter((item) => checked.has(item.id))
            .map((item) => item.id)
        );
      };
      label.append(checkbox, clip.name);
      return label;
    })
  );
  $('clip-play-selected').disabled = animations.enabled.length === 0;
  $('play').disabled = animations.enabled.length === 0;
}

function useClips(ids) {
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
    const { sceneClip, hidden } = object.userData;
    object.clipActive = !sceneClip || animations.enabled.includes(sceneClip);
    object.visible = object.clipActive && !hidden;
  });
}

$('clip-active').onchange = (event) => {
  const wasSolo =
    animations.enabled.length === 1 &&
    animations.enabled[0] === animations.active;
  animations.active = event.target.value;
  if (wasSolo) useClips([animations.active]);
  else {
    updateTimeline();
    paintInspector();
  }
};
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
  useClips(animations.clips.map((clip) => clip.id));
function playClips() {
  if (!animations.enabled.length) return;
  $('clip-name').closest('details').open = false;
  stopAt(0);
  setPlaying(true);
}
$('clip-play-selected').onclick = playClips;
$('clip-play-all').onclick = () => {
  useClips(animations.clips.map((clip) => clip.id));
  playClips();
};

function paintList() {
  const rows = [];
  let triangles = 0;
  function rowFor(object, depth) {
    const type = object.userData.type;
    const row = document.createElement('button');
    row.className = 'object-row' + (selected.has(object) ? ' selected' : '');
    row.style.paddingLeft = 7 + depth * 12 + 'px';
    row.setAttribute('aria-pressed', selected.has(object));
    row.title = object.name;
    row.innerHTML =
      '<span class="object-icon">' +
      icon(type) +
      '</span><span class="row-name"></span><span class="row-type">' +
      types[type] +
      '</span>';
    row.querySelector('.row-name').textContent = object.name;
    row.onclick = (event) => select(object, event.shiftKey);
    row.oncontextmenu = (event) => presets.openContext(event, object);
    rows.push(row);
    if (object.isMesh) triangles += object.geometry.index.count / 3;
    object.children.forEach((child) => rowFor(child, depth + 1));
  }
  root.children.forEach((object) => rowFor(object, 0));
  $('object-list').replaceChildren(...rows);
  $('object-count').textContent = rows.length;
  $('mesh-count').textContent = triangles.toLocaleString('tr-TR') + ' üçgen';
}

const fields = { position: 'Konum', rotation: 'Dönüş (°)', scale: 'Ölçek' };
function paintInspector() {
  const object = single();
  const panel = $('inspector-content');
  if (!object) {
    panel.innerHTML = '<p class="empty"></p>';
    panel.firstChild.textContent = selected.size
      ? selected.size + ' nesne seçili. Birlikte düzenlemek için grupla.'
      : 'Düzenlemek için bir nesne seç.';
    return;
  }
  panel.innerHTML =
    '<div class="inspector-block"><label class="field">Nesne adı<input id="object-name" maxlength="80"></label></div>' +
    '<div class="inspector-block"><h3>Dönüşüm</h3>' +
    Object.entries(fields)
      .filter(([channel]) => !object.isLight || channel === 'position')
      .map(
        ([channel, title]) =>
          '<div class="field">' +
          title +
          '<div class="axis-fields">' +
          ['x', 'y', 'z']
            .map(
              (axis) =>
                '<label><b>' +
                axis.toUpperCase() +
                '</b><input type="number" inputmode="decimal" step="any" aria-label="' +
                title +
                ' ' +
                axis.toUpperCase() +
                '" data-transform="' +
                channel +
                '" data-axis="' +
                axis +
                '"></label>'
            )
            .join('') +
          '</div></div>'
      )
      .join('') +
    '</div>' +
    settingsMarkup(object) +
    '<button id="inspector-delete" class="danger-button">Cismi sil</button>';
  for (const block of panel.querySelectorAll('.inspector-block')) {
    const heading = block.querySelector('h3');
    if (!heading) continue;
    const name = heading.textContent;
    const header = heading.closest('.setting-heading') || heading;
    const content = document.createElement('div');
    const toggle = document.createElement('button');
    toggle.className = 'inspector-toggle quiet';
    for (const node of [...block.children])
      if (node !== header) content.append(node);
    block.append(toggle, content);
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
    input.onkeydown = (event) => {
      if (event.key === 'Enter' && !event.ctrlKey) {
        input.dataset.symmetric = String(event.shiftKey);
        input.blur();
      }
    };
  }
  for (const input of all('[data-transform]')) {
    input.onchange = () => {
      const { transform: channel, axis } = input.dataset;
      const symmetric = shiftPressed || input.dataset.symmetric === 'true';
      delete input.dataset.symmetric;
      const value = input.valueAsNumber;
      if (!Number.isFinite(value) || (channel === 'scale' && value < 0.001)) {
        status(
          channel === 'scale'
            ? 'Ölçek en az 0,001 olmalı.'
            : 'Geçerli bir sayı gir.'
        );
      } else {
        edit(() => {
          const position = object.position.clone();
          const scale = object.scale.clone();
          const bounds = channel === 'scale' ? localBounds(object) : undefined;
          object[channel][axis] =
            channel === 'rotation' ? MathUtils.degToRad(value) : value;
          if (bounds) anchorScale(object, position, scale, bounds, symmetric);
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
    setMotion: (update) =>
      edit(() => {
        if (
          !object.userData.restPose ||
          (!hasKeys(object) && object.userData.positionMode !== 'physics')
        ) {
          object.userData.restPose = capture(object);
        }
        object.userData.physicsClip = animations.active;
        update();
        frameTo(frame);
      }),
    status,
    pick: (callback) => {
      setPlaying(false);
      view?.pickColor(callback);
      status('Sahnede renk almak istediğin noktaya tıkla.');
    },
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
        const names = intersections.map((object) => object.name);
        status(
          'Cisim şu cisimler ile iç içe: [' +
            names.join(', ') +
            ']. Devam etmek için önce cisimleri birbirinden ayırın.'
        );
        return;
      }
      solid.userData.solid = value;
      status(value ? 'Katılık açıldı.' : 'Katılık kapatıldı.');
      refreshTransform();
    }
  });
  refreshTransform();
}

function refreshTransform() {
  const object = single();
  if (!object) return;
  for (const input of all('[data-transform]')) {
    if (input === document.activeElement && input.value !== '' && playing)
      continue;
    const { transform: channel, axis } = input.dataset;
    const value = object[channel][axis];
    input.value = Number(
      (channel === 'rotation' ? MathUtils.radToDeg(value) : value).toFixed(3)
    );
  }
}

function updateExistingKey(object) {
  if (keysFor(object, animations.active).some((key) => key.frame === frame))
    writeKey(object, frame, animations.active);
  else if (object.userData.positionMode === 'physics' && !hasKeys(object))
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
  paintInspector();
  updateTimeline();
  setMode(mode);
  $('group').disabled = !canGroup();
  $('join').disabled =
    !canGroup() || ![...selected].every((object) => object.isMesh);
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
  document.querySelector('.project span:last-child').textContent = show
    ? 'Preset sahnesi'
    : 'Yeni sahne';
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
    mode = 'select';
    replaceScene({
      project: JSON.stringify({
        version: projectVersion,
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
  current: () => encodeProject(root, duration, animations),
  fromObject: (object) => ({
    version: projectVersion,
    duration,
    animations,
    objects: [encodeObject(object)]
  }),
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
      for (const object of project.objects) root.add(object);
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
    type === 'light' ? 3 : 0.5,
    1.7
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
  const parents = new Set(targets.map((object) => object.parent));
  targets.forEach(disposeObject);
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
      const anchor = targets.pop()?.getWorldPosition(new Vector3())[axis];
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
$('add-sphere').onclick = () => edit(() => addObject('sphere'));
$('add-light').onclick = () => edit(() => addObject('light'));
$('group').onclick = () => {
  if (!canGroup()) return;
  setPlaying(false);
  edit(() => select(groupObjects([...selected])));
  status('Nesneler gruplandı.');
};
$('join').onclick = () => {
  const objects = [...selected];
  if (!canGroup() || !objects.every((object) => object.isMesh)) return;
  if (objects.some(hasKeys)) {
    status(
      'Ağları birleştirmek için seçili nesnelerin anahtar karelerini kaldır.'
    );
    return;
  }
  setPlaying(false);
  edit(() => {
    select(joinMeshes(objects));
    setWireframe(wireframe);
  });
  status('Geometri tek bir ağda birleştirildi.');
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
  });
  status('Grup çözüldü.');
};
$('delete').onclick = () => edit(deleteSelection);
$('wireframe').onclick = () => setWireframe(!wireframe);
$('reset-view').onclick = () => {
  view?.reset();
  status('Kamera sıfırlandı.');
};
$('show-pivots').onclick = () => {
  const show = $('show-pivots').getAttribute('aria-pressed') !== 'true';
  $('show-pivots').setAttribute('aria-pressed', String(show));
  view?.showPivots(show);
};
for (const button of all('[data-mode]')) {
  button.onclick = () => {
    setPlaying(false);
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
  shiftPressed = event.shiftKey;
  const key = event.key.toLowerCase();
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
    /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)
  )
    return;
  const modeKey =
    'qgrs'.indexOf(key) !== -1 && key.length === 1
      ? modes['qgrs'.indexOf(key)]
      : undefined;
  if (modeKey) {
    setPlaying(false);
    setMode(modeKey);
  }
  if (key === 'delete') edit(deleteSelection);
  if (key === 'k') edit(addKeys);
  if (key === ' ' && document.activeElement?.tagName !== 'BUTTON') {
    event.preventDefault();
    setPlaying(!playing);
  }
});
window.addEventListener('keyup', (event) => {
  shiftPressed = event.shiftKey;
});
window.addEventListener('blur', () => {
  shiftPressed = false;
});

async function saveOutput(blob, name, label) {
  if (window.rendercardDesktop) {
    try {
      const saved = await window.rendercardDesktop.saveFile(
        name,
        await blob.arrayBuffer()
      );
      status(saved ? label + ' kaydedildi.' : 'Kaydetme iptal edildi.');
    } catch (error) {
      console.error('Dosya kaydedilemedi.', error);
      status('Dosya kaydedilemedi.');
    }
    return;
  }
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
  status(label + ' indirildi.');
}

$('save').onclick = () => {
  const content = JSON.stringify(
    encodeProject(root, duration, animations),
    null,
    2
  );
  void saveOutput(
    new Blob([content], { type: 'application/json' }),
    'sahne.rendercard.json',
    'Proje'
  );
};
$('open').onclick = () => $('project-file').click();
$('project-file').onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const project = decodeProject(JSON.parse(await file.text()));
    edit(() => {
      [...root.children].forEach(disposeObject);
      project.objects.forEach((object) => root.add(object));
      duration = project.duration;
      animations = project.animations;
      updateSceneVisibility();
      selected.clear();
      setWireframe(wireframe);
      frameTo(0);
      refresh();
    });
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
  view.render(true);
  view.canvas.toBlob((blob) => {
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
  const oldFrame = frame;
  const poses = new Map();
  forObjects((object) => poses.set(object, capture(object)));
  setPlaying(false);
  recording = true;
  const workspace = document.querySelector('.workspace');
  const actions = document.querySelector('.top-actions');
  workspace.inert = true;
  actions.inert = true;
  view.lockSize(true);
  try {
    const { encodeVideo } = await import('./video.js');
    const { blob, name } = await encodeVideo(view, duration, fps, (next) => {
      frame = next;
      poseScene(frame > 0);
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
    view.lockSize(false);
    frameTo(oldFrame);
    for (const [object, pose] of poses) applyPose(object, pose);
    refreshTransform();
  }
}
$('video').onclick = () => {
  if (!recording && view) status('Animasyon kaydediliyor…');
  void recordVideo();
};

function populate() {
  const platform = makeObject('box', 'Kaide', '#596c61');
  platform.position.set(0, 0.17, 0);
  platform.scale.set(4.65, 0.34, 3.25);
  const sphere = makeObject('sphere', 'Küre', '#d5f47c', 48);
  sphere.position.set(-0.77, 1.15, 0.24);
  sphere.scale.setScalar(1.62);
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
  root.add(sphere, box, platform);
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
    editing: (direction, axis) => {
      const object = single();
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
    change: (symmetric) => {
      const object = single();
      if (!drag || !object) return;
      if (mode === 'scale') {
        for (const axis of ['x', 'y', 'z'])
          object.scale[axis] = Math.max(0.001, object.scale[axis]);
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
        collisions?.sweep(root, object, drag.last);
      }
      if (collisions?.overlaps(root, object).length)
        applyPose(object, drag.lastPose);
      drag.last.copy(object.position);
      drag.lastPose = capture(object);
      refreshTransform();
    },
    moved: () => {
      if (!drag) return;
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
void import('./collisions.js')
  .then(async (engine) => {
    if (await engine.initializeCollisions()) {
      collisions = engine;
      if ($('object-solid')) $('object-solid').disabled = false;
    }
  })
  .catch((error) => console.error('Katılık modülü yüklenemedi.', error));
function animate(now) {
  if (playing) {
    const next = Math.floor(((now - startedAt) * fps) / 1000);
    if (next >= duration) {
      setPlaying(false);
      frameTo(duration, true);
    } else if (next !== frame) frameTo(next, true);
  }
  if (!recording) view?.render();
  window.requestAnimationFrame(animate);
}
window.requestAnimationFrame(animate);
