import{
    ExtensionContext,
    Disposable,
    commands,
    TextEditor,
    TextEditorEdit,
    window,
} from 'vscode';
import {TraceEngine} from "./engine/engine";
import { Z_PARTIAL_FLUSH } from 'zlib';

export class Container{
    // プロジェクト内でインスタンスを1つに限定
    static #instance: Container;
    private readonly engine: TraceEngine;
    private readonly disposables: Disposable[]=[];
    // disposable
    private copyDisposable: Disposable | undefined;
    private pasteDisposable: Disposable | undefined;
    

    public constructor(
        readonly context: ExtensionContext,
    ){
        this.engine=new TraceEngine(context);

        // トリガー登録
        // 変数に保持してon/offを切り変え可能
        this.enableCopyCommand();
        this.enablePasteCommand();
    }

    // 非同期的な初期化処理
    public static async create(context: ExtensionContext){
        const newContainer=new Container(context);

        return newContainer;
    }

    // gette
    public get getCopyDisposable():Disposable|undefined{
        return this.copyDisposable;
    }


    private enableCopyCommand(){
        // 再発防止
        if(this.copyDisposable)return;

        const copyCommandID="trace-pilot.store-in-repository";
        this.copyDisposable=commands.registerCommand(copyCommandID,async()=>{
            // ハッシュ値の計算＋貼り付け＋リポジトリ保存
            const ok:boolean=await this.engine.VSCodeCopy();
            if(ok){
                window.showInformationMessage("success: store copied text in repository!");
            }
        });

        this.context.subscriptions.push(this.copyDisposable);
        this.disposables.push(this.copyDisposable);
    }

    private enablePasteCommand(){
        // 再発防止
        if(this.pasteDisposable) return;

        const pasteCommandID="trace-pilot.paste";
        this.pasteDisposable=commands.registerCommand(pasteCommandID,async()=>{
            // parse
            let ok:boolean=await this.engine.VSCodePaste();

            if(ok){
                window.showInformationMessage("success: paste content!");
            }
        });

        this.context.subscriptions.push(this.pasteDisposable);
        this.disposables.push(this.pasteDisposable);
    }
}