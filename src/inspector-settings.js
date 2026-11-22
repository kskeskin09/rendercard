import { applyTile, tiles } from './tiles.js';
import { changePivot, groundObject } from './spatial.js';
import { setDetail } from './model.js';
import { colorMarkup, bindColor } from './color-editor.js';
import { rotationPaths } from './motion.js';
import { speedMarkup, bindSpeed } from './speed-graph.js';

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
const vectorFields = (id, label) =>
  axes
    .map(
      (axis) =>
        '<label><b>' +
        axis.toUpperCase() +
        '</b><input type="number" aria-label="' +
        label +
        ' ' +
        axis.toUpperCase() +
        '" data-' +
        id +
        '="' +
        axis +
        '" min="-1000" max="1000" step="any"></label>'
    )
    .join('');

export function settingsMarkup(object) {
  const type = object.userData.type;
  const primitive = type === 'box' || type === 'sphere';
  return (
    '<div class="inspector-block"><h3>Yerleşim</h3>' +
    (type === 'light'
      ? ''
      : '<label class="check-field" title="Katı yüzeylerden geçişi engeller. Açmak için nesneyi önce çakışmalardan ayır."><input id="object-solid" type="checkbox"> Katılık</label>') +
    '<label class="field" title="Nesnenin alt kenarını veya seçili merkezini sahne zeminiyle hizalar.">Zemine bitiştir<select id="object-ground"><option value="">Bir nokta seç</option><option value="edge">En uç kenarı</option><option value="center">Merkezi</option></select></label>' +
    '<div class="field" title="Konum ve hizalama işlemlerinin referans noktası.">Merkez noktası<div class="axis-fields pivot-fields">' +
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
    '<div class="inspector-block"><div class="setting-heading"><h3>Görünüm</h3><button id="object-visible" class="quiet" title="Nesneyi sahnede ve renderda göster veya gizle" aria-pressed="true"></button></div>' +
    (primitive
      ? '<label class="field" title="Düz bir renk veya tekrarlanan bir desen seç.">Yüzey<select id="object-finish">' +
        options([
          ['color', 'Renk'],
          ['tile', 'Tile (döşeme)']
        ]) +
        '</select></label>' +
        colorMarkup +
        '<div id="tile-settings" hidden><label class="field">Tile<select id="object-tile">' +
        options(Object.entries(tiles)) +
        '</select></label>' +
        '<label class="field" title="1/4, desenin dörtte bir ölçeğe inmesi ve daha sık tekrarlanması demektir.">Tile ölçeği<span class="fraction">1 / <input id="object-tile-scale" aria-label="Tile ölçeği paydası" type="number" min="1" max="1000" step="any"></span></label></div>'
      : type === 'light'
        ? colorMarkup +
          '<label class="field" title="%0 düşük ama görünür güç, %100 yüksek parlaklık.">Işık gücü (%)<input id="light-power" type="number" min="0" max="100" step="any"></label>'
        : '') +
    (object.isMesh
      ? '<label class="check-field" title="Cisim parlar ve merkezine bağlı bir ışık çevresini aydınlatır."><input id="object-emits" type="checkbox"> Işık yay</label>' +
        '<div id="emission-settings" hidden><label class="field">Yayılan ışık rengi<input id="emission-color" type="color"></label>' +
        '<label class="field">Yayılan ışık gücü (%)<input id="emission-power" type="number" min="0" max="100"></label></div>'
      : '') +
    '</div>' +
    (type === 'box'
      ? '<div class="inspector-block"><h3>Geometri</h3><div class="field" title="Sadece seçtiğin eksene paralel kenarları yuvarlar. Örneğin Y düşey kenarlardır.">Kenar yuvarlama (%)<div class="axis-fields">' +
        axes
          .map(
            (axis) =>
              '<label><b>' +
              axis.toUpperCase() +
              '</b><input id="edge-radius-' +
              axis +
              '" aria-label="Kenar yuvarlama ' +
              axis.toUpperCase() +
              ' (%)" type="number" min="0" max="50" step="1"></label>'
          )
          .join('') +
        '</div></div>' +
        '<label class="field" title="Yuvarlatılmış köşeleri oluşturan yüzey sayısı. Değer arttıkça köşe daha pürüzsüz görünür.">Köşe ayrıntısı<input id="object-segments" type="number" min="1" max="12" step="1"></label></div>'
      : '') +
    (type === 'sphere'
      ? '<div class="inspector-block"><h3>Geometri</h3><label class="field">Yüzey ayrıntısı<select id="object-detail">' +
        options([
          [12, 'Düşük'],
          [24, 'Orta'],
          [48, 'Yüksek']
        ]) +
        '</select></label></div>'
      : '') +
    '<div class="inspector-block"><h3>Animasyon</h3>' +
    '<label class="field" title="Özel bir sahne seçilirse nesne o animasyon seçiliyken görünür.">Nesnenin sahnesi<select id="scene-clip"></select></label>' +
    '<label class="field">Konum hareketi<select id="position-motion"><option value="keys">Karelerle hareket</option><option value="physics">Fiziksel ivme</option></select></label>' +
    '<div id="physics-controls" hidden><div class="field" title="Dünya eksenlerindeki ivme sekmeden sonra da aynı kalır.">İvme (m/s²)<div class="axis-fields">' +
    vectorFields('acceleration', 'İvme') +
    '</div></div>' +
    '<div class="field" title="Cismin başlarken sahip olduğu dünya ekseni hızı.">Başlangıç hızı (m/s)<div class="axis-fields">' +
    vectorFields('velocity', 'Başlangıç hızı') +
    '</div></div>' +
    '<label class="field" title="Çarpışmada yüzeye dik hızın ters yönde korunan yüzdesi.">Sekme (%)<input id="object-bounce" type="number" min="0" max="100" step="any"></label>' +
    '<p class="selection-tip">Hız grafiği bu modda dönüşü ve boyutu etkiler.</p></div>' +
    speedMarkup +
    '<label class="field" title="Kısa veya uzun dönüş yolunu seç. Bir eksende belirli yönde ya da tam tur dönmek için açıları izle seçeneğini kullan.">Dönüş yolu<select id="rotation-path">' +
    options(Object.entries(rotationPaths)) +
    '</select></label></div>'
  );
}

