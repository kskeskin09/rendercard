import { Color, SRGBColorSpace } from 'three';

export const colorMarkup = `<div class="field">Renk<div class="color-row">
  <details class="color-editor"><summary title="Rengi ve sayı biçimini düzenle"><span class="color-swatch"></span><span id="color-display"></span></summary>
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
  function refresh() {
    const hex = '#' + color.getHexString();
    swatch.style.backgroundColor = hex;
    display.textContent = hex.toUpperCase();
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
