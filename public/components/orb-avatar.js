(function (global) {
  "use strict";

  const DEFAULT_MAX = 80;
  const DEFAULT_START_COUNT = 150;

  function buildPointRing(max) {
    const points = [];
    let angle = 0;
    const step = (Math.PI * 2) / max;

    for (let index = 0; index < max; index += 1) {
      points.push([Math.cos(angle), Math.sin(angle), 0]);
      angle += step;
    }

    for (let index = 0; index < max; index += 1) {
      points.push([0, points[index][0], points[index][1]]);
    }

    for (let index = 0; index < max; index += 1) {
      points.push([points[index][1], 0, points[index][0]]);
    }

    return points;
  }

  function mount(canvas, size, options) {
    if (!canvas || size <= 0) {
      return function noop() {};
    }

    const settings = options || {};
    const max = settings.max || DEFAULT_MAX;
    const points = buildPointRing(max);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return function noop() {};
    }

    canvas.width = size;
    canvas.height = size;

    const center = size / 2;
    const scaleBase = size * 0.3;
    const lineScale = Math.max(size / 400, 0.04);
    let count = settings.startCount || DEFAULT_START_COUNT;
    let frameId = 0;
    let stopped = false;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);

    function render() {
      if (stopped) {
        return;
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0,0,0,0.03)";
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = "lighter";

      let time = count / 5;

      for (let layer = 0; layer < 3; layer += 1) {
        time *= 1.7;
        const depth = 1 - layer / 3;

        let angle = time / 59;
        const yPlane = Math.cos(angle);
        const yPlane2 = Math.sin(angle);

        angle = time / 23;
        const xPlane = Math.cos(angle);
        const xPlane2 = Math.sin(angle);

        const projected = [];

        for (let index = 0; index < points.length; index += 1) {
          let x = points[index][0];
          let y = points[index][1];
          let z = points[index][2];

          const yRot = y * yPlane + z * yPlane2;
          const zRot = y * yPlane2 - z * yPlane;
          const xRot = x * xPlane + zRot * xPlane2;
          z = x * xPlane2 - zRot * xPlane;

          const depthScale = Math.pow(2, z * depth);
          projected.push([xRot * depthScale, yRot * depthScale, z]);
        }

        const ringScale = depth * scaleBase;

        for (let ring = 0; ring < 3; ring += 1) {
          for (let index = 0; index < max; index += 1) {
            const start = projected[ring * max + index];
            const end = projected[((index + 1) % max) + ring * max];

            ctx.beginPath();
            ctx.strokeStyle =
              "hsla(" + (((index / max) * 360) | 0) + ",70%,60%,0.15)";
            ctx.lineWidth = Math.pow(6, start[2]) * lineScale;
            ctx.moveTo(
              start[0] * ringScale + center,
              start[1] * ringScale + center
            );
            ctx.lineTo(end[0] * ringScale + center, end[1] * ringScale + center);
            ctx.stroke();
          }
        }
      }

      count += 1;
      frameId = global.requestAnimationFrame(render);
    }

    frameId = global.requestAnimationFrame(render);

    return function cleanup() {
      stopped = true;
      global.cancelAnimationFrame(frameId);
    };
  }

  function createCanvas(size) {
    const canvas = document.createElement("canvas");
    canvas.className = "orb-avatar-canvas";
    canvas.width = size;
    canvas.height = size;
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
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

    if (
      src.includes("/avatars/" + nameKey) ||
      src.includes("/avatars/" + slugKey) ||
      src.includes("andrew_cohen_archive")
    ) {
      return true;
    }

    return false;
  }

  function resolveAvatarSize(node, fallbackSize) {
    const style = global.getComputedStyle(node);
    const styleWidth = parseFloat(style.width);
    if (styleWidth > 0) {
      return Math.round(styleWidth);
    }

    const bounds = node.getBoundingClientRect();
    if (bounds.width > 0) {
      return Math.round(bounds.width);
    }

    const parent = node.parentElement;
    if (parent) {
      const parentStyle = global.getComputedStyle(parent);
      const parentWidth = parseFloat(parentStyle.width);
      if (parentWidth > 0) {
        return Math.round(parentWidth);
      }
    }

    return fallbackSize || 32;
  }

  function mountOrbInAvatarSlot(node, size) {
    if (!node || node.dataset.orbAvatarMounted === "true") {
      return;
    }

    const avatarContainer =
      node.closest("span.rounded-full") ||
      node.closest('[class*="rounded-full"]') ||
      node.parentElement;

    if (!avatarContainer || avatarContainer.dataset.orbAvatarMounted === "true") {
      return;
    }

    const resolvedSize = resolveAvatarSize(avatarContainer, size);
    const canvas = createCanvas(resolvedSize);

    avatarContainer.dataset.orbAvatarMounted = "true";
    avatarContainer.innerHTML = "";
    avatarContainer.style.background = "#000";
    avatarContainer.style.overflow = "hidden";
    avatarContainer.style.display = "inline-flex";
    avatarContainer.style.alignItems = "center";
    avatarContainer.style.justifyContent = "center";
    avatarContainer.appendChild(canvas);
    mount(canvas, resolvedSize);
  }

  function initAssistantAvatars(root, assistantName, assistantAvatarId, avatarSize) {
    const scope = root || document;
    const seen = new Set();

    function mountIfAssistant(img) {
      if (!img || seen.has(img) || img.dataset.orbAvatarMounted === "true") {
        return;
      }

      if (!isAssistantAvatarImage(img, assistantName, assistantAvatarId)) {
        return;
      }

      seen.add(img);
      mountOrbInAvatarSlot(img, avatarSize);
    }

    scope
      .querySelectorAll('img[alt*="Andrew Cohen Archive"]')
      .forEach(mountIfAssistant);

    scope.querySelectorAll("img").forEach(mountIfAssistant);
  }

  global.ArchiveOrbAvatar = {
    mount: mount,
    mountOrbInAvatarSlot: mountOrbInAvatarSlot,
    initAssistantAvatars: initAssistantAvatars,
  };
})(window);
