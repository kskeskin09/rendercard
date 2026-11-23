import { CylinderGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import { updateTileBounds } from './tiles.js';
import { boneMaterial, boneSurface, makeBoneMesh, rigActive, rigLinks, skinMeshes } from './rig.js';

export function createRigView(scene, root) {
  const guides = new Group();
  const skin = new Group();
  scene.add(skin, guides);
  const pin = new SphereGeometry(.11, 16, 10);
  const shaft = new CylinderGeometry(.035, .06, 1, 10);
  const guideMaterial = color => new MeshBasicMaterial({ color, toneMapped: false, depthTest: false, depthWrite: false });
  const pointMaterial = guideMaterial('#f6ca56');
  const boneGuideMaterial = guideMaterial('#9bd2ff');
  const activeMaterial = guideMaterial('#fc8049');
  const previewMaterial = guideMaterial('#aeea73');
  const preview = new Mesh(shaft, previewMaterial);
  preview.renderOrder = 41;
  preview.visible = false;
  guides.add(preview);
  const pins = new Map();
  const shafts = new Map();
  const surfaces = new Map();
  const up = new Vector3(0, 1, 0);
  const a = new Vector3();
  const b = new Vector3();
  let current;
  let hovered;
  let enabled = false;

  function prune(markers, present, dispose) {
    for (const [key, value] of markers) {
      if (present.has(key)) continue;
      dispose?.(value);
      value.removeFromParent();
      markers.delete(key);
    }
  }

  function placeShaft(marker, start, end) {
    start.getWorldPosition(a);
    end.getWorldPosition(b);
    marker.position.copy(a).lerp(b, .5);
    b.sub(a);
    marker.scale.y = b.length();
    marker.visible = marker.scale.y > 1e-5;
    if (marker.visible) marker.quaternion.setFromUnitVectors(up, b.normalize());
  }

  function updateGuides(visible) {
    guides.visible = visible && enabled;
    if (!guides.visible) return;
    const { joints, links } = rigLinks(root);
    const active = new Set(joints.filter(rigActive));
    const canPreview = current !== hovered && active.has(current) && active.has(hovered) &&
      !links.some(({ source, target }) => (source === current && target === hovered) ||
        (target === current && source === hovered));
    prune(pins, active);
    for (const object of active) {
      if (!pins.has(object)) {
        const marker = new Mesh(pin, pointMaterial);
        marker.userData.joint = object;
        marker.renderOrder = 42;
        guides.add(marker);
        pins.set(object, marker);
      }
      const marker = pins.get(object);
      marker.material = current === object ? activeMaterial :
        canPreview && hovered === object ? previewMaterial : pointMaterial;
      object.getWorldPosition(marker.position);
    }
    const bones = new Set();
    for (const link of links) {
      if (!active.has(link.source) || !active.has(link.target)) continue;
      bones.add(link.bone);
      if (!shafts.has(link.bone)) {
        const marker = new Mesh(shaft, boneGuideMaterial);
        marker.renderOrder = 41;
        guides.add(marker);
        shafts.set(link.bone, marker);
      }
      const marker = shafts.get(link.bone);
      marker.userData.link = link;
      placeShaft(marker, link.source, link.target);
    }
    prune(shafts, bones);
    preview.visible = false;
    if (canPreview) placeShaft(preview, current, hovered);
    guides.updateMatrixWorld(true);
  }

  function visible(object) {
    for (let node = object; node && node !== root; node = node.parent) if (!node.visible) return false;
    return true;
  }

  function updateSkin() {
    const present = new Set();
    const { links } = rigLinks(root);
    if (links.some(link => link.bone.skin)) root.updateWorldMatrix(true, true);
    for (const { source, target, bone } of links) {
      if (!bone.skin || !visible(source) || !visible(target)) continue;
      present.add(bone);
      const endpoints = [skinMeshes(source), skinMeshes(target)];
      const appearance = [bone.finish, bone.color, bone.tile, bone.tileScale,
        ...endpoints.flat(1).flatMap(mesh => [mesh.geometry.uuid, ...[mesh.material].flat().flatMap(material =>
          [material.color?.getHex(), material.map?.uuid, material.opacity,
            material.userData.tileSize?.value, material.userData.tileMapping?.useDefault.value,
            material.userData.tileMapping?.fit.value])])].join('/');
      const pose = [bone.ratio, ...source.matrixWorld.elements, ...target.matrixWorld.elements,
        ...endpoints.flat().flatMap(mesh => [mesh.geometry.uuid, ...mesh.matrixWorld.elements])].join('/');
      let mesh = surfaces.get(bone);
      if (mesh?.userData.pose === pose && mesh.userData.appearance === appearance) continue;
      const surface = boneSurface(source, target, bone.ratio, endpoints);
      if (!surface) {
        if (mesh) {
          mesh.visible = false;
          Object.assign(mesh.userData, { pose, appearance });
        }
        continue;
      }
      if (!mesh) {
        mesh = makeBoneMesh(bone, surface);
        surfaces.set(bone, mesh);
        skin.add(mesh);
        mesh.userData.length = surface.length;
      } else {
        mesh.geometry.dispose();
        mesh.geometry = surface.geometry;
        const materialKey = surface.materials.map(material => material?.uuid).join('/');
        const texturedBlend = bone.finish === 'blend' && surface.materials.some(material => material?.map);
        if (mesh.userData.appearance !== appearance || mesh.userData.materialKey !== materialKey ||
            (texturedBlend && Math.abs((mesh.userData.length ?? 0) - surface.length) > .12)) {
          mesh.material.map?.dispose();
          mesh.material.dispose();
          mesh.material = boneMaterial(bone, surface);
          mesh.userData.length = surface.length;
        }
      }
      mesh.visible = true;
      Object.assign(mesh.userData, { pose, appearance,
        materialKey: surface.materials.map(material => material?.uuid).join('/') });
      updateTileBounds(mesh.material, mesh.geometry);
    }
    prune(surfaces, present, mesh => {
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    });
  }

  return {
    get enabled() { return enabled; },
    setMode(value, joint) {
      if (current !== joint || !value) hovered = undefined;
      enabled = value;
      current = joint;
      if (!value) {
        guides.visible = false;
        for (const marker of [...pins.values(), ...shafts.values()]) marker.removeFromParent();
        pins.clear();
        shafts.clear();
      }
    },
    updateGuides,
    updateSkin,
    hover(joint) { hovered = joint; },
    pick(ray, button) {
      if (!guides.visible) return;
      const markers = button === 2 ? [...shafts.values()].filter(marker => marker.visible) : [...pins.values()];
      return ray.intersectObjects(markers, false)[0]?.object.userData;
    }
  };
}
