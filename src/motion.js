import { Euler, Quaternion } from 'three';

export const rotationPaths = {
  short: 'Kısa yol',
  long: 'Uzun yol',
  axes: 'X, Y, Z açılarını izle'
};

export function easedTime(t, easeIn = 0, easeOut = 0) {
  return t - easeIn * t * (1 - t) ** 2 + easeOut * t ** 2 * (1 - t);
}

export function travelTime(t, acceleration = 0) {
  return t + acceleration * t * (t - 1);
}

export function profileTime(t, points) {
  const [start, middle, end] = points;
  const area = (start + 2 * middle + end) / 4;
  if (area === 0) return t;
  const first = t <= 0.5;
  const x = first ? t : t - 0.5;
  const integral = first
    ? start * x + (middle - start) * x * x
    : (start + middle) / 4 + middle * x + (end - middle) * x * x;
  return integral / area;
}

export function accelerationOffset(acceleration, frames, fps = 30) {
  const elapsed = Math.max(0, frames) / fps;
  return acceleration.map((value) => (value * elapsed ** 2) / 2);
}

export function interpolateRotation(object, from, to, t, path) {
  if (path === 'axes') {
    object.rotation.fromArray(
      from.map((value, axis) => value + (to[axis] - value) * t)
    );
    return;
  }
  const start = new Quaternion().setFromEuler(new Euler(...from));
  const end = new Quaternion().setFromEuler(new Euler(...to));
  if (path !== 'long') {
    object.quaternion.slerpQuaternions(start, end, t);
    return;
  }
  let dot = start.dot(end);
  if (dot >= 0) {
    end.set(-end.x, -end.y, -end.z, -end.w);
    dot = -dot;
  }
  if (dot <= -0.9999999) {
    object.quaternion.copy(start);
    return;
  }
  const angle = Math.acos(dot);
  const denominator = Math.sin(angle);
  const a = Math.sin((1 - t) * angle) / denominator;
  const b = Math.sin(t * angle) / denominator;
  object.quaternion
    .set(
      a * start.x + b * end.x,
      a * start.y + b * end.y,
      a * start.z + b * end.z,
      a * start.w + b * end.w
    )
    .normalize();
}
