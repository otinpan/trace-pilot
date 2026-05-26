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
    const pairs = parseContextThreadPairs(contextThreadPairsText);
    if (pairs.length > 0) {
      renderContextThreadPairs(contextEl, pairs);
      contextSectionEl.style.display = "";
    }
  }

  // extensionに準備完了通知
  vscode.postMessage({ type: "ready" });

  function parseContextThreadPairs(text) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function renderContextThreadPairs(root, pairs) {
    root.replaceChildren();

    pairs.forEach((pair, index) => {
      const details = document.createElement("details");
      details.className = "context-pair";
      details.open = index === pairs.length - 1;

      const summary = document.createElement("summary");
      summary.className = "context-pair-summary";

      const title = document.createElement("span");
      title.className = "context-pair-title";
      title.textContent = `Pair ${index + 1}`;

      const meta = document.createElement("span");
      meta.className = "context-pair-meta";
      meta.textContent = formatPairMeta(pair);

      summary.append(title, meta);
      details.appendChild(summary);

      const body = document.createElement("div");
      body.className = "context-pair-body";
      body.append(
        renderMarkdownBlock("Prompt", pair.userMessage || pair.prompt || ""),
        renderMarkdownBlock("Response", pair.botResponse || pair.response || ""),
      );

      const codeBlocks = Array.isArray(pair.codeBlocks) ? pair.codeBlocks : [];
      if (codeBlocks.length > 0) {
        body.appendChild(renderCodeBlocks(codeBlocks));
      }

      details.appendChild(body);
      root.appendChild(details);
    });
  }

  function formatPairMeta(pair) {
    const bits = [];
    if (typeof pair.time === "number" && Number.isFinite(pair.time)) {
      bits.push(new Date(pair.time).toLocaleString());
    }
    if (typeof pair.id === "string" && pair.id) {
      bits.push(`id: ${pair.id.slice(0, 8)}`);
    }
    return bits.join("  ");
  }

  function renderMarkdownBlock(label, text) {
    const section = document.createElement("section");
    section.className = "context-message";

    const heading = document.createElement("div");
    heading.className = "context-message-title";
    heading.textContent = label;

    const content = document.createElement("div");
    content.className = "context-message-content";
    content.innerHTML = md.render(text);

    section.append(heading, content);
    return section;
  }

  function renderCodeBlocks(codeBlocks) {
    const details = document.createElement("details");
    details.className = "context-codeblocks";

    const summary = document.createElement("summary");
    summary.className = "context-codeblocks-summary";
    summary.textContent = `Code Blocks (${codeBlocks.length})`;
    details.appendChild(summary);

    codeBlocks.forEach((block, index) => {
      const wrap = document.createElement("div");
      wrap.className = "context-codeblock";

      const label = document.createElement("div");
      label.className = "context-codeblock-title";
      label.textContent = block.language ? `${index + 1}. ${block.language}` : `${index + 1}. text`;

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.code || "";
      pre.appendChild(code);

      wrap.append(label, pre);
      details.appendChild(wrap);
    });

    return details;
  }

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
      clearHits(contextEl);

      const c1 = highlightAll(promptEl, needle);
      const c2 = highlightAll(genEl, needle);
      const c3 = highlightAll(contextEl, needle);

      const first = document.querySelector("mark.tp-hit");
      if (first) first.scrollIntoView({ block: "center" });

      vscode.postMessage({ type: "findResult", count: c1 + c2 + c3 });
    }
  });
})();
