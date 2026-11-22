export function slideMovement(origin, desired, cast) {
  const position = origin.clone();
  const travel = desired.clone().sub(origin);
  for (let i = 0; i < 4 && travel.lengthSq() > 1e-10; i++) {
    const hit = cast(position, travel);
    if (!hit) return position.add(travel);
    const distance = travel.length();
    position.addScaledVector(travel, Math.max(0, hit.time - 0.00002 / distance));
    travel.multiplyScalar(1 - hit.time);
    const intoSurface = travel.dot(hit.normal);
    if (intoSurface < 0) travel.addScaledVector(hit.normal, -intoSurface);
  }
  return position;
}
