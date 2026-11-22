export const axes = ['x', 'y', 'z'];

export function axisHeading(action = '') {
  return (
    '<div class="axis-table-head">' +
    (action || '<span></span>') +
    axes
      .map(
        (axis) =>
          '<b class="axis-title-' + axis + '">' + axis.toUpperCase() + '</b>'
      )
      .join('') +
    '</div>'
  );
}

export function axisRow(title, fields) {
  return (
    '<div class="axis-table-row"><span>' +
    title +
    '</span>' +
    fields.join('') +
    '</div>'
  );
}

export function constrainDimensions(
  start,
  proposed,
  boundsSize,
  changed,
  linked,
  step
) {
  const axes = changed.filter((axis) => boundsSize[axis] > 0);
  function fit(axis) {
    const size = Math.max(0.001, proposed[axis] * boundsSize[axis]);
    return (
      (step ? Math.max(step, Math.round(size / step) * step) : size) /
      boundsSize[axis]
    );
  }
  if (linked && axes.length) {
    const primary = axes.reduce((best, axis) =>
      Math.abs(proposed[axis] / start[axis] - 1) >
      Math.abs(proposed[best] / start[best] - 1)
        ? axis
        : best
    );
    return start.clone().multiplyScalar(fit(primary) / start[primary]);
  }
  const result = start.clone();
  for (const axis of axes) result[axis] = fit(axis);
  return result;
}
