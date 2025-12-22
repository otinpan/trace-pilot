import{
    ExtensionContext,
    Disposable,
    commands,
    TextEditor,
    TextEditorEdit,
    Range,
    Position,
    window,
    env,
    DocumentDropEdit,
    TextEditorDecorationType,
    DecorationOptions,
    workspace,
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
import { toEditorSettings } from 'typescript';

export class TraceEngine{
    private highlightDeco?: TextEditorDecorationType;
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

        // 全文のテキスト
        const fullText:string=editor.document.getText();

        try{
            // 選択範囲テキストの保存、ハッシュ値
            const originalHash=await this.calculateHashAndStore(copiedText);

            // 全文保存
            const fullTextHash=await this.calculateHashAndStore(fullText);
            
            const meta: Metadata={
                originalHash: originalHash,
                fullTextHash: fullTextHash,
                url: editor.document.uri.toString(true),
                type: WEB_INFO_SOURCE.VSCODE,
                timeCopied: new Date().toISOString(),
                timeCopiedNumber: Date.now(),
                additionalMetaData: null,
            };

            // メタデータの保存、ハッシュ値
            const metaJSON=JSON.stringify(meta);

            // windowに表示
            const metaHash=await this.calculateHashAndStore(metaJSON);

            window.showInformationMessage(metaHash);
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
        // stage
        await this.stageBlobObject(worktreePath,hash,_copied_text);
        // commit
        await this.commitBlobObject(worktreePath);
        // push
        //await this.pushBlobObject(worktreePath);

        return hash;
    }

    async createBlobObject(worktreePath:string,text:string):Promise<string>{
        return new Promise((resolve,reject)=>{
            const git=cp.spawn("git",["hash-object","--stdin"],{cwd:worktreePath});

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

        await execGit(["add","-f",`blobs/${hash}.bin`],worktreePath);
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

    async getMetaData(metaHash:string):Promise<boolean>{
        return true;
    }

    async VSCodeShowInformation(metaHash:string):Promise<boolean>{
        try{
            const metaJSON=await this.restoreTextByHash(metaHash);
            const metaData=JSON.parse(metaJSON) as Metadata;

            const fullText=await this.restoreTextByHash(metaData.fullTextHash);
            const copiedText=await this.restoreTextByHash(metaData.originalHash);

            await this.showFullTextAndHighlight(fullText,copiedText);

            return true;
        }catch(e:any){
            window.showErrorMessage(`failed to open meta: ${e?.message ?? e}`);
            return false;
        }
    }

    // full textからneedleを見つけてRangeを返す
    findAllRanges(fullText: string, needle: string): Range[] {
        if (!needle) return [];

        const ranges: Range[] = [];
        let idx = 0;

        while (true) {
          const hit = fullText.indexOf(needle, idx);
          if (hit === -1) break;
        
          const start = this.offsetToPosition(fullText, hit);
          const end = this.offsetToPosition(fullText, hit + needle.length);
          ranges.push(new Range(start, end));
        
          // 同じ場所で無限ループしないように進める（needleが空でない前提）
          idx = hit + Math.max(1, needle.length);
        }
        return ranges;
    }
    // 文字オフセットを（行、列）に直す
    offsetToPosition(text: string, offset: number): Position {
        const before = text.slice(0, offset);
        const lines = before.split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;
        return new Position(line, character);
    }

    // 全文の表示
    async showFullTextAndHighlight(fullText: string,copiedText: string){
        const doc=await workspace.openTextDocument({
            content: fullText,
            language: "plaintext",
        });

        const editor=await window.showTextDocument(doc,{preview:false});

        this.highlightDeco?.dispose();
        this.highlightDeco=window.createTextEditorDecorationType({
            backgroundColor: "rgba(255, 230, 0, 0.35)",
            border: "1px solid rgba(255, 230, 0, 0.8)",
            isWholeLine: false,
        });

        const ranges=this.findAllRanges(fullText,copiedText);
        const decorations: DecorationOptions[] = ranges.map((range) => ({
            range,
            hoverMessage: "Copied text",
        }));

        editor.setDecorations(this.highlightDeco,decorations);

        // 見つかったら最初の一致箇所にジャンプ
        if(ranges.length>0){
            editor.revealRange(ranges[0],1);
        }else{
            window.showInformationMessage("Could not find copied text in full text");
        }
    }


    // hashからテキストの復元
    async restoreTextByHash(hash:string):Promise<string>{
        const repoPath=await getRepositoryPathOrNull();
        if(!repoPath){
            throw new Error("Not a git repository. Open a folder that has .git (or init first).");
        }

        const worktreePath=path.join(repoPath,".trace-worktree");
        const blobPath=path.join(worktreePath,"blobs",`${hash}.bin`);

        return fs.readFileSync(blobPath,"utf8");
        
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