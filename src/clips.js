export const mainClip = { id: 'main', name: 'Animasyon 1' };

export function keysFor(object, id = 'main', create = false) {
  if (id === 'main') return object.userData.keys;
  const tracks = object.userData.tracks;
  if (create && !Object.hasOwn(tracks, id)) tracks[id] = [];
  return tracks[id] ?? [];
}

export function posesOf(object) {
  const { keys, tracks, restPose } = object.userData;
  return [
    ...keys,
    ...Object.values(tracks).flat(),
    ...(restPose ? [restPose] : [])
  ];
}

export function hasKeys(object) {
  return (
    object.userData.keys.length > 0 ||
    Object.values(object.userData.tracks).some((keys) => keys.length > 0)
  );
}

export function chooseTrack(object, ids, frame) {
  const tracks = ids
    .map((id) => keysFor(object, id))
    .filter((keys) => keys.length);
  for (const keys of tracks.toReversed()) {
    if (frame >= keys[0].frame && frame <= keys.at(-1).frame) return keys;
  }
  return tracks.findLast((keys) => frame >= keys[0].frame) ?? tracks[0];
}
