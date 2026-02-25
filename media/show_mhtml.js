(function () {
  const vscode = acquireVsCodeApi();
  const frame = document.getElementById("frame");
  const statusEl = document.getElementById("status");
  const htmlSourceEl = document.getElementById("tp-mhtml-html");
  let pendingNeedle = "";

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function isTextContainer(node) {
    if (!node || !node.parentElement) return false;
    const tag = node.parentElement.tagName;
    return tag !== "SCRIPT" && tag !== "STYLE" && tag !== "NOSCRIPT";
  }

  function clearHits(doc) {
    const hits = doc.querySelectorAll("mark.tp-hit");
    for (const m of hits) {
      const t = doc.createTextNode(m.textContent || "");
      m.replaceWith(t);
    }
  }

  function ensureHighlightStyle(doc) {
    const id = "trace-pilot-highlight-style";
    if (doc.getElementById(id)) return;
    const style = doc.createElement("style");
    style.id = id;
    style.textContent = `
      mark.tp-hit {
        background: rgba(255, 224, 71, 0.45) !important;
        outline: 1px solid rgba(255, 179, 0, 0.85) !important;
        border-radius: 2px;
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function highlightAll(doc, needle) {
    if (!needle) return 0;
    const root = doc.body || doc.documentElement;
    if (!root) return 0;

    ensureHighlightStyle(doc);
    clearHits(doc);

    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (isTextContainer(n)) nodes.push(n);
    }

    let count = 0;
    for (const node of nodes) {
      let currentNode = node;
      let currentText = node.nodeValue || "";
      let idx = currentText.indexOf(needle);
      if (idx === -1) continue;

      while (idx !== -1) {
        const before = currentText.slice(0, idx);
        const hit = currentText.slice(idx, idx + needle.length);
        const after = currentText.slice(idx + needle.length);
        const parent = currentNode.parentNode;
        if (!parent) break;

        if (before) parent.insertBefore(doc.createTextNode(before), currentNode);
        const mark = doc.createElement("mark");
        mark.className = "tp-hit";
        mark.textContent = hit;
        parent.insertBefore(mark, currentNode);
        const afterNode = doc.createTextNode(after);
        parent.insertBefore(afterNode, currentNode);
        parent.removeChild(currentNode);

        count++;
        currentNode = afterNode;
        currentText = after;
        idx = currentText.indexOf(needle);
      }
    }

    const first = doc.querySelector("mark.tp-hit");
    if (first && typeof first.scrollIntoView === "function") {
      first.scrollIntoView({ block: "center" });
    }
    return count;
  }

  function tryHighlight(needle) {
    if (!frame || !needle) return;
    try {
      const doc = frame.contentDocument;
      if (doc) {
        const count = highlightAll(doc, needle);
        setStatus(count > 0 ? `Highlighted ${count} match(es)` : "No match found");
        vscode.postMessage({ type: "findResult", count });
        return;
      }
    } catch (e) {
      // srcdoc should be same-origin, but keep a fallback for safety.
    }

    try {
      const win = frame.contentWindow;
      const ok = !!(win && typeof win.find === "function" && win.find(needle));
      setStatus(ok ? "Jumped to a match (browser find)" : "No match found");
      vscode.postMessage({ type: "findResult", count: ok ? 1 : 0, fallback: true });
    } catch (e) {
      setStatus("Loaded, but highlight is unavailable");
      vscode.postMessage({ type: "findResult", count: 0, error: String(e) });
    }
  }

  if (frame) {
    frame.addEventListener("load", () => {
      setStatus("Loaded");
      vscode.postMessage({ type: "ready" });
      if (pendingNeedle) tryHighlight(pendingNeedle);
    });
    frame.addEventListener("error", () => {
      setStatus("Failed to load extracted HTML");
    });

    const html = (htmlSourceEl && htmlSourceEl.value) || "";
    if (!html.trim()) {
      setStatus("No HTML found in MHTML");
      vscode.postMessage({ type: "ready" });
    } else {
      frame.srcdoc = html;
      setStatus("Rendering extracted HTML...");
    }
  } else {
    vscode.postMessage({ type: "ready" });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg?.type === "find") {
      pendingNeedle = msg.needle || "";
      tryHighlight(pendingNeedle);
    }
  });
})();
