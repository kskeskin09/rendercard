import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

export function roundedPolygon(sides, pointed, amount, segments) {
  const baseY = -0.5;
  const apothem = 0.5 * Math.cos(Math.PI / sides);
  const slope = Math.hypot(1, apothem);
  const inradius = pointed ? apothem / (slope + apothem) : apothem;
  const radius = inradius * amount * 1.8;
  const baseRadius = 0.5 * (pointed
    ? 1 - radius * (1 + slope / apothem)
    : 1 - radius / apothem);
  const ring = y => Array.from({ length: sides }, (_, i) => {
    const angle = Math.PI * (2 * i + 1) / sides;
    return new Vector3(Math.sin(angle) * baseRadius, y, Math.cos(angle) * baseRadius);
  });
  const vertices = ring(baseY + radius);
  if (pointed) vertices.push(new Vector3(0, 0.5 - radius * slope / apothem, 0));
  else vertices.push(...ring(0.5 - radius));

  const cap = Array.from({ length: sides }, (_, i) => i);
  const faces = [{ corners: cap, normal: new Vector3(0, -1, 0) }];
  if (!pointed) faces.push({ corners: cap.map(i => sides + i), normal: new Vector3(0, 1, 0) });
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    const angle = Math.PI * 2 * (i + 1) / sides;
    faces.push({
      corners: pointed ? [i, next, sides] : [i, next, next + sides, i + sides],
      normal: new Vector3(Math.sin(angle), pointed ? apothem : 0, Math.cos(angle)).normalize()
    });
  }

  const edges = new Map();
  const incident = vertices.map(() => []);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const a = new Vector3();
  const b = new Vector3();
  const surface = (corner, normal) => ({
    point: vertices[corner].clone().addScaledVector(normal, radius), normal
  });
  const blend = (from, to, t) => from.clone().lerp(to, t).normalize();
  const triangle = (p, q, r) => {
    const winding = a.subVectors(q.point, p.point).cross(b.subVectors(r.point, p.point)).dot(p.normal);
    if (winding < 0) [q, r] = [r, q];
    for (const { point, normal } of [p, q, r]) {
      indices.push(positions.length / 3);
      positions.push(...point);
      normals.push(...normal);
      uvs.push(point.x + 0.5, point.z + 0.5);
    }
  };
  const quad = (p, q, r, s) => {
    triangle(p, q, r);
    triangle(p, r, s);
  };

  for (const { corners, normal } of faces) {
    const points = corners.map(corner => surface(corner, normal));
    for (let i = 1; i < points.length - 1; i++) triangle(points[0], points[i], points[i + 1]);
    corners.forEach((corner, i) => {
      incident[corner].push(normal);
      const next = corners[(i + 1) % corners.length];
      const key = [Math.min(corner, next), Math.max(corner, next)].join(':');
      if (!edges.has(key)) edges.set(key, { ends: [corner, next], normals: [] });
      edges.get(key).normals.push(normal);
    });
  }

  for (const { ends: [start, end], normals: [first, last] } of edges.values()) {
    let normal = first;
    for (let step = 1; step <= segments; step++) {
      const next = blend(first, last, step / segments);
      quad(surface(start, normal), surface(end, normal), surface(end, next), surface(start, next));
      normal = next;
    }
  }

  incident.forEach((faceNormals, corner) => {
    const center = faceNormals.reduce((sum, normal) => sum.add(normal), new Vector3()).normalize();
    const axis = faceNormals[0].clone().addScaledVector(center, -faceNormals[0].dot(center)).normalize();
    const side = new Vector3().crossVectors(center, axis);
    const angle = normal => Math.atan2(normal.dot(side), normal.dot(axis));
    faceNormals.sort((first, last) => angle(first) - angle(last));
    const rim = faceNormals.flatMap((first, i) => Array.from({ length: segments }, (_, step) =>
      blend(first, faceNormals[(i + 1) % faceNormals.length], step / segments)));
    let previous;
    for (let layer = 1; layer <= segments; layer++) {
      const ring = rim.map(normal => surface(corner, blend(center, normal, layer / segments)));
      ring.forEach((point, i) => {
        const next = (i + 1) % ring.length;
        if (previous) quad(previous[i], point, ring[next], previous[next]);
        else triangle(surface(corner, center), point, ring[next]);
      });
      previous = ring;
    }
  });

  return new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new Float32BufferAttribute(normals, 3))
    .setAttribute('uv', new Float32BufferAttribute(uvs, 2))
    .setIndex(indices);
}
