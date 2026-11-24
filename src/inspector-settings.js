import { applyTile, setTileOptions, setTileSize, tiles } from './tiles.js';
import { changePivot, groundObject } from './spatial.js';
import { isPrimitive, shapeSides, setDetail, updateMeshSurface } from './model.js';
import { colorMarkup, bindColor } from './color-editor.js';
import { rotationPaths } from './motion.js';
import { speedMarkup, bindSpeed } from './speed-graph.js';
import { axes, axisHeading, axisRow } from './inspector-grid.js';
import { orbitPlanes } from './orbit-motion.js';
import { maximumLetterRadius } from './text-geometry.js';
import { minimumTriangleAngle, remainingTriangleAngle, validTriangleAngles } from './triangle-geometry.js';

const choices = [
  ['Sol', 'Orta', 'Sağ'],
  ['En üst', 'Orta', 'En alt'],
  ['Sol', 'Orta', 'Sağ']
];
const sizeCurveHint = 'Anahtar kareler hedef boyutu belirler. Grafik, büyüme ya da küçülmenin iki kare arasındaki zamana nasıl yayıldığını ayarlar.';
const selectedParts = new WeakMap();
const options = (entries) =>
  entries
    .map(
      ([value, label]) => '<option value="' + value + '">' + label + '</option>'
    )
    .join('');
const vectorFields = (id, label) =>
  axes.map(
    (axis) =>
      '<input type="number" aria-label="' +
      label +
      ' ' +
      axis.toUpperCase() +
      '" data-' +
      id +
      '="' +
      axis +
      '" min="' + (id.startsWith('angular') ? -3600 : -1000) + '" max="' + (id.startsWith('angular') ? 3600 : 1000) + '" step="any">'
  );

