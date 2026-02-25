/* ──────────────────────────────────────────────────────────────
 * content/overlay.ts — Full-screen glass overlay with region select
 *
 * Injected into the active tab when the user clicks the extension
 * icon. Creates a transparent overlay covering the entire viewport.
 * User draws a bounding box. The selection is sent to the service
 * worker which crops the pre-captured screenshot and POSTs to backend.
 * ────────────────────────────────────────────────────────────────── */

(() => {
  // Guard: don't inject twice
  if (document.getElementById("ercb-overlay")) return;

  /* ── State ── */
  let screenshotDataUrl = "";
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  let isRecording = false;

  /* ── Create Overlay DOM ── */

  const overlay = document.createElement("div");
  overlay.id = "ercb-overlay";

  overlay.innerHTML = `
    <div id="ercb-dim" class="ercb-dim"></div>
    <div id="ercb-selection" class="ercb-selection"></div>
    <div id="ercb-crosshair-h" class="ercb-crosshair ercb-crosshair--h"></div>
    <div id="ercb-crosshair-v" class="ercb-crosshair ercb-crosshair--v"></div>

    <div id="ercb-toolbar" class="ercb-toolbar">
      <span class="ercb-toolbar__text">Click & drag to select a region</span>
      <button id="ercb-btn-dictate" class="ercb-btn ercb-btn--mic" title="Hold to dictate">
        <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="currentColor"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2"/>
          <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2"/>
        </svg>
      </button>
      <button id="ercb-btn-close" class="ercb-btn ercb-btn--close" title="Cancel (Esc)">✕</button>
    </div>

    <div id="ercb-scan-preview" class="ercb-scan-preview" style="display:none;">
      <div class="ercb-scan-frame">
        <div class="ercb-scan-laser"></div>
        <span class="ercb-corner ercb-corner--tl"></span>
        <span class="ercb-corner ercb-corner--tr"></span>
        <span class="ercb-corner ercb-corner--bl"></span>
        <span class="ercb-corner ercb-corner--br"></span>
      </div>
      <p class="ercb-scan-label">Analyzing…</p>
    </div>

    <div id="ercb-audio-state" class="ercb-audio-state" style="display:none;">
      <div class="ercb-audio-pulse">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <p id="ercb-audio-timer" class="ercb-audio-timer">0:00</p>
      <p class="ercb-audio-label">Listening… release to send</p>
    </div>

    <div id="ercb-processing" class="ercb-processing" style="display:none;">
      <div class="ercb-spinner"></div>
      <p>Processing…</p>
    </div>

    <div id="ercb-results" class="ercb-results" style="display:none;">
      <div class="ercb-results__header">
        <h3>Results</h3>
        <div style="display:flex;gap:6px;">
          <button id="ercb-btn-copy-all" class="ercb-btn ercb-btn--sm">Copy All</button>
          <button id="ercb-btn-new" class="ercb-btn ercb-btn--sm">New Scan</button>
          <button id="ercb-btn-done" class="ercb-btn ercb-btn--sm ercb-btn--close-sm">✕</button>
        </div>
      </div>
      <div id="ercb-bubbles" class="ercb-bubbles"></div>
    </div>

    <div id="ercb-error" class="ercb-error" style="display:none;">
      <p id="ercb-error-text"></p>
      <button id="ercb-btn-retry" class="ercb-btn ercb-btn--sm">Retry</button>
    </div>
  `;

  document.body.appendChild(overlay);

  /* ── DOM refs ── */
  const dim          = overlay.querySelector("#ercb-dim") as HTMLElement;
  const selection    = overlay.querySelector("#ercb-selection") as HTMLElement;
  const crosshairH  = overlay.querySelector("#ercb-crosshair-h") as HTMLElement;
  const crosshairV  = overlay.querySelector("#ercb-crosshair-v") as HTMLElement;
  const toolbar      = overlay.querySelector("#ercb-toolbar") as HTMLElement;
  const scanPreview  = overlay.querySelector("#ercb-scan-preview") as HTMLElement;
  const audioState   = overlay.querySelector("#ercb-audio-state") as HTMLElement;
  const audioTimer   = overlay.querySelector("#ercb-audio-timer") as HTMLElement;
  const processing   = overlay.querySelector("#ercb-processing") as HTMLElement;
  const results      = overlay.querySelector("#ercb-results") as HTMLElement;
  const bubblesCont  = overlay.querySelector("#ercb-bubbles") as HTMLElement;
  const errorEl      = overlay.querySelector("#ercb-error") as HTMLElement;
  const errorText    = overlay.querySelector("#ercb-error-text") as HTMLElement;
  const btnDictate   = overlay.querySelector("#ercb-btn-dictate") as HTMLElement;
  const btnClose     = overlay.querySelector("#ercb-btn-close") as HTMLElement;
  const btnCopyAll   = overlay.querySelector("#ercb-btn-copy-all") as HTMLElement;
  const btnNew       = overlay.querySelector("#ercb-btn-new") as HTMLElement;
  const btnDone      = overlay.querySelector("#ercb-btn-done") as HTMLElement;
  const btnRetry     = overlay.querySelector("#ercb-btn-retry") as HTMLElement;

  /* ── Show/hide helpers ── */
  const hideAll = () => {
    selection.style.display = "none";
    crosshairH.style.display = "none";
    crosshairV.style.display = "none";
    toolbar.style.display = "none";
    scanPreview.style.display = "none";
    audioState.style.display = "none";
    processing.style.display = "none";
    results.style.display = "none";
    errorEl.style.display = "none";
  };

  const showSelectMode = () => {
    hideAll();
    toolbar.style.display = "flex";
    crosshairH.style.display = "block";
    crosshairV.style.display = "block";
    dim.classList.remove("ercb-dim--dark");
    dim.classList.add("ercb-dim--active");
    overlay.style.cursor = "crosshair";
  };

  const showScanPreview = (rect: DOMRect) => {
    hideAll();
    dim.classList.add("ercb-dim--dark");
    scanPreview.style.display = "flex";
    scanPreview.style.left = `${rect.left}px`;
    scanPreview.style.top = `${rect.top}px`;
    scanPreview.style.width = `${rect.width}px`;
    scanPreview.style.height = `${rect.height}px`;
    overlay.style.cursor = "default";
  };

  const showResults = (bubbles: any[]) => {
    hideAll();
    dim.classList.add("ercb-dim--dark");
    results.style.display = "flex";
    overlay.style.cursor = "default";
    renderBubbles(bubbles);
  };

  const showError = (msg: string) => {
    hideAll();
    dim.classList.add("ercb-dim--dark");
    errorEl.style.display = "flex";
    errorText.textContent = msg;
    overlay.style.cursor = "default";
  };

  const showAudio = () => {
    hideAll();
    dim.classList.add("ercb-dim--dark");
    audioState.style.display = "flex";
    overlay.style.cursor = "default";
  };

  const showProcessing = () => {
    hideAll();
    dim.classList.add("ercb-dim--dark");
    processing.style.display = "flex";
    overlay.style.cursor = "default";
  };

  const teardown = () => {
    overlay.remove();
  };

  /* ── Mouse tracking for crosshair ── */

  dim.addEventListener("mousemove", (e: MouseEvent) => {
    if (isDrawing) return;
    crosshairH.style.top = `${e.clientY}px`;
    crosshairV.style.left = `${e.clientX}px`;
  });

  /* ── Region Selection ── */

  dim.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button !== 0) return;
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;
    selection.style.display = "block";
    selection.style.left = `${startX}px`;
    selection.style.top = `${startY}px`;
    selection.style.width = "0";
    selection.style.height = "0";
    crosshairH.style.display = "none";
    crosshairV.style.display = "none";
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isDrawing) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    selection.style.left = `${x}px`;
    selection.style.top = `${y}px`;
    selection.style.width = `${w}px`;
    selection.style.height = `${h}px`;
  });

  document.addEventListener("mouseup", (e: MouseEvent) => {
    if (!isDrawing) return;
    isDrawing = false;

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    // Ignore tiny drags (accidental clicks)
    if (w < 10 || h < 10) {
      selection.style.display = "none";
      crosshairH.style.display = "block";
      crosshairV.style.display = "block";
      return;
    }

    const rect = { x, y, width: w, height: h };
    const domRect = new DOMRect(x, y, w, h);

    showScanPreview(domRect);

    // Send selection to service worker
    chrome.runtime.sendMessage({
      action: "region-selected",
      screenshotDataUrl,
      rect,
      devicePixelRatio: window.devicePixelRatio,
    });
  });

  /* ── Audio Dictation ── */

  let audioTimerInterval: ReturnType<typeof setInterval> | null = null;
  let audioStart = 0;

  const startAudioTimer = () => {
    audioStart = Date.now();
    audioTimerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - audioStart) / 1000);
      audioTimer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }, 250);
  };

  const stopAudioTimer = () => {
    if (audioTimerInterval) { clearInterval(audioTimerInterval); audioTimerInterval = null; }
  };

  btnDictate.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isRecording) return;
    isRecording = true;

    chrome.runtime.sendMessage({ action: "start-audio" }, (resp: any) => {
      if (resp?.ok) {
        showAudio();
        startAudioTimer();
      } else {
        showError(resp?.error || "Could not start recording.");
        isRecording = false;
      }
    });
  });

  const stopDictation = () => {
    if (!isRecording) return;
    isRecording = false;
    stopAudioTimer();
    showProcessing();

    chrome.runtime.sendMessage({ action: "stop-audio" }, (_resp: any) => {
      // Result arrives via "analysis-result" message
    });
  };

  btnDictate.addEventListener("pointerup", (e) => { e.stopPropagation(); stopDictation(); });
  btnDictate.addEventListener("pointerleave", (e) => { e.stopPropagation(); stopDictation(); });

  /* ── Buttons ── */

  btnClose.addEventListener("click", (e) => { e.stopPropagation(); teardown(); });

  btnNew.addEventListener("click", (e) => { e.stopPropagation(); showSelectMode(); });

  btnDone.addEventListener("click", (e) => { e.stopPropagation(); teardown(); });

  btnRetry.addEventListener("click", (e) => { e.stopPropagation(); showSelectMode(); });

  btnCopyAll.addEventListener("click", async (e) => {
    e.stopPropagation();
    const allText = Array.from(bubblesCont.querySelectorAll(".ercb-bubble"))
      .map((b) => {
        const k = b.querySelector(".ercb-bubble__key")?.textContent || "";
        const v = b.querySelector(".ercb-bubble__value")?.textContent || "";
        return `**${k}:** ${v}`;
      })
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(allText);
      btnCopyAll.textContent = "Copied!";
      setTimeout(() => { btnCopyAll.textContent = "Copy All"; }, 1200);
    } catch { /* */ }
  });

  /* ── Escape key ── */

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") teardown();
  });

  /* ── Render Bubbles ── */

  const renderBubbles = (bubbles: any[]) => {
    bubblesCont.innerHTML = "";
    bubbles.forEach((b: any, i: number) => {
      const el = document.createElement("div");
      el.className = `ercb-bubble ercb-bubble--${b.category}`;
      el.style.animationDelay = `${i * 40}ms`;
      el.innerHTML = `
        <span class="ercb-bubble__key">${esc(b.key)}</span>
        <span class="ercb-bubble__value">${esc(b.value)}</span>
        <span class="ercb-bubble__copied">Copied!</span>
      `;
      el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        try {
          await navigator.clipboard.writeText(b.value);
          el.classList.add("ercb-bubble--copied");
          setTimeout(() => el.classList.remove("ercb-bubble--copied"), 1100);
        } catch { /* */ }
      });
      bubblesCont.appendChild(el);
    });
  };

  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /* ── Listen for messages from service worker ── */

  chrome.runtime.onMessage.addListener((msg: any) => {
    if (msg.action === "show-overlay") {
      screenshotDataUrl = msg.screenshotDataUrl;
      showSelectMode();
    }

    if (msg.action === "analysis-result") {
      const resp = msg.result;
      const skip = new Set(["status", "source_type"]);
      const bubbles = Object.entries(resp)
        .filter(([k]) => !skip.has(k))
        .map(([key, value]) => {
          const k = key.toLowerCase();
          let cat = "generic";
          if (k.includes("airway")) cat = "airway";
          else if (k.includes("breath")) cat = "breathing";
          else if (k.includes("circ") || k.includes("heart")) cat = "circulation";
          else if (k.includes("neuro") || k.includes("disability")) cat = "disability";
          else if (k.includes("exposure") || k.includes("temp")) cat = "exposure";
          else if (k.includes("plan") || k.includes("disposition")) cat = "plan";
          return { key, value: typeof value === "string" ? value : JSON.stringify(value), category: cat };
        });
      showResults(bubbles);
    }

    if (msg.action === "analysis-error") {
      showError(msg.error);
    }

    if (msg.action === "volume-update") {
      // Could animate audio bars here based on msg.level
    }
  });
})();
