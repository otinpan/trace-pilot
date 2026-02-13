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

export async function showPromptCards(
  context:ExtensionContext,
  pair_hash: string,
):Promise<void>{
  const panel=window.createWebviewPanel(
    "trace-pilot.promptCards",
    `Trace-Pilot PromptCards: ${pair_hash.slice(0,8)}`,
    ViewColumn.Beside,
    {enableScripts: true}
  );

  panel.webview.options={
    enableScripts:true,
    localResourceRoots:[
      Uri.joinPath(context.extensionUri,"media"),
      Uri.file(path.join(os.tmpdir(),"trace-pilot")),
    ]
  }

  panel.webview.html=webviewContentPromptCards(context.extensionUri.fsPath,panel.webview);

}



function webviewContentPromptCards(extensionPath:string,webview: Webview):string{
  const htmlPath=path.join(extensionPath,"media","show_promptcards.html");
  
  const nonce=getNonce();

  const promptCardsJsPath=path.join(extensionPath,"media","show_promptcards.js");

  const promptCardsJsUri=webview.asWebviewUri(Uri.file(promptCardsJsPath));

  let html=fs.readFileSync(htmlPath,"utf8");
  html=replaceAllToken(html,"cspSource",webview.cspSource);
  html=replaceAllToken(html,"promptCardsJsUri",promptCardsJsUri.toString());
  html=replaceAllToken(html,"nonce",nonce);

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

