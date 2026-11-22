export function createHistory() {
  const undo = [];
  const redo = [];
  return {
    get canUndo() {
      return undo.length > 0;
    },
    get canRedo() {
      return redo.length > 0;
    },
    remember(before, after) {
      if (before.project === after.project) return;
      undo.push({ before, after });
      if (undo.length > 60) undo.shift();
      redo.length = 0;
    },
    step(direction) {
      const from = direction < 0 ? undo : redo;
      const to = direction < 0 ? redo : undo;
      const entry = from.pop();
      if (!entry) return undefined;
      to.push(entry);
      return direction < 0 ? entry.before : entry.after;
    }
  };
}
