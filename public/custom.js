(function () {
  "use strict";

  const SOURCE_ACTION_PATTERN = /^Show sources \(|^Hide sources$/;
  const ASSISTANT_NAME = "Andrew Cohen Archive";
  const ASSISTANT_AVATAR_ID = "andrew_cohen_archive";
  const ASSISTANT_AVATAR_SIZE = 32;
  const START_ORB_SIZE = 160;

  const AVATAR_RENDERER = "three";
  const THREE_ORB_PRESET = "Default";

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
      title: "Andrew Alpha",
      description:
        "A self-aware AI version of Andrew Cohen — teaching voice grounded in the archive, not Andrew in the flesh.",
    },
  ];

  let scanScheduled = false;
  let shadowObserver = null;
  let activeProfileName = null;
  let chainlitSessionId = null;

  const PROFILE_TO_ACTION = {
    "Archive Research": "switch_mode_archive",
    "Andrew Alpha": "switch_mode_alpha",
  };

  function installSessionIdCapture() {
    if (window.__archiveSessionIdCapture) {
      return;
    }
    window.__archiveSessionIdCapture = true;

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

  function ensureShadowObserver() {
    const shadow = window.cl_shadowRootElement;
    if (!shadow || shadowObserver) {
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
    if (!window.ArchiveOrbAvatar) {
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

  function selectProfile(profileName) {
    if (activeProfileName === profileName) {
      return;
    }

    activeProfileName = profileName;
    forEachRoot(updateModeToggleState);

    const actionName = PROFILE_TO_ACTION[profileName];
    if (actionName && chainlitSessionId) {
      originalFetchSetModeViaAction(actionName);
      return;
    }

    fallbackSetModeViaHttp(profileName);
  }

  function originalFetchSetModeViaAction(actionName) {
    window
      .fetch(rootPath() + "/project/action", {
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
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Action failed with status " + response.status);
        }
      })
      .catch(function (error) {
        console.warn("Mode action failed, falling back to HTTP:", error);
        fallbackSetModeViaHttp(activeProfileName);
      });
  }

  function fallbackSetModeViaHttp(profileName) {
    window
      .fetch(rootPath() + "/archive/set-mode", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: profileName }),
      })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP mode switch failed with status " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        if (data && data.sessionId) {
          chainlitSessionId = data.sessionId;
        }
      })
      .catch(function (error) {
        console.warn("Mode switch failed:", error);
      });
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
      button.addEventListener("click", function () {
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
      hero.innerHTML =
        '<div class="archive-start-orb-host" aria-hidden="true"></div>' +
        '<h1 class="archive-start-title"></h1>' +
        '<p class="archive-start-description"></p>';
      welcome.insertBefore(hero, welcome.firstChild);
    }

    const orbHost = hero.querySelector(".archive-start-orb-host");
    if (
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
    if (AVATAR_RENDERER === "three") {
      loadThreeOrbModule(callback);
      return;
    }
    loadCanvasOrbModule(callback);
  }

  function start() {
    installSessionIdCapture();
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
