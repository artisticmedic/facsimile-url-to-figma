/* GSAP — production: self-host gsap.min.js + CustomEase.min.js for CSP script-src 'self' (no eval). */
(function () {
  'use strict';

  // ─── safe DOM access ────────────────────────────────────────
  var $  = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ─── element refs (null-guarded everywhere downstream) ───────
  var el = {
    stage:        $('stage'),
    stageScale:   $('stageScale'),
    scene:        $('scene'),
    // chrome window + extension icon + popup
    chromeWin:    $('chromeWin'),
    extIcon:      $('extIcon'),
    popup:        $('popup'),
    popupBtn:     $('ppBtn'),
    pill:         $('pill'),
    ppTxt:        $('ppTxt'),
    scan:         $('scan'),
    capbar:       $('capbar'),
    cbBtn:        $('cbBtn'),
    cwPage:       $('cwPage'),
    // figma window + scrim
    figmaApp:     $('figmaApp'),
    fgScrim:      $('fgScrim'),
    // figma left panel
    layers:       $('layers'),
    layersEmpty:  $('layersEmpty'),
    flParent:     $('flParent'),
    // figma canvas
    canvas:       $('canvas'),
    canvasEmpty:  $('canvasEmpty'),
    keyhint:      $('keyhint'),
    frame:        $('frame'),
    frameName:    $('frameName'),
    frameCard:    $('frameCard'),
    sel:          $('sel'),
    dim:          $('dim'),
    // auto-layout reveal
    alFrame:      $('alFrame'),
    alGaps:       $('alGaps'),
    inspAL:       $('inspAL'),
    // figma right panel
    rightEmpty:   $('rightEmpty'),
    inspect:      $('inspect'),
    // cursor
    cursor:       $('cursor'),
    ripple:       $('ripple')
  };

  var flChildren = $$('.fl-child');                  // 5 child rows
  var inspSecs   = $$('.insp-sec:not(.insp-al)');    // base inspector sections (AL handled separately)
  var cwBlocks   = el.cwPage ? $$('[data-cwblk]', el.cwPage) : []; // 5 chrome-page blocks
  var selHandles = el.sel ? $$('.h', el.sel) : [];
  var alGapEls   = el.alGaps ? $$('.al-gap', el.alGaps) : [];

  if (!window.gsap || !el.scene) { return; } // GSAP missing or markup absent → bail quietly
  var gsap = window.gsap;

  // ─── CustomEase 'soft' = 0.22,1,0.36,1 ──────────────────────
  var SOFT = 'power3.out';
  if (window.CustomEase && typeof window.CustomEase.create === 'function') {
    try { window.CustomEase.create('soft', '0.22,1,0.36,1'); SOFT = 'soft'; } catch (e) { /* fallback */ }
  }

  // ─── popup state machine (mirrors extension/popup.js labels) ─
  var STATES = {
    idle:      { txt: 'Ready to capture',                btn: 'Capture this page', disabled: false },
    preparing: { txt: 'Preparing capture…',              btn: 'Capturing…',        disabled: true  },
    injecting: { txt: 'Injecting into page…',            btn: 'Capturing…',        disabled: true  },
    waiting:   { txt: 'Click “Copy to clipboard” →',     btn: 'Capture this page', disabled: false },
    done:      { txt: 'Copied — paste into Figma ⌘V',    btn: 'Capture this page', disabled: false }
  };

  function setPopupState(state) {
    var s = STATES[state];
    if (!s) { return; }
    if (el.pill)  { el.pill.dataset.state = state; }
    if (el.ppTxt) { el.ppTxt.textContent  = s.txt; }
    if (el.popupBtn) {
      el.popupBtn.innerHTML = '<span class="ic" aria-hidden="true">◆</span> ' + s.btn;
      el.popupBtn.disabled  = s.disabled;
    }
  }

  // ─── anchor the popup under the extension icon (real-popup feel) ─
  // Popup top-right sits just under #extIcon's bottom-right. Re-run on resize.
  function anchorPopup() {
    if (!el.popup || !el.extIcon || !el.scene) { return; }
    var ic = el.extIcon.getBoundingClientRect();
    var sc = el.scene.getBoundingClientRect();
    // scene may be transform-scaled; convert to scene-local coords
    var scale = sc.width / (el.scene.offsetWidth || sc.width);
    var iconRight  = (ic.right  - sc.left) / scale;
    var iconBottom = (ic.bottom - sc.top)  / scale;
    el.popup.style.left = '';
    el.popup.style.right = (el.scene.offsetWidth - iconRight - 4) + 'px';
    el.popup.style.top  = (iconBottom + 8) + 'px';
  }

  // ─── coordinate helper: a point inside a node, in scene-local space ──
  // fx/fy are fractional positions within the node's box (0.5,0.5 = center).
  function regionPoint(node, fx, fy) {
    if (!node || !el.scene) { return { x: 0, y: 0 }; }
    if (typeof fx !== 'number') { fx = 0.5; }
    if (typeof fy !== 'number') { fy = 0.5; }
    var t = node.getBoundingClientRect();
    var s = el.scene.getBoundingClientRect();
    var scale = s.width / (el.scene.offsetWidth || s.width);
    return {
      x: ((t.left - s.left) + t.width  * fx) / scale,
      y: ((t.top  - s.top)  + t.height * fy) / scale
    };
  }

  // cursor SVG tip sits at ~(6,4) within its 28px box → offset so the TIP lands on target
  var TIPX = 6, TIPY = 4;

  // Move the cursor so its tip lands on a node. fx/fy pick a region of the node
  // (default center). Uses FUNCTION-BASED values so the target is re-measured when
  // the tween STARTS — after the node has finished any open/move animation — instead
  // of at build time (which is why earlier the cursor missed the popup button + Figma).
  function moveCursorTo(tl, node, dur, pos, fx, fy) {
    tl.to(el.cursor, {
      x: function () { return regionPoint(node, fx, fy).x - TIPX; },
      y: function () { return regionPoint(node, fx, fy).y - TIPY; },
      duration: dur, ease: SOFT
    }, pos);
  }

  function clickPulse(tl, pos) {
    if (!el.cursor) { return; }
    tl.to(el.cursor, { scale: 0.86, duration: 0.08, ease: 'power2.out' }, pos)
      .to(el.cursor, { scale: 1,    duration: 0.14, ease: 'power2.out' }, '>-0.02');
    if (el.ripple) {
      tl.fromTo(el.ripple,
        { opacity: 0.9, scale: 0.4 },
        { opacity: 0, scale: 2.4, duration: 0.35, ease: 'power2.out' }, '<');
    }
  }

  // ─── window focus helpers (z-index + transform/opacity only) ──
  // OPEN: Chrome front+focused, Figma back+dimmed.
  function setChromeFront() {
    if (el.chromeWin) { gsap.set(el.chromeWin, { zIndex: 20 }); }
    if (el.figmaApp)  { gsap.set(el.figmaApp,  { zIndex: 10 }); }
  }
  function setFigmaFront() {
    if (el.chromeWin) { gsap.set(el.chromeWin, { zIndex: 10 }); }
    if (el.figmaApp)  { gsap.set(el.figmaApp,  { zIndex: 20 }); }
  }

  // ─── reset to the OPENING (Chrome focused, Figma dimmed/back) ──
  function resetScene() {
    gsap.killTweensOf('*');
    setPopupState('idle');
    setChromeFront();

    // CHROME: focused/front
    if (el.chromeWin) { gsap.set(el.chromeWin, { opacity: 1, scale: 1, x: 0, y: 0 }); }

    // FIGMA: behind, ~92% scale, slightly dimmed via cool scrim
    if (el.figmaApp)  { gsap.set(el.figmaApp,  { opacity: 1, scale: 0.92, x: 24, y: 18 }); }
    if (el.fgScrim)   { gsap.set(el.fgScrim,   { opacity: 1 }); }

    // cursor parks in lower area
    if (el.cursor)    { gsap.set(el.cursor,    { opacity: 0, x: 320, y: 520, scale: 1 }); }
    if (el.ripple)    { gsap.set(el.ripple,    { opacity: 0, scale: 0.4 }); }

    // popup closed, anchored to ext icon
    anchorPopup();
    if (el.popup)     { gsap.set(el.popup,     { opacity: 0, scale: 0.95, y: '-=6' }); }
    if (el.extIcon)   { gsap.set(el.extIcon,   { scale: 1 }); }

    // chrome page blocks: no outline
    cwBlocks.forEach(function (b) { if (b) { b.classList.remove('outlined'); } });
    if (el.scan)   { gsap.set(el.scan,   { opacity: 0, y: 0 }); }
    if (el.capbar) { gsap.set(el.capbar, { opacity: 0, y: 14 }); el.capbar.classList.remove('is-done'); }
    if (el.cbBtn)  { el.cbBtn.textContent = 'Copy to clipboard'; }

    // figma EMPTY: no frame, empty layer tree, empty inspector
    if (el.frame)      { gsap.set(el.frame,      { opacity: 0, scale: 0.78, x: 0, y: 14 }); }
    if (el.frameName)  { gsap.set(el.frameName,  { opacity: 0, y: 4 }); }
    if (el.sel)        { gsap.set(el.sel,        { opacity: 0 }); }
    if (el.dim)        { gsap.set(el.dim,        { opacity: 0, y: 4 }); }
    selHandles.forEach(function (h) { if (h) { gsap.set(h, { scale: 0 }); } });
    if (el.keyhint)    { gsap.set(el.keyhint,    { opacity: 0, scale: 0.85 }); }

    // auto-layout reveal hidden
    if (el.alFrame) { gsap.set(el.alFrame, { opacity: 0 }); }
    if (el.alGaps)  { gsap.set(el.alGaps,  { opacity: 0 }); }
    alGapEls.forEach(function (g) { if (g) { gsap.set(g, { scaleX: 0.6 }); } });
    if (el.inspAL)  { gsap.set(el.inspAL,  { opacity: 0, y: 6, height: 0, paddingTop: 0, paddingBottom: 0, overflow: 'hidden' }); }

    if (el.layersEmpty) { gsap.set(el.layersEmpty, { opacity: 1 }); }
    if (el.flParent)    { gsap.set(el.flParent,    { opacity: 0, x: -8 }); el.flParent.classList.remove('is-sel'); }
    flChildren.forEach(function (r) { if (r) { gsap.set(r, { opacity: 0, x: -8 }); r.classList.remove('is-sel'); } });

    if (el.rightEmpty) { gsap.set(el.rightEmpty, { opacity: 1 }); }
    inspSecs.forEach(function (s) { if (s) { gsap.set(s, { opacity: 0, y: 6 }); } });

    if (el.canvasEmpty) { gsap.set(el.canvasEmpty, { opacity: 1 }); }
  }

  // ─── jump straight to FINISHED end-state (reduced motion) ────
  function renderEndState() {
    setPopupState('done');
    setFigmaFront();

    // FIGMA front + focused, un-dimmed
    if (el.figmaApp)  { gsap.set(el.figmaApp,  { opacity: 1, scale: 1, x: 0, y: 0 }); }
    if (el.fgScrim)   { gsap.set(el.fgScrim,   { opacity: 0 }); }
    // CHROME receded + dimmed, behind
    if (el.chromeWin) { gsap.set(el.chromeWin, { opacity: 0.45, scale: 0.92, x: 14, y: 14 }); }

    if (el.cursor)    { gsap.set(el.cursor,    { opacity: 0 }); }
    if (el.popup)     { gsap.set(el.popup,     { opacity: 0, scale: 0.95 }); }
    if (el.capbar)    { gsap.set(el.capbar,    { opacity: 0 }); }
    if (el.scan)      { gsap.set(el.scan,      { opacity: 0 }); }
    cwBlocks.forEach(function (b) { if (b) { b.classList.remove('outlined'); } });

    if (el.canvasEmpty) { gsap.set(el.canvasEmpty, { opacity: 0 }); }
    if (el.frame)       { gsap.set(el.frame,      { opacity: 1, scale: 1, x: 0, y: 0 }); }
    if (el.frameName)   { gsap.set(el.frameName,  { opacity: 1, y: 0 }); }
    if (el.sel)         { gsap.set(el.sel,        { opacity: 1 }); }
    if (el.dim)         { gsap.set(el.dim,        { opacity: 1, y: 0 }); }
    selHandles.forEach(function (h) { if (h) { gsap.set(h, { scale: 1 }); } });

    // auto-layout shown
    if (el.alFrame) { gsap.set(el.alFrame, { opacity: 1 }); }
    if (el.alGaps)  { gsap.set(el.alGaps,  { opacity: 1 }); }
    alGapEls.forEach(function (g) { if (g) { gsap.set(g, { scaleX: 1 }); } });
    if (el.inspAL)  { gsap.set(el.inspAL,  { opacity: 1, y: 0, height: 'auto', clearProps: 'height,paddingTop,paddingBottom,overflow' }); }

    if (el.layersEmpty) { gsap.set(el.layersEmpty, { opacity: 0 }); }
    if (el.flParent)    { gsap.set(el.flParent, { opacity: 1, x: 0 }); el.flParent.classList.add('is-sel'); }
    flChildren.forEach(function (r) { if (r) { gsap.set(r, { opacity: 1, x: 0 }); } });

    if (el.rightEmpty) { gsap.set(el.rightEmpty, { opacity: 0 }); }
    inspSecs.forEach(function (s) { if (s) { gsap.set(s, { opacity: 1, y: 0 }); } });
    if (el.keyhint)    { gsap.set(el.keyhint, { opacity: 0 }); }
  }

  // ─── the ONE timeline (auto-looping) ────────────────────────
  var tl = null;
  var loopCall = null;        // delayedCall that schedules the next cycle
  var inView = false;         // only loop while the demo is on screen
  var HOLD = 2.2;             // seconds to rest on the finished Figma frame between loops

  function buildTimeline() {
    resetScene();

    tl = gsap.timeline({
      defaults: { ease: SOFT },
      onComplete: function () {
        // loop: hold on the finished frame, then replay — but only while in view
        if (loopCall) { loopCall.kill(); }
        loopCall = gsap.delayedCall(HOLD, function () {
          if (inView) { buildTimeline(); }
        });
      }
    });

    // ── 1. OPEN — Chrome focused/front, Figma dimmed/back; cursor fades in ──
    tl.to(el.cursor, { opacity: 1, duration: 0.3 }, 0.15);

    // ── 2. cursor → Facsimile EXTENSION ICON in Chrome toolbar, click ──
    moveCursorTo(tl, el.extIcon, 0.45, 0.3);
    clickPulse(tl, '>-0.05');
    // icon press feedback
    if (el.extIcon) {
      tl.to(el.extIcon, { scale: 0.88, duration: 0.1, ease: 'power2.out' }, '<')
        .to(el.extIcon, { scale: 1,    duration: 0.2,  ease: 'back.out(2)' }, '>-0.02');
    }

    // ── 3. POPUP DROPS OPEN from the icon (transform-origin top-right) ──
    if (el.popup) {
      tl.to(el.popup, { opacity: 1, scale: 1, y: 0, duration: 0.25, ease: SOFT }, '>-0.05');
    }
    tl.to({}, { duration: 0.3 }); // brief idle beat — "Ready to capture"

    // cursor → popup ◆ Capture button, click → starts capture
    moveCursorTo(tl, el.popupBtn, 0.4, '>');
    clickPulse(tl, '>-0.05');

    // ── 4. popup REAL states + amber scan sweeps DOWN the chrome page ──
    tl.call(setPopupState, ['preparing'], '>')
      .to({}, { duration: 0.32 })
      .call(setPopupState, ['injecting'], '>');

    if (el.scan && el.cwPage) {
      var sweep = (el.cwPage.offsetHeight || 300) - 46;
      tl.set(el.scan, { opacity: 1, y: 0 }, '<');
      var scanStart = tl.duration();
      tl.to(el.scan, { y: sweep, duration: 0.8, ease: 'none' }, scanStart);
      cwBlocks.forEach(function (b, i) {
        if (!b) { return; }
        var at = scanStart + 0.1 + i * 0.13;
        tl.call(function () { b.classList.add('outlined'); }, null, at);
      });
      tl.to(el.scan, { opacity: 0, duration: 0.22 }, scanStart + 0.76);
    } else {
      tl.to({}, { duration: 0.8 });
    }

    // ── 5. popup → waiting; capture toolbar rises; cursor → Copy; turns green; popup done ──
    tl.call(setPopupState, ['waiting'], '>-0.1');
    if (el.capbar) {
      tl.to(el.capbar, { opacity: 1, y: 0, duration: 0.4, ease: 'back.out(1.6)' }, '<');
    }
    moveCursorTo(tl, el.cbBtn, 0.4, '>-0.05');
    clickPulse(tl, '>-0.05');
    tl.call(function () {
      if (el.capbar) { el.capbar.classList.add('is-done'); }
      if (el.cbBtn)  { el.cbBtn.textContent = 'Copied ✓'; }
    }, null, '>-0.02');
    tl.call(setPopupState, ['done'], '>+0.1');

    // clear chrome-page outlines now that capture is "taken"
    tl.call(function () {
      cwBlocks.forEach(function (b) { if (b) { b.classList.remove('outlined'); } });
    }, null, '>');
    tl.to({}, { duration: 0.14 }); // let "Copied — paste into Figma ⌘V" read

    // ── 6. WINDOW SWAP — popup closes; cursor clicks Figma; Figma RAISES to front ──
    if (el.popup) {
      tl.to(el.popup, { opacity: 0, scale: 0.95, y: -6, duration: 0.26, ease: 'power2.in' }, '>');
    }
    // cursor glides onto the VISIBLE canvas of the Figma window. Chrome covers the
    // left ~60%, so aim at the middle of the visible right portion (≈74% across,
    // mid-height) — lands on the canvas, reading as "click the Figma doc to focus it."
    moveCursorTo(tl, el.figmaApp, 0.5, '<', 0.74, 0.52);
    clickPulse(tl, '>-0.05');

    // z-swap at the click moment (z-index only — no reflow)
    tl.call(setFigmaFront, null, '>-0.02');
    // Figma animates to focused; Chrome recedes/dims behind — ~0.5s soft
    if (el.figmaApp) {
      tl.to(el.figmaApp, { scale: 1, x: 0, y: 0, duration: 0.5, ease: SOFT }, '<');
    }
    if (el.fgScrim) {
      tl.to(el.fgScrim, { opacity: 0, duration: 0.45, ease: SOFT }, '<');
    }
    if (el.chromeWin) {
      tl.to(el.chromeWin, { scale: 0.92, x: 14, y: 14, opacity: 0.45, duration: 0.5, ease: SOFT }, '<');
    }

    // ── 7. PASTE — ⌘V chip blips; frame lands; tree + selection + inspector build ──
    moveCursorTo(tl, el.canvas, 0.38, '>-0.2');
    clickPulse(tl, '>-0.03');

    if (el.keyhint) {
      tl.fromTo(el.keyhint,
        { opacity: 0, scale: 0.85 },
        { opacity: 1, scale: 1, duration: 0.26, ease: 'back.out(2)' }, '>-0.02');
      tl.to(el.keyhint, { opacity: 0, scale: 0.85, duration: 0.26 }, '>+0.18');
    }

    tl.to(el.canvasEmpty, { opacity: 0, duration: 0.3 }, '<')
      .to(el.frame, { opacity: 1, scale: 1, x: 0, y: 0, duration: 0.55, ease: 'back.out(1.2)' }, '<+0.05');

    // LEFT layer tree builds (overlaps the frame land)
    tl.to(el.layersEmpty, { opacity: 0, duration: 0.2 }, '<+0.05')
      .to(el.flParent, { opacity: 1, x: 0, duration: 0.26 }, '<')
      .to(flChildren, { opacity: 1, x: 0, duration: 0.26, stagger: 0.05 }, '>-0.06');

    // SELECTION snaps on (border + handles pop), dim pill fades up — overlaps tree
    tl.to(el.sel, { opacity: 1, duration: 0.2 }, '<+0.05');
    if (selHandles.length) {
      tl.to(selHandles, { scale: 1, duration: 0.3, ease: 'back.out(2.4)', stagger: 0.02 }, '<');
    }
    tl.to(el.dim, { opacity: 1, y: 0, duration: 0.28 }, '<+0.05')
      .to(el.frameName, { opacity: 1, y: 0, duration: 0.28 }, '<');

    // parent "Pricing" row selected (blue)
    tl.call(function () { if (el.flParent) { el.flParent.classList.add('is-sel'); } }, null, '<');

    // RIGHT inspector populates (base sections) — overlaps selection
    tl.to(el.rightEmpty, { opacity: 0, duration: 0.2 }, '<')
      .to(inspSecs, { opacity: 1, y: 0, duration: 0.28, stagger: 0.045 }, '<+0.05');

    // ── 8. AUTO-LAYOUT REVEAL — cursor clicks frame; AL section + pink indicators ──
    tl.to({}, { duration: 0.18 });
    moveCursorTo(tl, el.frame, 0.38, '>');
    clickPulse(tl, '>-0.03');

    // inspector "Auto layout" section expands in
    if (el.inspAL) {
      tl.set(el.inspAL, { height: 'auto' }, '>-0.02');
      tl.fromTo(el.inspAL,
        { opacity: 0, y: 6, height: 0, paddingTop: 0, paddingBottom: 0 },
        { opacity: 1, y: 0, height: 'auto', paddingTop: 9, paddingBottom: 9, duration: 0.4, ease: SOFT,
          onComplete: function () {
            if (el.inspAL) { gsap.set(el.inspAL, { clearProps: 'height,overflow' }); }
          }
        }, '<');
    }

    // recompute gap positions against the now-settled frame geometry
    tl.call(placeGaps, null, '<');

    // pink magenta frame outline + gap indicators on canvas
    if (el.alFrame) {
      tl.to(el.alFrame, { opacity: 1, duration: 0.3 }, '<+0.05');
    }
    if (el.alGaps) {
      tl.to(el.alGaps, { opacity: 1, duration: 0.25 }, '<');
    }
    if (alGapEls.length) {
      tl.to(alGapEls, { scaleX: 1, duration: 0.4, ease: 'back.out(1.8)', stagger: 0.08 }, '<');
    }

    // ── 9. SETTLE — cursor fades; the loop holds, then replays (via onComplete) ──
    tl.to(el.cursor, { opacity: 0, duration: 0.4 }, '>+0.3');

    return tl;
  }

  function start() { stop(); buildTimeline(); }
  function stop() {
    if (loopCall) { loopCall.kill(); loopCall = null; }
    if (tl) { tl.kill(); tl = null; }
  }

  // ─── position the pink gap indicators between the stacked rows ──
  // The frame card has 3 stacked rows (nav / mid / row-of-cards). Place a thin
  // pink band centered in each inter-row gap. Uses offsetTop/offsetHeight, which
  // are layout values UNAFFECTED by the frame's transform (scale/opacity), so it
  // is correct even when called while the frame is reset/hidden. .al-gaps is
  // inset 13px to match .frame-card padding, so offsets here are card-relative.
  function placeGaps() {
    if (!el.frameCard || alGapEls.length < 2) { return; }
    var rows = Array.prototype.filter.call(el.frameCard.children, function (c) {
      return c.classList && (c.classList.contains('blk') ||
             c.classList.contains('b-mid') || c.classList.contains('b-row'));
    });
    if (rows.length < 3) { return; }
    var pad = 13; // .frame-card padding == .al-gaps inset
    for (var i = 0; i < 2 && i < alGapEls.length; i++) {
      var aBottom = rows[i].offsetTop + rows[i].offsetHeight;
      var bTop    = rows[i + 1].offsetTop;
      var center  = (aBottom + bTop) / 2 - pad;  // back out the inset
      alGapEls[i].style.top    = (center - 5) + 'px';
      alGapEls[i].style.height = '10px';
    }
  }

  // ─── reduced motion: end-state, no motion, no autoplay ──────
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    anchorPopup();
    placeGaps();
    renderEndState();
  } else {
    resetScene();
    placeGaps();

    // Loop while on screen; pause + reset when scrolled away (saves battery and
    // means it always starts fresh the next time it scrolls into view).
    if ('IntersectionObserver' in window && el.scene) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var vis = entries[i].isIntersecting;
          if (vis && !inView) {
            inView = true;
            if (!tl || !tl.isActive()) { start(); }
          } else if (!vis && inView) {
            inView = false;
            stop();
            resetScene();
          }
        }
      }, { threshold: 0.25 });
      io.observe(el.scene);
    } else {
      inView = true;
      start();
    }

    // Clicking the popup's Capture button restarts the cycle (nice-to-have; guarded).
    if (el.popupBtn) { el.popupBtn.addEventListener('click', start); }
  }

  // ─── responsive: scale the whole two-window scene to fit ─────
  function fit() {
    if (!el.stage || !el.stageScale) { return; }
    var avail = el.stage.clientWidth;            // .stage is width:100% of its column
    var scale = Math.min(1.18, avail / 980);     // allow modest upscale so the demo fills the space
    el.stageScale.style.transform = 'scale(' + scale + ')';
    el.stage.style.height = (660 * scale) + 'px';   // exact scaled height → no gap, no CLS
    // geometry changed → re-anchor popup + auto-layout gaps against live scaled coords
    anchorPopup();
    placeGaps();
  }
  fit();
  window.addEventListener('resize', fit);
})();

