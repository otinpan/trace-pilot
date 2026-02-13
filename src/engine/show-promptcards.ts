import {
    window,
    ExtensionContext,
    Uri,
    ViewColumn,
    Webview,
} from 'vscode';
import path from 'path';
import * as os from "os";
import * as fs from "fs";

export interface PromptCardsWebviewData{
  pairHash: string;
  timesText: string;
  timesToHashText: string;
  hashToPromptMetadataText: string;
}

export async function showPromptCards(
  context:ExtensionContext,
  data: PromptCardsWebviewData,
):Promise<void>{
  const panel=window.createWebviewPanel(
    "trace-pilot.promptCards",
    `Trace-Pilot PromptCards: ${data.pairHash.slice(0,8)}`,
    ViewColumn.Beside,
    {enableScripts: true}
  );

  panel.webview.options={
    enableScripts:true,
    localResourceRoots:[
      Uri.joinPath(context.extensionUri,"media"),
      Uri.file(path.join(os.tmpdir(),"trace-pilot")),
    ]
  };

  panel.webview.html=webviewContentPromptCards(context.extensionUri.fsPath,panel.webview,data);

}



function webviewContentPromptCards(
  extensionPath:string,
  webview: Webview,
  data: PromptCardsWebviewData
):string{
  const htmlPath=path.join(extensionPath,"media","show_promptcards.html");
  
  const nonce=getNonce();

  const promptCardsJsPath=path.join(extensionPath,"media","show_promptcards.js");

  const promptCardsJsUri=webview.asWebviewUri(Uri.file(promptCardsJsPath));

  let html=fs.readFileSync(htmlPath,"utf8");
  html=replaceAllToken(html,"cspSource",webview.cspSource);
  html=replaceAllToken(html,"promptCardsJsUri",promptCardsJsUri.toString());
  html=replaceAllToken(html,"nonce",nonce);
  html=replaceAllToken(html,"pairHash",escapeHtml(data.pairHash));
  html=replaceAllToken(html,"timesText",escapeHtml(data.timesText));
  html=replaceAllToken(html,"timesToHashText",escapeHtml(data.timesToHashText));
  html=replaceAllToken(
    html,
    "hashToPromptMetadataText",
    escapeHtml(data.hashToPromptMetadataText)
  );

  return html;
}

function replaceAllToken(html: string, key: string, value: string): string {
  const re=new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`,"g");
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

function escapeHtml(value: string): string{
  return value
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}
