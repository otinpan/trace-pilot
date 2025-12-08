// src/logger.ts
import * as vscode from 'vscode';
import * as os from 'os';

const LogChannel = vscode.window.createOutputChannel('TracePilot');

export interface LogContext {
  hash: string;
  content: string;
  filePath?: string;
}


export function logStore(_ctx: LogContext): void {
  const now = new Date().toISOString();
  const user = os.userInfo().username ?? '-';
  const filePath = _ctx.filePath ?? '-';
  const contentLength = Buffer.byteLength(_ctx.content, 'utf8');

  const headerLine = `${filePath} ${user} - [${now}] "TCC STORE local" 0 ${contentLength}`;

  LogChannel.appendLine(headerLine);
  LogChannel.appendLine('===');
  LogChannel.appendLine(_ctx.hash);
  LogChannel.appendLine('===');
  LogChannel.appendLine(_ctx.content);
  LogChannel.appendLine('---');
}

