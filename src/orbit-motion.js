import { Vector3 } from 'three';
import { profileTime } from './motion.js';

export const orbitPlanes = { xz: 'XZ · Yatay', xy: 'XY', yz: 'YZ' };
export const defaultOrbit = {
  target: null, clip: 'main', period: 4, plane: 'xz', direction: 1,
  mode: 'fixed', near: 2, far: 4, phase: 0, speed: [100, 100, 100]
};

export function orbitPosition(center, frame, fps, settings) {
  const turns = Math.max(0, frame) / (fps * settings.period);
  const progress = profileTime(turns % 1, settings.speed);
  const angle = settings.phase * Math.PI / 180 + settings.direction * Math.PI * 2 * progress;
  const first = Math.cos(angle);
  const last = Math.sin(angle);
  const near = settings.near;
  const far = settings.mode === 'ellipse' ? settings.far : near;
  const eccentricity = (far - near) / (near + far);
  const radius = (2 * near * far / (near + far)) / (1 + eccentricity * first);
  const result = new Vector3().copy(center);
  result[settings.plane[0]] += radius * first;
  result[settings.plane[1]] += radius * last;
  return result;
}

// A target and any moving ancestors must be placed before their dependants.
export function orderedOrbits(actors) {
  const status = new Map();
  const result = [];
  function visit(actor) {
    if (status.has(actor)) return status.get(actor) === 'ready';
    status.set(actor, 'visiting');
    const target = actors.get(actor);
    for (const start of [actor.parent, target]) {
      for (let node = start; node; node = node.parent) {
        if (actors.has(node) && !visit(node)) {
          status.set(actor, 'blocked');
          return false;
        }
      }
    }
    status.set(actor, 'ready');
    result.push([actor, target]);
    return true;
  }
  for (const actor of actors.keys()) visit(actor);
  return result;
}
