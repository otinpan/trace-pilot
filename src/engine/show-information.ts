import {
    Range,
    Position,
    workspace,
    window,
    TextEditorDecorationType,
    DecorationOptions,
    ExtensionContext,
    Uri,
    commands,
    ViewColumn,
    Webview,
    TaskPanelKind,
} from 'vscode';

import { TraceEngine } from "./engine";
import { ensureWorktree } from '../repository/worktree';
import * as cp from "child_process";
import path from 'path';
import { fstat, openSync } from 'fs';;
import * as os from "os";
import * as fs from "fs";
import { RestoredCodeBlock } from '../constants/types';
import { cachedDataVersionTag } from 'v8';
import * as vscode from "vscode";

// full textからneedleを見つけてRangeを返す
export function findAllRanges(fullText: string, needle: string): Range[] {
    if (!needle) return [];
    const ranges: Range[] = [];
    let idx = 0;
    while (true) {
      const hit = fullText.indexOf(needle, idx);
      if (hit === -1) break;
    
      const start = offsetToPosition(fullText, hit);
      const end = offsetToPosition(fullText, hit + needle.length);
      ranges.push(new Range(start, end));
    
      // 同じ場所で無限ループしないように進める（needleが空でない前提）
      idx = hit + Math.max(1, needle.length);
    }
    return ranges;
}
// 文字オフセットを（行、列）に直す
export function offsetToPosition(text: string, offset: number): Position {
    const before = text.slice(0, offset);
    const lines = before.split("\n");
    const line = lines.length - 1;
    const character = lines[lines.length - 1].length;
    return new Position(line, character);
}
// 全文の表示
export async function showFullTextAndHighlightText(fullText: string,copiedText: string,engine: TraceEngine){
    const doc=await workspace.openTextDocument({
        content: fullText,
        language: "plaintext",
    });
    const editor=await window.showTextDocument(doc,{preview:false});
    engine.highlightDeco?.dispose();
    engine.highlightDeco=window.createTextEditorDecorationType({
        backgroundColor: "rgba(255, 230, 0, 0.35)",
        border: "1px solid rgba(255, 230, 0, 0.8)",
        isWholeLine: false,
    });

    // 正規化 改行やタブに対応
    const normFull = fullText.replace(/\r\n/g, "\n");
    const normNeedle = copiedText.replace(/\r\n/g, "\n").replace(/\s+$/, ""); // 末尾の改行/空白だけ落とす
    const ranges = findAllRanges(normFull, normNeedle);

    const decorations: DecorationOptions[] = ranges.map((range) => ({
        range,
        hoverMessage: "Copied text",
    }));
    editor.setDecorations(engine.highlightDeco,decorations);
    // 見つかったら最初の一致箇所にジャンプ
    if(ranges.length>0){
        editor.revealRange(ranges[0],1);
    }else{
        window.showInformationMessage("Could not find copied text in full text");
    }
}

// git hash-object hash でpdfバイナリを返す
async function gitCatFileBlobBytes(cwd:string,hash:string):Promise<Buffer>{
    return new Promise((resolve,reject)=>{
        const p = cp.spawn("git", ["cat-file", "-p", hash], { cwd });

        const chunks: Buffer[]=[];
        let err="";

        p.stdout.on("data",(d:Buffer)=>chunks.push(d));
        p.stderr.on("data", (d) => (err += d.toString("utf8")));
        p.on("error",reject);

        p.on("close",(code)=>{
            if(code===0)resolve(Buffer.concat(chunks));
            else reject(new Error(`git cat-file failed (${code}): ${err}`));
        });
    });
}


// pdfを保存
async function storePdfFromHash(repoPath:string,hash:string):Promise<string>{
    const worktreePath=path.join(repoPath,'.trace-worktree');
    if(!fs.existsSync(worktreePath)){
        throw new Error(`worktree not found: ${repoPath}`);
    }

    // pdfバイナリ
    try{
        const pdfBytes=await gitCatFileBlobBytes(worktreePath,hash);
        // 現在開いているフォルダの一時的ディレクトリに保存
        const tmpdir=path.join(os.tmpdir(),"trace-pilot");
        fs.mkdirSync(tmpdir,{recursive:true});
        const pdfPath=path.join(tmpdir,`${hash}.pdf`);
        fs.writeFileSync(pdfPath,pdfBytes);

        return pdfPath;
    }catch(e:any){
        window.showErrorMessage(`failed: ${e?.message ?? e}`);
        return "";
    }
    
}


