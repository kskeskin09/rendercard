import { BoxGeometry } from 'three';

const planes = [
  [1, 2],
  [0, 2],
  [0, 1]
];

function distance(point, radius, pair) {
  const x = Math.abs(point[pair[0]]) - 0.5 + radius;
  const y = Math.abs(point[pair[1]]) - 0.5 + radius;
  return (
    Math.hypot(Math.max(x, 0), Math.max(y, 0)) +
    Math.min(Math.max(x, y), 0) -
    radius
  );
}

function spreading(value, radius) {
  const sign = Math.sign(value);
  const x = Math.abs(value) * 2;
  return sign * (x <= 0.5 ? x * (1 - 2 * radius) : 0.5 - 2 * radius * (1 - x));
}

export function roundedEdges(radii, detail) {
  const segments = 4 * detail;
  const result = new BoxGeometry(1, 1, 1, segments, segments, segments);
  const position = result.attributes.position;
  const normals = result.attributes.normal;
  const widest = Math.max(...radii);
  const active = radii
    .map((radius, axis) => (radius ? axis : -1))
    .filter((axis) => axis >= 0);
  const point = [0, 0, 0];
  for (let i = 0; i < position.count; i++) {
    const coord = [position.getX(i), position.getY(i), position.getZ(i)].map(
      (value) => spreading(value, widest)
    );
    let factor = 1;
    let limiting = -1;
    for (const [axis, pair] of planes.entries()) {
      const radius = radii[axis];
      if (!radius || distance(coord, radius, pair) <= 0.00000001) continue;
      let low = 0;
      let high = factor;
      if (
        distance(
          coord.map((value) => value * high),
          radius,
          pair
        ) <= 0
      )
        continue;
      for (let step = 0; step < 19; step++) {
        const middle = (low + high) / 2;
        for (let p = 0; p < 3; p++) point[p] = coord[p] * middle;
        if (distance(point, radius, pair) > 0) high = middle;
        else low = middle;
      }
      factor = high;
      limiting = axis;
    }
    for (let p = 0; p < 3; p++) point[p] = coord[p] * factor;
    if (active.length === 1) point[active[0]] = coord[active[0]];
    position.setXYZ(i, ...point);
    const cap =
      active.length === 1 && Math.abs(normals.getComponent(i, active[0])) > 0.5;
    if (limiting >= 0 && !cap) {
      const normal = [0, 0, 0];
      for (const axis of planes[limiting]) {
        normal[axis] =
          Math.sign(point[axis]) *
          Math.max(0, Math.abs(point[axis]) - 0.5 + radii[limiting]);
      }
      const length = Math.hypot(...normal);
      if (length) normals.setXYZ(i, ...normal.map((value) => value / length));
    }
  }
  return result;
}
