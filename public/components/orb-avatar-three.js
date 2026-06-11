const THREE_CDN =
  "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export const PRESETS = {
  Default: {
    primaryEnergy: "#00b3ff",
    secondaryEnergy: "#2e9aff",
    speed: 0.5,
    density: 3.0,
    dpr: 1.0,
    atmosphereGlow: 0.15,
    atmosphereLevel: 1.0,
    atmosphereScale: 1.03,
    orbRotation: 0.89,
    internalAnim: 0.43,
    fractalIters: 4,
    fractalScale: 0.97,
    fractalDecay: -16.7,
    smoothness: 0.031,
    asymmetry: 0.55,
    chromaticAberration: 0.025,
  },
  Cyan: {
    primaryEnergy: "#00ffee",
    secondaryEnergy: "#9900ff",
    speed: 0.5,
    density: 1.1,
    dpr: 1.0,
    atmosphereGlow: 0.15,
    atmosphereLevel: 1.0,
    atmosphereScale: 1.03,
    orbRotation: 0.89,
    internalAnim: 0.43,
    fractalIters: 3,
    fractalScale: 0.75,
    fractalDecay: -16.7,
    smoothness: 0.05,
    asymmetry: 0.45,
    chromaticAberration: 0.026,
  },
  Gray: {
    primaryEnergy: "#ffffff",
    secondaryEnergy: "#000000",
    speed: 0.3,
    density: 0.9,
    dpr: 1.0,
    atmosphereGlow: 0.15,
    atmosphereLevel: 1.0,
    atmosphereScale: 1.03,
    orbRotation: 0.46,
    internalAnim: 0.17,
    fractalIters: 4,
    fractalScale: 0.74,
    fractalDecay: -21.6,
    smoothness: 0.036,
    asymmetry: 0.0,
    chromaticAberration: 0.017,
  },
  Yellow: {
    primaryEnergy: "#ffbb00",
    secondaryEnergy: "#2eff9d",
    speed: 0.5,
    density: 2.1,
    dpr: 1.0,
    atmosphereGlow: 0.15,
    atmosphereLevel: 1.0,
    atmosphereScale: 1.03,
    orbRotation: 0.53,
    internalAnim: 0.43,
    fractalIters: 3,
    fractalScale: 0.69,
    fractalDecay: -14.5,
    smoothness: 0.008,
    asymmetry: 0.35,
    chromaticAberration: 0.024,
  },
  Green: {
    primaryEnergy: "#44ff00",
    secondaryEnergy: "#0062ff",
    speed: 1.1,
    density: 1.3,
    dpr: 1.0,
    atmosphereGlow: 0.15,
    atmosphereLevel: 1.0,
    atmosphereScale: 1.03,
    orbRotation: 0.56,
    internalAnim: 0.4,
    fractalIters: 4,
    fractalScale: 0.89,
    fractalDecay: -24.3,
    smoothness: 0.081,
    asymmetry: 0.26,
    chromaticAberration: 0.0,
  },
};

