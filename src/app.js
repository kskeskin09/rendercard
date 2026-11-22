import { Group, MathUtils, Vector3 } from 'three';
import { createViewport } from './viewport.js';
import { icon } from './icons.js';
import {
  applyPose,
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

function status(message) {
  $('status').textContent = message;
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
    project: JSON.stringify(encodeProject(root, duration)),
    frame,
    selection: [...selected].map((object) => objects.indexOf(object))
  };
}

function replaceScene(state) {
  const project = decodeProject(JSON.parse(state.project));
  [...root.children].forEach(disposeObject);
  project.objects.forEach((object) => root.add(object));
  duration = project.duration;
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
  callback();
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
  collisions?.separate(root, object);
  updateExistingKey(object);
  fitParentPivots(object);
}

function poseScene(continuous = false) {
  const animated = [];
  forObjects((object) => {
    if (object.userData.keys.length) {
      const from =
        continuous && collisions ? object.position.clone() : undefined;
      poseAt(object, frame);
      animated.push({ object, from });
    }
  });
  if (collisions && animated.length) {
    for (const { object, from } of animated) {
      if (from) collisions.sweep(root, object, from);
      collisions.separate(root, object);
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
    object.userData.keys.some((key) => key.frame === frame)
  );
}

function setPlaying(value) {
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
  $('track-name').textContent =
    single()?.name || (selected.size ? selected.size + ' nesne' : 'Sahne');
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
  const frames = new Set();
  if (selected.size) {
    for (const object of selected)
      for (const key of object.userData.keys) frames.add(key.frame);
  } else {
    forObjects((object) =>
      object.userData.keys.forEach((key) => frames.add(key.frame))
    );
  }
  $('key-markers').replaceChildren(
    ...[...frames]
      .filter((value) => value <= duration)
      .map((value) => {
        const marker = document.createElement('span');
        marker.className = 'key-dot';
        marker.style.left = (value / duration) * 100 + '%';
        return marker;
      })
  );
  refreshFrame();
}

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
    settingsMarkup(object);
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
          settleObject(object, channel === 'position' ? position : undefined);
        });
      }
      refreshTransform();
    };
  }
  bindSettings(panel, object, {
    edit,
    collisionReady: Boolean(collisions),
    changed: (changedObject) => {
      if (changedObject) settleObject(changedObject);
      paintList();
      refreshTransform();
    },
    toggleSolid: (solid, value) => {
      solid.userData.solid = value;
      const moved = value
        ? (collisions?.clearSolidOverlap(root, solid) ?? [])
        : [];
      for (const object of moved) {
        updateExistingKey(object);
        fitParentPivots(object);
      }
      status(
        value
          ? moved.length
            ? moved.length + ' nesne katı yüzeyin dışına taşındı.'
            : 'Katılık açıldı.'
          : 'Katılık kapatıldı.'
      );
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
  if (object.userData.keys.some((key) => key.frame === frame))
    writeKey(object, frame);
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
  current: () => encodeProject(root, duration),
  fromObject: (object) => ({
    version: projectVersion,
    duration,
    objects: [encodeObject(object)]
  }),
  insert(record) {
    const project = decodeProject(record.project);
    if (!project.objects.length) return;
    edit(() => {
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
      for (const key of object.userData.keys) {
        key.position = key.position.map((value, axis) => value + offset[axis]);
      }
      object.traverse((child) => {
        const lastKey = child.userData.keys.at(-1);
        if (lastKey) duration = Math.max(duration, lastKey.frame);
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
  object.position.set(Math.min((index - 1) * 0.35, 2.1), 0.5, 1.7);
  object.material.wireframe = wireframe;
  root.add(object);
  settleObject(object);
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
  for (const object of selected) writeKey(object, frame);
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
        settleObject(target, from);
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
$('group').onclick = () => {
  if (!canGroup()) return;
  setPlaying(false);
  edit(() => select(groupObjects([...selected])));
  status('Nesneler gruplandı.');
};
$('join').onclick = () => {
  const objects = [...selected];
  if (!canGroup() || !objects.every((object) => object.isMesh)) return;
  if (objects.some((object) => object.userData.keys.length)) {
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
  if (group.userData.keys.length) {
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
      const keys = object.userData.keys;
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
  const content = JSON.stringify(encodeProject(root, duration), null, 2);
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

populate();
try {
  view = createViewport($('viewport'), root, {
    select,
    editing: (direction) => {
      const object = single();
      if (!object) return;
      setPlaying(false);
      drag = {
        before: captureScene(),
        position: object.position.clone(),
        scale: object.scale.clone(),
        last: object.position.clone(),
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
      if (mode === 'translate') collisions?.sweep(root, object, drag.last);
      collisions?.separate(root, object);
      drag.last.copy(object.position);
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
