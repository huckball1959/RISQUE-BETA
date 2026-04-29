/**
 * Postgame reflection: after win celebration, host stays on the map with full HUD
 * (stats, lucky, combat log, cards played) until they exit to the menu.
 */
(function () {
  "use strict";

  var REVIEW_TOP_ID = "risque-postgame-review-topbar";

  function removeStaleTopbarReview() {
    var old = document.getElementById(REVIEW_TOP_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function mount(stageHost, opts) {
    opts = opts || {};
    var onLog = opts.onLog;
    var uiOverlay = document.getElementById("ui-overlay");
    if (!uiOverlay || !window.gameUtils) return;

    var stalePrompt = document.getElementById("prompt");
    if (stalePrompt && stalePrompt.parentNode) stalePrompt.parentNode.removeChild(stalePrompt);
    if (typeof window.risqueDismissAttackPrompt === "function") {
      window.risqueDismissAttackPrompt();
    }

    window.handleTerritoryClick = window.handleTerritoryClick || null;

    var wname =
      window.gameState && window.gameState.winner ? String(window.gameState.winner) : "Winner";

    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");

    if (window.gameState) {
      window.gameState.phase = "postgame";
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (e) {
        /* ignore */
      }
    }

    if (window.risqueRuntimeHud) {
      window.risqueRuntimeHud.ensure(uiOverlay);
      window.risqueRuntimeHud.clearPhaseSlot();
      window.risqueRuntimeHud.setAttackChromeInteractive(false);
      if (window.gameState) {
        window.risqueRuntimeHud.updateTurnBannerFromState(window.gameState);
      }

      if (typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
        window.risqueRuntimeHud.setControlVoiceText(
          String(wname).toUpperCase() + " WINS — POSTGAME REVIEW",
          "Use STATS, LUCKY, CARDS PLAYED, and the combat log. replay-machine.html: one *-replay.json per round, or select several to play a range.",
          {
            force: true
          }
        );
      }

      removeStaleTopbarReview();

      var rSlot = document.getElementById("risque-phase-content");
      if (rSlot) {
        rSlot.innerHTML =
          '<div class="postgame-compact-root">' +
          '<p class="postgame-compact-title">POSTGAME</p>' +
          '<p class="postgame-compact-copy">' +
          "Map and full statistics are frozen. Battle replay uses replay-machine.html on the host (not this TV). Exit clears this session." +
          "</p>" +
          '<div class="postgame-compact-actions">' +
          '<button type="button" class="postgame-btn postgame-btn--primary" id="risque-postgame-exit">' +
          "EXIT TO MENU" +
          "</button>" +
          "</div>" +
          "</div>";
      }

      requestAnimationFrame(function () {
        try {
          var main = document.getElementById("hud-main-panel");
          var strip = document.getElementById("ucp-slot-strip");
          var root = document.querySelector("#risque-phase-content .postgame-compact-root");
          if (root && main && strip && root.parentNode) {
            main.insertBefore(root, strip);
          }
        } catch (eMove) {
          /* ignore */
        }
        var exitBtn = document.getElementById("risque-postgame-exit");
        if (exitBtn) {
          exitBtn.addEventListener("click", function () {
            var dest =
              typeof window.risqueLoginRecoveryUrl === "function"
                ? window.risqueLoginRecoveryUrl()
                : "game.html?phase=login";
            try {
              localStorage.removeItem("gameState");
            } catch (eLs) {
              /* ignore */
            }
            if (typeof window.risqueNavigateWithFade === "function") {
              window.risqueNavigateWithFade(dest);
            } else {
              window.location.href = dest;
            }
          });
        }
        window.risqueRuntimeHud.syncPosition();
      });
    }

    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
      window.gameUtils.renderTerritories(null, window.gameState);
      window.gameUtils.renderStats(window.gameState);
    });

    if (typeof onLog === "function") {
      onLog("Postgame mounted", { winner: wname });
    }
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.postgame = { mount: mount, removeStaleTopbarReview: removeStaleTopbarReview };
})();
