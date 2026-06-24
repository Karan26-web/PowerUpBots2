/*
 * Fit-tuning debug helper for PowerUp Bots.
 *
 * Lets you visually seat the two cut pieces into the pod hollows for the
 * CURRENT round, then MOVE and RESIZE each piece until it fits perfectly.
 * Every adjustment writes straight back to the round's fit keys
 * (slotSize / slotOffset / slotXOffset / visualFitScale / fitPieceScale),
 * so the exported JSON drops directly into the ROUNDS entry.
 *
 * Load it after debug-jump.js:
 *     <script src="debug-fit.js"></script>
 *
 * Workflow:
 *   1. Use the Scene-Jump panel (or 0-9 / q / w) to pick a round.
 *   2. Press  F  (or click "Seat pieces") to render the seated/charged state.
 *   3. Drag a piece to move it. Drag its corner handle to resize it.
 *      Or use the steppers / arrow keys (with a side selected).
 *   4. Click "Copy JSON" and paste it back to Claude.
 *
 * Keys (ignored while typing in a field):
 *   F            seat pieces for the current round + open this panel
 *   G            toggle this panel
 *   L / R / B    select Left / Right / Both pieces for stepper + arrow nudges
 *   ← → ↑ ↓      nudge selected piece position by 1px (Shift = 5px)
 *
 * It never changes game logic — it only mutates the live ROUNDS[i] fit keys
 * and re-renders the seated state.
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
  console.log("[debug-fit] enabled (?debug). Waiting for game to load…");

  function ready(cb) {
    if (window.state && window.ROUNDS && window.els &&
        typeof window.fillSlotWithPiece === "function" &&
        typeof window.switchBotsToHappy === "function" &&
        typeof window.setupBots === "function") {
      cb();
    } else {
      setTimeout(function () { ready(cb); }, 120);
    }
  }

  ready(function () {
    var ROUNDS = window.ROUNDS;
    var els = window.els;
    var state = window.state;

    var MODELS = {};       // per-round working model, keyed by round index
    var activeSide = "B";  // "L" | "R" | "B"
    var seated = false;    // are pieces currently seated/charged?
    var seatBase = {};     // captured fill top/marginLeft at seat time, per side

    // ── helpers to read the round's current effective fit values ─────────────
    function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }

    function readPair(o) {
      return { x: num(o && o.x, 1), y: num(o && o.y, 1) };
    }

    function readFit(r) {
      var f = r.fitPieceScale;
      if (f && (f.left || f.right)) {
        return { left: readPair(f.left), right: readPair(f.right) };
      }
      if (f) { var p = readPair(f); return { left: { x: p.x, y: p.y }, right: { x: p.x, y: p.y } }; }
      return { left: { x: 1, y: 1 }, right: { x: 1, y: 1 } };
    }

    function buildModel(r) {
      var sz = window.targetSlotSizeForRound(r);
      return {
        slotSize: { width: sz.width, height: sz.height },
        off: { left: window.targetSlotOffsetForRound(r, "left"), right: window.targetSlotOffsetForRound(r, "right") },
        xoff: { left: window.targetSlotXOffsetForRound(r, "left"), right: window.targetSlotXOffsetForRound(r, "right") },
        vfs: window.visualFitScaleForRound(r),
        fit: readFit(r)
      };
    }

    function model() {
      var idx = state.round;
      if (!MODELS[idx]) { MODELS[idx] = buildModel(ROUNDS[idx]); }
      return MODELS[idx];
    }

    function round3(n) { return Math.round(n * 1000) / 1000; }

    // Write the working model back onto the live round object so every
    // existing helper (and the next real playthrough) uses these values.
    function applyToRound() {
      var r = ROUNDS[state.round], M = model();
      r.slotSize = { width: Math.round(M.slotSize.width), height: Math.round(M.slotSize.height) };
      r.slotOffset = { left: Math.round(M.off.left), right: Math.round(M.off.right) };
      r.slotXOffset = { left: Math.round(M.xoff.left), right: Math.round(M.xoff.right) };
      r.visualFitScale = round3(M.vfs);
      r.fitPieceScale = {
        left: { x: round3(M.fit.left.x), y: round3(M.fit.left.y) },
        right: { x: round3(M.fit.right.x), y: round3(M.fit.right.y) }
      };
    }

    function fitAngle(r) {
      var a = window.canonicalCutAngle ? window.canonicalCutAngle(r) : 90;
      return window.fitAngleForRound ? window.fitAngleForRound(r, a) : a;
    }

    function killAnim() {
      [els.leftFill, els.rightFill, els.leftPod, els.rightPod].forEach(function (el) {
        if (el) { el.style.transition = "none"; }
      });
      [els.leftBot, els.rightBot].forEach(function (b) {
        if (b && b.parentNode) { b.parentNode.classList.remove("celebrate-jump"); }
      });
    }

    // Full seat: ready layout → fill both hollows → charge → freeze.
    function seatPieces() {
      var r = ROUNDS[state.round];
      try { if (window.setInstruction) window.setInstruction("", { forceAudioStop: true }); } catch (e) {}
      try { if (window.clearTimers) window.clearTimers(); } catch (e) {}
      state.locked = false; state.teachingActive = false; state.tutActive = false;
      try { document.getElementById("game").classList.remove("teaching-active"); } catch (e) {}
      applyToRound();
      window.setupBots("layout-ready");
      var a = fitAngle(r);
      window.fillSlotWithPiece(els.leftFill, r, window.pieceIndexForSlot(r, 0), a);
      window.fillSlotWithPiece(els.rightFill, r, window.pieceIndexForSlot(r, 1), a);
      window.switchBotsToHappy(r);
      killAnim();
      seated = true;
      recordBase();
      decorate();
      sync();
    }

    function fillFor(side) { return side === "R" ? els.rightFill : els.leftFill; }
    function pieceSlotIndex(side) { return side === "R" ? 1 : 0; }
    function sideKey(side) { return side === "R" ? "right" : "left"; }

    // Snapshot the seated fill position so every later move is computed as a
    // delta from this known-good base (deterministic, no drift).
    function recordBase() {
      ["L", "R"].forEach(function (s) {
        var f = fillFor(s), k = sideKey(s), M = model();
        seatBase[s] = {
          top: parseFloat(f.style.top || "0"),
          ml: parseFloat(f.style.marginLeft || "0"),
          off: M.off[k],
          xoff: M.xoff[k]
        };
      });
    }

    function setFillPos(side) {
      var f = fillFor(side), k = sideKey(side), M = model(), b = seatBase[side];
      if (!b) { return; }
      f.style.top = (b.top + (M.off[k] - b.off)) + "px";
      f.style.marginLeft = (b.ml + (M.xoff[k] - b.xoff)) + "px";
    }

    // Light refresh of one side's piece (after size / scale change).
    function refillSide(side) {
      var r = ROUNDS[state.round], M = model(), fill = fillFor(side);
      fill.style.width = Math.round(M.slotSize.width) + "px";
      fill.style.height = Math.round(M.slotSize.height) + "px";
      window.fillSlotWithPiece(fill, r, pieceSlotIndex(side), fitAngle(r));
      setFillPos(side);
      reattachHandles(fill, side);
    }

    function refillBoth() { refillSide("L"); refillSide("R"); }

    // Move a side by a delta (steppers / arrow keys).
    function moveSide(side, dx, dy) {
      var M = model(), k = sideKey(side);
      M.xoff[k] += dx; M.off[k] += dy;
      applyToRound();
      setFillPos(side);
      sync();
    }

    function sidesFor(sel) { return sel === "B" ? ["L", "R"] : [sel]; }

    function nudge(prop, delta) {
      var M = model();
      if (prop === "x" || prop === "y") {
        sidesFor(activeSide).forEach(function (s) { moveSide(s, prop === "x" ? delta : 0, prop === "y" ? delta : 0); });
        return;
      }
      if (prop === "w") { M.slotSize.width += delta; applyToRound(); refillBoth(); }
      else if (prop === "h") { M.slotSize.height += delta; applyToRound(); refillBoth(); }
      else if (prop === "vfs") { M.vfs = Math.max(0.05, M.vfs + delta); applyToRound(); refillBoth(); }
      else if (prop === "sx" || prop === "sy") {
        sidesFor(activeSide).forEach(function (s) {
          var k = s === "R" ? "right" : "left";
          M.fit[k][prop === "sx" ? "x" : "y"] = Math.max(0.05, M.fit[k][prop === "sx" ? "x" : "y"] + delta);
        });
        applyToRound(); sidesFor(activeSide).forEach(refillSide);
      }
      sync();
    }

    // ── drag-to-move + corner-resize on the seated pieces ────────────────────
    function gameScale() {
      var g = document.getElementById("game");
      if (!g) { return 1; }
      var rect = g.getBoundingClientRect();
      return (rect.width || 1280) / 1280;
    }

    function startMove(side, e) {
      e.preventDefault(); e.stopPropagation();
      var sc = gameScale(), sx = e.clientX, sy = e.clientY;
      var M = model(), k = side === "R" ? "right" : "left";
      var startXoff = M.xoff[k], startYoff = M.off[k];
      var fill = fillFor(side);
      var startTop = parseFloat(fill.style.top || "0"), startML = parseFloat(fill.style.marginLeft || "0");
      function mv(ev) {
        var dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
        M.xoff[k] = startXoff + dx; M.off[k] = startYoff + dy;
        fill.style.top = (startTop + dy) + "px";
        fill.style.marginLeft = (startML + dx) + "px";
        applyToRound(); sync();
      }
      function up() { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }
      document.addEventListener("mousemove", mv);
      document.addEventListener("mouseup", up);
    }

    // Stretch / crop from any edge or corner. ax/ay ∈ {-1,0,1} pick which
    // edge follows the cursor; the OPPOSITE edge stays anchored. Width/height
    // are driven through fitPieceScale.x/.y so each piece stretches freely.
    function startStretch(side, ax, ay, e) {
      e.preventDefault(); e.stopPropagation();
      var sc = gameScale(), sx = e.clientX, sy = e.clientY;
      var M = model(), k = sideKey(side);
      var piece = fillFor(side).querySelector(".fit-piece") || fillFor(side);
      var rect = piece.getBoundingClientRect();
      var w0 = Math.max(6, rect.width / sc), h0 = Math.max(6, rect.height / sc);
      var fitX0 = M.fit[k].x, fitY0 = M.fit[k].y, xoff0 = M.xoff[k], yoff0 = M.off[k];
      function mv(ev) {
        var dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
        if (ax !== 0) {
          var nw = Math.max(6, w0 + dx * ax);
          M.fit[k].x = round3(Math.max(0.05, fitX0 * nw / w0));
          M.xoff[k] = xoff0 + dx / 2;           // keep opposite edge anchored
        }
        if (ay !== 0) {
          var nh = Math.max(6, h0 + dy * ay);
          M.fit[k].y = round3(Math.max(0.05, fitY0 * nh / h0));
          M.off[k] = yoff0 + dy / 2;
        }
        applyToRound();
        refillSide(side);
        sync();
      }
      function up() { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }
      document.addEventListener("mousemove", mv);
      document.addEventListener("mouseup", up);
    }

    // Eight grab handles (4 corners + 4 edges) around the piece's box.
    var HANDLES = [
      { ax: -1, ay: -1, css: "left:-7px;top:-7px;cursor:nwse-resize" },
      { ax: 0, ay: -1, css: "left:50%;top:-7px;transform:translateX(-50%);cursor:ns-resize" },
      { ax: 1, ay: -1, css: "right:-7px;top:-7px;cursor:nesw-resize" },
      { ax: 1, ay: 0, css: "right:-7px;top:50%;transform:translateY(-50%);cursor:ew-resize" },
      { ax: 1, ay: 1, css: "right:-7px;bottom:-7px;cursor:nwse-resize" },
      { ax: 0, ay: 1, css: "left:50%;bottom:-7px;transform:translateX(-50%);cursor:ns-resize" },
      { ax: -1, ay: 1, css: "left:-7px;bottom:-7px;cursor:nesw-resize" },
      { ax: -1, ay: 0, css: "left:-7px;top:50%;transform:translateY(-50%);cursor:ew-resize" }
    ];

    function reattachHandles(fill, side) {
      if (!seated) { return; }
      fill.querySelectorAll(".dbgFitHandle").forEach(function (h) { h.remove(); });
      HANDLES.forEach(function (def) {
        var h = document.createElement("div");
        h.className = "dbgFitHandle";
        h.style.cssText = "position:absolute;width:13px;height:13px;background:#ffd23d;" +
          "border:2px solid #7a4a00;border-radius:3px;z-index:99;box-sizing:border-box;" + def.css;
        h.title = "drag to stretch / crop this piece";
        h.addEventListener("mousedown", function (e) {
          activeSide = side; setActiveButtons();
          startStretch(side, def.ax, def.ay, e);
        });
        fill.appendChild(h);
      });
    }

    function decorate() {
      [["L", els.leftFill], ["R", els.rightFill]].forEach(function (pair) {
        var side = pair[0], fill = pair[1];
        if (!fill) { return; }
        fill.style.outline = "1px dashed rgba(255,90,160,.9)";
        fill.style.cursor = "move";
        if (!fill._dbgFitBound) {
          fill.addEventListener("mousedown", function (e) {
            if (!seated) { return; }
            if (e.target && e.target.classList && e.target.classList.contains("dbgFitHandle")) { return; }
            activeSide = side; setActiveButtons();
            startMove(side, e);
          });
          fill._dbgFitBound = true;
        }
        reattachHandles(fill, side);
      });
    }

    function undecorate() {
      [els.leftFill, els.rightFill].forEach(function (fill) {
        if (!fill) { return; }
        fill.style.outline = "";
        fill.style.cursor = "";
        fill.querySelectorAll(".dbgFitHandle").forEach(function (h) { h.remove(); });
      });
    }

    // ── export ───────────────────────────────────────────────────────────────
    function exportObj() {
      var r = ROUNDS[state.round], M = model();
      return {
        round: state.round,
        name: r.name,
        variant: r.variant || null,
        slotSize: { width: Math.round(M.slotSize.width), height: Math.round(M.slotSize.height) },
        slotOffset: { left: Math.round(M.off.left), right: Math.round(M.off.right) },
        slotXOffset: { left: Math.round(M.xoff.left), right: Math.round(M.xoff.right) },
        visualFitScale: round3(M.vfs),
        fitPieceScale: {
          left: { x: round3(M.fit.left.x), y: round3(M.fit.left.y) },
          right: { x: round3(M.fit.right.x), y: round3(M.fit.right.y) }
        }
      };
    }

    // ── floating panel ─────────────────────────────────────────────────────
    var panel = document.createElement("div");
    panel.id = "debugFitPanel";
    panel.style.cssText = [
      "position:fixed", "top:8px", "left:8px", "z-index:2147483647",
      "background:rgba(30,18,45,.94)", "color:#fff",
      "font:11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif",
      "padding:9px 11px", "border-radius:9px", "width:250px",
      "box-shadow:0 6px 24px rgba(0,0,0,.45)", "user-select:none", "display:none"
    ].join(";");

    function row(label, prop, steps) {
      var btns = steps.map(function (s) {
        return '<button data-prop="' + prop + '" data-step="' + s.d + '" class="dbgFitStep" ' +
          'style="min-width:30px;margin:0 2px;padding:3px 0;background:#5a3a78;color:#fff;border:0;border-radius:4px;cursor:pointer;font:inherit">' +
          s.t + "</button>";
      }).join("");
      return '<div style="display:flex;align-items:center;justify-content:space-between;margin:3px 0">' +
        '<span style="opacity:.8;min-width:78px">' + label + "</span><span>" + btns + "</span></div>";
    }

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;font-weight:700;margin-bottom:6px">' +
        '<span>🎯 Fit Debug</span>' +
        '<button id="dbgFitClose" style="background:transparent;border:0;color:#fff;cursor:pointer;font-size:14px">✕</button>' +
      "</div>" +
      '<div id="dbgFitRound" style="margin-bottom:6px;color:#ffd6f0;font-weight:700"></div>' +
      '<div style="display:flex;gap:4px;margin-bottom:6px">' +
        '<button id="dbgFitSeat" style="flex:1;padding:5px;background:#0a7d4d;color:#fff;border:0;border-radius:5px;cursor:pointer;font:inherit;font-weight:700">Seat pieces</button>' +
        '<button id="dbgFitRerender" style="flex:1;padding:5px;background:#2a5a9a;color:#fff;border:0;border-radius:5px;cursor:pointer;font:inherit">Re-render</button>' +
      "</div>" +
      '<div style="display:flex;gap:4px;margin-bottom:6px">' +
        '<span style="opacity:.8;align-self:center">Side:</span>' +
        '<button class="dbgFitSide" data-side="L" style="flex:1;padding:4px;border:0;border-radius:4px;cursor:pointer;font:inherit">Left</button>' +
        '<button class="dbgFitSide" data-side="R" style="flex:1;padding:4px;border:0;border-radius:4px;cursor:pointer;font:inherit">Right</button>' +
        '<button class="dbgFitSide" data-side="B" style="flex:1;padding:4px;border:0;border-radius:4px;cursor:pointer;font:inherit">Both</button>' +
      "</div>" +
      row("Move X", "x", [{ t: "−", d: -1 }, { t: "+", d: 1 }]) +
      row("Move Y", "y", [{ t: "−", d: -1 }, { t: "+", d: 1 }]) +
      row("Slot W", "w", [{ t: "−", d: -1 }, { t: "+", d: 1 }]) +
      row("Slot H", "h", [{ t: "−", d: -1 }, { t: "+", d: 1 }]) +
      row("Scale X", "sx", [{ t: "−", d: -0.02 }, { t: "+", d: 0.02 }]) +
      row("Scale Y", "sy", [{ t: "−", d: -0.02 }, { t: "+", d: 0.02 }]) +
      row("Fit scale", "vfs", [{ t: "−", d: -0.01 }, { t: "+", d: 0.01 }]) +
      '<div style="display:flex;gap:4px;margin-top:6px">' +
        '<button id="dbgFitCopy" style="flex:1;padding:6px;background:#c2418a;color:#fff;border:0;border-radius:5px;cursor:pointer;font:inherit;font-weight:700">Copy JSON</button>' +
        '<button id="dbgFitDownload" style="flex:1;padding:6px;background:#0a7d4d;color:#fff;border:0;border-radius:5px;cursor:pointer;font:inherit;font-weight:700">⬇ Download</button>' +
      "</div>" +
      '<textarea id="dbgFitJson" readonly style="width:100%;height:120px;margin-top:6px;background:#160b22;color:#9be7c4;border:1px solid #4a2c66;border-radius:5px;font:10px/1.35 monospace;padding:5px;box-sizing:border-box;resize:vertical"></textarea>' +
      '<div style="margin-top:5px;color:#b9a9c9;font-size:10px">Drag piece body = move · drag any yellow edge/corner = stretch / crop · keys: F seat, G panel, L/R/B side, arrows nudge</div>';

    document.body.appendChild(panel);

    function setActiveButtons() {
      panel.querySelectorAll(".dbgFitSide").forEach(function (b) {
        var on = b.dataset.side === activeSide;
        b.style.background = on ? "#ffd23d" : "#5a3a78";
        b.style.color = on ? "#3a2400" : "#fff";
        b.style.fontWeight = on ? "700" : "400";
      });
    }

    function sync() {
      var r = ROUNDS[state.round];
      panel.querySelector("#dbgFitRound").textContent =
        "Round " + state.round + " — " + (r.label || r.name) + (r.variant ? " · " + r.variant : "");
      panel.querySelector("#dbgFitJson").value = JSON.stringify(exportObj(), null, 2);
    }

    panel.querySelector("#dbgFitClose").addEventListener("click", function () { panel.style.display = "none"; });
    panel.querySelector("#dbgFitSeat").addEventListener("click", seatPieces);
    panel.querySelector("#dbgFitRerender").addEventListener("click", seatPieces);
    panel.querySelector("#dbgFitCopy").addEventListener("click", function () {
      var txt = JSON.stringify(exportObj(), null, 2);
      try {
        navigator.clipboard.writeText(txt).then(function () {
          var b = panel.querySelector("#dbgFitCopy"); var o = b.textContent;
          b.textContent = "Copied ✓"; setTimeout(function () { b.textContent = o; }, 900);
        });
      } catch (e) {}
      console.log("[debug-fit] " + txt);
    });
    panel.querySelector("#dbgFitDownload").addEventListener("click", function () {
      var r = ROUNDS[state.round];
      var txt = JSON.stringify(exportObj(), null, 2);
      var fname = "fit-round-" + state.round + "-" + (r.variant || r.name) + ".json";
      try {
        var blob = new Blob([txt], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = fname;
        document.body.appendChild(a); a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 120);
      } catch (e) { console.warn("[debug-fit] download failed", e); }
    });
    panel.querySelectorAll(".dbgFitSide").forEach(function (b) {
      b.addEventListener("click", function () { activeSide = b.dataset.side; setActiveButtons(); });
    });
    panel.querySelectorAll(".dbgFitStep").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!seated) { seatPieces(); }
        nudge(b.dataset.prop, parseFloat(b.dataset.step));
      });
    });
    setActiveButtons();

    // ── keyboard ─────────────────────────────────────────────────────────────
    document.addEventListener("keydown", function (e) {
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) { return; }
      var k = e.key.toLowerCase();
      if (k === "f") { e.preventDefault(); panel.style.display = "block"; seatPieces(); return; }
      if (k === "g") { e.preventDefault(); panel.style.display = panel.style.display === "none" ? "block" : "none"; if (panel.style.display === "block") { sync(); } return; }
      if (k === "l" || k === "r" || k === "b") { activeSide = k.toUpperCase(); setActiveButtons(); return; }
      if (!seated) { return; }
      var step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") { e.preventDefault(); nudge("x", -step); }
      else if (e.key === "ArrowRight") { e.preventDefault(); nudge("x", step); }
      else if (e.key === "ArrowUp") { e.preventDefault(); nudge("y", -step); }
      else if (e.key === "ArrowDown") { e.preventDefault(); nudge("y", step); }
    });

    window.debugFit = { seat: seatPieces, exportObj: exportObj, models: MODELS };
    console.log("[debug-fit] Ready. Jump to a round, then press F to seat pieces and tune the fit.");
  });
})();
