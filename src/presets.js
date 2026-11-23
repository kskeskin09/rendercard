const storageKey = 'rendercard.presets.v1';

export function installPresets({
  begin,
  finish,
  current,
  insert,
  fromObject,
  renameObject,
  deleteObject,
  duplicateObject,
  focusObject,
  selectionActions,
  textActions,
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
  let target;
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
        button.oncontextmenu = (event) => openContext(event, 'preset', record);
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
    showNameDialog('Preset olarak kaydet', 'Preset adı', '');
  }
  function showNameDialog(title, label, value) {
    $('preset-title').textContent = title;
    $('preset-name-label').textContent = label;
    $('preset-name').value = value;
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
    if (target?.kind === 'object') openName(fromObject(target.value), false);
  };
  $('context-rename').onclick = () => {
    $('object-menu').hidden = true;
    if (!target) return;
    source = { ...target };
    showNameDialog(
      'Yeniden adlandır',
      target.kind === 'preset' ? 'Preset adı' : 'Nesne adı',
      target.value.name
    );
  };
  $('context-delete').onclick = () => {
    $('object-menu').hidden = true;
    if (!target) return;
    if (target.kind === 'object') deleteObject(target.value);
    else if (saveRecords(records.filter((record) => record !== target.value))) {
      status(target.value.name + ' preseti silindi.');
    }
  };
  for (const [id, run] of [['context-duplicate', duplicateObject], ['context-focus', focusObject],
    ['context-group', selectionActions.group], ['context-parent', selectionActions.parent],
    ['context-unparent', selectionActions.unparent],
    ['context-edit-text', textActions.edit], ['context-animate-text', textActions.animate]]) {
    $(id).onclick = () => {
      $('object-menu').hidden = true;
      if (target?.kind === 'object') run(target.value);
    };
  }
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
          source.kind !== 'object' &&
          record !== source.value &&
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
    if (source.kind === 'object') {
      renameObject(source.value, name);
      $('preset-dialog').close();
      return;
    }
    const next =
      source.kind === 'preset'
        ? records.map((record) =>
            record === source.value ? { ...record, name } : record
          )
        : [...records, { name, project: source.project }];
    if (!saveRecords(next)) {
      error.textContent =
        'Preset kaydedilemedi. Uygulamanın depolama alanını kontrol et.';
      error.hidden = false;
      return;
    }
    $('preset-dialog').close();
    if (source.completesScene) finish(true);
    status(
      source.kind === 'preset'
        ? 'Preset adı değiştirildi.'
        : name + ' presetlere kaydedildi.'
    );
  };
  function saveRecords(next) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      status('Presetler kaydedilemedi.');
      return false;
    }
    records = next;
    paintMenu();
    return true;
  }
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
  function openContext(event, kind, value) {
    event.preventDefault();
    target = { kind, value };
    const menu = $('object-menu');
    $('object-to-preset').hidden = kind !== 'object';
    $('context-duplicate').hidden = kind !== 'object';
    $('context-focus').hidden = kind !== 'object';
    $('context-group').hidden = kind !== 'object' || !selectionActions.canGroup(value);
    $('context-parent').hidden = kind !== 'object' || !selectionActions.canParent(value);
    $('context-unparent').hidden = kind !== 'object' || !selectionActions.canUnparent(value);
    const hasText = kind === 'object' && textActions.matches(value);
    $('context-edit-text').hidden = !hasText;
    $('context-animate-text').hidden = !hasText || !value.children.some(child => child.userData.type === 'letter');
    menu.hidden = false;
    const row = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || row.left;
    const y = event.clientY || row.bottom;
    menu.style.left =
      Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth - 6)) + 'px';
    menu.style.top =
      Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight - 6)) +
      'px';
    $(kind === 'object' ? 'object-to-preset' : 'context-rename').focus();
  }
  return {
    openContext: (event, object) => openContext(event, 'object', object)
  };
}
