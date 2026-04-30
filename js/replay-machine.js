/**
 * Standalone battle tape playback (risque-replay-v1 JSON). Uses core.js map rendering only.
 */
(function () {
  "use strict";

  var TAPE_VERSION = 2;
  var MS_DEPLOY = 90;
  var MS_BATTLE = 140;
  /** Hold after elimination splash so flash + message are readable (scaled by playback speed). */
  var MS_ELIMINATION = 1300;
  var MS_INIT = 80;
  var MS_DEAL = 95;
  var MS_REPLAY_START_HOLD = 450;
  /** After a successful load, start playback automatically (pause with PAUSE or STOP). */
  var AUTO_START_PLAYBACK_AFTER_LOAD = true;
  var AUTO_START_DELAY_MS = 320;

  function tapeVersionOk(v) {
    var n = typeof v === "number" ? v : parseInt(v, 10);
    return n === 1 || n === TAPE_VERSION;
  }

  function speedMultiplier() {
    var el = document.getElementById("risque-replay-speed");
    var n = el ? Number(el.value) : 100;
    if (!Number.isFinite(n) || n < 25) n = 25;
    if (n > 200) n = 200;
    return n / 100;
  }

  function scaledDelay(ms) {
    var sp = speedMultiplier();
    if (sp <= 0) return ms;
    return Math.max(16, Math.round(ms / sp));
  }

  function setStatus(msg) {
    var el = document.getElementById("risque-replay-status");
    if (el) el.textContent = msg || "";
  }

  function setReplayEndedLine(on) {
    var el = document.getElementById("risque-replay-ended");
    if (!el) return;
    el.textContent = on ? "REPLAY ENDED" : "";
  }

  /** Round label for merge / UI; falls back to first stamped event round in the tape. */
  function effectiveReplayRoundFromPack(p) {
    if (!p) return 0;
    var rr = Number(p.replayRound != null ? p.replayRound : p.round) || 0;
    if (rr >= 1) return rr;
    var evs = p.tape && p.tape.events;
    if (!Array.isArray(evs) || !evs.length) return 0;
    var i;
    var minR = 0;
    for (i = 0; i < evs.length; i++) {
      var er = getEventRound(evs[i]);
      if (er != null && (minR === 0 || er < minR)) minR = er;
    }
    return minR;
  }

  function packSavedAtMs(p) {
    var n = p && p.savedAt != null ? Number(p.savedAt) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function formatReplaySavedAtChip(ms) {
    var n = packSavedAtMs({ savedAt: ms });
    if (!n) return "—";
    try {
      return new Date(n).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (e) {
      return "—";
    }
  }

  /**
   * Dedupe by replay round (newest savedAt wins), then concatenate in save-time order
   * (oldest file first). Round chips / seek still use round numbers inside the tape.
   */
  function mergeReplayPacks(packs) {
    if (!packs || !packs.length) return null;
    if (packs.length === 1) return packs[0];
    var byRound = {};
    var dupRounds = [];
    packs.forEach(function (p) {
      var rr = effectiveReplayRoundFromPack(p);
      if (!rr) return;
      var prev = byRound[rr];
      var sav = packSavedAtMs(p);
      var prevSav = prev ? packSavedAtMs(prev) : -1;
      if (prev) {
        dupRounds.push(rr);
        if (sav >= prevSav) {
          byRound[rr] = p;
        }
      } else {
        byRound[rr] = p;
      }
    });
    var roundNums = Object.keys(byRound)
      .map(function (k) {
        return Number(k);
      })
      .filter(function (n) {
        return n > 0;
      });
    var survivors = roundNums.map(function (r) {
      var pk = byRound[r];
      return { pack: pk, rr: r, sav: packSavedAtMs(pk) };
    });
    survivors.sort(function (a, b) {
      if (a.sav !== b.sav) return a.sav - b.sav;
      return a.rr - b.rr;
    });
    var sorted = survivors.map(function (s) {
      return s.pack;
    });
    var replayRoundOrder = survivors.map(function (s) {
      return s.rr;
    });
    var rrMonotone = true;
    var i;
    for (i = 1; i < survivors.length; i++) {
      if (survivors[i].rr < survivors[i - 1].rr) {
        rrMonotone = false;
        break;
      }
    }
    var events = [];
    var lastR = 0;
    var gaps = [];
    for (i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var rr = survivors[i].rr;
      var te = p.tape && p.tape.events;
      if (te && te.length) {
        events = events.concat(te);
      }
      if (lastR > 0 && rr > lastR + 1) {
        gaps.push("jump from round " + lastR + " to " + rr);
      }
      lastR = rr;
    }
    var headLast = sorted[sorted.length - 1];
    var headFirst = sorted[0];
    var skSet = {};
    sorted.forEach(function (q) {
      if (q.sessionKey) skSet[String(q.sessionKey)] = true;
    });
    var skList = Object.keys(skSet);
    var warns = [];
    if (dupRounds.length) {
      var uniqDup = [];
      dupRounds.forEach(function (d) {
        if (uniqDup.indexOf(d) === -1) uniqDup.push(d);
      });
      warns.push("Same round appeared in multiple files — kept the newest by save time: " + uniqDup.join(", "));
    }
    if (gaps.length) {
      warns.push("Some rounds missing between segments: " + gaps.join("; ") + " (still playing what you loaded).");
    }
    if (!rrMonotone) {
      warns.push("Save-time order does not match ascending round numbers — playback follows save timestamps.");
    }
    if (skList.length > 1) warns.push("Mixed session keys across files — OK if you meant to combine sessions.");
    var evs = events;
    return {
      format: "risque-replay-v1",
      replayScope: "merged",
      replayRounds: replayRoundOrder,
      tapeFormatVersion: TAPE_VERSION,
      savedAt: Date.now(),
      round: headLast.round,
      phase: headLast.phase,
      currentPlayer: headLast.currentPlayer,
      sessionKey: headLast.sessionKey,
      playerColors:
        headFirst.playerColors && typeof headFirst.playerColors === "object"
          ? headFirst.playerColors
          : headLast.playerColors || {},
      tape: {
        v: TAPE_VERSION,
        events: evs,
        openingRecorded: evs.some(function (e) {
          return e && e.type === "init";
        }),
        hasDealFrames: evs.some(function (e) {
          return e && e.type === "board" && e.segment === "deal";
        })
      },
      __mergeWarnings: warns
    };
  }

  function looksLikeGameBackupNotTape(raw) {
    return (
      raw &&
      typeof raw === "object" &&
      Array.isArray(raw.players) &&
      raw.phase &&
      !raw.format &&
      !raw.risqueReplayTape
    );
  }

  function normalizeImportedReplay(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.format === "risque-replay-v1" && raw.tape && tapeVersionOk(raw.tape.v)) {
      if (!Array.isArray(raw.tape.events)) return null;
      if (!packSavedAtMs(raw)) {
        try {
          raw.savedAt = Date.now();
        } catch (eSa) {
          /* ignore */
        }
      }
      return raw;
    }
    if (raw.risqueReplayTape && tapeVersionOk(raw.risqueReplayTape.v)) {
      if (!Array.isArray(raw.risqueReplayTape.events)) return null;
      var sav =
        packSavedAtMs(raw) ||
        (raw.exportedAt != null && isFinite(Number(raw.exportedAt)) ? Number(raw.exportedAt) : 0) ||
        Date.now();
      return {
        format: "risque-replay-v1",
        tapeFormatVersion: TAPE_VERSION,
        savedAt: sav,
        round: raw.round,
        phase: raw.phase,
        currentPlayer: raw.currentPlayer,
        sessionKey: raw.risqueReplayTapeSessionKey || null,
        playerColors:
          raw.risqueReplayPlayerColors && typeof raw.risqueReplayPlayerColors === "object"
            ? raw.risqueReplayPlayerColors
            : {},
        tape: {
          v: raw.risqueReplayTape.v,
          events: raw.risqueReplayTape.events,
          openingRecorded: !!raw.risqueReplayTape.openingRecorded,
          hasDealFrames: !!raw.risqueReplayTape.hasDealFrames
        }
      };
    }
    return null;
  }

  function replayGhostColorForOwner(gs, ownerName) {
    var nm = String(ownerName || "");
    var m = gs && gs.risqueReplayPlayerColors;
    if (m && m[nm]) return m[nm];
    return "black";
  }

  function applyBoard(gs, board) {
    if (!gs || !gs.players || !board) return;
    var replay = !!gs.risqueReplayPlaybackActive;
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

  function boardSnapshotFromTape(board) {
    if (!board || typeof board !== "object") return {};
    var out = {};
    Object.keys(board).forEach(function (k) {
      var c = board[k];
      if (c && c.owner) {
        out[k] = { owner: String(c.owner), troops: Number(c.troops) || 0 };
      }
    });
    return out;
  }

  function replayDiffChangedTerritoryLabels(prev, next) {
    var labels = [];
    var seen = {};
    function add(lab) {
      if (!lab || seen[lab]) return;
      seen[lab] = true;
      labels.push(lab);
    }
    var keys = {};
    if (prev) Object.keys(prev).forEach(function (k) {
      keys[k] = true;
    });
    if (next) Object.keys(next).forEach(function (k) {
      keys[k] = true;
    });
    Object.keys(keys).forEach(function (lab) {
      var a = prev ? prev[lab] : null;
      var b = next ? next[lab] : null;
      if (!a && !b) return;
      if (!a || !b) {
        add(lab);
        return;
      }
      if (String(a.owner) !== String(b.owner) || (Number(a.troops) || 0) !== (Number(b.troops) || 0)) {
        add(lab);
      }
    });
    return labels;
  }

  function filterFullReplayEvents(events) {
    if (!events || !events.length) return [];
    var out = [];
    var i;
    for (i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || !e.type) continue;
      if (e.type === "init" && e.board) {
        out.push(e);
      } else if (
        e.type === "board" &&
        e.board &&
        (e.segment === "deal" ||
          e.segment === "deploy" ||
          e.segment === "battle" ||
          e.segment === "reinforce")
      ) {
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

  function replayDelayForEvent(ev) {
    if (!ev || !ev.type) return scaledDelay(MS_BATTLE);
    if (ev.type === "init") return scaledDelay(MS_INIT);
    if (ev.type === "elimination") return scaledDelay(MS_ELIMINATION);
    if (ev.type === "board") {
      if (ev.segment === "deal") return scaledDelay(MS_DEAL);
      if (ev.segment === "deploy") return scaledDelay(MS_DEPLOY);
      if (ev.segment === "reinforce") return scaledDelay(MS_DEPLOY);
      return scaledDelay(MS_BATTLE);
    }
    return scaledDelay(MS_BATTLE);
  }

  function replayApplyOnePlayback(gs, ev, ctx) {
    if (!gs || !ev || !window.gameUtils) return;
    ctx = ctx || {};
    var skipFx = !!ctx.skipFx;
    var stamped = getEventRound(ev);
    if (stamped != null) {
      ctx.lastStampedRound = stamped;
      gs.round = stamped;
    }
    gs.risqueReplayHudRound =
      ctx.lastStampedRound != null ? ctx.lastStampedRound : ctx.replayRoundFallback;
    if (ev.type === "board" && ev.segment === "deal") {
      gs.risqueReplayMachineHudPhase = "deal";
    } else {
      delete gs.risqueReplayMachineHudPhase;
    }

    if (ev.type === "init") {
      delete gs.risqueReplayBattleFlashLabels;
      applyBoard(gs, ev.board);
      refreshTurnOrder(gs);
      ctx.lastReplayBoardSnapshot = boardSnapshotFromTape(ev.board);
      if (!skipFx) {
        window.gameUtils.renderTerritories(null, gs);
        window.gameUtils.renderStats(gs);
      }
    } else if (ev.type === "board") {
      delete gs.risqueReplayBattleFlashLabels;
      var nextSnap = boardSnapshotFromTape(ev.board);
      if (!skipFx && ev.segment === "battle" && ctx.lastReplayBoardSnapshot) {
        gs.risqueReplayBattleFlashLabels = replayDiffChangedTerritoryLabels(
          ctx.lastReplayBoardSnapshot,
          nextSnap
        );
      }
      applyBoard(gs, ev.board);
      refreshTurnOrder(gs);
      ctx.lastReplayBoardSnapshot = nextSnap;
      if (!skipFx) {
        window.gameUtils.renderTerritories(null, gs);
        window.gameUtils.renderStats(gs);
        if (ev.segment === "battle" && gs.risqueReplayBattleFlashLabels) {
          var flashCopy = gs.risqueReplayBattleFlashLabels;
          window.setTimeout(function () {
            if (!window.gameState || window.gameState !== gs) return;
            if (!gs.risqueReplayPlaybackActive) return;
            if (gs.risqueReplayBattleFlashLabels !== flashCopy) return;
            delete gs.risqueReplayBattleFlashLabels;
            window.gameUtils.renderTerritories(null, gs);
          }, 240);
        }
      }
    } else if (ev.type === "elimination") {
      delete gs.risqueReplayBattleFlashLabels;
      if (!skipFx) showEliminationSplash(ev.conqueror, ev.defeated);
    }
  }

  function setWatchRoundIdle() {
    var el = document.getElementById("risque-replay-watch-round");
    if (!el) return;
    el.textContent = "—";
  }

  function setWatchRoundDisplay(n, labelOverride) {
    var el = document.getElementById("risque-replay-watch-round");
    if (!el) return;
    if (labelOverride != null && String(labelOverride).length) {
      el.textContent = String(labelOverride);
      return;
    }
    if (n == null || !isFinite(Number(n)) || Number(n) < 1) {
      el.textContent = "—";
    } else {
      el.textContent = String(Math.floor(Number(n)));
    }
  }

  function updateRoundsLoadedUi(sourcePacks, mergedPack) {
    var el = document.getElementById("risque-replay-file-list");
    if (!el) return;
    el.innerHTML = "";
    if (!mergedPack || !sourcePacks || !sourcePacks.length) {
      var dash = document.createElement("span");
      dash.className = "risque-replay-round-chips-empty";
      dash.textContent = "—";
      el.appendChild(dash);
      return;
    }
    var ordered = sourcePacks.slice().sort(function (a, b) {
      return packSavedAtMs(a) - packSavedAtMs(b);
    });
    var any = false;
    var ci;
    for (ci = 0; ci < ordered.length; ci++) {
      var p = ordered[ci];
      var rn = effectiveReplayRoundFromPack(p);
      if (!rn) continue;
      any = true;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "risque-replay-round-chip";
      btn.setAttribute("data-round", String(rn));
      var rSpan = document.createElement("span");
      rSpan.className = "risque-replay-round-chip-r";
      rSpan.textContent = "R" + String(rn);
      var tSpan = document.createElement("span");
      tSpan.className = "risque-replay-round-chip-t";
      tSpan.textContent = formatReplaySavedAtChip(packSavedAtMs(p));
      btn.appendChild(rSpan);
      btn.appendChild(tSpan);
      el.appendChild(btn);
    }
    if (!any) {
      var dash2 = document.createElement("span");
      dash2.className = "risque-replay-round-chips-empty";
      dash2.textContent = "—";
      el.appendChild(dash2);
    }
  }

  function lowestRoundStartIndex(playbackEvents) {
    var rounds = collectReplayRounds(playbackEvents || []);
    if (rounds.length) {
      return replayComputeStartIndex(playbackEvents, "from_round", rounds[0]);
    }
    return 0;
  }

  function seekPlaybackToRound(roundNum) {
    var pack = window.__risqueReplayLoadedPack;
    if (!pack || !window.gameUtils) return;
    var rawEv = pack.tape && pack.tape.events;
    var pe = filterFullReplayEvents(Array.isArray(rawEv) ? rawEv.slice() : []);
    if (!pe.length) return;
    var r = parseInt(roundNum, 10);
    if (!isFinite(r) || r < 1) return;
    var target = replayComputeStartIndex(pe, "from_round", r);
    var s = window.__risqueReplaySession;
    if (s && typeof s.seekToIndex === "function") {
      s.seekToIndex(target);
    } else {
      runPlaybackFromPack(pack, target);
    }
  }

  function setTransportEnabled(enabled) {
    var ids = [
      "risque-replay-transport-play",
      "risque-replay-transport-pause",
      "risque-replay-transport-stop"
    ];
    var i;
    for (i = 0; i < ids.length; i++) {
      var node = document.getElementById(ids[i]);
      if (node) node.disabled = !enabled;
    }
  }

  /** Tape loaded, not playing: PLAY + STOP on; PAUSE off. */
  function setTransportStandbyLoaded() {
    var pauseBtn = document.getElementById("risque-replay-transport-pause");
    if (pauseBtn) pauseBtn.disabled = true;
    var playBtn = document.getElementById("risque-replay-transport-play");
    if (playBtn) playBtn.disabled = false;
    var stopBtn = document.getElementById("risque-replay-transport-stop");
    if (stopBtn) stopBtn.disabled = false;
  }

  /** Natural end of tape: PLAY + PAUSE off; STOP on to reset the board. */
  function setTransportReplayEnded() {
    var playBtn = document.getElementById("risque-replay-transport-play");
    var pauseBtn = document.getElementById("risque-replay-transport-pause");
    var stopBtn = document.getElementById("risque-replay-transport-stop");
    if (playBtn) playBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
  }

  function transportSyncStopButton() {
    var stopBtn = document.getElementById("risque-replay-transport-stop");
    if (stopBtn) stopBtn.disabled = !window.__risqueReplayLoadedPack;
  }

  function updateTransportPlayPauseUi(session) {
    var playBtn = document.getElementById("risque-replay-transport-play");
    var pauseBtn = document.getElementById("risque-replay-transport-pause");
    if (window.__risqueReplayEnded) {
      if (playBtn) playBtn.disabled = true;
      if (pauseBtn) pauseBtn.disabled = true;
      transportSyncStopButton();
      return;
    }
    if (!session || !session.playbackEvents) {
      if (window.__risqueReplayLoadedPack && !window.__risqueReplaySession) {
        if (playBtn) playBtn.disabled = false;
        if (pauseBtn) pauseBtn.disabled = true;
      } else {
        if (playBtn) playBtn.disabled = true;
        if (pauseBtn) pauseBtn.disabled = true;
      }
      transportSyncStopButton();
      return;
    }
    if (playBtn) playBtn.disabled = !session.paused;
    if (pauseBtn) pauseBtn.disabled = session.paused;
    transportSyncStopButton();
  }

  /** Empty map and stats (no territory markers). Keeps tape files loaded for PLAY. */
  function resetReplayBoardClean() {
    if (!window.gameUtils) return;
    window.gameState = {
      phase: "attack",
      round: 1,
      currentPlayer: "",
      turnOrder: [],
      players: [],
      deck: []
    };
    window.gameUtils.renderTerritories(null, window.gameState);
    window.gameUtils.renderStats(window.gameState);
  }

  /** STOP: end session, clear map to blank, leave JSON loaded and enable PLAY. */
  function replayStopToCleanStandby() {
    if (!window.__risqueReplayLoadedPack) return;
    window.__risqueReplayAutoStartTok = (window.__risqueReplayAutoStartTok || 0) + 1;
    stopPlayback({ skipStatusMsg: true, silentTransport: true });
    resetReplayBoardClean();
    setTransportStandbyLoaded();
    updateTransportPlayPauseUi(null);
    setWatchRoundIdle();
  }

  function removeReplayRoundHud() {
    var legacy = document.getElementById("risque-replay-round-hud");
    if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);
  }

  function syncRoundHud(gs) {
    if (!gs || !gs.risqueReplayPlaybackActive) {
      removeReplayRoundHud();
      var staleBar = document.getElementById("risque-replay-bar");
      if (staleBar && staleBar.parentNode) staleBar.parentNode.removeChild(staleBar);
      return;
    }
    if (gs.risqueReplayMachineHudPhase === "deal") {
      setWatchRoundDisplay(null, "Dealing");
      return;
    }
    var raw = gs.risqueReplayHudRound;
    var n = typeof raw === "number" ? raw : parseInt(raw, 10);
    if (!isFinite(n) || n < 1) {
      var r2 = gs.round;
      n = typeof r2 === "number" ? r2 : parseInt(r2, 10);
    }
    if (!isFinite(n) || n < 1) n = 1;
    setWatchRoundDisplay(n);
  }

  function removeReplaySplash() {
    var el = document.getElementById("risque-replay-splash");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function showEliminationSplash(conqueror, defeated) {
    removeReplaySplash();
    var conq = String(conqueror || "").trim() || "?";
    var def = String(defeated || "").trim() || "?";
    var root = document.createElement("div");
    root.id = "risque-replay-splash";
    root.className = "risque-replay-splash risque-replay-splash--elimination";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "assertive");
    var line = document.createElement("div");
    line.className = "risque-replay-splash-line risque-replay-splash-line--elimination";
    line.textContent = conq + " has conquered " + def;
    root.appendChild(line);
    document.body.appendChild(root);
  }

  function removeReplayStartOverlay() {
    var el = document.getElementById("risque-replay-start-overlay");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function minimalStateFromPack(pack) {
    var gs = {
      phase: pack.phase != null ? String(pack.phase) : "attack",
      round: Number(pack.round) || 1,
      currentPlayer: pack.currentPlayer != null ? String(pack.currentPlayer) : "",
      turnOrder: [],
      players: [],
      deck: [],
      risqueReplayPlaybackActive: true,
      risqueReplayPlayerColors:
        pack.playerColors && typeof pack.playerColors === "object" ? pack.playerColors : {}
    };
    return gs;
  }

  function refreshTurnOrder(gs) {
    if (!gs || !gs.players) return;
    var names = gs.players.map(function (p) {
      return p && p.name ? String(p.name) : "";
    }).filter(Boolean);
    gs.turnOrder = names;
    if (!gs.currentPlayer || names.indexOf(gs.currentPlayer) === -1) {
      gs.currentPlayer = names[0] || "";
    }
  }

  var __timer = null;

  function stopPlayback(opts) {
    opts = opts || {};
    window.__risqueReplaySession = null;
    if (!opts.replayEnded) {
      window.__risqueReplayEnded = false;
      setReplayEndedLine(false);
    }
    if (!opts.silentTransport) {
      if (opts.replayEnded) {
        setTransportReplayEnded();
      } else if (window.__risqueReplayLoadedPack) {
        setTransportStandbyLoaded();
      } else {
        setTransportEnabled(false);
      }
    }
    if (opts.replayEnded) {
      window.__risqueReplayEnded = true;
      setReplayEndedLine(true);
    }
    updateTransportPlayPauseUi(null);
    setWatchRoundIdle();
    if (__timer != null) {
      clearTimeout(__timer);
      __timer = null;
    }
    removeReplayStartOverlay();
    removeReplaySplash();
    removeReplayRoundHud();
    var barEarly = document.getElementById("risque-replay-bar");
    if (barEarly && barEarly.parentNode) barEarly.parentNode.removeChild(barEarly);
    if (window.gameState && typeof window.gameState === "object") {
      delete window.gameState.risqueReplayPlaybackActive;
      delete window.gameState.phaseReplayIndex;
      delete window.gameState.risqueReplayBattleFlashLabels;
      delete window.gameState.risqueReplayMachineHudPhase;
    }
    if (!opts.skipStatusMsg) {
      setStatus("");
    }
  }

  function runPlaybackFromPack(pack, startIndex) {
    if (!window.gameUtils) {
      setStatus("Map engine not ready.");
      return;
    }
    stopPlayback({ skipStatusMsg: true, silentTransport: true });
    var playbackEvents = filterFullReplayEvents(pack.tape.events.slice());
    if (!playbackEvents.length) {
      setStatus("No playable frames on this tape.");
      return;
    }

    var packRef = pack;
    var gs = minimalStateFromPack(pack);
    window.gameState = gs;

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
    var lastReplayBoardSnapshot = null;
    var paused = false;

    var canvasEl = document.getElementById("canvas");
    if (!canvasEl) return;

    gs.risqueReplayPlaybackActive = true;
    setTransportEnabled(true);
    var session = {
      playbackEvents: playbackEvents,
      paused: false,
      play: function () {},
      pause: function () {},
      seekToIndex: function () {}
    };

    function rebuildStateAt(nextIdx) {
      nextIdx = Math.max(0, Math.min(playbackEvents.length, Math.floor(nextIdx)));
      gs = minimalStateFromPack(packRef);
      window.gameState = gs;
      gs.risqueReplayPlaybackActive = true;
      lastStampedRound = null;
      lastReplayBoardSnapshot = null;
      var ctxBulk = {
        lastStampedRound: null,
        lastReplayBoardSnapshot: null,
        replayRoundFallback: replayRoundFallback,
        skipFx: true
      };
      var j;
      for (j = 0; j < nextIdx; j++) {
        replayApplyOnePlayback(gs, playbackEvents[j], ctxBulk);
        lastStampedRound = ctxBulk.lastStampedRound;
        lastReplayBoardSnapshot = ctxBulk.lastReplayBoardSnapshot;
      }
      idx = nextIdx;
      gs.phaseReplayIndex = idx;
      delete gs.risqueReplayBattleFlashLabels;
      removeReplaySplash();
      window.gameUtils.renderTerritories(null, gs);
      window.gameUtils.renderStats(gs);
      syncRoundHud(gs);
    }

    function clearTimer() {
      if (__timer != null) {
        clearTimeout(__timer);
        __timer = null;
      }
    }

    function scheduleAfter(ms) {
      if (paused) return;
      clearTimer();
      __timer = setTimeout(step, ms);
    }

    function step() {
      clearTimer();
      removeReplaySplash();
      if (!window.gameState || !window.gameState.risqueReplayPlaybackActive) return;

      if (idx >= playbackEvents.length) {
        stopPlayback({ replayEnded: true });
        return;
      }

      var ev = playbackEvents[idx];
      idx += 1;
      gs.phaseReplayIndex = idx;

      var ctxStep = {
        lastStampedRound: lastStampedRound,
        lastReplayBoardSnapshot: lastReplayBoardSnapshot,
        replayRoundFallback: replayRoundFallback,
        skipFx: false
      };
      replayApplyOnePlayback(gs, ev, ctxStep);
      lastStampedRound = ctxStep.lastStampedRound;
      lastReplayBoardSnapshot = ctxStep.lastReplayBoardSnapshot;

      syncRoundHud(gs);

      if (idx >= playbackEvents.length) {
        stopPlayback({ replayEnded: true });
        return;
      }

      var d = replayDelayForEvent(ev);
      scheduleAfter(d);
    }

    rebuildStateAt(idx);

    session.play = function () {
      if (!gs.risqueReplayPlaybackActive) return;
      if (idx >= playbackEvents.length) return;
      paused = false;
      session.paused = false;
      updateTransportPlayPauseUi(session);
      scheduleAfter(0);
    };
    session.pause = function () {
      paused = true;
      session.paused = true;
      clearTimer();
      updateTransportPlayPauseUi(session);
    };
    session.seekToIndex = function (targetIdx) {
      if (!gs.risqueReplayPlaybackActive) return;
      var t = Math.max(
        0,
        Math.min(Math.floor(Number(targetIdx)) || 0, Math.max(0, playbackEvents.length - 1))
      );
      paused = false;
      session.paused = false;
      clearTimer();
      rebuildStateAt(t);
      updateTransportPlayPauseUi(session);
      scheduleAfter(scaledDelay(MS_REPLAY_START_HOLD));
    };

    paused = false;
    session.paused = false;
    window.__risqueReplaySession = session;
    updateTransportPlayPauseUi(session);

    __timer = setTimeout(function () {
      __timer = null;
      step();
    }, scaledDelay(MS_REPLAY_START_HOLD));
  }

  function prepareLoadedPack(pack, sourcePacks, statusLineAfterOk) {
    try {
      var rawEv = pack && pack.tape && pack.tape.events;
      if (!Array.isArray(rawEv) || !rawEv.length) {
        setStatus(
          "This file has no tape events. Use the small *-replay.json from autosave — not the browser backup.json."
        );
        return;
      }
      var playbackEvents = filterFullReplayEvents(rawEv.slice());
      if (!playbackEvents.length) {
        setStatus("Tape has no playable frames (deal / deploy / battle / elimination).");
        return;
      }
      stopPlayback({ skipStatusMsg: true, silentTransport: true });
      window.__risqueReplayLoadedPack = pack;
      resetReplayBoardClean();
      setStatus(statusLineAfterOk != null ? String(statusLineAfterOk) : "");
      setTransportStandbyLoaded();
      updateTransportPlayPauseUi(null);
      updateRoundsLoadedUi(sourcePacks || [pack], pack);
    } catch (e) {
      setStatus("Replay error: " + (e && e.message ? e.message : String(e)));
      try {
        console.error(e);
      } catch (eLog) {
        /* ignore */
      }
    }
  }

  function startPlaybackFromLoadedPack() {
    var pack = window.__risqueReplayLoadedPack;
    if (!pack || !window.gameUtils) {
      if (!window.gameUtils) setStatus("Map engine not ready.");
      return;
    }
    var rawEv = pack.tape && pack.tape.events;
    var playbackEvents = filterFullReplayEvents(Array.isArray(rawEv) ? rawEv.slice() : []);
    if (!playbackEvents.length) return;
    var startIdx = lowestRoundStartIndex(playbackEvents);
    runPlaybackFromPack(pack, startIdx);
  }

  function readFileAsJson(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          resolve(JSON.parse(String(reader.result || "")));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = function () {
        reject(new Error("read"));
      };
      reader.readAsText(file);
    });
  }

  function onFilesSelected(fileList) {
    if (!fileList || !fileList.length) {
      return;
    }
    var files = Array.prototype.slice.call(fileList, 0);
    Promise.all(
      files.map(function (f) {
        return readFileAsJson(f)
          .then(function (raw) {
            return { ok: true, raw: raw, name: f && f.name ? f.name : "file" };
          })
          .catch(function () {
            return { ok: false, raw: null, name: f && f.name ? f.name : "file" };
          });
      })
    ).then(function (results) {
      var packs = [];
      var skipped = [];
      var fi;
      for (fi = 0; fi < results.length; fi++) {
        var res = results[fi];
        if (!res.ok) {
          skipped.push(res.name + " (unreadable JSON)");
          continue;
        }
        var rawOne = res.raw;
        if (looksLikeGameBackupNotTape(rawOne)) {
          skipped.push(res.name + " (game backup, not *-replay.json)");
          continue;
        }
        var pack = normalizeImportedReplay(rawOne);
        if (!pack) {
          skipped.push(res.name + " (not a replay tape)");
          continue;
        }
        packs.push(pack);
      }
      if (!packs.length) {
        var failMsg =
          skipped.length === 1
            ? "No replay loaded — " + skipped[0]
            : "No replay loaded. Skipped: " + skipped.join("; ");
        setStatus(failMsg);
        return;
      }
      var toPlay = packs.length === 1 ? packs[0] : mergeReplayPacks(packs);
      if (!toPlay || !toPlay.tape || !Array.isArray(toPlay.tape.events) || !toPlay.tape.events.length) {
        setStatus("No events to play — empty or invalid tape after merge.");
        return;
      }
      var msgParts = [];
      if (toPlay.__mergeWarnings && toPlay.__mergeWarnings.length) {
        msgParts.push(toPlay.__mergeWarnings.join(" "));
      }
      if (skipped.length) {
        msgParts.push("Skipped " + skipped.length + ": " + skipped.join("; ") + ".");
      }
      window.__risqueReplayAutoStartTok = (window.__risqueReplayAutoStartTok || 0) + 1;
      var autoTok = window.__risqueReplayAutoStartTok;
      prepareLoadedPack(toPlay, packs, msgParts.length ? msgParts.join(" ") : "");
      if (AUTO_START_PLAYBACK_AFTER_LOAD) {
        window.setTimeout(function () {
          if (window.__risqueReplayAutoStartTok !== autoTok) return;
          startPlaybackFromLoadedPack();
        }, AUTO_START_DELAY_MS);
      }
    });
  }

  /** Center of panel at logical x=1500 from canvas left (1920×1080 space); width capped at 800px. */
  function risqueReplayPositionHud() {
    if (!window.RISQUE_REPLAY_MACHINE) return;
    var stage = document.querySelector(".replay-stage-host");
    var canvas = document.getElementById("canvas");
    var hud = document.getElementById("runtime-hud-root");
    if (!stage || !canvas || !hud || !hud.classList.contains("runtime-hud-root--replay-machine")) return;
    var cr = canvas.getBoundingClientRect();
    if (cr.width < 4) return;
    var scale = cr.width / 1920;
    /* Viewport X of map anchor (panel uses translateX(-50%) so this is the column center). */
    var centerViewportX = cr.left + 1500 * scale;
    hud.style.left = centerViewportX + "px";
    /* Width comes only from replay-machine.html + game.css (never inline — avoids fighting 800px cap). */
  }

  window.risqueReplayPositionHud = risqueReplayPositionHud;

  function wireReplayTransportControls() {
    function bind(id, fn) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", function () {
        var s = window.__risqueReplaySession;
        if (s && typeof s[fn] === "function") s[fn]();
      });
    }
    var playEl = document.getElementById("risque-replay-transport-play");
    if (playEl) {
      playEl.addEventListener("click", function () {
        var s = window.__risqueReplaySession;
        if (s && typeof s.play === "function") {
          s.play();
          return;
        }
        startPlaybackFromLoadedPack();
      });
    }
    bind("risque-replay-transport-pause", "pause");
    var stopEl = document.getElementById("risque-replay-transport-stop");
    if (stopEl) {
      stopEl.addEventListener("click", function () {
        replayStopToCleanStandby();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    wireReplayTransportControls();
    var pickBtn = document.getElementById("risque-replay-file-pick");
    var roundsSec = document.getElementById("risque-replay-rounds-section");
    if (pickBtn) {
      pickBtn.addEventListener("click", function () {
        var el = document.getElementById("risque-replay-file");
        if (el) el.click();
      });
    }
    if (roundsSec) {
      roundsSec.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var chip = t.closest(".risque-replay-round-chip");
        if (!chip || !roundsSec.contains(chip)) return;
        var r = parseInt(chip.getAttribute("data-round"), 10);
        if (!isFinite(r) || r < 1) return;
        e.preventDefault();
        seekPlaybackToRound(r);
      });
    }
    window.risqueReplayPickFile = function () {
      var el = document.getElementById("risque-replay-file");
      if (el) el.click();
    };
    document.addEventListener("keydown", function (e) {
      if (e.altKey && String(e.key).toLowerCase() === "o") {
        e.preventDefault();
        window.risqueReplayPickFile();
      }
    });
    risqueReplayPositionHud();
    window.addEventListener("resize", risqueReplayPositionHud);
    requestAnimationFrame(function () {
      risqueReplayPositionHud();
      requestAnimationFrame(risqueReplayPositionHud);
    });
    var inp = document.getElementById("risque-replay-file");
    if (inp) {
      inp.addEventListener("change", function () {
        // inp.files is live — clearing value empties it. Snapshot before reset.
        var filesSnap =
          inp.files && inp.files.length ? Array.prototype.slice.call(inp.files, 0) : [];
        inp.value = "";
        if (filesSnap.length) {
          onFilesSelected(filesSnap);
        }
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!window.__risqueReplayLoadedPack) return;
      e.preventDefault();
      replayStopToCleanStandby();
    });
    setWatchRoundIdle();
    updateRoundsLoadedUi(null, null);
  });
})();
