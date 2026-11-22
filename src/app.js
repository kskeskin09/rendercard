import { Group, MathUtils } from 'three';
import { createViewport } from './viewport.js';
import { icon } from './icons.js';
import {
  applyPose,
  capture,
  decodeProject,
  disposeObject,
  dissolveGroup,
  encodeProject,
  groupObjects,
  joinMeshes,
  makeObject,
  materialsOf,
  poseAt,
  setDetail,
  types,
  writeKey
} from './model.js';

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

function frameTo(next) {
  frame = Math.min(duration, Math.max(0, Math.round(next)));
  forObjects((object) => poseAt(object, frame));
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
  const isPrimitive = object.isMesh && object.userData.type !== 'mesh';
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
    (isPrimitive
      ? '<div class="inspector-block"><h3>Görünüm</h3><label class="field">Renk<input id="object-color" type="color"></label></div>'
      : '') +
    (object.userData.type === 'sphere'
      ? '<div class="inspector-block"><h3>Geometri</h3><label class="field">Yüzey ayrıntısı<select id="object-detail"><option value="12">Düşük</option><option value="24">Orta</option><option value="48">Yüksek</option></select></label></div>'
      : '');
  const name = $('object-name');
  name.value = object.name;
  name.onchange = () => {
    object.name = name.value.trim() || types[object.userData.type];
    name.value = object.name;
    paintList();
    updateTimeline();
  };
  for (const input of all('[data-transform]')) {
    input.onchange = () => {
      setPlaying(false);
      const { transform: channel, axis } = input.dataset;
      const value = input.valueAsNumber;
      if (!Number.isFinite(value) || (channel === 'scale' && value < 0.001)) {
        status(
          channel === 'scale'
            ? 'Ölçek en az 0,001 olmalı.'
            : 'Geçerli bir sayı gir.'
        );
      } else {
        object[channel][axis] =
          channel === 'rotation' ? MathUtils.degToRad(value) : value;
        updateExistingKey(object);
      }
      refreshTransform();
    };
  }
  if (isPrimitive) {
    $('object-color').value = '#' + object.material.color.getHexString();
    $('object-color').oninput = (event) =>
      object.material.color.set(event.target.value);
  }
  if ($('object-detail')) {
    $('object-detail').value = object.userData.detail;
    $('object-detail').onchange = (event) => {
      setDetail(object, Number(event.target.value));
      paintList();
    };
  }
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
}

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
  select(object);
  setMode('translate');
  status(object.name + ' eklendi.');
}

function deleteSelection() {
  if (!selected.size) return;
  setPlaying(false);
  const targets = [...selected].filter((object) => {
    for (let parent = object.parent; parent; parent = parent.parent)
      if (selected.has(parent)) return false;
    return true;
  });
  targets.forEach(disposeObject);
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

$('add-box').onclick = () => addObject('box');
$('add-sphere').onclick = () => addObject('sphere');
$('group').onclick = () => {
  if (!canGroup()) return;
  setPlaying(false);
  select(groupObjects([...selected]));
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
  select(joinMeshes(objects));
  setWireframe(wireframe);
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
  const children = dissolveGroup(group);
  selected.clear();
  children.forEach((object) => selected.add(object));
  refresh();
  status('Grup çözüldü.');
};
$('delete').onclick = deleteSelection;
$('wireframe').onclick = () => setWireframe(!wireframe);
$('reset-view').onclick = () => {
  view?.reset();
  status('Kamera sıfırlandı.');
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
$('add-key').onclick = addKeys;
$('remove-key').onclick = () => {
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
      ? frame + '. karedeki anahtar silindi.'
      : 'Bu karede seçili nesnelere ait anahtar yok.'
  );
};
$('scrub').oninput = (event) => stopAt(event.target.valueAsNumber);
$('frame').onchange = (event) => stopAt(event.target.valueAsNumber || 0);
$('duration').onchange = (event) => {
  duration = Math.max(
    1,
    Math.min(1800, Math.round(event.target.valueAsNumber || duration))
  );
  stopAt(frame);
  updateTimeline();
};

window.addEventListener('keydown', (event) => {
  if (
    recording ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)
  )
    return;
  const key = event.key.toLowerCase();
  const modeKey =
    'qgrs'.indexOf(key) !== -1 && key.length === 1
      ? modes['qgrs'.indexOf(key)]
      : undefined;
  if (modeKey) {
    setPlaying(false);
    setMode(modeKey);
  }
  if (key === 'delete') deleteSelection();
  if (key === 'k') addKeys();
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
    setPlaying(false);
    [...root.children].forEach(disposeObject);
    project.objects.forEach((object) => root.add(object));
    duration = project.duration;
    selected.clear();
    setWireframe(wireframe);
    frameTo(0);
    refresh();
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
      forObjects((object) => poseAt(object, frame));
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
    editing: () => setPlaying(false),
    change: () => {
      const object = single();
      if (object && mode === 'scale') {
        for (const axis of ['x', 'y', 'z'])
          object.scale[axis] = Math.max(0.001, object.scale[axis]);
      }
      refreshTransform();
    },
    moved: () => {
      if (single()) updateExistingKey(single());
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
function animate(now) {
  if (playing) {
    const next = Math.floor(((now - startedAt) * fps) / 1000);
    if (next >= duration) stopAt(duration);
    else if (next !== frame) frameTo(next);
  }
  if (!recording) view?.render();
  window.requestAnimationFrame(animate);
}
window.requestAnimationFrame(animate);
