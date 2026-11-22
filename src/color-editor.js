import { Color, SRGBColorSpace } from 'three';

export const colorMarkup = `<div class="field">Renk<div class="color-row">
  <details class="color-editor"><summary title="Rengi ve sayı biçimini düzenle"><span class="color-swatch"></span><span id="color-display"></span></summary>
    <div class="color-spectrum" aria-label="Renk doygunluğu ve parlaklığı" title="Rengi seçmek için renk alanına tıkla veya sürükle"><span></span></div>
    <label class="field color-hue-label">Ton<input id="color-hue" type="range" min="0" max="359" step="1"></label>
    <label class="field">Renk biçimi<select id="color-format"><option>HEX</option><option>RGB</option><option>HSL</option></select></label>
    <input id="object-color" aria-label="Renk değeri" spellcheck="false">
  </details>
  <button id="pick-color" class="quiet" title="Sahnenin render renginden örnek al" aria-label="Sahneden renk seç">⌾</button>
</div></div>`;

export function readColor(value, format) {
  if (format === 'HEX') {
    const hex = value.trim().replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(hex) ? new Color('#' + hex) : null;
  }
  const values = value
    .trim()
    .split(/[ ,;]+/)
    .map((part) => Number(part.replace(/%$/, '')));
  const max = format === 'RGB' ? [255, 255, 255] : [360, 100, 100];
  if (
    values.length !== 3 ||
    values.some(
      (part, axis) => !Number.isFinite(part) || part < 0 || part > max[axis]
    )
  )
    return null;
  const [x, y, z] = values.map((part, axis) => part / max[axis]);
  return format === 'RGB'
    ? new Color().setRGB(x, y, z, SRGBColorSpace)
    : new Color().setHSL(x, y, z, SRGBColorSpace);
}

export function bindColor(panel, color, { edit, pick, status }) {
  const format = panel.querySelector('#color-format');
  const input = panel.querySelector('#object-color');
  const swatch = panel.querySelector('.color-swatch');
  const display = panel.querySelector('#color-display');
  const spectrum = panel.querySelector('.color-spectrum');
  const hue = panel.querySelector('#color-hue');
  let saturation;
  let brightness;
  function showSpectrum() {
    spectrum.style.setProperty(
      '--picker-hue',
      'hsl(' + hue.value + ' 100% 50%)'
    );
    spectrum.firstElementChild.style.left = saturation * 100 + '%';
    spectrum.firstElementChild.style.top = (1 - brightness) * 100 + '%';
  }
  function refresh() {
    const hex = '#' + color.getHexString();
    swatch.style.backgroundColor = hex;
    display.textContent = hex.toUpperCase();
    const hsl = color.getHSL({}, SRGBColorSpace);
    if (hsl.s > 0) hue.value = Math.min(359, Math.round(hsl.h * 360));
    brightness = hsl.l + hsl.s * Math.min(hsl.l, 1 - hsl.l);
    saturation = brightness === 0 ? 0 : 2 * (1 - hsl.l / brightness);
    showSpectrum();
    if (format.value === 'RGB') {
      const rgb = color.getRGB(new Color(), SRGBColorSpace);
      input.value = [rgb.r, rgb.g, rgb.b]
        .map((value) => Math.round(value * 255))
        .join(', ');
    } else if (format.value === 'HSL') {
      const { h, s, l } = color.getHSL({}, SRGBColorSpace);
      input.value = [
        Math.round(h * 360),
        Math.round(s * 100) + '%',
        Math.round(l * 100) + '%'
      ].join(', ');
    } else input.value = hex;
  }
  const set = (value) => {
    edit(() => color.copy(value));
    refresh();
  };
  function spectrumColor() {
    const l = brightness * (1 - saturation / 2);
    const s = l === 0 || l === 1 ? 0 : (brightness - l) / Math.min(l, 1 - l);
    return new Color().setHSL(Number(hue.value) / 360, s, l, SRGBColorSpace);
  }
  function previewSpectrum(event) {
    const rect = spectrum.getBoundingClientRect();
    saturation = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width)
    );
    brightness =
      1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    showSpectrum();
    swatch.style.backgroundColor = '#' + spectrumColor().getHexString();
  }
  spectrum.onpointerdown = (event) => {
    if (event.button !== 0) return;
    spectrum.setPointerCapture(event.pointerId);
    previewSpectrum(event);
  };
  spectrum.onpointermove = (event) => {
    if (spectrum.hasPointerCapture(event.pointerId)) previewSpectrum(event);
  };
  spectrum.onlostpointercapture = () => set(spectrumColor());
  hue.oninput = () => {
    showSpectrum();
    swatch.style.backgroundColor = '#' + spectrumColor().getHexString();
  };
  hue.onchange = () => set(spectrumColor());
  format.onchange = refresh;
  input.onchange = () => {
    const value = readColor(input.value, format.value);
    if (value) set(value);
    else {
      status('Geçerli bir ' + format.value + ' renk değeri gir.');
      refresh();
    }
  };
  panel.querySelector('#pick-color').onclick = () =>
    pick((hex) => set(new Color(hex)));
  refresh();
}
