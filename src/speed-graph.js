const labels = ['Başlangıç', 'Orta', 'Bitiş'];
const xPositions = [18, 110, 202];
const chartY = (value) => 84 - value * 0.36;

export const speedMarkup = `<div class="field" title="Noktaları sürükle veya aşağıdaki yüzdeleri düzenle. Yüksek nokta geçişin o bölümünü hızlandırır.">
  Hız grafiği
  <svg class="speed-graph" viewBox="0 0 220 96" aria-label="Başlangıç, orta ve bitiş hızı grafiği">
    <path class="speed-grid" d="M18 12H202M18 48H202M18 84H202M18 12V84M110 12V84M202 12V84"/>
    <polyline class="speed-line"/>
    ${xPositions.map((x, index) => `<circle data-speed-point="${index}" cx="${x}" r="6"/>`).join('')}
  </svg>
  <div class="axis-fields speed-fields">
    ${labels.map((label, index) => `<label><b>${label}</b><input data-speed-input="${index}" aria-label="${label} hızı (%)" type="number" min="0" max="200" step="1"></label>`).join('')}
  </div>
</div>`;

export function bindSpeed(panel, data, edit, status) {
  const graph = panel.querySelector('.speed-graph');
  const points = [...graph.querySelectorAll('circle')];
  const inputs = [...panel.querySelectorAll('[data-speed-input]')];
  let values = data.speedProfile?.slice() ?? [
    Math.round((1 - data.easeIn) * 100),
    100,
    Math.round((1 - data.easeOut) * 100)
  ];
  function draw() {
    graph
      .querySelector('polyline')
      .setAttribute(
        'points',
        values.map((value, i) => xPositions[i] + ',' + chartY(value)).join(' ')
      );
    points.forEach((point, i) => point.setAttribute('cy', chartY(values[i])));
    inputs.forEach((input, i) => {
      input.value = values[i];
    });
  }
  function commit() {
    if (!values.some(Boolean)) {
      values = data.speedProfile?.slice() ?? [100, 100, 100];
      status('Hız grafiğinde en az bir nokta sıfırdan büyük olmalı.');
      draw();
      return;
    }
    edit(() => {
      data.speedProfile = values.slice();
    });
  }
  inputs.forEach((input, index) => {
    input.onchange = () => {
      if (Number.isFinite(input.valueAsNumber))
        values[index] = Math.max(0, Math.min(200, input.valueAsNumber));
      draw();
      commit();
    };
  });
  let drag;
  graph.addEventListener('pointerdown', (event) => {
    if (event.target.dataset.speedPoint == null || event.button !== 0) return;
    drag = Number(event.target.dataset.speedPoint);
    graph.setPointerCapture(event.pointerId);
  });
  graph.addEventListener('pointermove', (event) => {
    if (drag == null) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      graph.getScreenCTM().inverse()
    );
    values[drag] = Math.round(
      Math.max(0, Math.min(200, (84 - point.y) / 0.36))
    );
    draw();
  });
  graph.addEventListener('lostpointercapture', () => {
    if (drag == null) return;
    drag = undefined;
    commit();
  });
  draw();
}
