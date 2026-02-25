/* ── background/service-worker.ts ──
 *
 * 1. Extension icon click → capture screenshot → inject overlay
 * 2. Overlay sends selection rect → crop + POST to backend
 * 3. Audio recording via offscreen document (for mic permission)
 */

import { ANALYZE_ENDPOINT } from "../types";
import type { AnalyzeResponse, SelectionRect } from "../types";

/* ── Offscreen Document ── */

let offscreenReady = false;

const ensureOffscreen = async (): Promise<void> => {
  if (offscreenReady) return;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL("offscreen.html")],
  });
  if (contexts.length > 0) { offscreenReady = true; return; }
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Microphone recording with standard permission prompt",
  });
  offscreenReady = true;
};

/* ── Icon Click → Screenshot → Inject Overlay ── */

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    // Capture the visible tab BEFORE injecting the overlay
    const dataUrl = await chrome.tabs.captureVisibleTab(
      tab.windowId,
      { format: "png", quality: 100 }
    );

    // Inject the content script that creates the overlay
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["dist/content.js"],
    });

    // Inject the overlay CSS
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["styles/overlay.css"],
    });

    // Send the screenshot to the content script
    chrome.tabs.sendMessage(tab.id, {
      action: "show-overlay",
      screenshotDataUrl: dataUrl,
    });
  } catch (err) {
    console.error("[SW] Failed to inject overlay:", err);
  }
});

/* ── Message Router ── */

chrome.runtime.onMessage.addListener(
  (
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: any) => void
  ): boolean | undefined => {
    /* ─ Content script sends a region selection ─ */
    if (message.action === "region-selected") {
      handleRegionCapture(
        message.screenshotDataUrl as string,
        message.rect as SelectionRect,
        message.devicePixelRatio as number,
        sender.tab?.id
      );
      return undefined;
    }

    /* ─ Content script requests audio recording start ─ */
    if (message.action === "start-audio") {
      (async () => {
        await ensureOffscreen();
        chrome.runtime.sendMessage({ action: "start-recording" }, (resp) => {
          sendResponse(resp);
        });
      })();
      return true;
    }

    /* ─ Content script requests audio recording stop ─ */
    if (message.action === "stop-audio") {
      chrome.runtime.sendMessage({ action: "stop-recording" }, (resp) => {
        if (resp?.ok && resp.audioBytes) {
          // Convert byte array back to Blob and POST
          const blob = new Blob(
            [new Uint8Array(resp.audioBytes)],
            { type: resp.mimeType }
          );
          postToBackend(blob, "dictation.webm")
            .then((result) => {
              if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, {
                  action: "analysis-result",
                  result,
                });
              }
            })
            .catch((err) => {
              if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, {
                  action: "analysis-error",
                  error: err.message,
                });
              }
            });
        }
        sendResponse(resp);
      });
      return true;
    }

    /* ─ Volume level forwarding from offscreen → content script ─ */
    if (message.action === "volume-level" && sender.url?.includes("offscreen")) {
      // Forward to the active tab's content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "volume-update",
            level: message.level,
          });
        }
      });
      return undefined;
    }

    return undefined;
  }
);

/* ── Crop + POST ── */

const handleRegionCapture = async (
  screenshotDataUrl: string,
  rect: SelectionRect,
  devicePixelRatio: number,
  tabId?: number
): Promise<void> => {
  try {
    // Create an OffscreenCanvas to crop the region
    const img = await createImageBitmap(await (await fetch(screenshotDataUrl)).blob());

    const sx = Math.round(rect.x * devicePixelRatio);
    const sy = Math.round(rect.y * devicePixelRatio);
    const sw = Math.round(rect.width * devicePixelRatio);
    const sh = Math.round(rect.height * devicePixelRatio);

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const result = await postToBackend(blob, "scan.jpg");

    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: "analysis-result", result });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Capture failed.";
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: "analysis-error", error: msg });
    }
  }
};

/* ── Backend POST ── */

const postToBackend = async (blob: Blob, filename: string): Promise<AnalyzeResponse> => {
  const form = new FormData();
  form.append("file", blob, filename);
  const res = await fetch(ANALYZE_ENDPOINT, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Backend ${res.status}: ${res.statusText}`);
  return (await res.json()) as AnalyzeResponse;
};