const VERTEX_SHADER = `
  varying vec3 vLocalPosition;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vLocalPosition = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = `
  uniform float uTime;
  uniform vec3 uLocalCamPos;
  uniform vec3 uPrimaryColor;
  uniform vec3 uSecondaryColor;
  uniform float uDensity;
  uniform float uFractalIters;
  uniform float uFractalScale;
  uniform float uFractalDecay;
  uniform float uInternalAnim;
  uniform float uSmoothness;
  uniform float uAsymmetry;
  uniform float uAtmosphereGlow;
  uniform float uEdgeSoftness;
  uniform float uBrightness;
  varying vec3 vLocalPosition;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  float evaluateStructure(vec3 pos) {
    float densityAcc = 0.0;
    vec3 anchor = pos;
    float animTime = uTime * uInternalAnim;
    float s = sin(animTime);
    float c = cos(animTime);
    mat2 rotAnim = mat2(c, s, -s, c);
    float a = 0.5 * uAsymmetry;
    mat2 rotAsym1 = mat2(cos(a), sin(a), -sin(a), cos(a));
    float b = 0.3 * uAsymmetry;
    mat2 rotAsym2 = mat2(cos(b), sin(b), -sin(b), cos(b));

    for (int step = 0; step < 12; ++step) {
      if (float(step) >= uFractalIters) break;
      pos.xy *= rotAnim;
      pos.yz *= rotAnim;
      pos.xz *= rotAsym1;
      pos.yz *= rotAsym2;
      pos += vec3(0.05, -0.02, 0.03) * uAsymmetry;
      vec3 foldedPos = sqrt(pos * pos + uSmoothness);
      float magnitudeSq = max(dot(foldedPos, foldedPos), 0.00001);
      pos = (uFractalScale * foldedPos / magnitudeSq) - uFractalScale;
      float ySq = pos.y * pos.y;
      float zSq = pos.z * pos.z;
      float yz2 = 2.0 * pos.y * pos.z;
      pos.yz = vec2(ySq - zSq, yz2);
      pos = vec3(pos.z, pos.x, pos.y);
      densityAcc += exp(uFractalDecay * abs(dot(pos, anchor)));
    }

    return densityAcc * 0.5;
  }

  vec2 getVolumeBounds(vec3 origin, vec3 dir, float radius) {
    float b = dot(origin, dir);
    float c = dot(origin, origin) - radius * radius;
    float discriminant = b * b - c;
    if (discriminant < 0.0) {
      return vec2(-1.0);
    }
    float root = sqrt(discriminant);
    return vec2(-b - root, -b + root);
  }

  vec3 traceEnergy(vec3 origin, vec3 dir, vec2 limits) {
    float currentDepth = limits.x;
    float marchStep = 0.02;
    vec3 finalEnergy = vec3(0.0);
    float fieldVal = 0.0;

    for (int i = 0; i < 64; i++) {
      currentDepth += marchStep * exp(-2.0 * fieldVal);
      if (currentDepth > limits.y) break;
      vec3 samplePoint = origin + currentDepth * dir;
      fieldVal = evaluateStructure(samplePoint);
      float vSq = fieldVal * fieldVal;
      float gradientBlend = smoothstep(0.0, 0.4, fieldVal);
      vec3 currentGradient = mix(uSecondaryColor, uPrimaryColor, gradientBlend);
      vec3 emission = currentGradient * (fieldVal * 1.8 + vSq * 1.0);
      finalEnergy = 0.99 * finalEnergy + (0.08 * uDensity) * emission;
    }

    return finalEnergy;
  }

  void main() {
    vec3 rayOrig = uLocalCamPos;
    vec3 rayDir = normalize(vLocalPosition - uLocalCamPos);
    float t = uTime * 0.1;
    float s = sin(t);
    float c = cos(t);
    mat2 rotXZ = mat2(c, s, -s, c);
    rayOrig.xz *= rotXZ;
    rayDir.xz *= rotXZ;
    vec2 limits = getVolumeBounds(rayOrig, rayDir, 2.0);

    if (limits.x < 0.0) {
      discard;
    }

    vec3 volumeColor = traceEnergy(rayOrig, rayDir, limits);
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    float facingRatio = max(dot(normal, viewDir), 0.0);
    float edgeAA = smoothstep(0.0, uEdgeSoftness, facingRatio);
    vec3 finalColor = uBrightness * 0.5 * log(1.0 + volumeColor);
    finalColor = clamp(finalColor, 0.0, 1.0);
    finalColor *= edgeAA;
    float maxLuma = max(finalColor.r, max(finalColor.g, finalColor.b));
    float alpha = clamp(maxLuma * 1.5, 0.0, 1.0) * edgeAA;
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

const ATMOSPHERE_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uGlow;
  uniform float uLevel;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    float vdn = max(dot(normal, viewDir), 0.0);
    float edgeFade = smoothstep(0.0, 0.15, vdn);
    float innerFadePoint = clamp(1.0 - uLevel, 0.0, 0.99);
    float centerFade = smoothstep(1.0, innerFadePoint, vdn);
    float alpha = edgeFade * centerFade * uGlow;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

let threePromise = null;
const orbInstances = new Set();
let sharedRenderer = null;
let globalFrameId = 0;

function loadThree() {
  if (!threePromise) {
    threePromise = import(/* @vite-ignore */ THREE_CDN);
  }
  return threePromise;
}

async function ensureSharedRenderer(THREE) {
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    sharedRenderer.setClearColor(0x000000, 0);
    sharedRenderer.domElement.style.position = "fixed";
    sharedRenderer.domElement.style.left = "-9999px";
    sharedRenderer.domElement.style.top = "-9999px";
    sharedRenderer.domElement.style.pointerEvents = "none";
    sharedRenderer.domElement.setAttribute("aria-hidden", "true");
    document.body.appendChild(sharedRenderer.domElement);
  }

  sharedRenderer.setPixelRatio(1);
  return sharedRenderer;
}

