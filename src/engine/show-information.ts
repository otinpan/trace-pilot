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
import { ResolveFnOutput } from 'module';
import { MetaData } from '../common';
import MarkdownIt from "markdown-it";
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
        "tracePilotPdf",
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
const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
});

function inferLang(mdItLike: string|undefined):string{
    const s=(mdItLike??"").trim();
    const m = s.match(/!\s*([a-zA-Z0-9_+-]+)/);
    if(m?.[1])return m[1].toLowerCase();
    return "text";
}

function toFencedMarkdownFromBotResponse(
    botResponse: string,
    codeBlocks: {code:string,language:string}[],
):string{
    let out=botResponse??"";

    out = out
        // 「rustCopy code」「pythonCopy code」「cppCopy code」全部消える
        .replace(/[a-zA-Z0-9_+-]*Copy code/gi, "")
        // 単独の「Copy code」も消す
        .replace(/\bCopy code\b/gi, "");

    // 長いコードから置換する
    const blocks = [...codeBlocks].sort((a, b) => (b.code?.length ?? 0) - (a.code?.length ?? 0));
    for(const b of blocks){
        const code=b.code?? "";
        if(!code)continue;

        const lang=inferLang(b.language);

        const idx=out.indexOf(code);
        if (idx >= 0) {
            // codeブロックで囲む
            const fenced = `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
            out = out.slice(0, idx) + fenced + out.slice(idx + code.length);
        }

    }
    out = out.replace(/\n{3,}/g, "\n\n");
    console.log(out);
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
    const panel=window.createWebviewPanel(
        "tracePilotMarkdown",
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
            code:cb.code ?? "",
            language: cb.language ?? "text",
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
    promptText:string,
    generatedText:string,
):string{
    const htmlPath=path.join(extensionPath,"media","show_markdown.html");
    const nonce=getNonce();

    const promptHtml=md.render(promptText ?? "");
    const generatedHtml=md.render(generatedText ?? "");

    let html=fs.readFileSync(htmlPath,"utf8");
    html = replaceAllToken(html, "cspSource", webview.cspSource);
    html=replaceAllToken(html,"nonce",nonce);

    // show_markdown.htmlの{{promptHtml}}をpromptHtmlに置き換える
    html=replaceAllToken(html,"promptHtml",promptHtml);
    html=replaceAllToken(html,"generatedHtml",generatedHtml);

    // 置換漏れがあると必ず事故るので検出
    const leftovers = html.match(/\{\{\s*\w+\s*\}\}/g);
    if(leftovers){
        console.error("Unreplaced template tokens remain:", leftovers);
    }

    return html;

}
