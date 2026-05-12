import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// ======================================
// console.log hook
// ======================================

const originalConsoleLog = console.log;

function getLogFilePath(): string {
  const ws = vscode.workspace.workspaceFolders?.[0];
  const baseDir = ws?.uri.fsPath ?? process.cwd();
  return path.join(baseDir, "app.log");
}

console.log = (...args: any[]) => {
  const message = args
    .map(v =>
      typeof v === "object"
        ? JSON.stringify(v)
        : String(v)
    )
    .join(" ");

  fs.appendFileSync(getLogFilePath(), message + "\n");

  originalConsoleLog(...args);
};

// ======================================
// Decorator
// ======================================

export function LogMethod(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) {
  const original = descriptor.value;

  descriptor.value = function (...args: any[]) {
    console.log(`[ENTER] ${propertyKey}`);

    try {
      const result = original.apply(this, args);

      console.log(`[EXIT] ${propertyKey}`);

      return result;
    } catch (e) {
      console.log(`[ERROR] ${propertyKey}`, e);
      throw e;
    }
  };
}

export function logMethodMessage(
  propertyKey: string,
  stage: "ENTER" | "EXIT" | "INFO" | "ERROR",
  details?: unknown,
) {
  if (details === undefined) {
    console.log(`[${stage}] ${propertyKey}`);
    return;
  }

  console.log(`[${stage}] ${propertyKey}`, details);
}
