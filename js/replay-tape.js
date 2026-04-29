/**
 * Battle replay: territory snapshots recorded per round. Playback lives in replay-machine.html.
 * Events live in risqueReplayByRound (no global cap — avoids losing early rounds). Each round bucket has a per-round cap.
 */
(function () {
  "use strict";

  var TAPE_VERSION = 2;
  /** Per completed round only — deal-heavy round 1 can be large; battles rarely approach this. */
  var MAX_EVENTS_PER_ROUND = 12000;

  var REPLAY_STRIP_KEYS = [
    "risqueReplayTape",
    "risqueReplayTapeSessionKey",
    "risqueReplayPlayerColors",
    "risqueReplayByRound",
    "risqueReplayPlaybackActive",
    "risqueReplayHudRound",
    "risqueReplayBattleFlashLabels",
    "risquePublicReplayRound",
    "risquePublicReplayEliminationSplash",
    "phaseReplayIndex"
  ];

  function tapeVersionOk(v) {
    return v === 1 || v === TAPE_VERSION;
  }

  window.risqueStripReplayFromGameStateClone = function (gs) {
    if (!gs || typeof gs !== "object") return gs;
    var out;
    try {
      out = JSON.parse(JSON.stringify(gs));
    } catch (e) {
      return gs;
    }
    REPLAY_STRIP_KEYS.forEach(function (k) {
      delete out[k];
    });
    return out;
  };

  function ensureReplayByRound(gs) {
    if (!gs || typeof gs !== "object") return;
    if (!gs.risqueReplayByRound || typeof gs.risqueReplayByRound !== "object") {
      gs.risqueReplayByRound = {};
    }
  }

  /**
   * One-time split: legacy saves only had risqueReplayTape.events. After migrate, new events go only to byRound.
   */
  function migrateLegacyTapeToByRound(gs) {
    if (!gs || !gs.risqueReplayTape || !Array.isArray(gs.risqueReplayTape.events)) return;
    ensureReplayByRound(gs);
    if (Object.keys(gs.risqueReplayByRound).length > 0) return;
    if (!gs.risqueReplayTape.events.length) return;
    gs.risqueReplayTape.events.forEach(function (ev) {
      var rk = ev && ev.round != null ? String(ev.round) : "1";
      if (!Array.isArray(gs.risqueReplayByRound[rk])) gs.risqueReplayByRound[rk] = [];
      gs.risqueReplayByRound[rk].push(ev);
    });
    gs.risqueReplayTape.events = [];
  }

  /**
   * Ordered event list (e.g. Mock Game Maker). Migrates legacy tape if needed.
   */
  window.risqueReplayFlattenEvents = function (gs) {
    if (!gs) return [];
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    var keys = Object.keys(gs.risqueReplayByRound).sort(function (a, b) {
      return Number(a) - Number(b);
    });
    var out = [];
    keys.forEach(function (k) {
      (gs.risqueReplayByRound[k] || []).forEach(function (e) {
        out.push(e);
      });
    });
    return out;
  };

  /**
   * Sidecar JSON for one completed round only (smaller files; chain in replay machine).
   * @param {object} gs
   * @param {number} [exportRound] — completed round number; defaults to gs.round
   */
  window.risqueBuildRoundReplayExport = function (gs, exportRound) {
    if (!gs || typeof gs !== "object") return null;
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    var n =
      exportRound != null && isFinite(Number(exportRound))
        ? Math.floor(Number(exportRound))
        : (function () {
            var r = gs.round;
            var x = typeof r === "number" ? r : parseInt(r, 10);
            return isFinite(x) && x >= 1 ? x : 1;
          })();
    var key = String(n);
    var evs = gs.risqueReplayByRound[key];
    if (!Array.isArray(evs) || !evs.length) return null;
    var slice = evs.slice();
    var openingRecorded = slice.some(function (e) {
      return e && e.type === "init";
    });
    var hasDealFrames = slice.some(function (e) {
      return e && e.type === "board" && e.segment === "deal";
    });
    return {
      format: "risque-replay-v1",
      replayScope: "round",
      replayRound: n,
      tapeFormatVersion: TAPE_VERSION,
      savedAt: Date.now(),
      round: gs.round,
      phase: gs.phase != null ? String(gs.phase) : "",
      currentPlayer: gs.currentPlayer != null ? String(gs.currentPlayer) : "",
      sessionKey: gs.risqueReplayTapeSessionKey || null,
      playerColors:
        gs.risqueReplayPlayerColors && typeof gs.risqueReplayPlayerColors === "object"
          ? gs.risqueReplayPlayerColors
          : {},
      tape: {
        v: TAPE_VERSION,
        events: slice,
        openingRecorded: openingRecorded,
        hasDealFrames: hasDealFrames
      }
    };
  };

  function shouldRecord(gs) {
    if (!gs || typeof gs !== "object") return false;
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
    if (tape.v !== TAPE_VERSION) {
      tape.v = TAPE_VERSION;
    }
    if (!Array.isArray(tape.events)) {
      tape.events = [];
    }
    if (typeof tape.hasDealFrames !== "boolean") {
      tape.hasDealFrames = window.risqueReplayFlattenEvents(gs).some(function (e) {
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

  function stampRound(gs, evt) {
    if (!evt) return;
    var r = gs && gs.round;
    var n = typeof r === "number" ? r : parseInt(r, 10);
    evt.round = isFinite(n) && n >= 1 ? n : 1;
  }

  function appendReplayEvent(gs, evt) {
    if (!gs || !evt) return false;
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    stampRound(gs, evt);
    var k = String(evt.round != null ? evt.round : 1);
    if (!Array.isArray(gs.risqueReplayByRound[k])) gs.risqueReplayByRound[k] = [];
    var bucket = gs.risqueReplayByRound[k];
    if (bucket.length >= MAX_EVENTS_PER_ROUND) return false;
    bucket.push(evt);
    return true;
  }

  function pushMirror() {
    if (typeof window.risqueMirrorPushGameState === "function") {
      try {
        window.risqueMirrorPushGameState();
      } catch (eM) {
        /* ignore */
      }
    }
  }

  function pushRaw(gs, evt) {
    ensureTape(gs);
    if (!appendReplayEvent(gs, evt)) return;
    mergeReplayPlayerColors(gs);
    pushMirror();
  }

  window.risqueReplaySeedOpening = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    migrateLegacyTapeToByRound(gs);
    var tape = gs.risqueReplayTape;
    if (tape.openingRecorded) return;
    tape.openingRecorded = true;
    if (tape.hasDealFrames) {
      mergeReplayPlayerColors(gs);
      pushMirror();
      return;
    }
    var evInit = { type: "init", board: snapshotBoard(gs) };
    if (!appendReplayEvent(gs, evInit)) return;
    mergeReplayPlayerColors(gs);
    pushMirror();
  };

  window.risqueReplayRecordDeal = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    var tape = gs.risqueReplayTape;
    tape.hasDealFrames = true;
    var evDeal = { type: "board", segment: "deal", board: snapshotBoard(gs) };
    pushRaw(gs, evDeal);
  };

  function ensureOpeningFrom(gs) {
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    migrateLegacyTapeToByRound(gs);
    var tape = gs.risqueReplayTape;
    if (tape.openingRecorded) return;
    tape.openingRecorded = true;
    if (tape.hasDealFrames) {
      mergeReplayPlayerColors(gs);
      pushMirror();
      return;
    }
    var evInit2 = { type: "init", board: snapshotBoard(gs) };
    if (!appendReplayEvent(gs, evInit2)) return;
    mergeReplayPlayerColors(gs);
    pushMirror();
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

  /** Fortify / reinforcement transfers — kept distinct from battle frames so replay can include final moves. */
  window.risqueReplayRecordReinforce = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureOpeningFrom(gs);
    pushRaw(gs, { type: "board", segment: "reinforce", board: snapshotBoard(gs) });
  };

  window.risqueReplayRecordElimination = function (gs, conqueror, defeated) {
    if (!shouldRecord(gs)) return;
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    var evElim = {
      type: "elimination",
      conqueror: String(conqueror || ""),
      defeated: String(defeated || "")
    };
    pushRaw(gs, evElim);
  };

  window.risqueReplayClearTapeSidecar = function () {
    try {
      localStorage.removeItem("risqueReplayTapeSidecar");
    } catch (e) {
      /* ignore */
    }
  };
})();
