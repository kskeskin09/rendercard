import { applyTile, tiles } from './tiles.js';
import { changePivot, groundObject } from './spatial.js';
import { setDetail } from './model.js';

const axes = ['x', 'y', 'z'];
const choices = [
  ['Sol', 'Orta', 'Sağ'],
  ['En alt', 'Orta', 'En üst'],
  ['Sol', 'Orta', 'Sağ']
];
const options = (entries) =>
  entries
    .map(
      ([value, label]) => '<option value="' + value + '">' + label + '</option>'
    )
    .join('');

export function settingsMarkup(object) {
  const type = object.userData.type;
  return (
    '<div class="inspector-block"><h3>Yerleşim</h3>' +
    '<label class="check-field"><input id="object-solid" type="checkbox"> Katılık</label>' +
    '<button id="object-ground" class="quiet ground-action">Zemine bitiştir</button>' +
    '<div class="field">Merkez noktası<div class="axis-fields pivot-fields">' +
    axes
      .map((axis, index) => {
        const label = axis.toUpperCase();
        return (
          '<label><b>' +
          label +
          '</b><select data-pivot="' +
          axis +
          '" aria-label="Merkez noktası ' +
          label +
          '">' +
          options(choices[index].map((choice, i) => [i - 1, choice])) +
          '</select></label>'
        );
      })
      .join('') +
    '</div></div></div>' +
    (type === 'box' || type === 'sphere'
      ? '<div class="inspector-block"><h3>Görünüm</h3><label class="field">Yüzey<select id="object-finish">' +
        options([
          ['color', 'Renk'],
          ['tile', 'Tile (döşeme)']
        ]) +
        '</select></label>' +
        '<label class="field">Renk<input id="object-color" type="color"></label>' +
        '<div id="tile-settings" hidden><label class="field">Tile<select id="object-tile">' +
        options(Object.entries(tiles)) +
        '</select></label>' +
        '<label class="field">Tile ölçeği<input id="object-tile-scale" type="number" min="0.05" max="20" step="0.05"></label></div></div>'
      : '') +
    (type === 'box'
      ? '<div class="inspector-block"><h3>Geometri</h3><label class="field">Köşe yarıçapı (%)<input id="object-radius" type="number" min="0" max="50" step="1"></label>' +
        '<label class="field">Köşe ayrıntısı<input id="object-segments" type="number" min="1" max="12" step="1"></label></div>'
      : '') +
    (type === 'sphere'
      ? '<div class="inspector-block"><h3>Geometri</h3><label class="field">Yüzey ayrıntısı<select id="object-detail">' +
        options([
          [12, 'Düşük'],
          [24, 'Orta'],
          [48, 'Yüksek']
        ]) +
        '</select></label></div>'
      : '')
  );
}

export function bindSettings(
  panel,
  object,
  { edit, changed, toggleSolid, collisionReady }
) {
  const $ = (id) => panel.querySelector('#' + id);
  const data = object.userData;
  $('object-solid').checked = data.solid;
  $('object-solid').disabled = !collisionReady;
  $('object-solid').onchange = (event) =>
    edit(() => toggleSolid(object, event.target.checked));
  $('object-ground').onclick = () =>
    edit(() => {
      groundObject(object);
      changed(object);
    });
  for (const [index, select] of [
    ...panel.querySelectorAll('[data-pivot]')
  ].entries()) {
    select.value = data.pivot[index];
    select.onchange = () =>
      edit(() => {
        changePivot(object, select.dataset.pivot, Number(select.value));
        changed();
      });
  }
  function number(id, value, min, max, update) {
    const input = $(id);
    input.value = value;
    input.onchange = () => {
      const next = input.valueAsNumber;
      if (Number.isFinite(next))
        edit(() => update(Math.max(min, Math.min(max, next))));
      input.value =
        id === 'object-radius'
          ? data.radius * 100
          : id === 'object-segments'
            ? data.segments
            : data.tileScale;
    };
  }
  if ($('object-finish')) {
    $('object-finish').value = data.finish;
    $('object-color').value = '#' + object.material.color.getHexString();
    $('object-tile').value = data.tile;
    $('tile-settings').hidden = data.finish !== 'tile';
    $('object-color').onchange = (event) =>
      edit(() => object.material.color.set(event.target.value));
    $('object-finish').onchange = (event) =>
      edit(() => {
        data.finish = event.target.value;
        $('tile-settings').hidden = data.finish !== 'tile';
        applyTile(object.material, data);
      });
    $('object-tile').onchange = (event) =>
      edit(() => {
        data.tile = event.target.value;
        applyTile(object.material, data);
      });
    number('object-tile-scale', data.tileScale, 0.05, 20, (value) => {
      data.tileScale = value;
      object.material.map?.repeat.setScalar(1 / value);
    });
  }
  function rebuild(detail = data.detail) {
    setDetail(object, detail);
    changed(object);
  }
  if ($('object-radius')) {
    number('object-radius', data.radius * 100, 0, 50, (value) => {
      data.radius = value / 100;
      rebuild();
    });
    number('object-segments', data.segments, 1, 12, (value) => {
      data.segments = Math.round(value);
      rebuild();
    });
  }
  if ($('object-detail')) {
    $('object-detail').value = data.detail;
    $('object-detail').onchange = (event) =>
      edit(() => rebuild(Number(event.target.value)));
  }
}
