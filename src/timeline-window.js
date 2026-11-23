export function timelineWindow(duration, zoom, position) {
  const maximum = Math.min(240, duration);
  const minimum = Math.min(6, maximum);
  const span = Math.round(maximum - (maximum - minimum) * zoom / 100);
  const start = Math.max(0, Math.min(duration - span, Math.round(position)));
  return { start, end: start + span, span };
}

export function stepTimelineZoom(duration, zoom, direction) {
  const limit = direction > 0 ? 100 : 0;
  const previousSpan = timelineWindow(duration, zoom, 0).span;
  do {
    zoom = Math.max(0, Math.min(100, zoom + direction * 20));
  } while (zoom !== limit && timelineWindow(duration, zoom, 0).span === previousSpan);
  return zoom;
}