export async function showFullPdfAndHighligtPdf(
    repoPath:string,
    hash:string,
    copiedText:string,
    context: ExtensionContext,
)
:Promise<void>{
    if(!fs.existsSync(repoPath)){
        throw new Error(`Source PDF not found: ${repoPath}`);
    }

    // 正規化
    const normNeedle = copiedText.replace(/\r\n/g, "\n").replace(/\s+$/, ""); // 末尾の改行/空白だけ落とす
    // 元pdf
    const srcPdfPath:string=await storePdfFromHash(repoPath,hash);
    if(!srcPdfPath||!fs.existsSync(srcPdfPath)){
        throw new Error(`PDF not restored: ${srcPdfPath}`);
    }

    //webview
    const panel=window.createWebviewPanel(
        "trace-pilot.pdf",
        `Trace-Pilot PDF: ${hash.slice(0,8)}`,
        ViewColumn.Active,
        { enableScripts:true}
    );


    panel.webview.options={
        enableScripts:true,
        localResourceRoots:[
            Uri.joinPath(context.extensionUri,"media"),
            Uri.file(path.dirname(srcPdfPath)),
            Uri.file(path.join(os.tmpdir(),"trace-pilot")),
        ]
    };


    panel.webview.html=webviewContentPDF(context.extensionUri.fsPath,srcPdfPath,panel.webview);


    // readyを受け取ったらfindを送り返す -> 検索、ハイライト
    const disp=panel.webview.onDidReceiveMessage((msg)=>{
        if(msg?.type==="ready"){
            console.log(`send message: find ${normNeedle}`);
            panel.webview.postMessage({type:"find",needle:normNeedle});
        }
    });

    context.subscriptions.push(disp);
}

// 毎回ランダムなキーを作成
function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function replaceAllToken(html: string, key: string, value: string): string {
  // {{key}} も {{ key }} も全部置換
  const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
  return html.replace(re, value);
}


// html設定 panel.webview.html=webviewContentPDF(context.extensionUri.fsPath,srcPdfPath,panel.webview);
function webviewContentPDF(extensionPath: string, srcPdfPath: string, webview: Webview): string {
    const pdfJsPath = path.join(extensionPath, "media", "pdfjs", "pdf.mjs");
    const pdfWorkerPath = path.join(extensionPath, "media", "pdfjs", "pdf.worker.mjs");
    const htmlPath = path.join(extensionPath, "media", "show_pdf.html");
    const pdfJsUri = webview.asWebviewUri(Uri.file(pdfJsPath));
    const pdfJsWorkerUri = webview.asWebviewUri(Uri.file(pdfWorkerPath));
    const pdfUri = webview.asWebviewUri(Uri.file(srcPdfPath));
    const nonce = getNonce();
    let html = fs.readFileSync(htmlPath, "utf8");

    html = replaceAllToken(html, "pdfJsUri", pdfJsUri.toString());
    html = replaceAllToken(html, "pdfJsWorkerUri", pdfJsWorkerUri.toString());
    html = replaceAllToken(html, "pdfUri", pdfUri.toString());
    html = replaceAllToken(html, "cspSource", webview.cspSource);
    html = replaceAllToken(html, "nonce", nonce);
    // 置換漏れがあると必ず事故るので検出
    const leftovers = html.match(/\{\{\s*\w+\s*\}\}/g);
    if (leftovers) {
          console.error("Unreplaced template tokens remain:", leftovers);
    }
    
    return html;
}



// markdown /////////////////////////////////////////////////////////////////////
function inferLang(mdItLike: string|undefined):string{
    const s=(mdItLike??"").trim();
    const m = s.match(/!\s*([a-zA-Z0-9_+-]+)/);
    if(m?.[1])return m[1].toLowerCase();
    return "text";
}

