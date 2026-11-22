export function createHistory() {
  const undo = [];
  const redo = [];
  let label;
  return {
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
      undo.push({ before, after, description });
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
      return direction < 0 ? entry.before : entry.after;
    }
  };
}