export function settingsMarkup(object) {
  const type = object.userData.type;
  const primitive = isPrimitive(type);
  return (
    '<div class="inspector-block"><h3>Yerleşim</h3>' +
    (type === 'light'
      ? ''
      : (object.isCamera ? '<label class="check-field"><input id="camera-collisions" type="checkbox"> Katı cisimlerden etkilen</label>' : '') +
        '<label id="solid-field" class="check-field" title="Katı yüzeylerden geçişi engeller. Açmak için nesneyi önce çakışmalardan ayır."><input id="object-solid" type="checkbox"> Katılık</label>') +
    (object.isMesh ? '<label id="elastic-field" class="check-field" title="Yeterince dar bir nesne katı yüzeye girebilir. Yüzey geçici olarak nesnenin çevresini sarar."><input id="object-elastic" type="checkbox"> Elastiklik</label>' : '') +
    (!object.isLight && !object.isCamera
      ? '<label class="check-field" title="Fiziksel ivme modunda Y = 0 yüzeyine temas ve sekme."><input id="ground-reaction" type="checkbox"> Zemine tepki verir</label>'
      : '') +
    (object.isMesh ? '<label class="field" title="Negatif bir nesne pozitif nesneye girdiğinde kesişim hacmini çıkarır. Boştayken normal görünür.">Nesne işlemi<select id="object-sign"><option value="positive">Pozitif · Hacim ekle</option><option value="negative">Negatif · Delik aç</option></select></label>' : '') +
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
          options(choices[index].map((choice, i) => [index === 1 ? 1 - i : i - 1, choice])) +
          '</select></label>'
        );
      })
      .join('') +
    '</div></div></div>' +
    '<div class="inspector-block"><h3>İskelet</h3>' +
    '<label class="check-field" title="Nesnenin seçili merkezine, nesneyle birlikte hareket eden bir bağlantı noktası ekler."><input id="skeleton-joint" type="checkbox"> İskelet bağı</label></div>' +
    (object.isCamera ? '<div class="inspector-block"><h3>Kamera takibi</h3>' +
      '<label class="field">Takip hedefi<select id="follow-target"></select></label>' +
      '<div id="follow-settings" hidden><output id="follow-distance"></output>' +
      '<button id="follow-rebase" class="quiet" title="Mevcut konumu yeni takip açısı ve mesafesi olarak kullan">Mesafeyi yeniden al</button></div></div>' : '') +
    '<div class="inspector-block"><h3>Görünüm</h3>' +
    (object.isMesh || type === 'group' ? '<div class="field">Opaklık (%)<div class="opacity-fields">' +
      '<input id="object-opacity" aria-label="Opaklık (%)" type="number" min="0" max="100">' +
      '<input id="opacity-range" aria-label="Opaklık kaydırıcısı" type="range" min="0" max="100"></div></div>' : '') +
    (primitive || type === 'mesh' || type === 'letter'
      ? '<label class="field" title="Düz bir renk veya tekrarlanan bir desen seç.">Yüzey<select id="object-finish">' +
        options([
          ...(type === 'mesh' ? [['parts', 'Parça yüzeyleri']] : []),
          ['color', 'Renk'],
          ['tile', 'Tile (döşeme)']
        ]) +
        '</select></label>' +
        (type === 'mesh' ? '<div id="mesh-part-settings"><label class="field">Parça<select id="mesh-part"></select></label>' +
          '<label class="field">Parça yüzeyi<select id="part-finish"><option value="color">Renk</option><option value="tile">Tile (döşeme)</option></select></label></div>' : '') +
        '<div id="tile-settings" hidden><label class="field">Tile<select id="object-tile">' +
        options(Object.entries(tiles)) +
        '</select></label>' +
        '<label class="field">Renk<select id="tile-color-mode"><option value="default">Varsayılan</option><option value="custom">Özel</option></select></label>' +
        '<label class="check-field" title="Deseni yüzeye bir kez sığdırır. Yüzde değeri, sığdırma kapatıldığında yeniden kullanılır."><input id="tile-fit" type="checkbox"> Yüzeye sığdır</label>' +
        '<label class="field" title="%100, zemindeki bir ızgara karesi büyüklüğündedir. %200, her kenarı iki kat büyütür.">Tile boyutu (%)<input id="object-tile-scale" aria-label="Tile boyutu (%)" type="number" min="0.1" max="2000" step="any"></label></div>' +
        '<div id="custom-color-settings">' + colorMarkup + '</div>'
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
    (['box', 'prism', 'pyramid'].includes(type)
      ? '<div class="inspector-block"><h3>Geometri</h3><label class="field" title="' +
        (type === 'pyramid' ? 'Tabanın kenar sayısı. Kenar sayısı arttıkça şekil koniye yaklaşır.' :
          'Üst ve alt yüzeyin kenar sayısını birlikte değiştirir. Kenar sayısı arttıkça şekil silindire yaklaşır.') +
        '">Taban kenarı<select id="object-sides">' +
        options(shapeSides.map(sides => [sides, sides])) + '</select></label>' +
        (type === 'box' || type === 'pyramid'
          ? '<label id="polygon-edge-settings" class="field" title="Şeklin kenarlarıyla birlikte birleşim köşelerini de yuvarlatır.">Kenar yumuşatma (%)<input id="polygon-roundness" type="number" min="0" max="50" step="1"></label>'
          : '') +
        (type === 'box'
          ? '<div id="box-edge-settings"><div class="field" title="Sadece seçtiğin eksene paralel kenarları yuvarlar. Örneğin Y düşey kenarlardır.">Kenar yuvarlama (%)<div class="axis-fields">' +
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
        '<label class="field" title="Yuvarlatılmış köşeleri oluşturan yüzey sayısı. Değer arttıkça köşe daha pürüzsüz görünür.">Köşe ayrıntısı<input id="object-segments" type="number" min="1" max="12" step="1"></label></div>' : '') +
        '</div>'
      : '') +
    (type === 'triangle'
      ? '<div class="inspector-block"><h3>Geometri</h3>' +
        '<div class="field" title="Üçgenin ön yüzündeki başlangıç açıları. X ve Y farklı oranlarda boyutlandırılırsa görünen açılar da değişir.">İç açılar (°)<div class="axis-fields">' +
        '<label><b>A</b><input id="triangle-angle-a" aria-label="İç açı A" type="number" min="1" step="any"></label>' +
        '<label><b>B</b><input id="triangle-angle-b" aria-label="İç açı B" type="number" min="1" step="any"></label>' +
        '<label><b>C</b><input id="triangle-angle-c" aria-label="Hesaplanan iç açı C" type="number" readonly title="180° eksi A ve B"></label></div></div></div>'
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
    (type === 'letter'
      ? '<div class="inspector-block"><h3>Geometri</h3>' +
        '<label class="field" title="Harf yüzeyinin yerel Z yönündeki, boyut çarpanı uygulanmadan önceki derinliği.">Kalınlık<input id="letter-depth" type="number" min="0.01" max="5" step="0.01"></label>' +
        '<label class="field" title="Harf yüzeyiyle yan duvarın birleşimini yuvarlatır. İnce harflerde yumuşatma kalınlığa göre sınırlanır.">Kenar yumuşatma (%)<input id="letter-radius" type="number" min="0" max="' + maximumLetterRadius * 100 + '" step="0.5"></label></div>'
      : '') +
    '<div class="inspector-block"><h3>Animasyon</h3>' +
    '<label class="field" title="Özel bir sahne seçilirse nesne o animasyon seçiliyken görünür.">Nesnenin sahnesi<select id="scene-clip"></select></label>' +
    '<label class="field">Konum hareketi<select id="position-motion"><option value="keys">Karelerle hareket</option><option value="physics">Fiziksel ivme</option><option value="orbit">Yörünge</option></select></label>' +
    '<div id="physics-controls" hidden><div class="axis-table">' +
    axisHeading() +
    axisRow('İvme <small>m/s²</small>', vectorFields('acceleration', 'İvme')) +
    axisRow(
      'Başlangıç hızı <small>m/s</small>',
      vectorFields('velocity', 'Başlangıç hızı')
    ) +
    '</div>' +
    '<label class="field" title="Çarpışmada yüzeye dik hızın ters yönde korunan yüzdesi.">Sekme (%)<input id="object-bounce" type="number" min="0" max="100" step="any"></label>' +
    '<p class="selection-tip">Konumu başlangıç hızı, ivme ve sekme belirler.</p></div>' +
    '<div id="orbit-controls" hidden>' +
    '<label class="field">Yörünge merkezi<select id="orbit-target"></select></label>' +
    '<label class="field" title="Bir tam turun saniye cinsinden süresi.">Periyot (s)<input type="number" id="orbit-period" min="0.1" max="3600" step="any"></label>' +
    '<div class="orbit-pair"><label class="field">Düzlem<select id="orbit-plane">' + options(Object.entries(orbitPlanes)) + '</select></label>' +
    '<label class="field">Yön<select id="orbit-direction"><option value="1">İleri</option><option value="-1">Ters</option></select></label></div>' +
    '<label class="field">Başlangıç açısı (°)<input type="number" id="orbit-phase" min="-360" max="360" step="any"></label>' +
    '<label class="field">Mesafe<select id="orbit-mode"><option value="fixed">Sabit · Daire</option><option value="ellipse">Değişken · Elips</option></select></label>' +
    '<div class="orbit-pair"><label class="field"><span id="orbit-near-label">Yarıçap (m)</span><input type="number" id="orbit-near" min="0.01" max="1000" step="any"></label>' +
    '<label id="orbit-far-field" class="field" hidden>En uzak (m)<input type="number" id="orbit-far" min="0.01" max="1000" step="any"></label></div>' +
    speedMarkup('orbit', 'Yörünge') +
    '<p class="selection-tip">Yörünge grafiği tur içindeki ilerlemeyi değiştirir. Periyot sabit kalır.</p></div>' +
    speedMarkup('linear', 'Konum') +
    (!object.isLight ? '<label class="field">Dönüş hareketi<select id="rotation-motion"><option value="keys">Karelerle dönüş</option><option value="physics">Açısal ivme ve hız</option></select></label>' +
    '<div id="angular-physics" hidden><div class="axis-table">' + axisHeading() +
    axisRow('Açısal ivme <small>°/s²</small>', vectorFields('angular-acceleration', 'Açısal ivme')) +
    axisRow('Açısal hız <small>°/s</small>', vectorFields('angular-velocity', 'Başlangıç açısal hızı')) +
    '</div><label class="field" title="Engelle temas eden eksenin açısal hızı tersine döner ve bu yüzde kadarını korur.">Açısal sekme (%)<input id="angular-bounce" type="number" min="0" max="100" step="any"></label></div>' +
    '<div id="angular-keys">' + speedMarkup('angular', 'Dönüş') +
    '<label class="field" title="Kısa veya uzun dönüş yolunu seç. Bir eksende belirli yönde ya da tam tur dönmek için açıları izle seçeneğini kullan.">Dönüş yolu<select id="rotation-path">' +
    options(Object.entries(rotationPaths)) + '</select></label></div>' : '') +
    (!object.isLight && !object.isCamera
      ? speedMarkup('size', 'Boyut', 'Boyut değişim grafiği', sizeCurveHint) +
        '<p id="size-curve-hint" class="selection-tip">' + sizeCurveHint + '</p>'
      : '') + '</div>'
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
    toggleElastic,
    refreshInspector,
    followOptions,
    orbitOptions,
    setFollow,
    collisionChanged,
    collisionReady,
    pick,
    highlight,
    status
  }
) {
  const $ = (id) => panel.querySelector('#' + id);
  const data = object.userData;
  const elastic = $('object-elastic');
  if ($('object-sign')) {
    const sign = $('object-sign');
    sign.value = data.negative ? 'negative' : 'positive';
    sign.onchange = () => {
      edit(() => {
      data.negative = sign.value === 'negative';
      if (data.negative) data.elastic = false;
      return changed(object);
      }, 'Nesnenin işaretini değiştir');
      paintElastic();
    };
  }
  if ($('ground-reaction')) {
    $('ground-reaction').checked = data.reactsToGround;
    $('ground-reaction').onchange = (event) =>
      edit(() => {
        data.reactsToGround = event.target.checked;
      }, 'Zemin tepkisini değiştir');
  }
  if ($('object-solid')) {
    $('object-solid').checked = data.solid;
    $('object-solid').disabled = !collisionReady;
    $('object-solid').onchange = (event) => {
      const input = event.target;
      edit(() => toggleSolid(object, input.checked));
      input.checked = data.solid;
      paintElastic();
    };
  }
  function paintElastic() {
    if (!elastic) return;
    elastic.checked = data.elastic;
    elastic.disabled = !data.solid || data.negative;
  }
  if (elastic) {
    elastic.onchange = event => {
      edit(() => toggleElastic(object, event.target.checked), 'Elastikliği değiştir');
      paintElastic();
    };
    paintElastic();
  }
  if ($('camera-collisions')) {
    const check = $('camera-collisions');
    const repaint = () => {
      check.checked = data.affectsSolids;
      $('solid-field').hidden = !data.affectsSolids;
      $('object-solid').checked = data.solid;
    };
    check.onchange = () => edit(() => {
      data.affectsSolids = check.checked;
      if (!check.checked) data.solid = false;
      repaint();
      if (data.affectsSolids && changed(object) === false) return false;
      collisionChanged();
    }, 'Kamera çarpışmasını değiştir');
    repaint();
  }
  if ($('follow-target')) {
    const picker = $('follow-target');
    picker.replaceChildren(new Option('Takip kapalı', ''), ...followOptions.map(target => new Option(target.name, target.userData.objectId)));
    function repaintFollow() {
      picker.value = data.followTarget ?? '';
      $('follow-settings').hidden = !data.followOffset;
      const distance = data.followOffset ? Math.hypot(...data.followOffset) : 0;
      $('follow-distance').textContent = 'Takip mesafesi ' + distance.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' m';
    }
    picker.onchange = () => { setFollow(picker.value); repaintFollow(); };
    $('follow-rebase').onclick = () => { setFollow(picker.value); repaintFollow(); };
    repaintFollow();
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
  if ($('object-opacity')) {
    const input = $('object-opacity');
    const range = $('opacity-range');
    input.value = range.value = data.opacity;
    const commit = value => {
      edit(() => { data.opacity = value; delete object.previewOpacity; }, 'Opaklığı değiştir');
      range.value = input.value = value;
    };
    range.oninput = () => {
      object.previewOpacity = range.valueAsNumber;
      input.value = range.value;
    };
    range.onchange = () => commit(range.valueAsNumber);
    input.onchange = () => commit(Number.isFinite(input.valueAsNumber) ? Math.min(100, Math.max(0, input.valueAsNumber)) : data.opacity);
  }
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
  function number(id, read, min, max, update, description) {
    const input = $(id);
    input.value = read();
    input.onchange = () => {
      const next = input.valueAsNumber;
      if (Number.isFinite(next))
        edit(() => update(Math.max(min, Math.min(max, next))), description);
      input.value = read();
    };
  }
  if ($('object-finish')) {
    const index = selectedParts.get(object) ?? 0;
    const part = data.finish === 'parts' ? data.parts?.[index] : undefined;
    const surface = part ?? data;
    const updateSurface = () => {
      if (data.type === 'mesh') updateMeshSurface(object);
      else applyTile(object.material, data);
    };
    const updateOptions = () => {
      if (data.type === 'mesh') updateMeshSurface(object);
      else setTileOptions(object.material, data);
    };
    const repaintTileFields = () => {
      $('tile-settings').hidden = surface.finish !== 'tile';
      $('custom-color-settings').hidden = surface.finish === 'tile' && surface.tileColorMode !== 'custom';
    };
    $('object-finish').value = data.finish;
    $('object-tile').value = surface.tile ?? 'checker';
    $('tile-color-mode').value = surface.tileColorMode ?? 'default';
    $('tile-fit').checked = surface.tileFit ?? false;
    if ($('mesh-part-settings')) $('mesh-part-settings').hidden = !part;
    if (part) {
      $('mesh-part').replaceChildren(...data.parts.map((_, slot) => new Option('Parça ' + (slot + 1), slot)));
      $('mesh-part').value = index;
      $('mesh-part').onchange = event => {
        selectedParts.set(object, Number(event.target.value));
        refreshInspector();
      };
      $('part-finish').value = part.finish === 'tile' ? 'tile' : 'color';
      $('part-finish').onchange = event => edit(() => {
        part.finish = event.target.value;
        part.tile ??= 'checker';
        part.tileScale ??= 1;
        part.tileColorMode ??= 'default';
        repaintTileFields();
        updateSurface();
      }, 'Parça yüzeyini değiştir');
    }
    repaintTileFields();
    $('object-finish').onchange = (event) =>
      edit(() => {
        data.finish = event.target.value;
        updateSurface();
        refreshInspector();
      });
    $('object-tile').onchange = (event) =>
      edit(() => {
        surface.tile = event.target.value;
        updateSurface();
      });
    $('tile-color-mode').onchange = event => edit(() => {
      surface.tileColorMode = event.target.value;
      updateOptions();
      repaintTileFields();
    }, 'Karo rengini değiştir');
    $('tile-fit').onchange = event => edit(() => {
      surface.tileFit = event.target.checked;
      updateOptions();
      repaintTileFields();
    }, 'Karo sığdırmayı değiştir');
    number(
      'object-tile-scale',
      () => Number(((surface.tileScale ?? 1) * 100).toFixed(8)),
      0.1,
      2000,
      (value) => {
        surface.tileScale = value / 100;
        if (part) setTileSize(object.material[index], surface.tileScale);
        else if (data.type === 'mesh') for (const material of object.material) setTileSize(material, data.tileScale);
        else setTileSize(object.material, data.tileScale);
      }
    );
  }
  function rebuild(detail = data.detail) {
    setDetail(object, detail);
    return changed(object);
  }
  if ($('triangle-angle-a')) {
    const inputs = [$('triangle-angle-a'), $('triangle-angle-b')];
    const remaining = $('triangle-angle-c');
    const paintAngles = () => {
      const values = data.triangleAngles;
      inputs.forEach((input, index) => {
        input.value = values[index];
        input.max = 180 - minimumTriangleAngle - values[1 - index];
      });
      remaining.value = Number(remainingTriangleAngle(values).toFixed(8));
    };
    inputs.forEach((input, index) => {
      input.onchange = () => {
        const angles = [...data.triangleAngles];
        angles[index] = input.valueAsNumber;
        if (validTriangleAngles(angles)) edit(() => {
          data.triangleAngles = angles;
          return rebuild();
        }, 'Üçgenin iç açısını değiştir');
        else status('Üçgenin her iç açısı en az 1° olmalı.');
        paintAngles();
      };
    });
    paintAngles();
  }
  if ($('letter-depth')) {
    number('letter-depth', () => data.letterDepth, 0.01, 5, value => {
      data.letterDepth = value;
      return rebuild();
    }, 'Harf kalınlığını değiştir');
    number('letter-radius', () => data.radius * 100, 0, maximumLetterRadius * 100, value => {
      data.radius = value / 100;
      return rebuild();
    }, 'Harf kenarlarını yumuşat');
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
  if ($('object-sides')) {
    const sides = $('object-sides');
    function showEdgeSettings() {
      sides.value = data.sides ?? (data.type === 'prism' ? 3 : 4);
      if (data.type === 'box') {
        $('box-edge-settings').hidden = sides.value !== '4';
        $('polygon-edge-settings').hidden = sides.value === '4';
      }
    }
    showEdgeSettings();
    sides.onchange = () => {
      edit(() => {
        data.sides = Number(sides.value);
        return rebuild();
      }, 'Taban kenarı sayısını değiştir');
      showEdgeSettings();
    };
  }
  if ($('polygon-roundness')) {
    number('polygon-roundness', () => Math.round(data.polygonRoundness * 100), 0, 50, value => {
      data.polygonRoundness = Math.round(value) / 100;
      return rebuild();
    });
  }
  if ($('object-color')) {
    const index = selectedParts.get(object) ?? 0;
    const part = data.finish === 'parts' ? data.parts?.[index] : undefined;
    const color = part ? object.material[index].color : object.isLight ? object.color : object.surfaceColor ?? object.material.color;
    bindColor(panel, color, {
      edit,
      pick,
      status,
      changed: object.surfaceColor && (() => {
        if (part) part.color = '#' + color.getHexString();
        else data.surfaceColor = '#' + color.getHexString();
        updateMeshSurface(object);
      })
    });
  }
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
  const positionMode = $('position-motion');
  const linearCurve = panel.querySelector('[data-speed-curve="linear"]');
  function paintMotion() {
    positionMode.value = data.positionMode;
    $('physics-controls').hidden = data.positionMode !== 'physics';
    $('orbit-controls').hidden = data.positionMode !== 'orbit';
    linearCurve.hidden = data.positionMode !== 'keys';
  }
  paintMotion();
  $('position-motion').onchange = (event) => {
    const value = event.currentTarget.value;
    setMotion(() => {
      data.positionMode = value;
    }, value === 'orbit' ? 'orbit' : 'linear');
    paintMotion();
  };
  const orbit = data.orbit;
  const target = $('orbit-target');
  target.replaceChildren(new Option('Merkez seç', ''), ...orbitOptions.map(center => new Option(center.name, center.userData.objectId)));
  target.value = orbit.target ?? '';
  target.onchange = () => setMotion(() => { orbit.target = target.value || null; }, 'orbit');
  for (const field of ['plane', 'direction', 'mode']) {
    const input = $('orbit-' + field);
    input.value = orbit[field];
    input.onchange = () => setMotion(() => {
      orbit[field] = field === 'direction' ? Number(input.value) : input.value;
      paintOrbitDistances();
    }, 'orbit');
  }
  function paintOrbitDistances() {
    $('orbit-near-label').textContent = orbit.mode === 'fixed' ? 'Yarıçap (m)' : 'En yakın (m)';
    $('orbit-far-field').hidden = orbit.mode !== 'ellipse';
    $('orbit-near').value = orbit.near;
    $('orbit-far').value = orbit.far;
  }
  paintOrbitDistances();
  for (const field of ['period', 'phase', 'near', 'far']) {
    const input = $('orbit-' + field);
    input.value = orbit[field];
    input.onchange = () => {
      const value = input.valueAsNumber;
      if (Number.isFinite(value)) setMotion(() => {
        orbit[field] = Math.max(Number(input.min), Math.min(Number(input.max), value));
        if (field === 'near' && orbit.near > orbit.far) orbit.far = orbit.near;
        if (field === 'far' && orbit.far < orbit.near) orbit.near = orbit.far;
        paintOrbitDistances();
      }, 'orbit');
      input.value = orbit[field];
    };
  }
  bindSpeed(panel.querySelector('[data-speed-curve="orbit"]'), orbit, 'speed',
    update => setMotion(update, 'orbit'), status);
  for (const [field, property] of [
    ['acceleration', 'physicsAcceleration'],
    ['velocity', 'initialVelocity'],
    ['angular-acceleration', 'angularAcceleration'],
    ['angular-velocity', 'angularVelocity']
  ]) {
    for (const [index, input] of [
      ...panel.querySelectorAll('[data-' + field + ']')
    ].entries()) {
      input.value = data[property][index];
      input.onchange = () => {
        if (Number.isFinite(input.valueAsNumber))
          setMotion(() => {
            data[property][index] = Math.min(
              Number(input.max),
              Math.max(Number(input.min), input.valueAsNumber)
            );
          }, field.startsWith('angular') ? 'angular' : 'linear');
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
  bindSpeed(linearCurve, data, 'speedProfile', edit, status);
  const sizeCurve = panel.querySelector('[data-speed-curve="size"]');
  if (sizeCurve) bindSpeed(sizeCurve, data, 'sizeSpeedProfile', edit, status);
  if ($('rotation-motion')) {
    const mode = $('rotation-motion');
    const repaint = () => {
      mode.value = data.rotationMode;
      $('angular-physics').hidden = data.rotationMode !== 'physics';
      $('angular-keys').hidden = data.rotationMode === 'physics';
    };
    mode.onchange = () => {
      setMotion(() => { data.rotationMode = mode.value; }, 'angular');
      repaint();
    };
    const bounce = $('angular-bounce');
    bounce.value = data.angularRestitution * 100;
    bounce.onchange = () => {
      if (Number.isFinite(bounce.valueAsNumber)) setMotion(() => {
        data.angularRestitution = Math.min(100, Math.max(0, bounce.valueAsNumber)) / 100;
      }, 'angular');
      bounce.value = data.angularRestitution * 100;
    };
    bindSpeed(panel.querySelector('[data-speed-curve="angular"]'), data, 'angularSpeedProfile', edit, status);
    repaint();
  }
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
  if ($('rotation-path')) {
    $('rotation-path').value = data.rotationPath;
    $('rotation-path').onchange = (event) =>
    edit(() => {
      data.rotationPath = event.target.value;
    });
  }
}