// responseからcodeBlockを探して```を差し込む
function toFencedMarkdownFromBotResponse(
    botResponse: string,
    codeBlocks: { code: string; language: string }[],
): string {
    const normalize = (s: string) =>
        (s ?? "")
            .replace(/[a-zA-Z0-9_+-]*Copy code/gi, "")
            .replace(/\bCopy code\b/gi, "")
            .replace(/\r\n/g, "\n");

    const stripLangHeader = (code: string, lang: string) => {
        const firstLine = code.split("\n", 1)[0] ?? "";
        const fl = firstLine.trim().toLowerCase();

        const langNorm = (lang ?? "").trim().toLowerCase();

        const isLangLine =
            (langNorm && fl === langNorm) ||
            [
                "rust",
                "bash",
                "sh",
                "shell",
                "makefile",
                "python",
                "perl",
                "cpp",
                "c++",
                "js",
                "javascript",
                "ts",
                "typescript",
                "json",
                "yaml",
                "toml",
            ].includes(fl);

        if (!isLangLine) return code;

        const rest = code.slice(firstLine.length);
        return rest.replace(/^\n+/, "");
    };

    const inferLang = (mdItLike: string | undefined): string => {
        const s = (mdItLike ?? "").trim();
        const m = s.match(/!\s*([a-zA-Z0-9_+-]+)/);
        if (m?.[1]) return m[1].toLowerCase();
        return "text";
    };

    const isLineBoundary = (ch: string | undefined) => ch === undefined || ch === "\n";

    const getFenceRanges = (text: string): Array<{ start: number; end: number }> => {
        const ranges: Array<{ start: number; end: number }> = [];
        let i = 0;
        while (i < text.length) {
            const openIdx = text.indexOf("```", i);
            if (openIdx < 0) break;
            const closeIdx = text.indexOf("```", openIdx + 3);
            if (closeIdx < 0) break;
            ranges.push({ start: openIdx, end: closeIdx + 3 });
            i = closeIdx + 3;
        }
        return ranges;
    };

    const overlapsFence = (start: number, end: number, ranges: Array<{ start: number; end: number }>) => {
        for (const r of ranges) {
            if (start < r.end && end > r.start) return true;
        }
        return false;
    };

    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const findBestCodeMatch = (text: string, code: string): number => {
        const fenceRanges = getFenceRanges(text);
        let from = 0;
        while (from < text.length) {
            const idx = text.indexOf(code, from);
            if (idx < 0) return -1;

            const end = idx + code.length;
            const prev = text[idx - 1];
            const next = text[end];

            const boundaryOk = isLineBoundary(prev) && isLineBoundary(next);
            const notInsideFence = !overlapsFence(idx, end, fenceRanges);

            if (boundaryOk && notInsideFence) return idx;
            from = idx + 1;
        }
        return -1;
    };

    const findCodeRangeIgnoringWhitespace = (
        text: string,
        code: string,
    ): { start: number; end: number } | null => {
        const tokens = code.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return null;

        const pattern = tokens.map(escapeRegExp).join("\\s*");
        const re = new RegExp(pattern, "gm");
        const fenceRanges = getFenceRanges(text);

        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const start = m.index;
            const end = start + (m[0]?.length ?? 0);
            if (end <= start) {
                re.lastIndex = start + 1;
                continue;
            }
            if (overlapsFence(start, end, fenceRanges)) {
                continue;
            }
            return { start, end };
        }
        return null;
    };

    let out = normalize(botResponse ?? "");

    // 長いコードから先に置換する
    const blocks = [...codeBlocks].sort((a, b) => (b.code?.length ?? 0) - (a.code?.length ?? 0));
    const appended: Array<{ lang: string; code: string }> = [];

    for (const b of blocks) {
        const raw = b.code ?? "";
        if (!raw.trim()) continue;

        const lang = inferLang(b.language);

        let code = normalize(raw).trimEnd();
        code = stripLangHeader(code, lang).trimEnd();

        if (!code.trim()) continue;
        if (code.length < 20 && !code.includes("\n")) continue;

        const idx = findBestCodeMatch(out, code);

        if (idx >= 0) {
            const fenced = `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
            out = out.slice(0, idx) + fenced + out.slice(idx + code.length);
        } else {
            const loose = findCodeRangeIgnoringWhitespace(out, code);
            if (loose) {
                const fenced = `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
                out = out.slice(0, loose.start) + fenced + out.slice(loose.end);
            } else {
                appended.push({ lang, code });
            }
        }
    }

    if (appended.length > 0) {
        out = out.replace(/\n{3,}/g, "\n\n").trimEnd();
        out += `\n\n---\n\nRecovered code blocks:\n`;
        for (const a of appended) {
            out += `\n\n\`\`\`${a.lang}\n${a.code}\n\`\`\`\n`;
        }
    }

    out = out.replace(/\n{3,}/g, "\n\n");
    return out.trim();
}


