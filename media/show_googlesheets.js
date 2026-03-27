(function () {
  const selectedEl = document.getElementById("tp-gs-selected");
  const snapshotEl = document.getElementById("tp-gs-snapshot");
  const rootEl = document.getElementById("sheet-root");
  const sheetWrapEl = document.getElementById("sheet-wrap");
  const sheetNameEl = document.getElementById("sheet-name");
  const metaEl = document.getElementById("meta");

  function parseJson(text) {
    try {
      return JSON.parse(text || "");
    } catch {
      return null;
    }
  }

  function columnLabel(index) {
    let n = index + 1;
    let out = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function a1ToRowCol(a1) {
    const match = /^([A-Z]+)(\d+)$/i.exec((a1 || "").trim());
    if (!match) return null;

    const colLabel = match[1].toUpperCase();
    let col = 0;
    for (const ch of colLabel) {
      col = col * 26 + (ch.charCodeAt(0) - 64);
    }

    return {
      row: Number(match[2]) - 1,
      col: col - 1,
    };
  }

  function makeMeta(selected, snapshot) {
    const bits = [];
    if (snapshot && snapshot.name) bits.push("Sheet: " + snapshot.name);
    if (selected && selected.startA1) bits.push("Selection: " + selected.startA1);
    if (selected && Number.isFinite(selected.rowCount) && Number.isFinite(selected.colCount)) {
      bits.push("Range size: " + selected.rowCount + " x " + selected.colCount);
    }
    if (snapshot && Number.isFinite(snapshot.rowCount) && Number.isFinite(snapshot.colCount)) {
      bits.push("Snapshot: " + snapshot.rowCount + " rows x " + snapshot.colCount + " cols");
    }
    return bits;
  }

  function renderTable(selected, snapshot) {
    if (!rootEl || !sheetNameEl || !metaEl) return;
    if (!snapshot || !Array.isArray(snapshot.rows)) {
      rootEl.className = "empty";
      rootEl.textContent = "Invalid snapshot JSON";
      return;
    }

    const rows = snapshot.rows;
    const rowCount = Math.max(snapshot.rowCount || 0, rows.length);
    const colCount = Math.max(
      snapshot.colCount || 0,
      rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
    );
    const start = a1ToRowCol(selected && selected.startA1);

    sheetNameEl.textContent = snapshot.name || "Untitled sheet";
    metaEl.textContent = "";
    for (const bit of makeMeta(selected, snapshot)) {
      const span = document.createElement("span");
      span.textContent = bit;
      metaEl.appendChild(span);
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "row-header corner";
    corner.textContent = "";
    headerRow.appendChild(corner);

    for (let c = 0; c < colCount; c++) {
      const th = document.createElement("th");
      th.textContent = columnLabel(c);
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    let firstSelectedCell = null;

    for (let r = 0; r < rowCount; r++) {
      const tr = document.createElement("tr");
      const rowHeader = document.createElement("th");
      rowHeader.className = "row-header";
      rowHeader.textContent = String(r + 1);
      tr.appendChild(rowHeader);

      const row = Array.isArray(rows[r]) ? rows[r] : [];
      for (let c = 0; c < colCount; c++) {
        const td = document.createElement("td");
        const value = row[c];
        td.textContent = value == null ? "" : String(value);

        const inSelection = !!(
          start &&
          r >= start.row &&
          r < start.row + (selected && selected.rowCount ? selected.rowCount : 0) &&
          c >= start.col &&
          c < start.col + (selected && selected.colCount ? selected.colCount : 0)
        );

        if (inSelection) {
          td.classList.add("selected");
          if (r === start.row && c === start.col) {
            td.classList.add("selection-start");
            firstSelectedCell = td;
          }
        }

        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    rootEl.className = "";
    rootEl.textContent = "";
    rootEl.appendChild(table);

    if (firstSelectedCell && typeof firstSelectedCell.scrollIntoView === "function") {
      firstSelectedCell.scrollIntoView({ block: "center", inline: "center" });
    } else if (sheetWrapEl) {
      sheetWrapEl.scrollTop = 0;
      sheetWrapEl.scrollLeft = 0;
    }
  }

  const selected = parseJson(selectedEl && selectedEl.value);
  const snapshot = parseJson(snapshotEl && snapshotEl.value);
  renderTable(selected, snapshot);
})();