export function bindSettings(
  panel,
  object,
  {
    edit,
    setMotion,
    scenes,
    sceneChanged,
    changed,
    toggleSolid,
    collisionReady,
    pick,
    highlight,
    status
  }
) {
  const $ = (id) => panel.querySelector('#' + id);
  const data = object.userData;
  if ($('object-solid')) {
    $('object-solid').checked = data.solid;
    $('object-solid').disabled = !collisionReady;
    $('object-solid').onchange = (event) => {
      const input = event.target;
      edit(() => toggleSolid(object, input.checked));
      input.checked = data.solid;
    };
  }
  $('object-ground').onchange = (event) => {
    const select = event.target;
    if (select.value)
      edit(() => {
        const oldPosition = object.position.clone();
        groundObject(object, select.value);
        return changed(object, oldPosition);
      });
    select.value = '';
  };
  function visibility() {
    $('object-visible').textContent = data.hidden ? 'Gizli' : 'Görünür';
    $('object-visible').setAttribute('aria-pressed', String(!data.hidden));
  }
  visibility();
  $('object-visible').onclick = () =>
    edit(() => {
      data.hidden = !data.hidden;
      object.visible = !data.hidden && object.clipActive !== false;
      visibility();
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
  function number(id, read, min, max, update) {
    const input = $(id);
    input.value = read();
    input.onchange = () => {
      const next = input.valueAsNumber;
      if (Number.isFinite(next))
        edit(() => update(Math.max(min, Math.min(max, next))));
      input.value = read();
    };
  }
  if ($('object-finish')) {
    $('object-finish').value = data.finish;
    $('object-tile').value = data.tile;
    $('tile-settings').hidden = data.finish !== 'tile';
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
    number(
      'object-tile-scale',
      () => 1 / data.tileScale,
      1,
      1000,
      (value) => {
        data.tileScale = 1 / value;
        object.material.map?.repeat.setScalar(value);
      }
    );
  }
  function rebuild(detail = data.detail) {
    setDetail(object, detail);
    return changed(object);
  }
  if ($('edge-radius-x')) {
    for (const [index, axis] of axes.entries()) {
      number(
        'edge-radius-' + axis,
        () => (data.edgeRadii?.[index] ?? data.radius) * 100,
        0,
        50,
        (value) => {
          data.edgeRadii ??= [data.radius, data.radius, data.radius];
          data.radius = 0;
          data.edgeRadii[index] = value / 100;
          return rebuild();
        }
      );
      const field = $('edge-radius-' + axis);
      field.onfocus = field.onpointerenter = () => highlight(axis);
      field.onblur = field.onpointerleave = () => highlight();
    }
    number(
      'object-segments',
      () => data.segments,
      1,
      12,
      (value) => {
        data.segments = Math.round(value);
        return rebuild();
      }
    );
  }
  if ($('object-detail')) {
    $('object-detail').value = data.detail;
    $('object-detail').onchange = (event) =>
      edit(() => rebuild(Number(event.target.value)));
  }
  if ($('object-color'))
    bindColor(panel, object.isLight ? object.color : object.material.color, {
      edit,
      pick,
      status
    });
  if (object.isLight)
    number(
      'light-power',
      () =>
        Math.max(
          0,
          Math.min(100, Math.round((object.intensity - 0.5) / 1.795))
        ),
      0,
      100,
      (value) => {
        object.intensity = 0.5 + 1.795 * value;
      }
    );
  if ($('object-emits')) {
    $('object-emits').checked = data.emitsLight;
    $('emission-settings').hidden = !data.emitsLight;
    $('object-emits').onchange = (event) =>
      edit(() => {
        data.emitsLight = event.target.checked;
        $('emission-settings').hidden = !data.emitsLight;
      });
    $('emission-color').value = data.emissionColor;
    $('emission-color').onchange = (event) =>
      edit(() => {
        data.emissionColor = event.target.value;
      }, 'Yayılan ışık rengini değiştir');
    number(
      'emission-power',
      () => data.emissionPower,
      0,
      100,
      (value) => {
        data.emissionPower = value;
      }
    );
  }
  $('position-motion').value = data.positionMode;
  $('physics-controls').hidden = data.positionMode !== 'physics';
  $('position-motion').onchange = (event) => {
    setMotion(() => {
      data.positionMode = event.target.value;
    });
    $('physics-controls').hidden = data.positionMode !== 'physics';
  };
  for (const [field, property] of [
    ['acceleration', 'physicsAcceleration'],
    ['velocity', 'initialVelocity']
  ]) {
    for (const [index, input] of [
      ...panel.querySelectorAll('[data-' + field + ']')
    ].entries()) {
      input.value = data[property][index];
      input.onchange = () => {
        if (Number.isFinite(input.valueAsNumber))
          setMotion(() => {
            data[property][index] = Math.min(
              1000,
              Math.max(-1000, input.valueAsNumber)
            );
          });
        input.value = data[property][index];
      };
    }
  }
  $('object-bounce').value = data.restitution * 100;
  $('object-bounce').onchange = (event) => {
    const input = event.target;
    if (Number.isFinite(input.valueAsNumber))
      setMotion(() => {
        data.restitution =
          Math.min(100, Math.max(0, input.valueAsNumber)) / 100;
      });
    input.value = data.restitution * 100;
  };
  bindSpeed(panel, data, edit, status);
  $('scene-clip').replaceChildren(
    new Option('Her animasyonda', ''),
    ...scenes.map((clip) => new Option(clip.name, clip.id))
  );
  $('scene-clip').value = data.sceneClip ?? '';
  $('scene-clip').onchange = (event) =>
    edit(() => {
      data.sceneClip = event.target.value || null;
      sceneChanged();
    });
  $('rotation-path').value = data.rotationPath;
  $('rotation-path').onchange = (event) =>
    edit(() => {
      data.rotationPath = event.target.value;
    });
}
