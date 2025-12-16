import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import { window, workspace } from 'vscode';

class Worktree{
    private readonly preBranch: String | undefined;

    public constructor(){

    }

}
export async function getRepositoryPath(cwd:string):Promise<string>{
    return new Promise<string>((resolve, reject) => {
        cp.exec("git rev-parse --show-toplevel", { cwd }, (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr?.toString() || "Not a git repository"));
            return;
          }
          resolve(stdout.trim());
        });

    });

}




// 見つからなかった場合null
export async function getRepositoryPathOrNull():Promise<string|null>{
    // エディタでファイルを開いているならそのファイルがあるフォルダをcwd
    const cwd=window.activeTextEditor?.document.uri.fsPath
    ?require("path").dirname(window.activeTextEditor.document.uri.fsPath)
    :(workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
    try{
        return await getRepositoryPath(cwd);
    }catch{
        return null;
    }
}


// cd "$(git rev-parse --show-toplevel)"