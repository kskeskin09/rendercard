export function cameraAt(animations, frame) {
  for (const clip of animations.enabled.toReversed()) {
    const track = animations.cameraTracks?.[clip];
    const key = track?.findLast((entry) => entry.frame <= frame);
    if (key) return key.camera;
  }
  return null;
}

export function writeCameraKey(animations, frame, camera) {
  animations.cameraTracks ??= {};
  const track = (animations.cameraTracks[animations.active] ??= []);
  const previous = track.findIndex((entry) => entry.frame === frame);
  const key = { frame, camera };
  if (previous >= 0) track[previous] = key;
  else track.push(key);
  track.sort((a, b) => a.frame - b.frame);
}
