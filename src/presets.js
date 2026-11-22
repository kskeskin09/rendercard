const storageKey = 'rendercard.presets.v1';

export function installPresets({
  begin,
  finish,
  current,
  insert,
  fromObject,
  status
}) {
  const $ = (id) => document.getElementById(id);
  let records;
  try {
    records = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(records)) records = [];
    records = records.filter(
      (record) => typeof record?.name === 'string' && record.project
    );
  } catch {
    records = [];
  }
  let contextObject;
  let source;
  function showMenu(show) {
    $('preset-menu').hidden = !show;
    $('presets').setAttribute('aria-expanded', String(show));
  }
  function paintMenu() {
    $('preset-items').replaceChildren(
      ...records.map((record) => {
        const button = document.createElement('button');
        button.textContent = record.name;
        button.title = record.name;
        button.onclick = () => {
          showMenu(false);
          try {
            insert(record);
          } catch {
            status('Preset açılamadı.');
          }
        };
        return button;
      })
    );
  }
  function openName(project, completesScene) {
    source = { project, completesScene };
    $('preset-name').value = '';
    $('preset-error').hidden = true;
    $('preset-dialog').showModal();
    $('preset-name').focus();
  }
  $('presets').onclick = () => showMenu($('preset-menu').hidden);
  $('create-preset').onclick = () => {
    showMenu(false);
    begin();
  };
  $('save-preset').onclick = () => openName(current(), true);
  $('cancel-preset').onclick = () => finish(false);
  $('object-to-preset').onclick = () => {
    $('object-menu').hidden = true;
    if (contextObject) openName(fromObject(contextObject), false);
  };
  $('close-preset-dialog').onclick = () => $('preset-dialog').close();
  $('preset-form').onsubmit = (event) => {
    event.preventDefault();
    const name = $('preset-name').value.trim();
    const error = $('preset-error');
    if (
      !source ||
      !name ||
      records.some(
        (record) =>
          record.name.toLocaleLowerCase('tr-TR') ===
          name.toLocaleLowerCase('tr-TR')
      )
    ) {
      error.textContent = name
        ? 'Bu adla bir preset var.'
        : 'Preset için bir ad yaz.';
      error.hidden = false;
      return;
    }
    const next = [...records, { name, project: source.project }];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      error.textContent =
        'Preset kaydedilemedi. Uygulamanın depolama alanını kontrol et.';
      error.hidden = false;
      return;
    }
    records = next;
    paintMenu();
    $('preset-dialog').close();
    if (source.completesScene) finish(true);
    status(name + ' presetlere kaydedildi.');
  };
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.preset-wrap')) showMenu(false);
    if (!event.target.closest('#object-menu')) $('object-menu').hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      showMenu(false);
      $('object-menu').hidden = true;
    }
  });
  paintMenu();
  return {
    openContext(event, object) {
      event.preventDefault();
      contextObject = object;
      const menu = $('object-menu');
      menu.hidden = false;
      const row = event.currentTarget.getBoundingClientRect();
      const x = event.clientX || row.left;
      const y = event.clientY || row.bottom;
      menu.style.left =
        Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth - 6)) +
        'px';
      menu.style.top =
        Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight - 6)) +
        'px';
      $('object-to-preset').focus();
    }
  };
}