function startGlobalLoop() {
  if (globalFrameId) {
    return;
  }

  function tick() {
    if (!sharedRenderer || orbInstances.size === 0) {
      globalFrameId = 0;
      return;
    }

    orbInstances.forEach(function (instance) {
      if (instance.stopped) {
        return;
      }

      const delta = instance.clock.getDelta();
      instance.uniforms.uTime.value += delta * instance.params.speed;
      instance.orb.rotation.y += delta * instance.params.orbRotation;
      instance.orb.rotation.x += delta * (instance.params.orbRotation * 0.5);
      instance.orb.updateMatrixWorld();
      instance.localCam.copy(instance.camera.position);
      instance.orb.worldToLocal(instance.localCam);
      instance.uniforms.uLocalCamPos.value.copy(instance.localCam);

      sharedRenderer.setSize(instance.renderScale, instance.renderScale, false);
      sharedRenderer.render(instance.scene, instance.camera);
      instance.displayCtx.clearRect(
        0,
        0,
        instance.displayPixels,
        instance.displayPixels
      );
      instance.displayCtx.drawImage(
        sharedRenderer.domElement,
        0,
        0,
        instance.renderScale,
        instance.renderScale,
        0,
        0,
        instance.displayPixels,
        instance.displayPixels
      );
    });

    globalFrameId = globalThis.requestAnimationFrame(tick);
  }

  globalFrameId = globalThis.requestAnimationFrame(tick);
}

function stopGlobalLoopIfEmpty() {
  if (orbInstances.size === 0 && globalFrameId) {
    globalThis.cancelAnimationFrame(globalFrameId);
    globalFrameId = 0;
  }
}

function normalizeAvatarKey(value) {
  return decodeURIComponent(String(value || ""))
    .toLowerCase()
    .replace(/\./g, "_")
    .replace(/\s+/g, "_");
}

function isAssistantAvatarImage(img, assistantName, assistantAvatarId) {
  const alt = (img.getAttribute("alt") || "").toLowerCase();
  const src = normalizeAvatarKey(img.getAttribute("src") || "");
  const nameKey = normalizeAvatarKey(assistantName);
  const slugKey = normalizeAvatarKey(assistantAvatarId);

  if (alt.includes("avatar for") && alt.includes(assistantName.toLowerCase())) {
    return true;
  }

  return (
    src.includes("/avatars/" + nameKey) ||
    src.includes("/avatars/" + slugKey) ||
    src.includes("andrew_cohen_archive")
  );
}

function resolveAvatarSize(node, fallbackSize) {
  const style = globalThis.getComputedStyle(node);
  const styleWidth = parseFloat(style.width);
  if (styleWidth > 0) {
    return Math.round(styleWidth);
  }

  const bounds = node.getBoundingClientRect();
  if (bounds.width > 0) {
    return Math.round(bounds.width);
  }

  return fallbackSize || 32;
}

const DISPLAY_REFERENCE_SIZE = 160;

function computeSizeProfile(size) {
  const cssSize = Math.max(Math.round(size), 16);
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const displayPixels = Math.max(Math.round(cssSize * dpr), cssSize);
  const renderScale = Math.min(Math.max(Math.round(cssSize * 4), 112), 192);
  const ratio = Math.min(Math.max(cssSize / DISPLAY_REFERENCE_SIZE, 0.18), 1);
  const segments = cssSize <= 36 ? 48 : cssSize <= 64 ? 64 : cssSize <= 96 ? 96 : 128;

  return {
    cssSize,
    dpr,
    displayPixels,
    renderScale,
    ratio,
    segments,
    cameraDistance: 6 - (1 - ratio) * 1.35,
    fov: 45 + (1 - ratio) * 4,
  };
}

function adaptParamsForSize(params, profile) {
  const boost = 1 + (1 - profile.ratio) * 1.1;
  const glowBoost = 1 + (1 - profile.ratio) * 2.4;
  const edgeSoftness = 0.05 + (1 - profile.ratio) * 0.07;
  const brightness = 1 + (1 - profile.ratio) * 0.65;

  return {
    ...params,
    density: params.density * boost,
    atmosphereGlow: params.atmosphereGlow * glowBoost,
    atmosphereLevel: Math.min(params.atmosphereLevel + (1 - profile.ratio) * 0.08, 1),
    atmosphereScale: params.atmosphereScale + (profile.cssSize <= 40 ? 0.02 : 0),
    smoothness: params.smoothness * (profile.cssSize <= 40 ? 1.35 : 1),
    edgeSoftness,
    brightness,
  };
}

function configureDisplayContext(ctx) {
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = "high";
  }
}

