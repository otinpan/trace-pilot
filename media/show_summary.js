(function () {
  const md = window.markdownit({
    html: false,
    linkify: true,
    breaks: false,
  });

  const summaryEl = document.getElementById("summary");
  const summaryText = document.getElementById("tp-summary")?.value || "";

  if (summaryEl) {
    summaryEl.innerHTML = md.render(summaryText);
  }
})();
