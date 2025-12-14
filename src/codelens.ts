/*
const markerRegex = /\/\/\s*@trace-pilot\s+([0-9a-f]+)/;

provideCodeLenses(document: TextDocument): CodeLens[] {
  const lenses: CodeLens[] = [];
  for (let line = 0; line < document.lineCount; line++) {
    const text = document.lineAt(line).text;
    const m = text.match(markerRegex);
    if (!m) continue;

    const hash = m[1]; // マーカーから hash を取り出す
    const meta = index_repository.getMetaByHash(hash);
    if (!meta) continue;

    const range = new Range(line, 0, line, 0); // 行頭とかでOK
    lenses.push(new CodeLens(range, {
      title: 'Trace Pilot: jump to origin',
      command: 'trace-pilot.open-origin',
      arguments: [meta],
    }));
  }
  return lenses;
}

*/