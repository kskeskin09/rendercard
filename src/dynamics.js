import { Vector3 } from 'three';

const dt = 1 / 60;
const minimumBounce = 0.08;

export function advanceBody(state, gravity, restitution, cast) {
  const position = state.position.clone();
  const velocity = state.velocity.clone();
  const acceleration = gravity.clone();
  let remaining = dt;
  for (let impact = 0; impact < 5 && remaining > 0.000001; impact++) {
    const delta = velocity
      .clone()
      .multiplyScalar(remaining)
      .addScaledVector(acceleration, (remaining * remaining) / 2);
    const hit = cast(position, delta);
    const elapsed = remaining * (hit?.time ?? 1);
    position.addScaledVector(delta, hit?.time ?? 1);
    velocity.addScaledVector(acceleration, elapsed);
    if (!hit) break;
    const incoming = velocity.dot(hit.normal);
    const bounce = -incoming * restitution;
    if (incoming < 0)
      velocity.addScaledVector(
        hit.normal,
        -incoming + Math.max(0, bounce >= minimumBounce ? bounce : 0)
      );
    if (bounce < minimumBounce) {
      const intoSurface = acceleration.dot(hit.normal);
      if (intoSurface < 0)
        acceleration.addScaledVector(hit.normal, -intoSurface);
    }
    remaining -= elapsed;
  }
  return { position, velocity };
}

export function trajectory(origin, velocity, gravity, restitution, cast) {
  const states = [
    { position: origin.clone(), velocity: new Vector3().fromArray(velocity) }
  ];
  const acceleration = new Vector3().fromArray(gravity);
  return (frame) => {
    const step = Math.max(0, frame) * 2;
    while (states.length <= step) {
      states.push(advanceBody(states.at(-1), acceleration, restitution, cast));
    }
    return states[step].position;
  };
}

export function angularTrajectory(origin, velocity, acceleration, restitution, blocked) {
  const dt = 1 / 120;
  const states = [{ angles: origin.slice(), speed: velocity.slice() }];
  return frame => {
    const step = Math.max(0, Math.round(frame * 4));
    while (states.length <= step) {
      const { angles: previous, speed: previousSpeed } = states.at(-1);
      const angles = previous.slice();
      const speed = previousSpeed.slice();
      const sample = states.length / 4;
      for (let axis = 0; axis < 3; axis++) {
        const start = angles[axis];
        const increment = speed[axis] * dt + acceleration[axis] * dt ** 2 / 2;
        if (!increment) continue;
        angles[axis] += increment;
        speed[axis] += acceleration[axis] * dt;
        if (!blocked(angles, sample)) continue;
        let safe = 0;
        let impact = 1;
        for (let iteration = 0; iteration < 10; iteration++) {
          const fraction = (safe + impact) / 2;
          angles[axis] = start + increment * fraction;
          if (blocked(angles, sample)) impact = fraction;
          else safe = fraction;
        }
        angles[axis] = start + increment * safe;
        speed[axis] = -speed[axis] * restitution;
        if (Math.abs(speed[axis]) < 0.01) speed[axis] = 0;
      }
      states.push({ angles, speed });
    }
    return states[step].angles;
  };
}
