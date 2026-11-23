export function timelineWindow(duration, zoom, position) {
  const maximum = Math.min(240, duration);
  const minimum = Math.min(6, maximum);
  const span = Math.round(maximum - (maximum - minimum) * zoom / 100);
  const start = Math.max(0, Math.min(duration - span, Math.round(position)));
  return { start, end: start + span, span };
}
