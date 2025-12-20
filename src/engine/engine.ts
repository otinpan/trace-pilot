import{
    ExtensionContext,
    Disposable,
    commands,
    TextEditor,
    TextEditorEdit,
    window,
    env,
} from 'vscode';
import * as fs from "fs";
import * as path from "path";
import * as cp from 'child_process';
import {Metadata, WEB_INFO_SOURCE} from '../constants/types';
import {getRepositoryPath,getRepositoryPathOrNull} from '../repository/repository';
import { spawn } from 'child_process';
import { ensureWorktree } from '../repository/worktree';
import { json, text } from 'stream/consumers';
import {execGit} from "../common";
import { fstat } from 'fs';

export class TraceEngine{
    constructor(
        private readonly context: ExtensionContext
    ){
        
    };

    async VSCodeCopy(): Promise<boolean>{
        const editor=window.activeTextEditor;
        if(!editor){
            window.showInformationMessage("error: window is invalid");
            return false;
        }

        // 選択した範囲のtext
        const copiedText:string=editor.document.getText(editor.selection);
        if(!copiedText){
            window.showInformationMessage("error: select no contents");
            return false;
        }

        try{
            // 元データの保存、ハッシュ値
            const originalHash=await this.calculateHashAndStore(copiedText);

            const meta: Metadata={
                hash: originalHash,
                url: editor.document.uri.toString(true),
                type: WEB_INFO_SOURCE.VSCODE,
                timeCopied: new Date().toISOString(),
                timeCopiedNumber: Date.now(),
                additionalMetaData: null,
            };

            // メタデータの保存、ハッシュ値
            const metaJSON=JSON.stringify(meta);
            const metaHash=await this.calculateHashAndStore(metaJSON);

            // 元のテキストとハッシュ値をクリップボードに書き込む
            const marker=`// @trace-pilot ${metaHash}`;
            const clipboardText=`${marker}\n${copiedText}`;
            await env.clipboard.writeText(clipboardText);

            window.showInformationMessage("success: stored + metadata copied!");
            return true;
        }catch(err: any){
            window.showErrorMessage(`error: failed: ${err?.message ?? err}`);
            return false;
        }
    };

    async calculateHashAndStore(_copied_text: string): Promise<string>{
        const repoPath=await getRepositoryPathOrNull();
	    if(!repoPath){
	    	throw new Error("Not a git repository. Open a folder that has .git (or init first).");
        }
        

        // worktreeの作成
        await ensureWorktree(repoPath);

        // ブランチの移動
        const worktreePath=path.join(repoPath,'.trace-worktree');

        // コマンドの実行
        // blobオブジェクトの作成
        let hash=await this.createBlobObject(worktreePath,_copied_text);
        window.showInformationMessage(hash);
        // stage
        await this.stageBlobObject(worktreePath,hash,_copied_text);
        window.showInformationMessage(worktreePath);
        
        // commit
        await this.commitBlobObject(worktreePath);
        // push
        await this.pushBlobObject(worktreePath);

        return hash;
    }

    async createBlobObject(worktreePath:string,text:string):Promise<string>{
        return new Promise((resolve,reject)=>{
            const git=cp.spawn("git",["hash-object","-w","--stdin"],{cwd:worktreePath});

            let stdout="";
            let stderr="";

            git.stdout?.on("data",(d)=>(stdout+=d.toString("utf8")));
            git.stderr?.on("data",(d)=>(stderr+=d.toString("utf8")));

            git.on('error',(err)=>{
                reject(err);
            });

            // 子プロセスが終了
            git.on('close',(code)=>{
                // 成功
                if(code===0){
                    resolve(stdout.trim());
                }else{
                    reject(new Error(`git hash-object exited with code ${code}: ${stderr}`));
                }
            });
        
            // text書き込み
            git.stdin.write(text,'utf8');
            git.stdin.end();

        });
    }

    async stageBlobObject(worktreePath:string,hash:string,text:string){
        const dir=path.join(worktreePath,"blobs");
        fs.mkdirSync(dir,{recursive:true});
        fs.writeFileSync(path.join(dir,`${hash}.bin`),text,"utf8");

        await execGit(["add",`blobs/${hash}.bin`],worktreePath);
    }

    async commitBlobObject(worktreePath:string){
        return new Promise((resolve,reject)=>{
            const git=cp.spawn(
                "git",
                ["commit","-m","store copied content"],
                {cwd:worktreePath}
            );

            let stdout="";
            let stderr="";

            git.stdout?.on("data",(d)=>(stdout+=d.toString("utf8")));
            git.stderr?.on("data", (d) => (stderr += d.toString("utf8")));

            git.on("error",reject);

            git.on("close", (code) => {
                if (code === 0) resolve(stdout.trim());
                else reject(new Error(`git commit exited with code ${code}: ${stderr || stdout}`));
            });

        });
    }

    async pushBlobObject(worktreePath:string){
        return new Promise((resolve,reject)=>{
            const git=cp.spawn(
                "git",
                ["push","origin","trace-store"],
                {cwd:worktreePath}
            );
            let stdout="";
            let stderr="";

            git.stdout?.on("data",(d)=>(stdout+=d.toString("utf8")));
            git.stderr?.on("data", (d) => (stderr += d.toString("utf8")));

            git.on("error",reject);

            git.on("close", (code) => {
                if (code === 0) resolve(stdout.trim());
                else reject(new Error(`git push exited with code ${code}: ${stderr || stdout}`));
            });
        });
    }

    async VSCodePaste(): Promise<boolean>{
        return true;
    }

    // コピー
    // 元の文書を保存する → ハッシュ値
    // メタデータの生成
    // メタデータの保存 → ハッシュ値
    // クリップボードに文書＋ハッシュ値の貼り付け
    
    // ペースト
    // パース
    // メタデータの生成
    // メタデータの保存
    // リンクを作る

    //b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
    

    // 候補1
    // ハイライト表示 → 右クリックでリンクに飛ぶ
    // ハイライトの位置は編集とともに更新する必要あり

    // 候補2
    // 該当コードの上の行にリンク
    // 位置の更新はなし

    // 候補3
    // hover表示
    // 正規表現と一致した行を取り出して、そこからハッシュ値をパースする

    
}