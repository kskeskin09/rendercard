import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { configurePointLight, materialsOf } from './model.js';
import { localBounds } from './spatial.js';
import { updateOpacity } from './opacity.js';
import { withSceneCuts } from './boolean-cuts.js';
import { updateTileBounds } from './tiles.js';
import { axisLabels, changeAxisView, resizeAxisView, stopOrbitMotion } from './axis-view.js';
import { createMeasurement } from './measurement.js';
import { fitRenderFrame } from './render-settings.js';
import { skyTexture } from './sky-texture.js';
import { createRigView } from './rig-view.js';

export function createViewport(
  element,
  root,
  { select, context, editing, change, moved, measurementSettings, measured, rigPick }
) {
  function createRenderer() {
    const display = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    display.shadowMap.enabled = true;
    display.shadowMap.type = THREE.PCFShadowMap;
    display.toneMapping = THREE.ACESFilmicToneMapping;
    display.toneMappingExposure = 1.15;
    return display;
  }
  const renderer = createRenderer();
  let outputRenderer;
  let outputWidth;
  let outputHeight;
  let frameAspect;
  const negativeGuide = new THREE.MeshBasicMaterial({
    transparent: true, opacity: .68, depthWrite: false, toneMapped: false
  });
  negativeGuide.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vNegativePosition;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvNegativePosition = position * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));'
    );
    shader.fragmentShader = 'varying vec3 vNegativePosition;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\nfloat stripe = fract(dot(vNegativePosition, vec3(5.0)));\ndiffuseColor.rgb = vec3(mix(0.01, 0.95, step(0.5, stripe)));'
    );
  };
  const frameGuide = element.querySelector('#frame-guide');
  const editingSize = new THREE.Vector2();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.setAttribute('aria-label', '3B sahne');
  renderer.domElement.tabIndex = 0;
  element.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const backgroundColor = new THREE.Color('#26322b');
  let backgroundTexture;
  let backgroundTile;
  scene.background = backgroundColor;
  scene.add(root);
  const rig = createRigView(scene, root);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.08, 160);
  const shot = new THREE.PerspectiveCamera(35, 1, 0.08, 160);
  const outputCamera = shot.clone();
  let shotObject;
  let outputShot;
  let previewShot = false;
  let savedDefault;
  let axisView;
  let namedView;
  const cameraViews = new Map();
  const axisViews = new Map();
  const axisButtons = [...element.querySelectorAll('[data-view-axis]')];
  const orbit = new OrbitControls(camera, renderer.domElement);
  const measurement = createMeasurement(root, scene, renderer.domElement, element.querySelector('#measurement-label'), measurementSettings);
  orbit.addEventListener('change', measurement.invalidate);
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
  const edgeGeometry = new LineSegmentsGeometry().setPositions(new Float32Array(24));
  const edgeStroke = new LineSegments2(edgeGeometry, new LineMaterial({
    color: '#252939', linewidth: 8, depthTest: false, toneMapped: false
  }));
  const edgeLine = new LineSegments2(edgeGeometry,
    new LineMaterial({ linewidth: 4.5, depthTest: false, toneMapped: false })
  );
  for (const [index, line] of [edgeStroke, edgeLine].entries()) {
    line.frustumCulled = false;
    line.renderOrder = 13 + index;
    line.visible = false;
    scene.add(line);
  }
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
    edgeStroke.visible = edgeLine.visible;
    if (!edgeLine.visible) return;
    const { object, axis } = highlighted;
    const bounds = localBounds(object);
    if (bounds.isEmpty()) {
      edgeLine.visible = false;
      edgeStroke.visible = false;
      return;
    }
    const [a, b] = ['x', 'y', 'z'].filter((component) => component !== axis);
    const positions = edgeGeometry.attributes.instanceStart.data;
    const point = new THREE.Vector3();
    let i = 0;
    for (const first of [bounds.min[a], bounds.max[a]]) {
      for (const second of [bounds.min[b], bounds.max[b]]) {
        for (const end of [bounds.min[axis], bounds.max[axis]]) {
          point[a] = first;
          point[b] = second;
          point[axis] = end;
          point.applyMatrix4(object.matrixWorld);
          point.toArray(positions.array, i);
          i += 3;
        }
      }
    }
    positions.needsUpdate = true;
    edgeLine.material.color.set(
      { x: '#ff7369', y: '#a9ff68', z: '#68c8ff' }[axis]
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
  const selectionPivot = new THREE.Object3D();
  scene.add(selectionPivot);
  transform.setSize(0.78);
  const transformHelper = transform.getHelper();
  scene.add(transformHelper);
  transform.addEventListener('dragging-changed', updateControls);
  function updateControls() {
    const staged = previewShot && (shotObject || axisView);
    orbit.enabled = !axisView && !staged && !transform.dragging;
    if (axisView) axisView.controls.enabled = !staged && !transform.dragging;
    transform.enabled = !staged && !measurement.active && !rig.enabled;
    transform.camera = axisView?.camera ?? camera;
    for (const button of axisButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.viewAxis === axisView?.axis));
    }
  }

  function rememberAxis() {
    if (!axisView) return;
    stopOrbitMotion(axisView.controls);
    axisViews.set(axisView.axis, {
      center: axisView.controls.target.clone(), height: axisView.height / axisView.camera.zoom
    });
  }

  function closeAxisView() {
    if (!axisView) return;
    rememberAxis();
    axisView.controls.dispose();
    axisView = undefined;
    updateFrameGuide();
    measurement.invalidate();
    updateControls();
  }
  transform.addEventListener('objectChange', () => change(symmetricScale, transform.object === selectionPivot ? selectionPivot : undefined));
  transform.addEventListener('mouseDown', () => {
    const direction =
      transform.mode === 'scale' && transform.axis !== 'XYZ'
        ? transform.pointStart
            .clone()
            .applyQuaternion(transform.worldQuaternionStart.clone().invert())
        : undefined;
    const multi = transform.object === selectionPivot ? selectionPivot : undefined;
    editing(direction, transform.axis, multi);
    if (transform.mode === 'scale' && !multi)
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
    if ((!selected && targets.length < 2) || mode === 'select') transform.detach();
    else {
      if (!selected) {
        selectionPivot.position.set(0, 0, 0);
        for (const target of targets)
          selectionPivot.position.add(target.getWorldPosition(new THREE.Vector3()));
        selectionPivot.position.divideScalar(targets.length);
        selectionPivot.quaternion.identity();
        selectionPivot.scale.setScalar(1);
      }
      transform.attach(selected ?? selectionPivot);
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
  const cameraHelpers = new THREE.Group();
  scene.add(cameraHelpers);
  const markers = new Map();
  const cameraBody = new THREE.BoxGeometry(.27, .17, .19);
  const cameraLens = new THREE.ConeGeometry(.095, .15, 4);
  cameraLens.rotateX(Math.PI / 2);
  const cameraHandle = new THREE.BoxGeometry(.10, .055, .09);
  const screen = new THREE.PlaneGeometry(.42, .255);
  const cameraColor = new THREE.MeshBasicMaterial({ color: '#87bdff', toneMapped: false });
  const frameColor = new THREE.LineBasicMaterial({ color: '#9ccaff', transparent: true, opacity: .75, depthWrite: false });
  const screenColor = new THREE.MeshBasicMaterial({
    color: '#87bdff', transparent: true, opacity: .27, side: THREE.DoubleSide, depthWrite: false
  });
  const screenEdges = new THREE.BufferGeometry().setFromPoints(
    [[-.21, -.1275], [.21, -.1275], [.21, .1275], [-.21, .1275]].flatMap(([x, y]) =>
      [new THREE.Vector3(0, 0, -.14), new THREE.Vector3(x, y, -.7)])
  );
  const screenBorder = new THREE.EdgesGeometry(screen);

  function cameraMarker(cameraObject) {
    if (markers.has(cameraObject)) return markers.get(cameraObject);
    const marker = new THREE.Group();
    const body = new THREE.Mesh(cameraBody, cameraColor);
    const lens = new THREE.Mesh(cameraLens, cameraColor);
    lens.position.z = -.145;
    const handle = new THREE.Mesh(cameraHandle, cameraColor);
    handle.position.y = .103;
    const window = new THREE.Mesh(screen, screenColor);
    window.position.z = -.7;
    const edges = new THREE.LineSegments(screenBorder, frameColor);
    edges.position.z = -.7;
    for (const part of [body, lens, handle]) part.userData.camera = cameraObject;
    marker.add(body, lens, handle, window, edges, new THREE.LineSegments(screenEdges, frameColor));
    cameraHelpers.add(marker);
    markers.set(cameraObject, marker);
    return marker;
  }
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
    if (measurement.active) measurement.move(event.clientX, event.clientY);
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
    if (measurement.active) measurement.move();
    previewPosition = undefined;
    samplePreview.hidden = true;
  });

  renderer.domElement.addEventListener(
    'pointerdown',
    (event) => {
      if (!sampler) {
        if (!measurement.active || event.button !== 0 || event.altKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        renderer.domElement.focus({ preventScroll: true });
        down = undefined;
        const result = withSceneCuts(root, () => measurement.place(
          event.clientX, event.clientY, activeCamera(previewShot), (axisView?.controls ?? orbit).target
        ));
        if (result !== undefined) measured(result);
        return;
      }
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
    if (measurement.active && event.button === 0) return;
    if (
      event.isPrimary &&
      (event.button === 2 || (event.button === 0 && (!transform.axis || rig.enabled)))
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
    const rigHit = rig.pick(ray, event.button);
    if (rigHit && rigPick?.(event, rigHit)) return;
    const light =
      previewShot && shotObject
        ? undefined
        : ray.intersectObject(lightMarkers)[0];
    const cameraHit = cameraHelpers.visible && ray.intersectObjects(
      [...markers.values()].filter(marker => marker.visible).flatMap(marker => marker.children.slice(0, 3)), false
    )[0];
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
    const object = cameraHit && (!hit || cameraHit.distance < hit.distance)
      ? cameraHit.object.userData.camera
      : light ? visibleLights[light.index] : hit?.object;
    if (event.button === 2) {
      if (object) context?.(event, object);
    } else select(object, event.shiftKey);
  });
  renderer.domElement.addEventListener('pointercancel', () => {
    down = undefined;
    if (transform.dragging) transform.pointerUp(null);
  });

  function resize() {
    const width = Math.max(1, element.clientWidth);
    const height = Math.max(1, element.clientHeight);
    renderer.domElement.style.width = width + 'px';
    renderer.domElement.style.height = height + 'px';
    renderer.setSize(width, height, false);
    editingSize.set(width, height);
    updateFrameGuide();
    resizeAxisView(axisView, width / height);
    measurement.invalidate();
  }

  function updateFrameGuide() {
    const { x: width, y: height } = editingSize;
    const show = Boolean(frameAspect && !axisView && width && height);
    frameGuide.hidden = !show;
    if (show) {
      const fit = fitRenderFrame(width, height, frameAspect);
      frameGuide.style.width = fit.width + 'px';
      frameGuide.style.height = fit.height + 'px';
      camera.setViewOffset(fit.width, fit.height, (fit.width - width) / 2, (fit.height - height) / 2, width, height);
    } else {
      camera.clearViewOffset();
      camera.aspect = width / height;
    }
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

  function activeCamera(useShot, output = false, targetAspect = editingSize.x / editingSize.y) {
    const source = output ? outputShot : shotObject;
    if (!useShot) return axisView?.camera ?? camera;
    if (!output && !source && !savedDefault) return camera;
    const target = output ? outputCamera : shot;
    if (source) {
      source.getWorldPosition(target.position);
      source.getWorldQuaternion(target.quaternion);
    } else if (savedDefault) {
      target.position.copy(savedDefault.position);
      target.lookAt(savedDefault.target);
    } else {
      target.position.copy(camera.position);
      target.quaternion.copy(camera.quaternion);
    }
    if (!output && camera.view?.enabled) {
      const { fullWidth, fullHeight, offsetX, offsetY, width, height } = camera.view;
      target.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, width, height);
    } else {
      target.clearViewOffset();
      target.aspect = targetAspect;
      target.updateProjectionMatrix();
    }
    target.updateMatrixWorld();
    return target;
  }

  function render(clean = false, useShot = clean || previewShot, includeHidden = clean, targetRenderer = renderer) {
    const control = axisView?.controls ?? orbit;
    if (control.enabled) control.update();
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
    const renderCamera = activeCamera(useShot, clean && includeHidden,
      targetRenderer === outputRenderer ? outputWidth / outputHeight : undefined);
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
      !clean && !measurement.active && !rig.enabled && (!useShot || (!shotObject && !axisView)) && Boolean(transform.object);
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
    cameraHelpers.visible = lightMarkers.visible;
    if (!clean) {
      const positions = [];
      const lights = [];
      const currentCameras = new Set();
      visibleLights.length = 0;
      root.updateMatrixWorld();
      root.traverseVisible((object) => {
        if (
          object !== root &&
          (pivots.visible || object.isLight || object.isCamera)
        ) {
          point.setFromMatrixPosition(object.matrixWorld);
          let showPivot = pivots.visible;
          if (object.isLight) {
            visibleLights.push(object);
            lights.push(point.x, point.y, point.z);
          }
          if (object.isCamera) {
            currentCameras.add(object);
            const marker = cameraMarker(object);
            marker.position.copy(point);
            object.getWorldQuaternion(marker.quaternion);
            // The view plane reaches 0.7 units past the camera body.
            // A larger distance on re-entry prevents flicker at the boundary.
            const near = marker.visible ? 1.2 : 1.4;
            marker.visible = point.distanceToSquared(renderCamera.position) > near ** 2;
            showPivot &&= marker.visible;
          }
          if (showPivot) positions.push(point.x, point.y, point.z);
        }
      });
      for (const [object, marker] of markers) if (!currentCameras.has(object)) {
        marker.removeFromParent();
        markers.delete(object);
      }
      updateMarkers(lightMarkers, lights);
      if (pivots.visible) updateMarkers(pivots, positions);
    }
    withSceneCuts(root, () => {
      rig.updateGuides(!clean && !useShot && !measurement.active);
      rig.updateSkin();
      updateEmitters();
      measurement.render(renderCamera, (axisView?.controls ?? orbit).target, clean);
      const fog = scene.fog;
      const striped = [];
      if (!clean) root.traverseVisible(object => {
        if (!object.isMesh || !object.userData.negative) return;
        striped.push([object, object.material, object.castShadow]);
        object.material = negativeGuide;
        object.castShadow = false;
      });
      if (axisView?.camera === renderCamera) scene.fog = null;
      try {
        targetRenderer.render(scene, renderCamera);
      } finally {
        for (const [object, material, castShadow] of striped) {
          object.material = material;
          object.castShadow = castShadow;
        }
        scene.fog = fog;
      }
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

  const cameraState = () => ({ position: camera.position.clone(), target: orbit.target.clone() });
  function rememberPerspective() {
    stopOrbitMotion(orbit);
    if (namedView) cameraViews.set(namedView.id, { ...namedView, ...cameraState() });
  }
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
    rememberPerspective();
    namedView = undefined;
    if (!savedDefault) return;
    restoreCamera(savedDefault);
    savedDefault = undefined;
  }
  return {
    render,
    setFrameGuide(aspect) {
      frameAspect = aspect;
      updateFrameGuide();
      measurement.invalidate();
    },
    renderOutput(width, height) {
      outputRenderer ??= createRenderer();
      if (outputWidth !== width || outputHeight !== height) {
        outputWidth = width;
        outputHeight = height;
        outputRenderer.setSize(width, height, false);
      }
      render(true, true, true, outputRenderer);
      return outputRenderer.domElement;
    },
    pickColor,
    setMeasuring(active) {
      if (active) pickColor(undefined);
      measurement.setActive(active);
      updateControls();
    },
    toggleColor(callback) {
      const active = !sampler;
      pickColor(active ? callback : undefined);
      return active;
    },
    setAtmosphere(settings) {
      scene.fog = settings.enabled
        ? new THREE.Fog(settings.color, settings.near, settings.far)
        : null;
      const tile = settings.skyMode === 'tile' ? settings.skyTile : undefined;
      if (tile !== backgroundTile) {
        backgroundTexture?.dispose();
        backgroundTexture = tile && skyTexture(tile, 1024, 512, true);
        backgroundTile = tile;
      }
      backgroundColor.set(settings.skyMode === 'color' ? settings.skyColor : settings.enabled ? settings.color : '#26322b');
      scene.background = backgroundTexture ?? backgroundColor;
      defaultLights.visible = settings.defaultLight;
    },
    setShot(object, preview, output) {
      const control = axisView?.controls ?? orbit;
      if (control.enabled && preview && (object || axisView)) stopOrbitMotion(control);
      shotObject = object;
      outputShot = output;
      previewShot = preview;
      updateControls();
    },
    get axisLabel() {
      return axisLabels[axisView?.axis];
    },
    toggleAxis(axis) {
      if (axisView) rememberAxis();
      else rememberPerspective();
      axisView = changeAxisView(axisView, axis, camera, orbit.target, renderer.domElement,
        measurement.invalidate, axisViews.get(axis));
      resizeAxisView(axisView, editingSize.x / editingSize.y);
      updateFrameGuide();
      measurement.invalidate();
      updateControls();
    },
    focus(objects) {
      const bounds = new THREE.Box3();
      for (const object of objects) {
        const item = new THREE.Box3().setFromObject(object, true);
        if (item.isEmpty()) bounds.expandByPoint(object.getWorldPosition(new THREE.Vector3()));
        else bounds.union(item);
      }
      const { center, radius } = bounds.getBoundingSphere(new THREE.Sphere());
      if (axisView) {
        const offset = axisView.camera.position.clone().sub(axisView.controls.target);
        axisView.controls.target.copy(center);
        axisView.camera.position.copy(center).add(offset);
        axisView.camera.zoom = Math.min(axisView.controls.maxZoom,
          axisView.height * Math.min(1, camera.aspect) / Math.max(1, radius * 2.4));
        axisView.camera.updateProjectionMatrix();
        axisView.controls.update();
        return;
      }
      const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
      const halfFov = Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
      const distance = THREE.MathUtils.clamp(radius * 1.2 / Math.sin(halfFov), orbit.minDistance * 1.5, orbit.maxDistance);
      const direction = camera.position.clone().sub(orbit.target).normalize();
      orbit.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance);
      orbit.update();
    },
    highlightEdges,
    setRigMode(value, joint) {
      rig.setMode(value, joint);
      updateControls();
    },
    reset() {
      closeAxisView();
      if (savedDefault) useDefaultView();
      else {
        stopOrbitMotion(orbit);
        reset();
      }
    },
    useDefaultView,
    useCameraView(object) {
      closeAxisView();
      if (!object) return useDefaultView();
      rememberPerspective();
      savedDefault ??= cameraState();
      const origin = object.getWorldPosition(new THREE.Vector3());
      const rotation = object.getWorldQuaternion(new THREE.Quaternion());
      const id = object.userData.cameraId;
      const previous = cameraViews.get(id);
      namedView = { id, origin, rotation };
      if (previous && previous.origin.distanceToSquared(origin) < 1e-10 &&
          previous.rotation.angleTo(rotation) < 1e-5) {
        restoreCamera(previous);
        return;
      }
      cameraViews.delete(id);
      camera.position.copy(origin);
      const distance = Math.max(1, object.userData.followOffset ? Math.hypot(...object.userData.followOffset) :
        savedDefault.position.distanceTo(savedDefault.target));
      orbit.target.copy(camera.position).addScaledVector(object.getWorldDirection(new THREE.Vector3()), distance);
      orbit.update();
    },
    captureCamera: () => savedDefault ?? cameraState(),
    restoreCamera(state) {
      closeAxisView();
      stopOrbitMotion(orbit);
      savedDefault = undefined;
      namedView = undefined;
      cameraViews.clear();
      axisViews.clear();
      restoreCamera(state);
    },
    showPivots: (value) => {
      showPivots = value;
    },
    updateSelection,
    canvas: renderer.domElement
  };
}
