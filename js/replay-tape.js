/**
 * Instant replay tape: host records territory snapshots — deal (per territory), opening init (legacy),
 * setup deploy, battle, and eliminations. Playback runs the full sequence on the public map (TV follows mirror).
 */
(function () {
  "use strict";

  var TAPE_VERSION = 2;
  /** Older saves may still carry v1; playback and sidecar merge accept both. */
  function tapeVersionOk(v) {
    return v === 1 || v === TAPE_VERSION;
  }
  /** Compact replay tape backup so a full gameState save failure does not lose the entire battle tape. */
  var REPLAY_TAPE_SIDECAR_KEY = "risqueReplayTapeSidecar";
  var MAX_EVENTS = 1200;
  var MS_DEPLOY = 90;
  var MS_BATTLE = 140;
  var MS_ELIMINATION = 900;
  var MS_INIT = 80;
  /** Per-territory deal step — fast strip so full deal fits without huge delay. */
  var MS_DEAL = 95;
  /** Brief beat before the first tape frame (replaces old “hold on pre-battle only” when opening is included). */
  var MS_REPLAY_START_HOLD = 450;

  function risqueReplayPushMirrorIfHost() {
    if (window.risqueDisplayIsPublic) return;
    if (typeof window.risqueMirrorPushGameState === "function") {
      try {
        window.risqueMirrorPushGameState();
      } catch (eM) {
        /* ignore */
      }
    }
  }

  function shouldRecord(gs) {
    if (!gs || gs.risqueReplayPlaybackActive) return false;
    if (window.risqueDisplayIsPublic) return false;
    return true;
  }

  function ensureTape(gs) {
    if (!gs || typeof gs !== "object") return;
    if (!gs.risqueReplayTape || typeof gs.risqueReplayTape !== "object") {
      gs.risqueReplayTape = { v: TAPE_VERSION, events: [], openingRecorded: false, hasDealFrames: false };
      return;
    }
    var tape = gs.risqueReplayTape;
    /* Never wipe events on version drift / partial saves — that made REPLAY stay disabled after long games. */
    if (tape.v !== TAPE_VERSION) {
      tape.v = TAPE_VERSION;
    }
    if (!Array.isArray(tape.events)) {
      tape.events = [];
    }
    if (typeof tape.hasDealFrames !== "boolean") {
      tape.hasDealFrames = tape.events.some(function (e) {
        return e && e.type === "board" && e.segment === "deal";
      });
    }
  }

  function ensureReplayTapeSessionKey(gs) {
    if (!gs || typeof gs !== "object") return;
    if (gs.risqueReplayTapeSessionKey) return;
    gs.risqueReplayTapeSessionKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "rsq-" + String(Date.now()) + "-" + String(Math.floor(Math.random() * 1e9));
  }

  /**
   * While players are active, record name → color so replay ghosts after elimination still use the right chip color.
   */
  function mergeReplayPlayerColors(gs) {
    if (!gs || typeof gs !== "object") return;
    if (!gs.risqueReplayPlayerColors || typeof gs.risqueReplayPlayerColors !== "object") {
      gs.risqueReplayPlayerColors = {};
    }
    var m = gs.risqueReplayPlayerColors;
    (gs.players || []).forEach(function (p) {
      if (!p || !p.name || p.color == null || String(p.color).trim() === "") return;
      m[String(p.name)] = String(p.color).trim().toLowerCase();
    });
  }

  function replayGhostColorForOwner(gs, ownerName) {
    var nm = String(ownerName || "");
    var m = gs && gs.risqueReplayPlayerColors;
    if (m && m[nm]) return m[nm];
    return "black";
  }

  function snapshotBoard(gs) {
    var out = {};
    if (!gs || !gs.players) return out;
    gs.players.forEach(function (p) {
      if (!p || !p.name) return;
      (p.territories || []).forEach(function (t) {
        if (!t || !t.name) return;
        out[t.name] = { owner: String(p.name), troops: Number(t.troops) || 0 };
      });
    });
    return out;
  }

  function applyBoard(gs, board) {
    if (!gs || !gs.players || !board) return;
    var replay = !!gs.risqueReplayPlaybackActive;
    /* Older tape frames can list owners who were later eliminated from gs.players; without stubs those
     * territories were dropped and markers vanished or flickered as later frames re-included owners. */
    if (replay) {
      var need = {};
      Object.keys(board).forEach(function (label) {
        var cell = board[label];
        if (cell && cell.owner) need[String(cell.owner)] = true;
      });
      Object.keys(need).forEach(function (nm) {
        var hit = gs.players.some(function (x) {
          return x && String(x.name) === nm;
        });
        if (!hit) {
          gs.players.push({
            name: nm,
            territories: [],
            cards: [],
            cardCount: 0,
            color: replayGhostColorForOwner(gs, nm),
            risqueReplayGhostPlayer: true
          });
        }
      });
    }
    gs.players.forEach(function (p) {
      p.territories = [];
    });
    Object.keys(board).forEach(function (label) {
      var cell = board[label];
      if (!cell || !cell.owner) return;
      var own = String(cell.owner);
      var pl = gs.players.find(function (x) {
        return x && String(x.name) === own;
      });
      if (pl) {
        pl.territories.push({
          name: label,
          troops: Number(cell.troops) || 0
        });
      }
    });
    gs.players.forEach(function (p) {
      p.troopsTotal = (p.territories || []).reduce(function (s, t) {
        return s + (Number(t.troops) || 0);
      }, 0);
    });
    if (replay) {
      gs.players = gs.players.filter(function (p) {
        if (!p || !p.risqueReplayGhostPlayer) return true;
        return p.territories && p.territories.length > 0;
      });
    }
  }

  function persist(gs) {
    mergeReplayPlayerColors(gs);
    try {
      localStorage.setItem("gameState", JSON.stringify(gs));
    } catch (e) {
      /* ignore */
    }
    try {
      var sk = gs && gs.risqueReplayTapeSessionKey;
      var tape = gs && gs.risqueReplayTape;
      if (sk && tape && tapeVersionOk(tape.v) && Array.isArray(tape.events) && tape.events.length) {
        localStorage.setItem(
          REPLAY_TAPE_SIDECAR_KEY,
          JSON.stringify({
            sessionKey: sk,
            v: TAPE_VERSION,
            openingRecorded: !!tape.openingRecorded,
            hasDealFrames: !!tape.hasDealFrames,
            events: tape.events,
            playerColors: gs.risqueReplayPlayerColors && typeof gs.risqueReplayPlayerColors === "object"
              ? gs.risqueReplayPlayerColors
              : {}
          })
        );
      }
    } catch (eSide) {
      /* ignore */
    }
    if (typeof window.risqueReplaySyncHostButton === "function") {
      try {
        window.risqueReplaySyncHostButton(gs);
      } catch (eSync) {
        /* ignore */
      }
    }
  }

  function stampRound(gs, evt) {
    if (!evt) return;
    var r = gs && gs.round;
    var n = typeof r === "number" ? r : parseInt(r, 10);
    evt.round = isFinite(n) && n >= 1 ? n : 1;
  }

  function pushRaw(gs, evt) {
    ensureTape(gs);
    stampRound(gs, evt);
    var tape = gs.risqueReplayTape;
    if (tape.events.length >= MAX_EVENTS) return;
    tape.events.push(evt);
    persist(gs);
  }

  /**
   * First board state at start of setup deploy (after deal), before anyone places reserves.
   * Skips a duplicate init frame when {@link risqueReplayRecordDeal} already captured the full deal sequence.
   */
  window.risqueReplaySeedOpening = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    var tape = gs.risqueReplayTape;
    if (tape.openingRecorded) return;
    tape.openingRecorded = true;
    if (tape.hasDealFrames) {
      persist(gs);
      return;
    }
    var evInit = { type: "init", board: snapshotBoard(gs) };
    stampRound(gs, evInit);
    tape.events.push(evInit);
    persist(gs);
  };

  /** One snapshot per territory during random deal (opening assignment). Host-only. */
  window.risqueReplayRecordDeal = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    var tape = gs.risqueReplayTape;
    if (tape.events.length >= MAX_EVENTS) return;
    tape.hasDealFrames = true;
    var evDeal = { type: "board", segment: "deal", board: snapshotBoard(gs) };
    stampRound(gs, evDeal);
    tape.events.push(evDeal);
    mergeReplayPlayerColors(gs);
    persist(gs);
  };

  function ensureOpeningFrom(gs) {
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    var tape = gs.risqueReplayTape;
    if (tape.openingRecorded) return;
    tape.openingRecorded = true;
    if (tape.hasDealFrames) {
      persist(gs);
      return;
    }
    var evInit2 = { type: "init", board: snapshotBoard(gs) };
    stampRound(gs, evInit2);
    tape.events.push(evInit2);
    persist(gs);
  }

  window.risqueReplayRecordDeploy = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureOpeningFrom(gs);
    pushRaw(gs, { type: "board", segment: "deploy", board: snapshotBoard(gs) });
  };

  window.risqueReplayRecordBattle = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureOpeningFrom(gs);
    pushRaw(gs, { type: "board", segment: "battle", board: snapshotBoard(gs) });
  };

  window.risqueReplayRecordElimination = function (gs, conqueror, defeated) {
    if (!shouldRecord(gs)) return;
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    if (gs.risqueReplayTape.events.length >= MAX_EVENTS) return;
    var evElim = {
      type: "elimination",
      conqueror: String(conqueror || ""),
      defeated: String(defeated || "")
    };
    stampRound(gs, evElim);
    gs.risqueReplayTape.events.push(evElim);
    persist(gs);
  };

  function removeReplayRoundHud() {
    var legacy = document.getElementById("risque-replay-round-hud");
    if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);
  }

  /**
   * Merged strip: INSTANT REPLAY + buttons + ROUND (right). Appended to #canvas.
   * @param {boolean} publicView — TV: buttons disabled (host drives playback).
   */
  function createReplayBarElement(publicView) {
    var bar = document.createElement("div");
    bar.id = "risque-replay-bar";
    bar.className = "risque-replay-bar" + (publicView ? " risque-replay-bar--public" : "");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Instant replay");
    bar.innerHTML =
      '<div class="risque-replay-bar__main">' +
      '<span class="risque-replay-bar-title">INSTANT REPLAY</span>' +
      '<button type="button" class="risque-replay-bar-btn" id="risque-replay-skip">SKIP TO END</button>' +
      '<button type="button" class="risque-replay-bar-btn risque-replay-bar-btn--done" id="risque-replay-cancel">CANCEL</button>' +
      "</div>" +
      '<div class="risque-replay-bar__round" role="status" aria-live="polite">' +
      '<span class="risque-replay-bar-round__label">ROUND</span>' +
      '<span class="risque-replay-bar-round__num" id="risque-replay-bar-round-num">1</span>' +
      "</div>";
    if (publicView) {
      var sk = bar.querySelector("#risque-replay-skip");
      var ca = bar.querySelector("#risque-replay-cancel");
      if (sk) {
        sk.disabled = true;
        sk.setAttribute("aria-disabled", "true");
        sk.title = "Host controls replay";
      }
      if (ca) {
        ca.disabled = true;
        ca.setAttribute("aria-disabled", "true");
        ca.title = "Host controls replay";
      }
    }
    return bar;
  }

  function wireReplayBarButtons(skipCb, cancelCb) {
    var sk = document.getElementById("risque-replay-skip");
    var ca = document.getElementById("risque-replay-cancel");
    if (sk && skipCb) {
      sk.onclick = function () {
        skipCb();
      };
    }
    if (ca && cancelCb) {
      ca.onclick = function () {
        cancelCb();
      };
    }
  }

  /**
   * Host + public TV: update ROUND in the merged replay strip on #canvas.
   * Creates the strip on the TV when missing (host builds it in {@link window.risqueReplayRunPlayback}).
   */
  window.risqueReplaySyncRoundHudFromState = function (gs) {
    if (!gs || !gs.risqueReplayPlaybackActive) {
      removeReplayRoundHud();
      var staleBar = document.getElementById("risque-replay-bar");
      if (staleBar && staleBar.parentNode) staleBar.parentNode.removeChild(staleBar);
      return;
    }
    var canvas = document.getElementById("canvas");
    if (!canvas) return;
    var raw = gs.risqueReplayHudRound;
    if (raw == null && gs.risquePublicReplayRound != null) {
      raw = gs.risquePublicReplayRound;
    }
    var n = typeof raw === "number" ? raw : parseInt(raw, 10);
    if (!isFinite(n) || n < 1) {
      var r2 = gs.round;
      n = typeof r2 === "number" ? r2 : parseInt(r2, 10);
    }
    if (!isFinite(n) || n < 1) n = 1;
    var bar = document.getElementById("risque-replay-bar");
    if (!bar) {
      bar = createReplayBarElement(!!window.risqueDisplayIsPublic);
      canvas.appendChild(bar);
    }
    var numEl = document.getElementById("risque-replay-bar-round-num");
    if (numEl) numEl.textContent = String(n);
  };

  function removeReplaySplash() {
    var el = document.getElementById("risque-replay-splash");
    if (el && el.parentNode) el.parentNode.removeChild(el);
    var hadSplash = !!(window.gameState && window.gameState.risquePublicReplayEliminationSplash);
    if (window.gameState) {
      delete window.gameState.risquePublicReplayEliminationSplash;
    }
    /* TV tab mirrors gameState — clear overlay there when the splash field is dropped. */
    if (
      hadSplash &&
      !window.risqueDisplayIsPublic &&
      window.gameState &&
      window.gameState.risqueReplayPlaybackActive
    ) {
      risqueReplayPushMirrorIfHost();
    }
  }

  function showEliminationSplash(conqueror, defeated) {
    removeReplaySplash();
    var root = document.createElement("div");
    root.id = "risque-replay-splash";
    root.className = "risque-replay-splash";
    root.setAttribute("role", "status");
    var line = document.createElement("div");
    line.className = "risque-replay-splash-line";
    line.textContent =
      String(conqueror || "").toUpperCase() + " CONQUERS " + String(defeated || "").toUpperCase();
    root.appendChild(line);
    document.body.appendChild(root);
    if (window.gameState) {
      window.gameState.risquePublicReplayEliminationSplash = {
        conqueror: conqueror != null ? String(conqueror) : "",
        defeated: defeated != null ? String(defeated) : ""
      };
    }
  }

  /**
   * Public TV: same full-screen replay elimination overlay as the host (mirror carries
   * {@link gameState#risquePublicReplayEliminationSplash} during instant replay).
   */
  window.risquePublicApplyReplayEliminationSplashMirror = function (gs) {
    if (!window.risqueDisplayIsPublic) return;
    var el = document.getElementById("risque-replay-splash");
    var splash = gs && gs.risquePublicReplayEliminationSplash;
    var active = gs && gs.risqueReplayPlaybackActive;
    if (!active || !splash || typeof splash !== "object") {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    var lineText =
      String(splash.conqueror || "").toUpperCase() + " CONQUERS " + String(splash.defeated || "").toUpperCase();
    if (el) {
      var ln = el.querySelector(".risque-replay-splash-line");
      if (ln) ln.textContent = lineText;
      return;
    }
    var root = document.createElement("div");
    root.id = "risque-replay-splash";
    root.className = "risque-replay-splash";
    root.setAttribute("role", "status");
    var line = document.createElement("div");
    line.className = "risque-replay-splash-line";
    line.textContent = lineText;
    root.appendChild(line);
    document.body.appendChild(root);
  };

  function replayDelayForEvent(ev) {
    if (!ev || !ev.type) return MS_BATTLE;
    if (ev.type === "init") return MS_INIT;
    if (ev.type === "elimination") return MS_ELIMINATION;
    if (ev.type === "board") {
      if (ev.segment === "deal") return MS_DEAL;
      if (ev.segment === "deploy") return MS_DEPLOY;
      return MS_BATTLE;
    }
    return MS_BATTLE;
  }

  /** Playback: opening init, deal steps, setup deploy, battles, eliminations (chronological). */
  function filterFullReplayEvents(events) {
    if (!events || !events.length) return [];
    var out = [];
    var i;
    for (i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || !e.type) continue;
      if (e.type === "init" && e.board) {
        out.push(e);
      } else if (e.type === "board" && e.board && (e.segment === "deal" || e.segment === "deploy" || e.segment === "battle")) {
        out.push(e);
      } else if (e.type === "elimination") {
        out.push(e);
      }
    }
    return out;
  }

  function getEventRound(ev) {
    if (!ev || ev.round == null) return null;
    var n = typeof ev.round === "number" ? ev.round : parseInt(ev.round, 10);
    return isFinite(n) && n >= 1 ? n : null;
  }

  function collectReplayRounds(playbackEvents) {
    var seen = {};
    var i;
    for (i = 0; i < playbackEvents.length; i++) {
      var r = getEventRound(playbackEvents[i]);
      if (r != null) seen[r] = true;
    }
    return Object.keys(seen)
      .map(function (k) {
        return parseInt(k, 10);
      })
      .filter(function (x) {
        return isFinite(x);
      })
      .sort(function (a, b) {
        return a - b;
      });
  }

  function indexFirstBattle(playbackEvents) {
    var i;
    for (i = 0; i < playbackEvents.length; i++) {
      var e = playbackEvents[i];
      if (e && e.type === "board" && e.segment === "battle") return i;
    }
    return -1;
  }

  /**
   * @param {"deal"|"first_battle"|"from_round"} mode
   * @param {number} [roundMin] — first frame whose stamped round is greater than or equal to roundMin
   */
  function replayComputeStartIndex(playbackEvents, mode, roundMin) {
    if (!playbackEvents || !playbackEvents.length) return 0;
    var m = String(mode || "deal").toLowerCase();
    if (m === "first_battle") {
      var ib = indexFirstBattle(playbackEvents);
      return ib >= 0 ? ib : 0;
    }
    if (m === "from_round") {
      var target = Number(roundMin);
      if (!isFinite(target) || target < 1) return 0;
      var j;
      for (j = 0; j < playbackEvents.length; j++) {
        var r = getEventRound(playbackEvents[j]);
        if (r != null && r >= target) return j;
      }
      return 0;
    }
    return 0;
  }

  function removeReplayStartOverlay() {
    var el = document.getElementById("risque-replay-start-overlay");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /**
   * Host: choose full replay from deal (default), skip to first battle, or jump to a round.
   * Calls onPick(startIndex) or onCancel().
   */
  window.risqueReplayShowStartChooser = function (playbackEvents, onPick, onCancel) {
    removeReplayStartOverlay();
    var rounds = collectReplayRounds(playbackEvents);
    var hasRounds = rounds.length > 0;
    var ib = indexFirstBattle(playbackEvents);
    var hasBattle = ib >= 0;

    var overlay = document.createElement("div");
    overlay.id = "risque-replay-start-overlay";
    overlay.className = "risque-replay-start-overlay";
    overlay.setAttribute("role", "presentation");

    var dlg = document.createElement("div");
    dlg.className = "risque-replay-start-dialog";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-labelledby", "risque-replay-start-heading");

    var title = document.createElement("div");
    title.id = "risque-replay-start-heading";
    title.className = "risque-replay-start-title";
    title.textContent = "INSTANT REPLAY";

    var sub = document.createElement("div");
    sub.className = "risque-replay-start-sub";
    sub.textContent = "Start from:";

    function rowRadio(value, labelText, checked, disabled) {
      var row = document.createElement("label");
      row.className = "risque-replay-start-row";
      if (disabled) row.className += " risque-replay-start-row--disabled";
      var inp = document.createElement("input");
      inp.type = "radio";
      inp.name = "risque-replay-start-mode";
      inp.value = value;
      inp.checked = !!checked;
      inp.disabled = !!disabled;
      var span = document.createElement("span");
      span.textContent = labelText;
      row.appendChild(inp);
      row.appendChild(span);
      return { row: row, input: inp };
    }

    var rDeal = rowRadio("deal", "Full — from territory deal (default)", true, false);
    var rBattle = rowRadio("first_battle", "Skip to first battle", false, !hasBattle);
    var rRound = rowRadio("from_round", "From round — first frame at or after:", false, !hasRounds);

    var roundSelect = document.createElement("select");
    roundSelect.id = "risque-replay-start-round";
    roundSelect.className = "risque-replay-start-round-select";
    roundSelect.disabled = !hasRounds;
    var ri;
    for (ri = 0; ri < rounds.length; ri++) {
      var opt = document.createElement("option");
      opt.value = String(rounds[ri]);
      opt.textContent = "Round " + rounds[ri];
      roundSelect.appendChild(opt);
    }

    var roundIndent = document.createElement("div");
    roundIndent.className = "risque-replay-start-round-indent";
    roundIndent.appendChild(roundSelect);

    if (!hasRounds) {
      var hint = document.createElement("div");
      hint.className = "risque-replay-start-hint";
      hint.textContent =
        "Round labels are unavailable for this recording (tape from before round stamps). Use full replay or skip to battle.";
      roundIndent.appendChild(hint);
    }

    var actions = document.createElement("div");
    actions.className = "risque-replay-start-actions";
    var btnOk = document.createElement("button");
    btnOk.type = "button";
    btnOk.className = "risque-replay-start-btn risque-replay-start-btn--primary";
    btnOk.id = "risque-replay-start-ok";
    btnOk.textContent = "START";
    var btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.className = "risque-replay-start-btn";
    btnCancel.id = "risque-replay-start-cancel";
    btnCancel.textContent = "CANCEL";
    actions.appendChild(btnOk);
    actions.appendChild(btnCancel);

    dlg.appendChild(title);
    dlg.appendChild(sub);
    dlg.appendChild(rDeal.row);
    dlg.appendChild(rBattle.row);
    dlg.appendChild(rRound.row);
    dlg.appendChild(roundIndent);
    dlg.appendChild(actions);
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);

    function selectedMode() {
      var radios = dlg.querySelectorAll('input[name="risque-replay-start-mode"]');
      var i;
      for (i = 0; i < radios.length; i++) {
        if (radios[i].checked) return radios[i].value;
      }
      return "deal";
    }

    function syncRoundEnabled() {
      roundSelect.disabled = !hasRounds || selectedMode() !== "from_round";
    }

    function onRadioChange() {
      syncRoundEnabled();
    }

    rDeal.input.addEventListener("change", onRadioChange);
    rBattle.input.addEventListener("change", onRadioChange);
    rRound.input.addEventListener("change", onRadioChange);
    roundSelect.addEventListener("change", function () {
      rRound.input.checked = true;
      syncRoundEnabled();
    });
    roundSelect.addEventListener("mousedown", function () {
      if (!rRound.input.disabled) rRound.input.checked = true;
    });

    function detachKey() {
      document.removeEventListener("keydown", onKey);
    }

    function finishPick() {
      var mode = selectedMode();
      var rn = rounds.length ? parseInt(roundSelect.value, 10) : 1;
      if (mode === "from_round" && !hasRounds) mode = "deal";
      if (mode === "first_battle" && !hasBattle) mode = "deal";
      var startIdx = replayComputeStartIndex(playbackEvents, mode, rn);
      detachKey();
      removeReplayStartOverlay();
      if (typeof onPick === "function") onPick(startIdx);
    }

    function finishCancel() {
      detachKey();
      removeReplayStartOverlay();
      if (typeof onCancel === "function") onCancel();
    }

    btnOk.addEventListener("click", function (e) {
      e.preventDefault();
      finishPick();
    });
    btnCancel.addEventListener("click", function (e) {
      e.preventDefault();
      finishCancel();
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) finishCancel();
    });

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        finishCancel();
      }
    }
    document.addEventListener("keydown", onKey);

    syncRoundEnabled();
    try {
      btnOk.focus();
    } catch (eF) {
      /* ignore */
    }
  };

  window.risqueReplayHasTape = function (gs) {
    try {
      var t = gs && gs.risqueReplayTape;
      if (!t || !tapeVersionOk(t.v) || !t.events || !t.events.length) return false;
      return filterFullReplayEvents(t.events).length > 0;
    } catch (e) {
      return false;
    }
  };

  window.risqueReplayClearTapeSidecar = function () {
    try {
      localStorage.removeItem(REPLAY_TAPE_SIDECAR_KEY);
    } catch (e) {
      /* ignore */
    }
  };

  /**
   * Host boot: if main gameState JSON lost the tape (quota, partial write) but the sidecar still has
   * the same session, restore so REPLAY stays available in postgame.
   */
  window.risqueReplayMergeTapeFromSidecar = function (gs) {
    if (!gs || gs.risqueReplayPlaybackActive || window.risqueDisplayIsPublic) return;
    try {
      if (window.risqueReplayHasTape(gs)) return;
    } catch (eHas) {
      return;
    }
    var raw;
    try {
      raw = localStorage.getItem(REPLAY_TAPE_SIDECAR_KEY);
    } catch (e0) {
      return;
    }
    if (!raw) return;
    var side;
    try {
      side = JSON.parse(raw);
    } catch (e1) {
      return;
    }
    if (!side || !tapeVersionOk(side.v) || !Array.isArray(side.events) || !side.events.length) return;
    var i;
    var hasPlayback = false;
    for (i = 0; i < side.events.length; i++) {
      var ev = side.events[i];
      if (!ev || !ev.type) continue;
      if (ev.type === "init" && ev.board) {
        hasPlayback = true;
        break;
      }
      if (ev.type === "board" && ev.board && (ev.segment === "deal" || ev.segment === "deploy" || ev.segment === "battle")) {
        hasPlayback = true;
        break;
      }
      if (ev.type === "elimination") {
        hasPlayback = true;
        break;
      }
    }
    if (!hasPlayback) return;
    if (side.sessionKey && gs.risqueReplayTapeSessionKey) {
      if (side.sessionKey !== gs.risqueReplayTapeSessionKey) return;
    } else if (side.sessionKey || gs.risqueReplayTapeSessionKey) {
      return;
    }
    gs.risqueReplayTape = {
      v: TAPE_VERSION,
      events: side.events.slice(),
      openingRecorded: !!side.openingRecorded,
      hasDealFrames: !!side.hasDealFrames
    };
    if (side.sessionKey) {
      gs.risqueReplayTapeSessionKey = side.sessionKey;
    }
    if (side.playerColors && typeof side.playerColors === "object") {
      gs.risqueReplayPlayerColors = Object.assign({}, side.playerColors);
    }
    try {
      localStorage.setItem("gameState", JSON.stringify(gs));
    } catch (eSave) {
      /* ignore */
    }
    if (typeof window.risqueReplaySyncHostButton === "function") {
      try {
        window.risqueReplaySyncHostButton(gs);
      } catch (eSb) {
        /* ignore */
      }
    }
  };

  /** Host: hide replay during login / setup / privacy gate only. */
  window.risqueReplayPhaseBlocksHostUi = function (gs) {
    if (!gs) return false;
    var ph = String(gs.phase || "").toLowerCase();
    if (ph === "login") return true;
    if (ph === "playerselect") return true;
    if (ph === "privacygate" || ph === "privacy-gate") return true;
    return false;
  };

  window.risqueReplaySyncHostButton = function (gsOpt) {
    if (window.risqueDisplayIsPublic) return;
    var btn = document.getElementById("risque-host-instant-replay-btn");
    if (!btn) return;
    var gs = gsOpt != null ? gsOpt : window.gameState;
    var has = gs && window.risqueReplayHasTape(gs);
    var playing = gs && gs.risqueReplayPlaybackActive;
    var blocked =
      typeof window.risqueReplayPhaseBlocksHostUi === "function" &&
      window.risqueReplayPhaseBlocksHostUi(gs);
    if (blocked) {
      btn.disabled = true;
      btn.setAttribute("hidden", "hidden");
      btn.title = "Replay is not available on this screen.";
      return;
    }
    btn.removeAttribute("hidden");
    btn.disabled = !has || !!playing;
    btn.title = playing
      ? "Instant replay in progress — CANCEL or SKIP TO END on the replay strip (lower-left on the map)."
      : has
        ? "Instant replay — choose start (default: full from territory deal), then playback on the TV."
        : "Replay unavailable until the game records an opening (deal or deploy) or a battle.";
  };

  window.risqueReplayStop = function () {
    if (window.__risqueReplayTimer != null) {
      clearTimeout(window.__risqueReplayTimer);
      window.__risqueReplayTimer = null;
    }
    removeReplayStartOverlay();
    removeReplaySplash();
    removeReplayRoundHud();
    var barEarly = document.getElementById("risque-replay-bar");
    if (barEarly && barEarly.parentNode) barEarly.parentNode.removeChild(barEarly);
    if (window.__risqueReplayFrozenGameStateJson) {
      try {
        window.gameState = JSON.parse(window.__risqueReplayFrozenGameStateJson);
        delete window.gameState.risqueReplayPlaybackActive;
        delete window.gameState.phaseReplayIndex;
        try {
          localStorage.setItem("gameState", JSON.stringify(window.gameState));
        } catch (e2) {}
        if (window.gameUtils) {
          window.gameUtils.renderTerritories(null, window.gameState);
          window.gameUtils.renderStats(window.gameState);
        }
        risqueReplayPushMirrorIfHost();
      } catch (e) {
        /* ignore */
      }
    }
    window.__risqueReplayFrozenGameStateJson = null;
    if (typeof window.risqueReplaySyncHostButton === "function") {
      try {
        window.risqueReplaySyncHostButton(window.gameState);
      } catch (eSb) {
        /* ignore */
      }
    }
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
      var gs2 = window.gameState;
      var ph = gs2 && String(gs2.phase || "");
      if (ph === "postgame" && gs2.winner) {
        window.risqueRuntimeHud.setControlVoiceText(
          String(gs2.winner).toUpperCase() + " WINS — POSTGAME REVIEW",
          "Replay finished.",
          { force: true }
        );
      } else if (gs2 && gs2.currentPlayer) {
        window.risqueRuntimeHud.setControlVoiceText(
          String(gs2.currentPlayer).toUpperCase() + " — " + ph.toUpperCase(),
          "Replay finished.",
          { force: true }
        );
      } else {
        window.risqueRuntimeHud.setControlVoiceText("RISQUE", "Replay finished.", { force: true });
      }
    }
  };

  /**
   * Host: run instant replay from a frame index (0 = territory deal / full opening).
   * Prefer {@link window.risqueReplayStart} so the host can pick deal vs battle vs round.
   */
  window.risqueReplayRunPlayback = function (startIndex) {
    var gs = window.gameState;
    if (!gs || !window.risqueReplayHasTape(gs)) return;
    if (!window.gameUtils) return;

    mergeReplayPlayerColors(gs);
    window.risqueReplayStop();
    gs = window.gameState;
    if (!gs || !window.risqueReplayHasTape(gs)) return;
    window.__risqueReplayFrozenGameStateJson = JSON.stringify(gs);

    var tape = gs.risqueReplayTape;
    var events = tape.events.slice();
    var playbackEvents = filterFullReplayEvents(events);
    if (!playbackEvents.length) return;
    var idx = Math.max(
      0,
      Math.min(Math.floor(Number(startIndex)) || 0, Math.max(0, playbackEvents.length - 1))
    );

    var replayRoundFallback = (function () {
      var r = gs.round;
      var n = typeof r === "number" ? r : parseInt(r, 10);
      return isFinite(n) && n >= 1 ? n : 1;
    })();
    var lastStampedRound = null;

    var canvasEl = document.getElementById("canvas");
    if (!canvasEl) return;

    gs.risqueReplayPlaybackActive = true;
    try {
      localStorage.setItem("gameState", JSON.stringify(gs));
    } catch (e) {}
    if (typeof window.risqueReplaySyncHostButton === "function") {
      try {
        window.risqueReplaySyncHostButton(gs);
      } catch (eSb2) {
        /* ignore */
      }
    }
    var bar = createReplayBarElement(false);
    canvasEl.appendChild(bar);
    gs.risqueReplayHudRound = replayRoundFallback;
    if (typeof window.risqueReplaySyncRoundHudFromState === "function") {
      try {
        window.risqueReplaySyncRoundHudFromState(gs);
      } catch (eHud0) {
        /* ignore */
      }
    }
    wireReplayBarButtons(
      function () {
        idx = playbackEvents.length;
        step();
      },
      function () {
        window.risqueReplayStop();
      }
    );

    function replayVoiceForEvent(ev) {
      if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
        if (!ev) return;
        if (ev.type === "init") {
          window.risqueRuntimeHud.setControlVoiceText("INSTANT REPLAY", "Opening board — before setup deploy.", {
            force: true
          });
        } else if (ev.type === "board" && ev.segment === "deal") {
          window.risqueRuntimeHud.setControlVoiceText("INSTANT REPLAY", "Territory deal — random assignment.", {
            force: true
          });
        } else if (ev.type === "board" && ev.segment === "deploy") {
          window.risqueRuntimeHud.setControlVoiceText("INSTANT REPLAY", "Setup deploy — placing starting troops.", {
            force: true
          });
        } else if (ev.type === "board" && ev.segment === "battle") {
          window.risqueRuntimeHud.setControlVoiceText("INSTANT REPLAY", "Battle — board after combat.", { force: true });
        } else if (ev.type === "elimination") {
          window.risqueRuntimeHud.setControlVoiceText(
            "INSTANT REPLAY",
            String(ev.conqueror || "").toUpperCase() + " eliminates " + String(ev.defeated || "").toUpperCase(),
            { force: true }
          );
        }
      }
    }

    window.__risqueReplayTimer = setTimeout(function () {
      window.__risqueReplayTimer = null;
      if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
        window.risqueRuntimeHud.setControlVoiceText("INSTANT REPLAY", "Playing recorded map…", { force: true });
      }
      step();
    }, MS_REPLAY_START_HOLD);

    function step() {
      if (window.__risqueReplayTimer != null) {
        clearTimeout(window.__risqueReplayTimer);
        window.__risqueReplayTimer = null;
      }
      removeReplaySplash();
      if (!window.gameState || !window.gameState.risqueReplayPlaybackActive) return;

      if (idx >= playbackEvents.length) {
        window.risqueReplayStop();
        return;
      }

      var ev = playbackEvents[idx];
      idx += 1;
      gs.phaseReplayIndex = idx;

      var stamped = getEventRound(ev);
      if (stamped != null) {
        lastStampedRound = stamped;
        gs.round = stamped;
      }
      gs.risqueReplayHudRound = lastStampedRound != null ? lastStampedRound : replayRoundFallback;
      if (typeof window.risqueReplaySyncRoundHudFromState === "function") {
        try {
          window.risqueReplaySyncRoundHudFromState(gs);
        } catch (eHud) {
          /* ignore */
        }
      }

      if (ev.type === "init") {
        applyBoard(gs, ev.board);
        replayVoiceForEvent(ev);
        window.gameUtils.renderTerritories(null, gs);
        window.gameUtils.renderStats(gs);
        risqueReplayPushMirrorIfHost();
      } else if (ev.type === "board") {
        applyBoard(gs, ev.board);
        replayVoiceForEvent(ev);
        window.gameUtils.renderTerritories(null, gs);
        window.gameUtils.renderStats(gs);
        risqueReplayPushMirrorIfHost();
      } else if (ev.type === "elimination") {
        showEliminationSplash(ev.conqueror, ev.defeated);
        replayVoiceForEvent(ev);
        risqueReplayPushMirrorIfHost();
      }

      var d = replayDelayForEvent(ev);
      window.__risqueReplayTimer = setTimeout(step, d);
    }

  };

  window.risqueReplayStart = function () {
    var gs = window.gameState;
    if (!gs || !window.risqueReplayHasTape(gs)) return;
    if (!window.gameUtils) return;
    mergeReplayPlayerColors(gs);
    var playbackEvents = filterFullReplayEvents(gs.risqueReplayTape.events.slice());
    if (!playbackEvents.length) return;
    window.risqueReplayShowStartChooser(playbackEvents, function (startIdx) {
      window.risqueReplayRunPlayback(startIdx);
    });
  };

  window.risqueReplayStartFromPostgame = window.risqueReplayStart;

  document.addEventListener("click", function (e) {
    if (window.risqueDisplayIsPublic) return;
    var t = e.target && e.target.closest && e.target.closest("#risque-host-instant-replay-btn");
    if (!t || t.disabled || t.hasAttribute("hidden")) return;
    e.preventDefault();
    if (typeof window.risqueReplayStart === "function") {
      window.risqueReplayStart();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (!window.gameState || !window.gameState.risqueReplayPlaybackActive) return;
    if (e.key === "Escape") {
      e.preventDefault();
      window.risqueReplayStop();
    }
  });
})();
