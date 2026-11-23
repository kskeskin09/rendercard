import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { configurePointLight, materialsOf } from './model.js';
import { localBounds } from './spatial.js';
import { updateOpacity } from './opacity.js';
import { withSceneCuts } from './boolean-cuts.js';
import { updateTileBounds } from './tiles.js';

export function createViewport(
  element,
  root,
  { select, context, editing, change, moved }
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute('aria-label', '3B sahne');
  element.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#26322b');
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.08, 160);
  const shot = new THREE.PerspectiveCamera(35, 1, 0.08, 160);
  let shotObject;
  let outputShot;
  let previewShot = false;
  let savedDefault;
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.minDistance = 1;
  orbit.maxDistance = 70;

  function reset() {
    camera.position.set(6.5, 4.3, 8.7);
    orbit.target.set(0, 0.95, 0);
    orbit.update();
  }
  reset();

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180),
    new THREE.MeshStandardMaterial({ color: '#344336', roughness: 0.92 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.012;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(80, 80, '#a7bca3', '#83977f');
  grid.position.y = 0.004;
  grid.material.transparent = true;
  grid.material.depthWrite = false;
  grid.material.opacity = 0.48;
  scene.add(grid);

  scene.add(new THREE.HemisphereLight('#eff6dc', '#b7c3b0', 2.2));
  const defaultLights = new THREE.Group();
  const sun = new THREE.DirectionalLight('#fff3da', 3.2);
  sun.position.set(-4, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -10,
    right: 10,
    top: 10,
    bottom: -10,
    far: 28
  });
  sun.shadow.normalBias = 0.028;
  sun.shadow.bias = -0.0002;
  sun.shadow.camera.updateProjectionMatrix();
  const rim = new THREE.DirectionalLight('#c3d9ff', 1.8);
  rim.position.set(5, 4, -8);
  defaultLights.add(sun, rim);
  defaultLights.visible = false;
  scene.add(defaultLights);
  const emitters = new Map();
  const edgeLine = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ depthTest: false })
  );
  edgeLine.geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(24, 3)
  );
  edgeLine.frustumCulled = false;
  edgeLine.renderOrder = 13;
  edgeLine.visible = false;
  scene.add(edgeLine);
  let highlighted;

  function highlightEdges(object, axis) {
    highlighted =
      object && axis?.length === 1 && 'xyz'.includes(axis)
        ? { object, axis }
        : undefined;
  }

  function updateHighlightedEdges(clean) {
    edgeLine.visible =
      !clean && Boolean(highlighted && highlighted.object.visible);
    if (!edgeLine.visible) return;
    const { object, axis } = highlighted;
    const bounds = localBounds(object);
    if (bounds.isEmpty()) {
      edgeLine.visible = false;
      return;
    }
    const [a, b] = ['x', 'y', 'z'].filter((component) => component !== axis);
    const attribute = edgeLine.geometry.attributes.position;
    const point = new THREE.Vector3();
    let i = 0;
    for (const first of [bounds.min[a], bounds.max[a]]) {
      for (const second of [bounds.min[b], bounds.max[b]]) {
        for (const end of [bounds.min[axis], bounds.max[axis]]) {
          point[a] = first;
          point[b] = second;
          point[axis] = end;
          point.applyMatrix4(object.matrixWorld);
          attribute.setXYZ(i++, point.x, point.y, point.z);
        }
      }
    }
    attribute.needsUpdate = true;
    edgeLine.material.color.set(
      { x: '#ff8582', y: '#93e473', z: '#79b5ff' }[axis]
    );
  }

  function updateEmitters() {
    const seen = new Set();
    root.traverseVisible((object) => {
      if (!object.isMesh || !object.userData.emitsLight) return;
      seen.add(object);
      const data = object.userData;
      let light = emitters.get(object);
      if (!light) {
        light = configurePointLight(new THREE.PointLight());
        emitters.set(object, light);
        scene.add(light);
      }
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      object.geometry.boundingBox.getCenter(light.position);
      object.localToWorld(light.position);
      light.color.set(data.emissionColor);
      const opacity = object.previewOpacity ?? data.opacity;
      light.intensity = (0.5 + data.emissionPower * 1.795) * opacity / 100;
      object.castShadow = false;
      for (const material of materialsOf(object)) {
        material.emissive.set(data.emissionColor);
        material.emissiveIntensity = 0.08 + data.emissionPower / 65;
      }
    });
    for (const [object, light] of emitters) {
      if (seen.has(object)) continue;
      scene.remove(light);
      light.dispose();
      emitters.delete(object);
      if (object.parent) {
        object.castShadow = true;
        for (const material of materialsOf(object)) material.emissive.set(0);
      }
    }
  }

  let symmetricScale = false;
  renderer.domElement.addEventListener(
    'pointermove',
    (event) => {
      symmetricScale = event.shiftKey;
    },
    { capture: true }
  );
  const transform = new TransformControls(camera, renderer.domElement);
  transform.setSize(0.78);
  const transformHelper = transform.getHelper();
  scene.add(transformHelper);
  transform.addEventListener('dragging-changed', (event) => {
    orbit.enabled = !event.value;
  });
  transform.addEventListener('objectChange', () => change(symmetricScale));
  transform.addEventListener('mouseDown', () => {
    const direction =
      transform.mode === 'scale' && transform.axis !== 'XYZ'
        ? transform.pointStart
            .clone()
            .applyQuaternion(transform.worldQuaternionStart.clone().invert())
        : undefined;
    editing(direction, transform.axis);
    if (transform.mode === 'scale')
      highlightEdges(transform.object, transform.axis?.toLowerCase());
  });
  transform.addEventListener('mouseUp', () => {
    highlightEdges();
    moved();
  });

  const outline = new THREE.BoxHelper(new THREE.Object3D(), '#d8f882');
  outline.material.transparent = true;
  outline.material.opacity = 0.56;
  outline.visible = false;
  scene.add(outline);
  const referenceOutline = new THREE.BoxHelper(new THREE.Object3D(), '#96b84c');
  referenceOutline.visible = false;
  scene.add(referenceOutline);
  const pivots = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({
      color: '#f6be65',
      size: 8,
      sizeAttenuation: false,
      depthTest: false
    })
  );
  pivots.frustumCulled = false;
  pivots.renderOrder = 10;
  pivots.visible = false;
  scene.add(pivots);
  let showPivots = false;
  let selected;
  let alignment;
  let mode = 'select';

  function updateSelection(object, nextMode, targets = []) {
    highlightEdges();
    selected = object;
    alignment = targets.length > 1 ? targets[0] : undefined;
    mode = nextMode;
    if (!selected || mode === 'select') transform.detach();
    else {
      transform.attach(selected);
      transform.setMode(mode);
    }
  }

  const pointer = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  ray.params.Points.threshold = 0.17;
  let down;
  let sampler;
  const lightMarkers = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({
      color: '#ffe397',
      size: 10,
      sizeAttenuation: false,
      depthTest: false
    })
  );
  lightMarkers.frustumCulled = false;
  lightMarkers.renderOrder = 11;
  scene.add(lightMarkers);
  const visibleLights = [];
  const samplePreview = element.querySelector('#sample-preview');
  let previewPosition;
  let previewRequest;

  function pickColor(callback) {
    sampler = callback;
    renderer.domElement.classList.toggle('sampling-color', Boolean(callback));
    samplePreview.hidden = true;
    previewPosition = undefined;
    element.dispatchEvent(
      new CustomEvent('rendercard-color-mode', {
        detail: Boolean(callback),
        bubbles: true
      })
    );
  }

  function sampleAt(clientX, clientY) {
    render(true, previewShot, false);
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(
        canvas.width - 1,
        Math.floor(((clientX - rect.left) * canvas.width) / rect.width)
      )
    );
    const topY = Math.max(
      0,
      Math.min(
        canvas.height - 1,
        Math.floor(((clientY - rect.top) * canvas.height) / rect.height)
      )
    );
    const gl = renderer.getContext();
    const pixel = new Uint8Array(4);
    gl.readPixels(
      x,
      canvas.height - topY - 1,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel
    );
    render();
    return (
      '#' +
      [...pixel.slice(0, 3)]
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')
    );
  }
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!sampler) return;
    previewPosition = [event.clientX, event.clientY];
    if (previewRequest != null) return;
    previewRequest = requestAnimationFrame(() => {
      previewRequest = undefined;
      if (!sampler || !previewPosition) return;
      const hex = sampleAt(...previewPosition);
      const rect = element.getBoundingClientRect();
      samplePreview.style.left =
        Math.max(
          0,
          Math.min(rect.width - 92, previewPosition[0] - rect.left + 13)
        ) + 'px';
      samplePreview.style.top =
        Math.max(
          0,
          Math.min(rect.height - 29, previewPosition[1] - rect.top + 13)
        ) + 'px';
      samplePreview.querySelector('span').style.backgroundColor = hex;
      samplePreview.querySelector('b').textContent = hex.toUpperCase();
      samplePreview.hidden = false;
    });
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    previewPosition = undefined;
    samplePreview.hidden = true;
  });

  renderer.domElement.addEventListener(
    'pointerdown',
    (event) => {
      if (!sampler) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      down = undefined;
      const callback = sampler;
      pickColor(undefined);
      if (event.button !== 0) return;
      callback(sampleAt(event.clientX, event.clientY));
    },
    { capture: true }
  );
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (
      event.isPrimary &&
      (event.button === 2 || (event.button === 0 && !transform.axis))
    )
      down = [event.clientX, event.clientY, event.button];
    else down = undefined;
  });
  renderer.domElement.addEventListener('contextmenu', (event) =>
    event.preventDefault()
  );
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (
      !event.isPrimary ||
      !down ||
      event.button !== down[2] ||
      transform.dragging
    )
      return;
    const distance = Math.hypot(
      event.clientX - down[0],
      event.clientY - down[1]
    );
    down = undefined;
    if (distance > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      (2 * (event.clientX - rect.left)) / rect.width - 1,
      1 - (2 * (event.clientY - rect.top)) / rect.height
    );
    ray.setFromCamera(pointer, activeCamera(previewShot));
    const light =
      previewShot && shotObject
        ? undefined
        : ray.intersectObject(lightMarkers)[0];
    const hit = withSceneCuts(root, () => ray
      .intersectObjects(root.children, true)
      .find(({ object, face }) => {
        for (let node = object; node; node = node.parent)
          if (!node.visible) return false;
        return (
          !Array.isArray(object.material) ||
          object.material[face?.materialIndex]?.visible !== false
        );
      }));
    const object = light ? visibleLights[light.index] : hit?.object;
    if (event.button === 2) {
      if (object) context?.(event, object);
    } else select(object, event.shiftKey);
  });
  renderer.domElement.addEventListener('pointercancel', () => {
    down = undefined;
    if (transform.dragging) transform.pointerUp(null);
  });

  let recordingSize = false;
  function resize() {
    if (recordingSize) return;
    const width = Math.max(1, element.clientWidth);
    const height = Math.max(1, element.clientHeight);
    renderer.domElement.style.width = width + 'px';
    renderer.domElement.style.height = height + 'px';
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(element);
  resize();

  const axisWidget = element.querySelector('.axis-widget');
  const axes = ['x', 'y', 'z'].map((axis, index) => ({
    label: axisWidget.querySelector('.axis-' + axis),
    direction: new THREE.Vector3().setComponent(index, 1)
  }));
  const orientation = new THREE.Quaternion();
  const inverseOrientation = new THREE.Quaternion();
  const point = new THREE.Vector3();

  function activeCamera(useShot, output = false) {
    const source = output ? outputShot : shotObject;
    if (!useShot || (!source && !savedDefault)) return camera;
    if (!source) {
      shot.position.copy(savedDefault.position);
      shot.lookAt(savedDefault.target);
    } else {
      source.getWorldPosition(shot.position);
      source.getWorldQuaternion(shot.quaternion);
    }
    shot.aspect = camera.aspect;
    shot.updateProjectionMatrix();
    shot.updateMatrixWorld();
    return shot;
  }

  function render(clean = false, useShot = clean || previewShot, includeHidden = clean) {
    orbit.update();
    const restore = [];
    root.traverse(object => {
      if (object === root) return;
      const { hidden, opacity } = object.userData;
      const visible = object.clipActive !== false && (includeHidden || !hidden) && (object.previewOpacity ?? opacity ?? 100) > 0;
      if (object.visible !== visible) {
        restore.push([object, object.visible]);
        object.visible = visible;
      }
      updateOpacity(object, includeHidden);
      if (object.isMesh)
        for (const material of materialsOf(object)) updateTileBounds(material, object.geometry);
    });
    const renderCamera = activeCamera(useShot, clean && includeHidden);
    updateHighlightedEdges(clean);
    if (!clean && !orientation.equals(renderCamera.quaternion)) {
      orientation.copy(renderCamera.quaternion);
      inverseOrientation.copy(orientation).invert();
      for (const { label, direction } of axes) {
        point.copy(direction).applyQuaternion(inverseOrientation);
        label.style.left = 19 + point.x * 17 + 'px';
        label.style.top = 18 - point.y * 17 + 'px';
        label.style.zIndex = String(Math.round(10 + point.z * 4));
      }
    }
    grid.visible = !clean;
    transformHelper.visible =
      !clean && (!useShot || !shotObject) && Boolean(transform.object);
    outline.visible =
      !clean &&
      Boolean(
        selected && !selected.isLight && !selected.isCamera && selected.visible
      );
    if (outline.visible) outline.setFromObject(selected);
    referenceOutline.visible = !clean && Boolean(alignment?.visible && (alignment.isMesh || alignment.isGroup));
    if (referenceOutline.visible) referenceOutline.setFromObject(alignment);
    pivots.visible = !clean && showPivots;
    lightMarkers.visible = !clean && (!useShot || !shotObject);
    if (!clean) {
      const positions = [];
      const lights = [];
      visibleLights.length = 0;
      root.updateMatrixWorld();
      root.traverseVisible((object) => {
        if (
          object !== root &&
          (pivots.visible || object.isLight || object.isCamera)
        ) {
          point.setFromMatrixPosition(object.matrixWorld);
          if (pivots.visible) positions.push(point.x, point.y, point.z);
          if (object.isLight || object.isCamera) {
            visibleLights.push(object);
            lights.push(point.x, point.y, point.z);
          }
        }
      });
      updateMarkers(lightMarkers, lights);
      if (pivots.visible) updateMarkers(pivots, positions);
    }
    withSceneCuts(root, () => {
      updateEmitters();
      renderer.render(scene, renderCamera);
    });
    for (const [object, visible] of restore) object.visible = visible;
  }

  function updateMarkers(markers, positions) {
    let buffer = markers.geometry.getAttribute('position');
    if (!buffer || buffer.array.length !== positions.length) {
      markers.geometry.dispose();
      buffer = new THREE.Float32BufferAttribute(positions.length, 3);
      markers.geometry.setAttribute('position', buffer);
      markers.geometry.boundingSphere = null;
    }
    let moved = false;
    for (let index = 0; index < positions.length; index++) {
      if (Math.fround(positions[index]) !== buffer.array[index]) {
        buffer.array[index] = positions[index];
        moved = true;
      }
    }
    if (moved) {
      buffer.needsUpdate = true;
      markers.geometry.boundingSphere = null;
    }
  }

  function lockSize(value) {
    recordingSize = value;
    if (!value) resize();
  }
  const cameraState = () => ({ position: camera.position.clone(), target: orbit.target.clone() });
  function restoreCamera(state) {
    if (Array.isArray(state.position)) {
      camera.position.fromArray(state.position);
      orbit.target.fromArray(state.target);
    } else {
      camera.position.copy(state.position);
      orbit.target.copy(state.target);
    }
    orbit.update();
  }
  function useDefaultView() {
    if (!savedDefault) return;
    restoreCamera(savedDefault);
    savedDefault = undefined;
  }
  return {
    render,
    pickColor,
    toggleColor(callback) {
      const active = !sampler;
      pickColor(active ? callback : undefined);
      return active;
    },
    setAtmosphere(settings) {
      scene.fog = settings.enabled
        ? new THREE.Fog(settings.color, settings.near, settings.far)
        : null;
      scene.background.set(settings.enabled ? settings.color : '#26322b');
      defaultLights.visible = settings.defaultLight;
    },
    setShot(object, preview, output) {
      shotObject = object;
      outputShot = output;
      previewShot = preview;
      orbit.enabled = !(preview && object) && !transform.dragging;
      transform.enabled = !(preview && object);
    },
    copyDefaultCamera(object) {
      orbit.update();
      object.position.copy(camera.position);
      object.quaternion.copy(camera.quaternion);
    },
    highlightEdges,
    reset() {
      if (savedDefault) useDefaultView();
      else reset();
    },
    useDefaultView,
    useCameraView(object) {
      if (!object) return useDefaultView();
      savedDefault ??= cameraState();
      object.getWorldPosition(camera.position);
      const distance = Math.max(1, object.userData.followOffset ? Math.hypot(...object.userData.followOffset) :
        savedDefault.position.distanceTo(savedDefault.target));
      orbit.target.copy(camera.position).addScaledVector(object.getWorldDirection(new THREE.Vector3()), distance);
      orbit.update();
    },
    captureCamera: () => savedDefault ?? cameraState(),
    restoreCamera(state) {
      savedDefault = undefined;
      restoreCamera(state);
    },
    showPivots: (value) => {
      showPivots = value;
    },
    updateSelection,
    lockSize,
    canvas: renderer.domElement
  };
}
