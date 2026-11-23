export function planKeyTiming(entries, mapFrame, duration) {
  const tracks = new Map();
  const changes = entries.map(({ track, key }) => {
    if (!tracks.has(track)) tracks.set(track, new Map());
    const moves = tracks.get(track);
    const frame = mapFrame(key.frame);
    if (!Number.isInteger(frame) || frame < 0 || frame > duration)
      throw new Error('Seçili kareler 0–' + duration + ' aralığının dışına çıkıyor.');
    moves.set(key, frame);
    return { key, frame };
  });
  for (const [track, moves] of tracks) {
    const frames = track.map(key => moves.get(key) ?? key.frame);
    if (new Set(frames).size !== frames.length)
      throw new Error('Aynı satırda iki kare aynı konuma geliyor. Başka bir değer seç.');
  }
  return { changes, tracks: [...tracks.keys()] };
}

export function applyKeyTiming({ changes, tracks }) {
  for (const { key, frame } of changes) key.frame = frame;
  for (const track of tracks) track.sort((a, b) => a.frame - b.frame);
}