export async function mountThreeOrb(container, size = 32, options = {}) {
  if (!container || size <= 0) {
    return function noop() {};
  }

  const THREE = await loadThree();
  const presetName = options.preset || "Default";
  const baseParams = { ...(PRESETS[presetName] || PRESETS.Default), ...options.params };
  const profile = computeSizeProfile(size);
  const params = adaptParamsForSize(baseParams, profile);

  await ensureSharedRenderer(THREE);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(profile.fov, 1, 0.1, 100);
  camera.position.set(0, 0, profile.cameraDistance);

  const displayCanvas = document.createElement("canvas");
  displayCanvas.className = "three-orb-avatar-canvas";
  displayCanvas.width = profile.displayPixels;
  displayCanvas.height = profile.displayPixels;
  displayCanvas.style.width = profile.cssSize + "px";
  displayCanvas.style.height = profile.cssSize + "px";
  displayCanvas.style.display = "block";
  displayCanvas.setAttribute("aria-hidden", "true");

  container.innerHTML = "";
  container.appendChild(displayCanvas);

  const displayCtx = displayCanvas.getContext("2d", { alpha: true });
  if (!displayCtx) {
    return function noop() {};
  }
  configureDisplayContext(displayCtx);

  const uniforms = {
    uTime: { value: 0 },
    uLocalCamPos: { value: new THREE.Vector3() },
    uPrimaryColor: { value: new THREE.Color(params.primaryEnergy) },
    uSecondaryColor: { value: new THREE.Color(params.secondaryEnergy) },
    uDensity: { value: params.density },
    uFractalIters: { value: params.fractalIters },
    uFractalScale: { value: params.fractalScale },
    uFractalDecay: { value: params.fractalDecay },
    uInternalAnim: { value: params.internalAnim },
    uSmoothness: { value: params.smoothness },
    uAsymmetry: { value: params.asymmetry },
    uAtmosphereGlow: { value: params.atmosphereGlow },
    uEdgeSoftness: { value: params.edgeSoftness },
    uBrightness: { value: params.brightness },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const atmosphereUniforms = {
    uColor: { value: new THREE.Color(params.primaryEnergy) },
    uGlow: { value: params.atmosphereGlow },
    uLevel: { value: params.atmosphereLevel },
  };

  const atmosphereMaterial = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    uniforms: atmosphereUniforms,
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const geometry = new THREE.SphereGeometry(2.0, profile.segments, profile.segments);
  const orb = new THREE.Mesh(geometry, material);
  scene.add(orb);

  const atmosphereMesh = new THREE.Mesh(geometry, atmosphereMaterial);
  atmosphereMesh.scale.set(
    params.atmosphereScale,
    params.atmosphereScale,
    params.atmosphereScale
  );
  orb.add(atmosphereMesh);

  const instance = {
    stopped: false,
    cssSize: profile.cssSize,
    displayPixels: profile.displayPixels,
    renderScale: profile.renderScale,
    params,
    scene,
    camera,
    orb,
    uniforms,
    clock: new THREE.Clock(),
    localCam: new THREE.Vector3(),
    displayCtx,
  };

  orbInstances.add(instance);
  startGlobalLoop();

  return function cleanup() {
    instance.stopped = true;
    orbInstances.delete(instance);
    geometry.dispose();
    material.dispose();
    atmosphereMaterial.dispose();
    stopGlobalLoopIfEmpty();
    if (displayCanvas.parentNode === container) {
      container.removeChild(displayCanvas);
    }
  };
}

function mountThreeOrbInAvatarSlot(node, size, preset) {
  if (!node || node.dataset.threeOrbAvatarMounted === "true") {
    return;
  }

  const avatarContainer =
    node.closest("span.rounded-full") ||
    node.closest('[class*="rounded-full"]') ||
    node.parentElement;

  if (!avatarContainer || avatarContainer.dataset.threeOrbAvatarMounted === "true") {
    return;
  }

  const resolvedSize = resolveAvatarSize(avatarContainer, size);
  avatarContainer.dataset.threeOrbAvatarMounted = "true";
  avatarContainer.innerHTML = "";
  avatarContainer.style.background = "transparent";
  avatarContainer.style.overflow = "hidden";
  avatarContainer.style.display = "inline-flex";
  avatarContainer.style.alignItems = "center";
  avatarContainer.style.justifyContent = "center";

  const host = document.createElement("div");
  host.className = "three-orb-avatar-host";
  host.style.width = resolvedSize + "px";
  host.style.height = resolvedSize + "px";
  host.style.flexShrink = "0";
  avatarContainer.appendChild(host);

  mountThreeOrb(host, resolvedSize, { preset }).catch(function (error) {
    console.warn("Three.js orb avatar failed to mount:", error);
  });
}

export function initAssistantAvatars(
  root,
  assistantName,
  assistantAvatarId,
  avatarSize,
  preset = "Default"
) {
  const scope = root || document;
  const seen = new Set();

  function mountIfAssistant(img) {
    if (!img || seen.has(img) || img.dataset.threeOrbAvatarMounted === "true") {
      return;
    }

    if (!isAssistantAvatarImage(img, assistantName, assistantAvatarId)) {
      return;
    }

    seen.add(img);
    mountThreeOrbInAvatarSlot(img, avatarSize, preset);
  }

  scope
    .querySelectorAll('img[alt*="Andrew Cohen Archive"]')
    .forEach(mountIfAssistant);
  scope.querySelectorAll("img").forEach(mountIfAssistant);
}
