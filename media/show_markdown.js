(function () {
  const vscode = acquireVsCodeApi();

    console.log("show_markdown.js loaded");
    console.log("markdownit=", typeof window.markdownit);
    console.log("acquireVsCodeApi=", typeof acquireVsCodeApi);


  const md = window.markdownit({
    html: false,
    linkify: true,
    breaks: false,
  });

  const promptEl = document.getElementById("prompt");
  const genEl = document.getElementById("generated");
  const contextSectionEl = document.getElementById("context-section");
  const contextEl = document.getElementById("context-thread-pairs");

  const promptText = document.getElementById("tp-prompt")?.value || "";
  const generatedText = document.getElementById("tp-generated")?.value || "";
  const contextThreadPairsText = document.getElementById("tp-context-thread-pairs")?.value || "";


  promptEl.innerHTML = md.render(promptText);
  genEl.innerHTML = md.render(generatedText);
  if (contextThreadPairsText.trim()) {
    contextEl.innerHTML = md.render(contextThreadPairsText);
    contextSectionEl.style.display = "";
  }

  // extensionに準備完了通知
  vscode.postMessage({ type: "ready" });

  // 既存ハイライトを消す
  function clearHits(root) {
    const hits = root.querySelectorAll("mark.tp-hit");
    hits.forEach(m => {
      const t = document.createTextNode(m.textContent || "");
      m.replaceWith(t);
    });
  }

  // テキストを全ノードから検索して mark で囲う（簡易）
  function highlightAll(root, needle) {
    if (!needle) return 0;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    let count = 0;

    for (const node of textNodes) {
      const text = node.nodeValue || "";
      let idx = text.indexOf(needle);
      if (idx === -1) continue;

      // 1つのテキストノードに複数hitがあり得るのでループ
      let currentNode = node;
      let currentText = text;

      while ((idx = currentText.indexOf(needle)) !== -1) {
        const before = currentText.slice(0, idx);
        const hit = currentText.slice(idx, idx + needle.length);
        const after = currentText.slice(idx + needle.length);

        const beforeNode = document.createTextNode(before);
        const mark = document.createElement("mark");
        mark.className = "tp-hit";
        mark.textContent = hit;
        const afterNode = document.createTextNode(after);

        const parent = currentNode.parentNode;
        if (!parent) break;

        parent.insertBefore(beforeNode, currentNode);
        parent.insertBefore(mark, currentNode);
        parent.insertBefore(afterNode, currentNode);
        parent.removeChild(currentNode);

        count++;

        // 続きは afterNode を対象に
        currentNode = afterNode;
        currentText = after;
      }
    }

    return count;
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg?.type === "find") {
      const needle = msg.needle || "";

      // まず消してから再ハイライト
      clearHits(promptEl);
      clearHits(genEl);

      const c1 = highlightAll(promptEl, needle);
      const c2 = highlightAll(genEl, needle);

      const first = document.querySelector("mark.tp-hit");
      if (first) first.scrollIntoView({ block: "center" });

      vscode.postMessage({ type: "findResult", count: c1 + c2 });
    }
  });
})();
