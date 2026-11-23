export function createHistory() {
  const undo = [];
  const redo = [];
  let label;
  let revision = Symbol();
  return {
    get revision() {
      return revision;
    },
    get canUndo() {
      return undo.length > 0;
    },
    get canRedo() {
      return redo.length > 0;
    },
    get lastLabel() {
      return label;
    },
    remember(before, after, description = 'Sahneyi düzenle') {
      if (before.project === after.project) return;
      const next = Symbol();
      undo.push({ before, after, description, previousRevision: revision, nextRevision: next });
      revision = next;
      if (undo.length > 60) undo.shift();
      redo.length = 0;
    },
    step(direction) {
      const from = direction < 0 ? undo : redo;
      const to = direction < 0 ? redo : undo;
      const entry = from.pop();
      if (!entry) return undefined;
      to.push(entry);
      label = entry.description;
      revision = direction < 0 ? entry.previousRevision : entry.nextRevision;
      return direction < 0 ? entry.before : entry.after;
    }
  };
}
