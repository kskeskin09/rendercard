const icons = {
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  eyeOff:
    '<path d="m3 3 18 18M10 6.2c.6-.1 1.3-.2 2-.2 6.5 0 10 6 10 6a14 14 0 0 1-3.6 3.8M6 7.4A17 17 0 0 0 2 12s3.5 6 10 6c1.5 0 2.8-.3 3.9-.8"/>',
  link: '<path d="M10 13.5a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6L11 7m3 3.5a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l2-2.1"/>',
  light:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',
  snap: '<path d="M5 3v18M12 3v18M19 3v18M3 5h18M3 12h18M3 19h18"/>',
  undo: '<path d="M9 6 4 11l5 5M4 11h10a5 5 0 0 1 0 10"/>',
  redo: '<path d="m15 6 5 5-5 5m5-5H10a5 5 0 0 0 0 10"/>',
  center:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h9V3M7 21v-8h10v8"/>',
  camera:
    '<path d="M4 7h4l2-3h4l2 3h4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  video:
    '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5m-9 5L3 7m9 5v10"/>',
  sphere:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  group:
    '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="2 3"/><path d="M7 7h5v5H7zm5 5h5v5h-5z"/>',
  ungroup: '<path d="M3 3h7v7H3zm11 11h7v7h-7zm11-11h5v5M9 21H4v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3m4 0-1 15H6L5 6m5 4v7m4-7v7"/>',
  mesh: '<path d="m12 3 9 16H3L12 3Zm0 0v16m-5-8 10 0m-10 0 5 8 5-8"/>',
  focus:
    '<path d="M9 3H3v6m12-6h6v6m0 6v6h-6M3 15v6h6"/><circle cx="12" cy="12" r="3"/>',
  cursor: '<path d="m4 3 16 9-7 1-3 7-6-17Z"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
  rotate: '<path d="M3 12a9 9 0 1 1 3 7m-3-7V5m0 7h7"/>',
  scale: '<path d="M21 9V3h-6m6 0-9 9m8 1v7H4V4h7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  first: '<path d="M5 5v14m14-14L8 12l11 7Z"/>',
  last: '<path d="M19 5v14M5 5l11 7-11 7Z"/>',
  play: '<path d="m8 4 12 8-12 8Z" fill="currentColor"/>',
  pause: '<path d="M9 5v14m6-14v14" stroke-width="3"/>',
  diamond: '<path d="m12 3 9 9-9 9-9-9Z"/>',
  sliders: '<path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-5 0v6"/>'
};

export function icon(name) {
  return (
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' +
    icons[name] +
    '</svg>'
  );
}
