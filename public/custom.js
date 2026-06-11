(function () {
  "use strict";

  const SOURCE_ACTION_PATTERN = /^Show sources \(|^Hide sources$/;
  const ASSISTANT_NAME = "Andrew Cohen Archive";
  const ASSISTANT_AVATAR_ID = "andrew_cohen_archive";
  const ASSISTANT_AVATAR_SIZE = 32;
  const START_ORB_SIZE = 160;

  const AVATAR_RENDERER = "three";
  const THREE_ORB_PRESET = "Default";
  const ORBS_ENABLED = false;

  const MODE_OPTIONS = [
    {
      id: "Archive Research",
      shortLabel: "Archive",
      title: "Andrew Cohen Archive",
      description:
        "Research assistant with citations from books, teachings, journal, transcripts, and dictionary entries.",
    },
    {
      id: "Andrew Alpha",
      shortLabel: "Alpha",
      title: "Alpha",
      description:
        "Alpha is an experimental AI that speaks in the first-person, a digital twin of Andrew's teaching voice derived from his writings and transcripts. Alpha will speak as Andrew while not claiming to be Andrew or any spiritual authority.",
    },
  ];

  let scanScheduled = false;
  let shadowObserver = null;
  let activeProfileName = MODE_OPTIONS[0].id;
  let chainlitSessionId = null;

  function readSessionIdFromCookie() {
    const match = document.cookie.match(/(?:^|;\s*)X-Chainlit-Session-id=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function currentProfileName() {
    return activeProfileName || MODE_OPTIONS[0].id;
  }

  function decorateOutboundMessage(message) {
    if (!message || typeof message !== "object") {
      return message;
    }

    const profileName = currentProfileName();
    const prefix = buildModeMessagePrefix();
    const content = typeof message.output === "string" ? message.output : "";
    const stripped = content.replace(MODE_MARKER_PATTERN, "");
    message.output = prefix + stripped;
    message.metadata = Object.assign({}, message.metadata || {}, {
      archive_profile: profileName,
    });
    return message;
  }

  function patchSocketIoPayload(data) {
    if (typeof data !== "string" || data.indexOf("client_message") === -1) {
      return data;
    }

    if (!data.startsWith("42")) {
      return data;
    }

    try {
      const parsed = JSON.parse(data.slice(2));
      if (!Array.isArray(parsed) || parsed[0] !== "client_message" || !parsed[1]) {
        return data;
      }

      parsed[1].message = decorateOutboundMessage(parsed[1].message);
      return "42" + JSON.stringify(parsed);
    } catch (_error) {
      return data;
    }
  }

  const PROFILE_TO_MODE = {
    "Archive Research": "archive",
    "Andrew Alpha": "andrew_alpha",
  };

  const PROFILE_TO_ACTION = {
    "Archive Research": "switch_mode_archive",
    "Andrew Alpha": "switch_mode_alpha",
  };

  const MODE_MARKER_ARCHIVE = "\u200B\u200C";
  const MODE_MARKER_ALPHA = "\u200B\u200D";
  const MODE_MARKER_PATTERN = /^\u200B(\u200C|\u200D)\s*/;

  function installSessionIdCapture() {
    if (window.__archiveSessionIdCapture) {
      return;
    }
    window.__archiveSessionIdCapture = true;

    chainlitSessionId = readSessionIdFromCookie();

    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      if (init && typeof init.body === "string") {
        try {
          const payload = JSON.parse(init.body);
          if (payload.sessionId) {
            chainlitSessionId = payload.sessionId;
          }
        } catch (_error) {
          // Ignore non-JSON bodies.
        }
      }
      return originalFetch(input, init);
    };

    if (!window.__archiveWebSocketCapture) {
      window.__archiveWebSocketCapture = true;
      const originalSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        if (typeof data === "string") {
          data = patchSocketIoPayload(data);
        }
        return originalSend.call(this, data);
      };
    }
  }

  function rootPath() {
    const meta = document.querySelector('meta[property="og:root_path"]');
    return meta && meta.getAttribute("content") ? meta.getAttribute("content") : "";
  }

  function moduleUrl(path) {
    return new URL(rootPath() + path, window.location.href).href;
  }

  function getScanRoots() {
    const roots = [document];
    if (window.cl_shadowRootElement) {
      roots.push(window.cl_shadowRootElement);
    }
    return roots;
  }

  function forEachRoot(callback) {
    getScanRoots().forEach(callback);
  }

  function scheduleScan() {
    if (scanScheduled) {
      return;
    }
    scanScheduled = true;
    window.requestAnimationFrame(function () {
      scanScheduled = false;
      scanAll();
    });
  }

  function installCustomScrollbarStylesInShadow(shadow) {
    if (!shadow || shadow.querySelector("#archive-scrollbar-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "archive-scrollbar-styles";
    style.textContent =
      "*{scrollbar-width:thin;scrollbar-color:hsl(var(--muted-foreground)/0.32) transparent;}" +
      "*::-webkit-scrollbar{height:6px;width:6px;}" +
      "*::-webkit-scrollbar-track{background:transparent;}" +
      "*::-webkit-scrollbar-thumb{background-color:hsl(var(--muted-foreground)/0.32);border:2px solid transparent;border-radius:9999px;background-clip:padding-box;}" +
      "*::-webkit-scrollbar-thumb:hover{background-color:hsl(var(--muted-foreground)/0.5);}" +
      "*::-webkit-scrollbar-corner{background:transparent;}";
    shadow.insertBefore(style, shadow.firstChild);
  }

  function ensureShadowObserver() {
    const shadow = window.cl_shadowRootElement;
    if (!shadow) {
      return;
    }

    installCustomScrollbarStylesInShadow(shadow);
    installModeToggleDelegationOnRoot(shadow);
    installOutboundModeHookOnRoot(shadow);

    if (shadowObserver) {
      return;
    }

    shadowObserver = new MutationObserver(scheduleScan);
    shadowObserver.observe(shadow, {
      childList: true,
      subtree: true,
    });
  }

  function styleSourceLinks(root) {
    root.querySelectorAll("button").forEach(function (button) {
      const label = (button.textContent || "").trim();
      if (SOURCE_ACTION_PATTERN.test(label)) {
        button.classList.add("archive-source-link");
      }
    });
  }

  function initAssistantOrbAvatars(root) {
    if (!ORBS_ENABLED || !window.ArchiveOrbAvatar) {
      return;
    }

    if (AVATAR_RENDERER === "three") {
      window.ArchiveOrbAvatar.initAssistantAvatars(
        root,
        ASSISTANT_NAME,
        ASSISTANT_AVATAR_ID,
        ASSISTANT_AVATAR_SIZE,
        THREE_ORB_PRESET
      );
      return;
    }

    window.ArchiveOrbAvatar.initAssistantAvatars(
      root,
      ASSISTANT_NAME,
      ASSISTANT_AVATAR_ID,
      ASSISTANT_AVATAR_SIZE
    );
  }

  function getModeMeta(profileName) {
    return (
      MODE_OPTIONS.find(function (option) {
        return option.id === profileName;
      }) || MODE_OPTIONS[0]
    );
  }

  function readActiveProfile(root) {
    if (activeProfileName) {
      return activeProfileName;
    }

    const trigger = root.querySelector("#chat-profiles");
    if (!trigger) {
      return MODE_OPTIONS[0].id;
    }

    const value = (trigger.textContent || "").trim();
    const match = MODE_OPTIONS.find(function (option) {
      return value.indexOf(option.id) !== -1;
    });
    activeProfileName = match ? match.id : MODE_OPTIONS[0].id;
    return activeProfileName;
  }

  function activeModeKey() {
    return PROFILE_TO_MODE[activeProfileName || MODE_OPTIONS[0].id] || "archive";
  }

  function buildModeMessagePrefix() {
    return activeModeKey() === "andrew_alpha"
      ? MODE_MARKER_ALPHA
      : MODE_MARKER_ARCHIVE;
  }

  function injectModeIntoComposerInput() {
    const profileName = currentProfileName();
    activeProfileName = profileName;
    ensureServerModeBeforeSend();

    forEachRoot(function (root) {
      const input = root.querySelector("#chat-input");
      if (!input) {
        return;
      }

      const textarea =
        input.tagName === "TEXTAREA"
          ? input
          : input.querySelector("textarea,[contenteditable='true']");
      if (!textarea) {
        return;
      }

      const prefix = buildModeMessagePrefix();
      const currentValue =
        textarea.tagName === "TEXTAREA"
          ? textarea.value
          : textarea.textContent || "";
      const stripped = currentValue.replace(MODE_MARKER_PATTERN, "");
      const nextValue = prefix + stripped;

      if (textarea.tagName === "TEXTAREA") {
        textarea.value = nextValue;
      } else {
        textarea.textContent = nextValue;
      }

      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function ensureServerModeBeforeSend() {
    const profileName = currentProfileName();
    persistModeSelection(profileName).catch(function () {
      // Best-effort sync before each send.
    });
  }

  function persistModeSelection(profileName) {
    const actionName = PROFILE_TO_ACTION[profileName];
    const requests = [
      window.fetch(rootPath() + "/archive/set-mode", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: profileName }),
      }),
    ];

    if (actionName && chainlitSessionId) {
      requests.push(
        window.fetch(rootPath() + "/project/action", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: chainlitSessionId,
            action: {
              name: actionName,
              payload: {},
              label: actionName,
            },
          }),
        })
      );
    }

    return Promise.allSettled(requests).then(function (results) {
      const httpResult = results[0];
      if (httpResult.status === "fulfilled" && httpResult.value.ok) {
        return httpResult.value.json();
      }
      const actionResult = results[1];
      if (
        actionResult &&
        actionResult.status === "fulfilled" &&
        actionResult.value.ok
      ) {
        return actionResult.value.json();
      }
      throw new Error("Mode switch failed");
    });
  }

  function selectProfile(profileName) {
    if (activeProfileName === profileName) {
      return;
    }

    activeProfileName = profileName;
    forEachRoot(updateModeToggleState);

    persistModeSelection(profileName)
      .then(function (data) {
        if (data && data.sessionId) {
          chainlitSessionId = data.sessionId;
        }
      })
      .catch(function (error) {
        console.warn("Mode switch persist failed:", error);
      });
  }

  function handleModeToggleClick(event) {
    const button = event.target.closest(".archive-mode-toggle-button");
    if (!button || !button.dataset.profile) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectProfile(button.dataset.profile);
  }

  function installModeToggleDelegation() {
    if (window.__archiveToggleDelegation) {
      return;
    }
    window.__archiveToggleDelegation = true;

    document.addEventListener("click", handleModeToggleClick, true);
  }

  function installModeToggleDelegationOnRoot(root) {
    if (!root || root.__archiveToggleDelegation) {
      return;
    }
    root.__archiveToggleDelegation = true;
    root.addEventListener("click", handleModeToggleClick, true);
  }

  function installOutboundModeHook() {
    if (window.__archiveOutboundModeHook) {
      return;
    }
    window.__archiveOutboundModeHook = true;

    function handleSubmitIntent(event) {
      if (event.target.closest("#chat-submit")) {
        injectModeIntoComposerInput();
      }
    }

    function handleEnterIntent(event) {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      if (!event.target.closest("#chat-input")) {
        return;
      }
      injectModeIntoComposerInput();
    }

    function handleStarterIntent(event) {
      const starter = event.target.closest("[data-test^='starter:'], button");
      if (!starter || !starter.closest("#welcome-screen")) {
        return;
      }
      const label = (starter.textContent || "").trim();
      if (!label) {
        return;
      }
      injectModeIntoComposerInput();
    }

    document.addEventListener("click", handleSubmitIntent, true);
    document.addEventListener("keydown", handleEnterIntent, true);
    document.addEventListener("click", handleStarterIntent, true);

    installOutboundModeHookOnRoot(document);
  }

  function installOutboundModeHookOnRoot(root) {
    if (!root || root.__archiveOutboundModeHook) {
      return;
    }
    root.__archiveOutboundModeHook = true;

    root.addEventListener(
      "click",
      function (event) {
        if (event.target.closest("#chat-submit")) {
          injectModeIntoComposerInput();
        }
        const starter = event.target.closest("[data-test^='starter:'], button");
        if (starter && starter.closest("#welcome-screen")) {
          injectModeIntoComposerInput();
        }
      },
      true
    );

    root.addEventListener(
      "keydown",
      function (event) {
        if (event.key !== "Enter" || event.shiftKey) {
          return;
        }
        if (event.target.closest("#chat-input")) {
          injectModeIntoComposerInput();
        }
      },
      true
    );
  }

  function bootstrapArchiveSession() {
    window
      .fetch(rootPath() + "/archive/session", { credentials: "include" })
      .then(function (response) {
        if (!response.ok) {
          return null;
        }
        return response.json();
      })
      .then(function (data) {
        if (!data) {
          return;
        }
        if (data.sessionId) {
          chainlitSessionId = data.sessionId;
        } else {
          chainlitSessionId = readSessionIdFromCookie() || chainlitSessionId;
        }
        if (data.profile) {
          activeProfileName = data.profile;
          forEachRoot(updateModeToggleState);
        }
      })
      .catch(function () {
        // Session bootstrap is best-effort.
      });
  }

  function bindModeToggleButtons(toggle) {
    toggle.querySelectorAll(".archive-mode-toggle-button").forEach(function (button) {
      if (button.dataset.archiveClickBound === "true") {
        return;
      }
      button.dataset.archiveClickBound = "true";
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (button.dataset.profile) {
          selectProfile(button.dataset.profile);
        }
      });
    });
  }

  function buildModeToggle() {
    const toggle = document.createElement("div");
    toggle.className = "archive-mode-toggle";
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", "Response mode");

    MODE_OPTIONS.forEach(function (option) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "archive-mode-toggle-button";
      button.dataset.profile = option.id;
      button.textContent = option.shortLabel;
      button.title = option.id;
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        selectProfile(option.id);
      });
      toggle.appendChild(button);
    });

    return toggle;
  }

  function removeLegacyModeToggle(composer) {
    const legacy = composer.nextElementSibling;
    if (legacy && legacy.classList.contains("archive-mode-toggle")) {
      legacy.remove();
    }
  }

  function ensureModeToggleInComposer(composer) {
    if (!composer) {
      return;
    }

    removeLegacyModeToggle(composer);

    const submit = composer.querySelector("#chat-submit");
    if (!submit) {
      return;
    }

    const actionRow = submit.parentElement;
    if (!actionRow) {
      return;
    }

    let toggle = actionRow.querySelector(".archive-mode-toggle");
    if (!toggle) {
      toggle = buildModeToggle();
      actionRow.insertBefore(toggle, submit);
    }

    bindModeToggleButtons(toggle);
    composer.dataset.archiveToggleMounted = "true";
  }

  function updateModeToggleState(root) {
    const activeProfile = readActiveProfile(root);
    root.querySelectorAll(".archive-mode-toggle-button").forEach(function (button) {
      const isActive = button.dataset.profile === activeProfile;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    const meta = getModeMeta(activeProfile);
    root.querySelectorAll(".archive-start-title").forEach(function (title) {
      title.textContent = meta.title;
    });
    root.querySelectorAll(".archive-start-description").forEach(function (copy) {
      copy.textContent = meta.description;
    });
  }

  function hideDefaultWelcomeHeader(welcome) {
    welcome.querySelectorAll("img.rounded-full").forEach(function (img) {
      const block = img.closest(".flex.flex-col");
      if (block) {
        block.classList.add("archive-welcome-default-hidden");
      }
    });

    welcome.querySelectorAll("svg").forEach(function (svg) {
      const block = svg.closest(".mb-2");
      if (block) {
        block.classList.add("archive-welcome-default-hidden");
      }
    });
  }

  function setupWelcomeHero(root) {
    const welcome = root.querySelector("#welcome-screen");
    if (!welcome) {
      return;
    }

    hideDefaultWelcomeHeader(welcome);

    let hero = welcome.querySelector(".archive-start-hero");
    if (!hero) {
      hero = document.createElement("div");
      hero.className = "archive-start-hero";
      hero.innerHTML = ORBS_ENABLED
        ? '<div class="archive-start-orb-host" aria-hidden="true"></div>' +
          '<h1 class="archive-start-title"></h1>' +
          '<p class="archive-start-description"></p>'
        : '<h1 class="archive-start-title"></h1>' +
          '<p class="archive-start-description"></p>';
      welcome.insertBefore(hero, welcome.firstChild);
    }

    const orbHost = hero.querySelector(".archive-start-orb-host");
    if (orbHost) {
      orbHost.hidden = !ORBS_ENABLED;
    }

    if (
      ORBS_ENABLED &&
      orbHost &&
      window.ArchiveThreeOrbAvatar &&
      orbHost.dataset.startOrbMounted !== "true"
    ) {
      orbHost.dataset.startOrbMounted = "pending";
      window.ArchiveThreeOrbAvatar.mountThreeOrb(orbHost, START_ORB_SIZE, {
        preset: THREE_ORB_PRESET,
      })
        .then(function () {
          orbHost.dataset.startOrbMounted = "true";
        })
        .catch(function (error) {
          console.warn("Start page orb failed to mount:", error);
          orbHost.dataset.startOrbMounted = "false";
        });
    }

    const composer = welcome.querySelector("#message-composer");
    if (composer) {
      ensureModeToggleInComposer(composer);
    }

    updateModeToggleState(root);
  }

  function setupComposerLayout(root) {
    root.querySelectorAll("#message-composer").forEach(ensureModeToggleInComposer);
    root.querySelectorAll("#chat-profiles").forEach(function (trigger) {
      const wrapper = trigger.closest(".relative");
      if (wrapper) {
        wrapper.classList.add("archive-native-profile-picker");
      }
    });
    updateModeToggleState(root);
  }

  function scanAll() {
    ensureShadowObserver();
    forEachRoot(function (root) {
      styleSourceLinks(root);
      initAssistantOrbAvatars(root);
      setupWelcomeHero(root);
      setupComposerLayout(root);
    });
  }

  function loadCanvasOrbModule(callback) {
    if (window.ArchiveOrbAvatar && AVATAR_RENDERER === "canvas") {
      callback();
      return;
    }

    const script = document.createElement("script");
    script.src = rootPath() + "/public/components/orb-avatar.js";
    script.onload = callback;
    script.onerror = function () {
      console.warn("Failed to load canvas orb avatar component.");
      callback();
    };
    document.head.appendChild(script);
  }

  function loadThreeOrbModule(callback) {
    if (window.ArchiveThreeOrbAvatar) {
      window.ArchiveOrbAvatar = window.ArchiveThreeOrbAvatar;
      callback();
      return;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.textContent =
      'import * as threeOrb from "' +
      moduleUrl("/public/components/orb-avatar-three.js") +
      '"; window.ArchiveThreeOrbAvatar = threeOrb; window.ArchiveOrbAvatar = threeOrb; window.dispatchEvent(new Event("archive-three-orb-ready"));';
    script.onerror = function () {
      console.warn("Failed to load Three.js orb avatar module.");
      callback();
    };
    window.addEventListener("archive-three-orb-ready", callback, { once: true });
    document.head.appendChild(script);
  }

  function loadOrbModule(callback) {
    if (!ORBS_ENABLED) {
      callback();
      return;
    }
    if (AVATAR_RENDERER === "three") {
      loadThreeOrbModule(callback);
      return;
    }
    loadCanvasOrbModule(callback);
  }

  function start() {
    installSessionIdCapture();
    installOutboundModeHook();
    installModeToggleDelegation();
    bootstrapArchiveSession();
    loadOrbModule(function () {
      scanAll();

      const observer = new MutationObserver(scheduleScan);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      ensureShadowObserver();

      let polls = 0;
      const poll = window.setInterval(function () {
        polls += 1;
        ensureShadowObserver();
        scanAll();
        if (polls >= 40 || window.cl_shadowRootElement) {
          window.clearInterval(poll);
        }
      }, 250);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
