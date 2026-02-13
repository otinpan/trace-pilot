const cards = Array.isArray(window.TRACE_PROMPT_CARDS) ? window.TRACE_PROMPT_CARDS : [];
const PREVIEW_LEN = 120;
const selectedPairHash = typeof window.TRACE_SELECTED_PAIR_HASH === "string"
  ? window.TRACE_SELECTED_PAIR_HASH
  : "";
const list = document.getElementById("card-list");
let selectedCardElement = null;

if (list) {
  for (const card of cards) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-card";
    const pairHash = `${card.promptHash}:${card.generatedHash}`;
    if (pairHash === selectedPairHash && !selectedCardElement) {
      button.classList.add("is-selected");
      selectedCardElement = button;
    }

    button.appendChild(makeRow("prompt", toPreview(card.promptText, PREVIEW_LEN)));
    button.appendChild(makeRow("generated", toPreview(card.generatedText, PREVIEW_LEN)));
    button.appendChild(makeRow("metaHashes", Array.isArray(card.metaHashes) ? card.metaHashes.join("\n") : ""));
    button.appendChild(makeRow("copiedTime", card.copiedTime));

    button.addEventListener("click", () => {
      // click action will be implemented later.
      console.log("clicked metaHashes:", card.metaHashes);
    });

    list.appendChild(button);
  }
}

if (selectedCardElement) {
  requestAnimationFrame(() => {
    selectedCardElement.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  });
}

function makeRow(label, value) {
  const row = document.createElement("div");
  row.className = "card-row";

  const labelEl = document.createElement("div");
  labelEl.className = "card-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "card-value";
  valueEl.textContent = String(value ?? "");

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function toPreview(text, maxLen) {
  const s = String(text ?? "");
  if (s.length <= maxLen) {
    return s;
  }
  return `${s.slice(0, maxLen)}...`;
}
