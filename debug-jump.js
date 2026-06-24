/*
 * Scene-jump debug helper for PowerUp Bots.
 *
 * Drop this file next to index.html, then add the following line just before
 * </body> in index.html (or paste the contents into the console):
 *
 *   <script src="debug-jump.js"></script>
 *
 * Keyboard shortcuts (active once the game has loaded):
 *   0..9            jump to round 0..9 at the current target scene
 *   q  ............  jump to round 10
 *   w  ............  jump to round 11 (if it exists)
 *   [  /  ]         previous / next round, same target scene
 *   { / }           previous / next scene in FLOW (for any round)
 *   Esc            toggle the floating panel
 *   Ctrl/⌘ + D     toggle the floating panel
 *
 * The "Last two flows" (45° and 135° circle-diagonal cuts) live at rounds 9
 * and 10 — press `9` or `0` (round 10 is mapped to `q` because `0` is round 0).
 *
 * Wait — read carefully: keyboard map
 *   key '9'  → round 9  → circle-diagonal 45° (slash)
 *   key 'q'  → round 10 → circle-diagonal 135° (backslash)
 *
 * The default target scene is "laser" (the actual cutting screen). Switch the
 * dropdown in the panel to jump to slotInstruct, cutInstruct, etc. instead.
 */
(function () {
  "use strict";

  // Gate: only active when the page is opened with ?debug (e.g. ?debug=1).
  // Accepts ?debug, ?debug=1, ?debug=true, and the same in the hash.
  function debugEnabled() {
    try {
      var q = (window.location.search || "") + "&" + (window.location.hash || "");
      var m = /[?&#]debug(?:=([^&#]*))?/i.exec(q);
      if (!m) { return false; }
      var v = (m[1] || "1").toLowerCase();
      return v !== "0" && v !== "false" && v !== "no";
    } catch (e) { return false; }
  }
  if (!debugEnabled()) { return; }
  console.log("[debug-jump] enabled (?debug). Waiting for game to load…");

  var TARGET_SCENES = [
    "laser",         // the cutting gameplay
    "cutInstruct",   // "Cut the block into two equal parts."
    "slotInstruct",  // "Make sure both parts fit into the slots."
    "preplay",       // Ira walk-in screen
    "tutorial",      // first-round-only tutorial
    "halves",        // "So, we need to cut the block into two equal parts."
    "laserIntro",    // "Use the laser to cut the block."
    "needs",         // "Each bot needs a part of the energy block."
    "whole",         // "Here is one whole energy block."
    "moveOut",       // bots slide outward
    "plugReady",     // "The bots are ready to get charged."
    "plug",          // plug animation
    "intro",         // "Let us charge the bots."
    "play"           // start screen
  ];

  function ready(cb) {
    if (window.state && window.FLOW && window.ROUNDS && typeof window.renderStep === "function") {
      cb();
    } else {
      setTimeout(function () { ready(cb); }, 100);
    }
  }

  function findStep(sceneName) {
    for (var i = 0; i < window.FLOW.length; i++) {
      if (window.FLOW[i].scene === sceneName) return i;
    }
    return -1;
  }

  function quiet() {
    // Reset transient audio/animation state so the jump is clean.
    try { if (window.setInstruction) window.setInstruction("", { forceAudioStop: true }); } catch (e) {}
    try { if (window.stopInstructionAudio) window.stopInstructionAudio(true); } catch (e) {}
    try { if (window.clearTimers) window.clearTimers(); } catch (e) {}
    try {
      if (window._themeAudio && typeof window.THEME_BASE_VOLUME === "number") {
        window._themeAudio.volume = window.THEME_BASE_VOLUME;
      }
    } catch (e) {}
  }

  function jumpTo(roundIdx, sceneName) {
    var s = window.state;
    var r = window.ROUNDS[roundIdx];
    if (!r) {
      console.warn("[debug-jump] No round at index " + roundIdx);
      return;
    }
    var step = findStep(sceneName);
    if (step < 0) {
      console.warn("[debug-jump] Scene '" + sceneName + "' not found");
      return;
    }
    quiet();
    s.round = roundIdx;
    s.step = step;
    s.locked = false;
    s.tutActive = false;
    s.teachingActive = false;
    s.nextAction = null;
    window.renderStep();
    var name = (r.label || r.name) + (r.variant ? " · " + r.variant : "");
    console.log("[debug-jump] → round " + roundIdx + " (" + name + ") @ " + sceneName);
  }

  // Map keys to round indices. 0-9 → rounds 0-9, then q/w for 10/11.
  var KEY_TO_ROUND = {};
  for (var i = 0; i <= 9; i++) KEY_TO_ROUND[String(i)] = i;
  KEY_TO_ROUND["q"] = 10;
  KEY_TO_ROUND["w"] = 11;

  ready(function () {
    var ROUNDS = window.ROUNDS;
    var FLOW = window.FLOW;

    // ── Build the floating panel ────────────────────────────────────────────
    var panel = document.createElement("div");
    panel.id = "debugJumpPanel";
    panel.style.cssText = [
      "position:fixed",
      "top:8px",
      "right:8px",
      "z-index:2147483647",
      "background:rgba(20,30,55,.92)",
      "color:#fff",
      "font:11px/1.45 -apple-system,Segoe UI,Roboto,sans-serif",
      "padding:8px 10px",
      "border-radius:8px",
      "max-width:260px",
      "box-shadow:0 6px 24px rgba(0,0,0,.4)",
      "user-select:none",
      "backdrop-filter:blur(6px)"
    ].join(";");

    var sceneOptions = TARGET_SCENES.map(function (s) {
      return '<option value="' + s + '">' + s + "</option>";
    }).join("");

    var roundButtons = ROUNDS.map(function (r, idx) {
      var label = r.label || r.name;
      if (r.variant) label += " · " + r.variant;
      // Note in label which key hits this round
      var keyHint = "";
      Object.keys(KEY_TO_ROUND).forEach(function (k) {
        if (KEY_TO_ROUND[k] === idx) keyHint = k;
      });
      return (
        '<button class="dbgBtn" data-idx="' + idx + '" ' +
        'style="display:flex;justify-content:space-between;width:100%;' +
        'margin:2px 0;padding:4px 6px;background:#2a4378;color:#fff;' +
        "border:0;border-radius:4px;cursor:pointer;font:inherit;text-align:left\">" +
        "<span>" + idx + " — " + label + "</span>" +
        (keyHint ? '<span style="opacity:.65;margin-left:8px">[' + keyHint + "]</span>" : "") +
        "</button>"
      );
    }).join("");

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;font-weight:700;margin-bottom:6px">' +
        '<span>🐛 Scene Jump</span>' +
        '<button id="dbgClose" style="background:transparent;border:0;color:#fff;cursor:pointer;font-size:14px;padding:0 4px">✕</button>' +
      "</div>" +
      '<label style="display:block;margin-bottom:6px">' +
        'Target scene: <select id="dbgScene" style="width:100%;margin-top:2px;background:#1a2848;color:#fff;border:1px solid #3b5694;border-radius:4px;padding:3px;font:inherit">' +
          sceneOptions +
        "</select>" +
      "</label>" +
      '<div style="max-height:320px;overflow:auto">' + roundButtons + "</div>" +
      '<div style="margin-top:8px;color:#aab;font-size:10px;line-height:1.4">' +
        "Shortcuts: 0–9 / q / w jump rounds<br>" +
        "[ ] = prev/next round · { } = prev/next scene<br>" +
        "Esc or ⌘D toggles this panel" +
      "</div>";

    document.body.appendChild(panel);

    var sceneSelect = panel.querySelector("#dbgScene");
    sceneSelect.value = "laser";

    panel.querySelector("#dbgClose").addEventListener("click", function () {
      panel.style.display = "none";
    });

    panel.querySelectorAll(".dbgBtn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        jumpTo(parseInt(btn.dataset.idx, 10), sceneSelect.value);
      });
    });

    function togglePanel() {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    }

    // ── Keyboard shortcuts ──────────────────────────────────────────────────
    document.addEventListener("keydown", function (e) {
      var tag = (e.target && e.target.tagName) || "";
      // Don't hijack typing in form controls
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;

      var key = e.key;
      var lower = key.toLowerCase();

      if (key === "Escape" || ((e.ctrlKey || e.metaKey) && lower === "d")) {
        e.preventDefault();
        togglePanel();
        return;
      }

      if (lower === "[" || lower === "]") {
        e.preventDefault();
        var delta = lower === "]" ? 1 : -1;
        var next = Math.max(0, Math.min(window.ROUNDS.length - 1, (window.state.round || 0) + delta));
        jumpTo(next, sceneSelect.value);
        return;
      }

      if (lower === "{" || lower === "}") {
        e.preventDefault();
        var idx = TARGET_SCENES.indexOf(sceneSelect.value);
        if (idx < 0) idx = 0;
        idx = (idx + (lower === "}" ? 1 : -1) + TARGET_SCENES.length) % TARGET_SCENES.length;
        sceneSelect.value = TARGET_SCENES[idx];
        jumpTo(window.state.round || 0, sceneSelect.value);
        return;
      }

      if (Object.prototype.hasOwnProperty.call(KEY_TO_ROUND, lower)) {
        var roundIdx = KEY_TO_ROUND[lower];
        if (roundIdx < window.ROUNDS.length) {
          e.preventDefault();
          jumpTo(roundIdx, sceneSelect.value);
        }
      }
    });

    // Expose programmatic access for the console.
    window.debugJump = jumpTo;
    console.log(
      "[debug-jump] Ready. Press 9 → circle-diagonal slash, q → circle-diagonal backslash. " +
      "Open the panel any time with Esc or " + (navigator.platform.indexOf("Mac") >= 0 ? "⌘" : "Ctrl") + "+D."
    );
  });
})();
