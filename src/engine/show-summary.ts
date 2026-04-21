import {
  window,
  ExtensionContext,
  Uri,
  ViewColumn,
  Webview,
} from "vscode";
import path from "path";
import * as fs from "fs";

export async function showSummary(
  context: ExtensionContext,
  titleHash: string,
  promptText: string,
  summaryMarkdown: string,
): Promise<void> {
  const panel = window.createWebviewPanel(
    "trace-pilot.summary",
    `Trace-Pilot Summary: ${titleHash.slice(0, 8)}`,
    ViewColumn.Beside,
    { enableScripts: true },
  );

  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [
      Uri.joinPath(context.extensionUri, "media"),
    ],
  };

  panel.webview.html = webviewContentSummary(
    context.extensionUri.fsPath,
    panel.webview,
    titleHash,
    promptText,
    summaryMarkdown,
  );
}

function webviewContentSummary(
  extensionPath: string,
  webview: Webview,
  titleHash: string,
  promptText: string,
  summaryMarkdown: string,
): string {
  const htmlPath = path.join(extensionPath, "media", "show_summary.html");
  const markdownItPath = path.join(extensionPath, "media", "markdown-it.min.js");
  const showSummaryJsPath = path.join(extensionPath, "media", "show_summary.js");
  const nonce = getNonce();

  const markdownItUri = webview.asWebviewUri(Uri.file(markdownItPath));
  const showSummaryJsUri = webview.asWebviewUri(Uri.file(showSummaryJsPath));

  let html = fs.readFileSync(htmlPath, "utf8");
  html = replaceAllToken(html, "cspSource", webview.cspSource);
  html = replaceAllToken(html, "nonce", nonce);
  html = replaceAllToken(html, "markdownItUri", markdownItUri.toString());
  html = replaceAllToken(html, "showSummaryJsUri", showSummaryJsUri.toString());
  html = replaceAllToken(html, "sourceHash", escapeForHtmlTemplate(titleHash));
  html = replaceAllToken(html, "promptText", escapeForHtmlTemplate(promptText));
  html = replaceAllToken(html, "summaryText", escapeForHtmlTemplate(summaryMarkdown));

  return html;
}

function replaceAllToken(html: string, key: string, value: string): string {
  const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
  return html.replace(re, value);
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeForHtmlTemplate(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