export async function showFullMdAndHighlightMd(
    hash: string,
    copiedText: string,
    promptText: string,
    generatedText: string,
    codeBlocks: RestoredCodeBlock[],
    context: ExtensionContext,
)
:Promise<void>{
  console.log("code blocks: ",codeBlocks);
    const panel=window.createWebviewPanel(
        "trace-pilot.markdown",
        `Trace-Pilot Markdown: ${hash.slice(0,8)}`,
        ViewColumn.Active,
    );

    panel.webview.options={
        enableScripts:true,
        localResourceRoots:[
            Uri.file(path.join(os.tmpdir(),"trace-pilot")),
            Uri.joinPath(context.extensionUri,"media"),
        ]
    };

    const generatedMd=toFencedMarkdownFromBotResponse(
        generatedText,
        codeBlocks.map(cb=>({
            code:cb.code ?? "", //codeがundefinedなら""
            language: cb.language ?? "text", //languageがundefinedならtext
        })),
    );
    panel.webview.html=webviewContentMarkdown(
        context.extensionUri.fsPath,
        panel.webview,
        promptText,
        generatedMd
    );

    // 正規化
    const normNeedle = copiedText.replace(/\r\n/g, "\n").replace(/\s+$/, ""); // 末尾の改行/空白だけ落とす

    // readyを受け取ったらfindを送り返す -> 検索、ハイライト
    const disp=panel.webview.onDidReceiveMessage((msg)=>{
        if(msg?.type==="ready"){
            console.log(`send message: find ${normNeedle}`);
            panel.webview.postMessage({type:"find",needle:normNeedle});
        }else{
            console.log("failed to send message");
        }
    });

    context.subscriptions.push(disp);
}

function webviewContentMarkdown(
    extensionPath: string,
    webview: Webview,
    promptText: string,
    generatedText: string,
): string {
    const htmlPath = path.join(extensionPath, "media", "show_markdown.html");
    const nonce = getNonce();

    const markdownItPath = path.join(extensionPath, "media", "markdown-it.min.js");
    const showMarkdownJsPath = path.join(extensionPath, "media", "show_markdown.js");

    const markdownItUri = webview.asWebviewUri(Uri.file(markdownItPath));
    const showMarkdownJsUri = webview.asWebviewUri(Uri.file(showMarkdownJsPath));

    let html = fs.readFileSync(htmlPath, "utf8");
    html = replaceAllToken(html, "cspSource", webview.cspSource);
    html = replaceAllToken(html, "nonce", nonce);

    html = replaceAllToken(html, "markdownItUri", markdownItUri.toString());
    html = replaceAllToken(html, "showMarkdownJsUri", showMarkdownJsUri.toString());

    html = replaceAllToken(html, "promptText", escapeForHtmlTemplate(promptText ?? ""));
    html = replaceAllToken(html, "generatedText", escapeForHtmlTemplate(generatedText ?? ""));

    const leftovers = html.match(/\{\{\s*\w+\s*\}\}/g);
    if (leftovers) console.error("Unreplaced template tokens remain:", leftovers);

    return html;
}


function escapeForHtmlTemplate(s: string): string {
    // show_markdown.html に埋め込むので最低限のエスケープ
    // （Webview側で textContent / md.render に渡す前提）
    return (s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
