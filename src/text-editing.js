import { Vector3 } from 'three';
import { addTextLetter, capture, disposeObject } from './model.js';
import { hasKeys, keysFor, posesOf } from './clips.js';
import { fitPivot, fitParentPivots } from './spatial.js';
import { letterLayout } from './text-geometry.js';

export const textGroupName = text => text.trim().replace(/\s+/g, ' ').slice(0, 72);

export function isTextGroup(group) {
  return group?.userData.type === 'group' && (Boolean(group.userData.textLayout) ||
    (group.children.length > 0 && group.children.every(child => child.userData.type === 'letter')));
}

export function textGroupInfo(group) {
  if (group.userData.textLayout) return group.userData.textLayout;
  const [first] = group.children;
  const word = group.children.map(child => child.userData.glyph).join('');
  let text = word;
  try {
    if (letterLayout(group.name).map(slot => slot.glyph).join('') === word) text = group.name;
  } catch {
    // A manually assigned group name can contain characters outside the font.
  }
  const pose = first.userData.restPose ?? capture(first);
  const offset = new Vector3().fromArray(first.userData.offset);
  const origin = new Vector3().fromArray(pose.position).add(offset).toArray();
  return { text, origin, depth: first.userData.letterDepth, radius: first.userData.radius };
}

export function textLetters(group) {
  return group.children.filter(child => child.userData.type === 'letter');
}

export function planTextEdit(group, text) {
  const info = textGroupInfo(group);
  const letters = textLetters(group);
  const previous = group.userData.textLayout ? [] : letterLayout(info.text);
  const slots = letterLayout(text);
  const matches = Array.from({ length: letters.length + 1 }, () => new Uint16Array(slots.length + 1));
  for (let i = letters.length - 1; i >= 0; i--) {
    for (let j = slots.length - 1; j >= 0; j--) {
      matches[i][j] = letters[i].userData.glyph === slots[j].glyph
        ? 1 + matches[i + 1][j + 1]
        : Math.max(matches[i + 1][j], matches[i][j + 1]);
    }
  }
  const retained = new Map();
  const used = new Set();
  for (let i = 0, j = 0; i < letters.length && j < slots.length;) {
    if (letters[i].userData.glyph === slots[j].glyph) {
      retained.set(j++, i);
      used.add(i++);
    } else if (matches[i + 1][j] > matches[i][j + 1]) i++;
    else j++;
  }
  for (const [index, slot] of slots.entries()) {
    if (retained.has(index)) continue;
    const old = letters.findIndex((letter, i) => !used.has(i) && letter.userData.glyph === slot.glyph);
    if (old >= 0) {
      retained.set(index, old);
      used.add(old);
    }
  }
  const removed = letters.filter((_, index) => !used.has(index));
  const animated = removed.filter(letter => hasKeys(letter) ||
    letter.userData.positionMode !== 'keys' || letter.userData.rotationMode !== 'keys');
  return { info, letters, previous, slots, retained, removed, animated, text: text.trim() };
}

export function applyTextEdit(group, plan) {
  const { info, letters, previous, slots, retained, removed, text } = plan;
  if (group.name === textGroupName(info.text)) group.name = textGroupName(text);
  group.userData.textLayout = { ...info, text };
  removed.forEach(disposeObject);
  const ordered = slots.map((slot, index) => {
    const old = retained.get(index);
    if (old == null) return addTextLetter(group, slot, info.depth, info.radius);
    const letter = letters[old];
    const { x, y } = slot;
    const baseline = letter.userData.textSlot ?? [previous[old]?.x ?? x, previous[old]?.y ?? y, 0];
    const delta = [x - baseline[0], y - baseline[1], 0];
    letter.position.add(new Vector3().fromArray(delta));
    for (const pose of posesOf(letter)) pose.position = pose.position.map((value, axis) => value + delta[axis]);
    letter.userData.textSlot = [x, y, 0];
    return letter;
  });
  group.add(...ordered);
  fitPivot(group);
  fitParentPivots(group);
}

export function planLetterEntrance(group, { clip, start, gap, span, mode, amount }) {
  const letters = textLetters(group);
  const end = start + (letters.length - 1) * gap + span;
  if (end > 1800) throw new Error('Son kare 1800’ü aşıyor. Süreyi veya harf aralığını azalt.');
  const channel = { move: 'position', rotate: 'rotation', grow: 'scale' }[mode];
  const entries = letters.map((letter, index) => {
    const from = start + index * gap;
    const to = from + span;
    if ((mode === 'move' && letter.userData.positionMode !== 'keys') ||
        (mode === 'rotate' && letter.userData.rotationMode !== 'keys')) {
      throw new Error(letter.name + ' için bu hareket anahtar karelerle yönetilmiyor.');
    }
    if (mode === 'rotate' && letter.userData.rotationPath === 'long')
      throw new Error(letter.name + ' için dönüş yolunu Kısa yol veya Açıları izle olarak ayarla.');
    if (keysFor(letter, clip).some(key => key.frame >= from && key.frame <= to))
      throw new Error(letter.name + ' için ' + from + '–' + to + ' aralığında kare var. Başka bir başlangıç seç.');
    const rest = capture(letter);
    const entrance = structuredClone(rest);
    if (mode === 'move') entrance[channel][1] -= amount;
    if (mode === 'rotate') entrance[channel][2] -= amount * Math.PI / 180;
    if (mode === 'grow') entrance[channel] = rest.scale.map(value => value * amount / 100);
    return { letter, from, to, entrance, rest };
  });
  return { end, entries };
}
