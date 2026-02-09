import{
    ExtensionContext,
    Disposable,
    commands,
    TextEditor,
    TextEditorEdit,
    Uri,
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
import {
    Metadata,
    WEB_INFO_SOURCE,
    AdditionalHash,
    VSCodeMetadata,
    VSCodeHash,
    GPTHash,
    RestoredCodeBlock,
    GPTMetadata,
    ChromePDFMetadata,
    ChromePDFHash,
} from '../constants/types';
import {getRepositoryPath,getRepositoryPathOrNull} from '../repository/repository';
import { spawn } from 'child_process';
import { ensureWorktree } from '../repository/worktree';
import { json, text } from 'stream/consumers';
import {execGit,getActiveUri} from "../common";
import { fstat } from 'fs';
import { getParseTreeNode, toEditorSettings } from 'typescript';
import { calculateHashAndStore,calculateHashAndStoreFromBuffer } from './hash-and-store';
import { setEngine } from 'crypto';
import { showFullTextAndHighlightText,showFullPdfAndHighligtPdf, showFullMdAndHighlightMd } from './show-information';
import { showPromptCards } from './show-promptcards';

export class TraceEngine{
    public highlightDeco?: TextEditorDecorationType;
    constructor(
        private readonly context: ExtensionContext
    ){
        
    };

    async VSCodeCopy(): Promise<boolean>{
        // ctr+cを行う
        await commands.executeCommand("editor.action.clipboardCopyAction");

        const uri=getActiveUri();

        if(!uri){
            window.showErrorMessage("error: no active tab");
            return false;
        }


        const editor=window.activeTextEditor;

        let copiedText:string=await env.clipboard.readText();
        if(!copiedText){
            window.showErrorMessage("error: select no contents");
            return false;
        }
        // pdfかどうか
        const isPdf = this.checkIsPdfOpen(uri);

        // 全文のテキスト
        let fullText:string|Buffer|null;
        if(isPdf===null){
            fullText="";
        }else if(isPdf){
            fullText=await this.getPdfAsBuffer(uri);
        }else{
            if(editor){
                fullText=editor.document.getText();
            }else{
                fullText="";
            } 
        }

        try{
            // 選択範囲テキストの保存、ハッシュ値
            const originalHash=await calculateHashAndStore(copiedText);

            // 全文保存
            let fullTextHash:string;
            let isTextMedia:boolean;

            if(typeof fullText==="string"){ //text
                isTextMedia=true;
                fullTextHash=await calculateHashAndStore(fullText);
            }else if(Buffer.isBuffer(fullText)){ // pdf
                isTextMedia=false;
                fullTextHash=await calculateHashAndStoreFromBuffer(fullText);
            }else{
                throw new Error("fullText is null");
            }

            
            const meta: Metadata={
                originalHash: originalHash,
                additionalHash:{
                    fullTextHash:fullTextHash,
                },
                url: uri.toString(),
                type: WEB_INFO_SOURCE.VSCODE,
                timeCopied: new Date().toISOString(),
                timeCopiedNumber: Date.now(),
                additionalMetaData: {
                    isText:isTextMedia,
                },
            };

            // メタデータの保存、ハッシュ値
            const metaJSON=JSON.stringify(meta);

            // windowに表示
            const metaHash=await calculateHashAndStore(metaJSON);

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

    
    // 現在開かれているファイルがpdfか
    checkIsPdfOpen(uri: Uri):boolean | null{
        const isPdf=uri.scheme==='file'&&
        uri.fsPath.toLowerCase().endsWith('.pdf');

        return isPdf;
    }

    // pdfをバイナリ化
    async getPdfAsBuffer(uri:Uri):Promise<Buffer>{
        const bytes=await workspace.fs.readFile(uri);
        return Buffer.from(bytes);
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

            window.showInformationMessage(metaJSON);

            const metaData=JSON.parse(metaJSON) as Metadata;
            const ah=metaData.additionalHash;
            const add=metaData.additionalMetaData;
            switch(metaData.type){
            case WEB_INFO_SOURCE.VSCODE:{
                if(!ah||typeof ah!=="object"||!("fullTextHash" in ah)){
                    throw new Error("fullTextHash is not available for this metadata");
                }
                const fullTextHash = (ah as VSCodeHash).fullTextHash;
                const isText=
                    !!add&&typeof add==="object" && "isText" in add
                        ? (add as VSCodeMetadata).isText
                        :true;
                if(isText){
                    const fullText=await this.restoreTextByHash(fullTextHash);
                    const copiedText=await this.restoreTextByHash(metaData.originalHash);

                    await showFullTextAndHighlightText(fullText,copiedText,this);
                    return true;
                }else{
                    const copiedText=await this.restoreTextByHash(metaData.originalHash);
                    const uri=metaData.url;
                    const repoPath= await getRepositoryPathOrNull();
                    if(!repoPath){
                        throw new Error("Not a git repository. Open a folder that has .git (or init first).");
                    }

                    await showFullPdfAndHighligtPdf(repoPath,fullTextHash,copiedText,this.context);
                    return true;    
                }
                break;
            }
            case WEB_INFO_SOURCE.CHROME_PDF:{
                if(!ah||typeof ah!=="object"||!("fullTextHash" in ah)){
                    throw new Error("fullTextHash is not available for this metadata");
                }
                const fullTextHash = (ah as VSCodeHash).fullTextHash;
                const isText=
                    !!add&&typeof add==="object" && "isText" in add
                        ? (add as VSCodeMetadata).isText
                        :true;
                if(isText){
                    const fullText=await this.restoreTextByHash(fullTextHash);
                    const copiedText=await this.restoreTextByHash(metaData.originalHash);

                    await showFullTextAndHighlightText(fullText,copiedText,this);
                    return true;
                }else{
                    const copiedText=await this.restoreTextByHash(metaData.originalHash);
                    const uri=metaData.url;
                    const repoPath= await getRepositoryPathOrNull();
                    if(!repoPath){
                        throw new Error("Not a git repository. Open a folder that has .git (or init first).");
                    }

                    await showFullPdfAndHighligtPdf(
                        repoPath,
                        fullTextHash,
                        copiedText,
                        this.context
                    );
                    return true;    
                }
            }
            case WEB_INFO_SOURCE.CHAT_GPT:{
                if(!ah||typeof ah!=="object"||!("promptHash" in ah)||!("generatedHash" in ah)){
                    throw new Error("promptHash or gneneratedHash is not available for this metadata");
                }
                const promptHash=(ah as GPTHash).promptHash;
                const generatedHash=(ah as GPTHash).generatedHash;
                const codeBlockHashes=(ah as GPTHash).codeBlockHashes;

                const promptText=await this.restoreTextByHash(promptHash);
                const generatedText=await this.restoreTextByHash(generatedHash);
                const copiedText=await this.restoreTextByHash(metaData.originalHash);
                const restoredBlocks: RestoredCodeBlock[]=await Promise.all(
                    (codeBlockHashes ?? []).map(async (b)=>{
                        const code=await this.restoreTextByHash(b.codeHash);
                        return{
                            index: b.index,
                            code,
                            language: b.language,
                            parentId: b.parentId,
                            turnParentId: b.turnParentId,
                        };
                    })
                );
                
                console.log(restoredBlocks);

                await showFullMdAndHighlightMd(
                    metaHash,
                    copiedText,
                    promptText,
                    generatedText,
                    restoredBlocks,
                    this.context
                );
                return true;
            }
            default:
                throw new Error(`Unsupported meta type:" ${metaData.type}`);
            }  
        }catch(e:any){
            window.showErrorMessage(`failed to open meta: ${e?.message ?? e}`);
            return false;
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

    // metadataのWEB_INFO_SORUCEを見る
    async getMetadataType(metaHash: string):Promise<WEB_INFO_SOURCE>{
      try{
        const metaJSON=await this.restoreTextByHash(metaHash);

        window.showInformationMessage(metaJSON);
        const metaData=JSON.parse(metaJSON) as Metadata;
        return metaData.type;
      }catch{
        console.log("failed to get type from Metadata");
        return WEB_INFO_SOURCE.OTHER;
      }
    }

    async  VSCodeShowPromptCards(metaHash:string):Promise<boolean>{
      try{
        const metaJSON=await this.restoreTextByHash(metaHash);
        const metaData=JSON.parse(metaJSON) as Metadata;
        if(metaData.type!==WEB_INFO_SOURCE.CHAT_GPT){
          return false;
        }

        await showPromptCards(this.context,metaHash);
        return true;
      }catch{
        console.log("failed to show prompt");
        return false;
      }
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
