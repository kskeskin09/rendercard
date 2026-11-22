import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export function createViewport(
  element,
  root,
  { select, editing, change, moved }
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
  scene.fog = new THREE.FogExp2('#26322b', 0.042);
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.08, 160);
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

  scene.add(new THREE.HemisphereLight('#eff6dc', '#657667', 2.05));
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
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#c3d9ff', 1.8);
  rim.position.set(5, 4, -8);
  scene.add(rim);

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
  });
  transform.addEventListener('mouseUp', moved);

  const outline = new THREE.BoxHelper(new THREE.Object3D(), '#d8f882');
  outline.material.transparent = true;
  outline.material.opacity = 0.56;
  outline.visible = false;
  scene.add(outline);
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
  let mode = 'select';

  function updateSelection(object, nextMode) {
    selected = object;
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

  function pickColor(callback) {
    sampler = callback;
    renderer.domElement.classList.toggle('sampling-color', Boolean(callback));
  }

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
      render(true);
      const canvas = renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min(
          canvas.width - 1,
          Math.floor(((event.clientX - rect.left) * canvas.width) / rect.width)
        )
      );
      const topY = Math.max(
        0,
        Math.min(
          canvas.height - 1,
          Math.floor(((event.clientY - rect.top) * canvas.height) / rect.height)
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
      callback(
        '#' +
          [...pixel.slice(0, 3)]
            .map((channel) => channel.toString(16).padStart(2, '0'))
            .join('')
      );
      render();
    },
    { capture: true }
  );
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.isPrimary && event.button === 0 && !transform.axis)
      down = [event.clientX, event.clientY];
    else down = undefined;
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!event.isPrimary || event.button !== 0 || !down || transform.dragging)
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
    ray.setFromCamera(pointer, camera);
    const light = ray.intersectObject(lightMarkers)[0];
    const hit = ray
      .intersectObjects(root.children, true)
      .find(({ object, face }) => {
        for (let node = object; node; node = node.parent)
          if (!node.visible) return false;
        return (
          !Array.isArray(object.material) ||
          object.material[face?.materialIndex]?.visible !== false
        );
      });
    select(light ? visibleLights[light.index] : hit?.object, event.shiftKey);
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

  function render(clean = false) {
    orbit.update();
    if (!clean && !orientation.equals(camera.quaternion)) {
      orientation.copy(camera.quaternion);
      inverseOrientation.copy(orientation).invert();
      for (const { label, direction } of axes) {
        point.copy(direction).applyQuaternion(inverseOrientation);
        label.style.left = 19 + point.x * 17 + 'px';
        label.style.top = 18 - point.y * 17 + 'px';
        label.style.zIndex = String(Math.round(10 + point.z * 4));
      }
    }
    grid.visible = !clean;
    transformHelper.visible = !clean && Boolean(transform.object);
    outline.visible =
      !clean && Boolean(selected && !selected.isLight && selected.visible);
    if (outline.visible) outline.setFromObject(selected);
    pivots.visible = !clean && showPivots;
    lightMarkers.visible = !clean;
    if (!clean) {
      const positions = [];
      const lights = [];
      visibleLights.length = 0;
      root.updateMatrixWorld();
      root.traverseVisible((object) => {
        if (object !== root && (pivots.visible || object.isLight)) {
          point.setFromMatrixPosition(object.matrixWorld);
          if (pivots.visible) positions.push(point.x, point.y, point.z);
          if (object.isLight) {
            visibleLights.push(object);
            lights.push(point.x, point.y, point.z);
          }
        }
      });
      updateMarkers(lightMarkers, lights);
      if (pivots.visible) updateMarkers(pivots, positions);
    }
    renderer.render(scene, camera);
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
  return {
    render,
    pickColor,
    reset,
    captureCamera: () => ({
      position: camera.position.clone(),
      target: orbit.target.clone()
    }),
    restoreCamera(state) {
      camera.position.copy(state.position);
      orbit.target.copy(state.target);
      orbit.update();
    },
    showPivots: (value) => {
      showPivots = value;
    },
    updateSelection,
    lockSize,
    canvas: renderer.domElement
  };
}
