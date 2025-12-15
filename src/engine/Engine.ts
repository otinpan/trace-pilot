import{
    ExtensionContext,
    Disposable,
    commands,
    TextEditor,
    TextEditorEdit,
    window,
    env,
} from 'vscode';

import * as cp from 'child_process';
import {Metadata, WEB_INFO_SOURCE} from '../constants/types';
import {makeID} from '../common'
import {getRepositoryPath,ensureGitRepo} from '../repository';
import { spawn } from 'child_process';

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
        }

        try{
            const hash=await this.calculateHashAndStore(copiedText);

            const meta: Metadata={
                code: copiedText,
                hash,
                url: editor.document.uri.toString(true),
                type: WEB_INFO_SOURCE.VSCODE,
                timeCopied: Date.now(),
                id: makeID(),
                additionalMetaData: null,
            };

            // メタデータをjsonに変換して書き込み
            await env.clipboard.writeText(JSON.stringify(meta));

            window.showInformationMessage("success: stored + metadata copied!");
            return true;
        }catch(err: any){
            window.showErrorMessage(`error: failed: ${err?.message ?? err}`);
            return false;
        }
    };

    async calculateHashAndStore(_copied_text: string): Promise<string>{
        const repoPath=getRepositoryPath();
        ensureGitRepo(repoPath);

        return new Promise<string>((resolve,reject)=>{
            // シェルを叩く
           // printf '%s' $CONTENT | git hash-object -w --stdin でハッシュ値を生成
           // blobオブジェクトとして保存
           const git=cp.spawn('git',['hash-object','-w','--stdin'],{
                cwd:repoPath
            });
        
            let stdout='';
            let stderr='';
        
            // 標準出力
            git.stdout.on('data',(data)=>{
                stdout+=data.toString();
            });
        
            // 標準エラー出力
            git.stderr.on('data',(data)=>{
                stderr+=data.toString();
            });
        
            // 子プロセスの起動に失敗
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
            git.stdin.write(_copied_text,'utf8');
            git.stdin.end();
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