import {
    window,
    ExtensionContext,
    Uri,
    ViewColumn,
    Webview,
    commands,
} from 'vscode';
import path from 'path';
import * as os from "os";
import * as fs from "fs";

export interface PromptCardsWebviewData{
  selectedPairHash: string;
  cards: PromptCardItem[];
}

export interface PromptCardItem{
  promptHash: string;
  promptText: string;
  generatedHash: string;
  generatedText: string;
  metaHashes: string[];
  copiedTime: string;
  copiedTimeNumber: number;
}

export async function showPromptCards(
  context:ExtensionContext,
  data: PromptCardsWebviewData,
):Promise<void>{
  const panel=window.createWebviewPanel(
    "trace-pilot.promptCards",
    `Trace-Pilot PromptCards: ${data.selectedPairHash.slice(0,8)}`,
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

  const disp=panel.webview.onDidReceiveMessage(async (msg)=>{
    if(msg?.type!=="openMeta"){
      return;
    }
    if(typeof msg.metaHash!=="string" || !msg.metaHash){
      return;
    }
    await commands.executeCommand("trace-pilot.openMeta",msg.metaHash);
  });
  context.subscriptions.push(disp);

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
  html=replaceAllToken(html,"selectedPairHash",escapeHtml(data.selectedPairHash));
  html=replaceAllToken(html,"cardsJson",escapeForInlineScript(JSON.stringify(data.cards)));
  html=replaceAllToken(
    html,
    "selectedPairHashJson",
    escapeForInlineScript(JSON.stringify(data.selectedPairHash))
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

// json文字列を安全にする
function escapeForInlineScript(value: string): string{
  return value
    .replaceAll("<","\\u003c")
    .replaceAll(">","\\u003e")
    .replaceAll("&","\\u0026");
}
