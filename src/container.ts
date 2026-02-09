import{
  ExtensionContext,
  Disposable,
  commands,
  languages,
  window,
  Hover,
  CodeLens,
  CodeLensProvider,
  MarkdownString,
  TextDocument,
  Position,
  Command,
  CancellationToken,
  Range,
} from 'vscode';

import {TraceEngine} from "./engine/engine";
import { Z_PARTIAL_FLUSH } from 'zlib';
import { WEB_INFO_SOURCE } from './constants/types';

export class Container{
    // プロジェクト内でインスタンスを1つに限定
    static #instance: Container;
    private readonly engine: TraceEngine;
    private readonly disposables: Disposable[]=[];
    // disposable
    private copyDisposable: Disposable | undefined;
    private pasteDisposable: Disposable | undefined;
    private hoverDisposable: Disposable | undefined;
    private codelensDisposable: Disposable | undefined;
    private openMetaDisposable: Disposable | undefined;
    private openPromptCardsDisposable: Disposable | undefined;

    public constructor(
        readonly context: ExtensionContext,
    ){
        this.engine=new TraceEngine(context);

        // トリガー登録
        // 変数に保持してon/offを切り変え可能
        this.enableCopyCommand();
        this.enablePasteCommand();
        this.enableHoverProvider();
        this.enableCodeLensProvider();
        this.enableOpenMetaCommand();
        this.enableOpenPromptCardsCommand();
    }

    // 非同期的な初期化処理
    public static async create(context: ExtensionContext){
        if(!Container.#instance){
            Container.#instance=new Container(context);
        }

        return Container.#instance;
    }

    // getter
    public get getCopyDisposable():Disposable|undefined{
        return this.copyDisposable;
    }

    public get getPasteDisposable():Disposable|undefined{
        return this.pasteDisposable;
    }

    public get getHoverDisposable():Disposable|undefined{
        return this.hoverDisposable;
    }


    private enableCopyCommand(){
        // 再発防止
        if(this.copyDisposable)return;

        const copyCommandID="trace-pilot.store-in-repository";
        this.copyDisposable=commands.registerCommand(copyCommandID,async()=>{
            // ハッシュ値の計算＋貼り付け＋リポジトリ保存
            const ok:boolean=await this.engine.VSCodeCopy();
            if(ok){
                return;
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

    private enableHoverProvider(){
        if(this.hoverDisposable)return;

        // hovor登録
        this.hoverDisposable=languages.registerHoverProvider(
            {scheme: "file"},
            {
                provideHover: async(
                    document: TextDocument,
                    position: Position,
                    token: CancellationToken
                )=>{
                    // マウスがある行番号
                    const line=document.lineAt(position.line).text;
                    const m = line.match(/@trace-pilot\s+([0-9a-f]+)/);
                    if(!m)return;
                    const metaHash=m[1];

                    // ユーザーがマウスをすぐ動かしときはフックしない
                    if(token.isCancellationRequested)return;

                    const meta=await this.engine.getMetaData(metaHash);
                    if(token.isCancellationRequested)return;

                    // Hovorに表示する文章 (Markdown)
                    const md=new MarkdownString();
                    md.isTrusted=true;

                    const args=encodeURIComponent(JSON.stringify([metaHash]));
                    const cmdUri = `command:trace-pilot.openMeta?${args}`;

                    md.appendMarkdown(`**Trace-Pilot**\n\n`);
                    md.appendMarkdown(`- hash: \`${metaHash}\`\n`);
                    md.appendMarkdown(`\n[Show full text](${cmdUri})\n`);

                    return new Hover(md);
                }
            }
        );

        this.context.subscriptions.push(this.hoverDisposable);
        this.disposables.push(this.hoverDisposable);
    }

    private enableCodeLensProvider(){
        if(this.codelensDisposable)return;

        const selector={scheme:"file"};

        const provider: CodeLensProvider={
            provideCodeLenses: async(
                document: TextDocument,
                token: CancellationToken
            ):Promise<CodeLens[]>=>{
                const lenses: CodeLens[]=[];

                for(let i=0;i<document.lineCount;i++){
                    if(token.isCancellationRequested)return lenses;

                    const text=document.lineAt(i).text;
                    const m = text.match(/@trace-pilot\s+([0-9a-f]+)/);
                    if (!m) continue;

                    const metaHash=m[1];

                    // codelensを置く場所
                    const range=new Range(new Position(i,0),new Position(i,0));

                    // クリックできる
                    const cmdMeta: Command = {
                        title: `Trace-Pilot: ${metaHash.slice(0, 8)}…`, // CodeLens上に表示されるテキスト
                        command: "trace-pilot.openMeta", // 実行するコマンドID
                        arguments: [metaHash], // コマンドに渡す引数
                    };

                    const type:WEB_INFO_SOURCE=await this.engine.getMetadataType(metaHash);
                    if(type===WEB_INFO_SOURCE.CHAT_GPT){
                      const cmdPrompt:Command={
                        title: `Trace-Pilot: Open PromptCards`,
                        command: "trace-pilot.openPromptCards",
                        arguments: [metaHash],
                      };
                      lenses.push(new CodeLens(range,cmdPrompt));
                    }
                    lenses.push(new CodeLens(range,cmdMeta));
                }

                return lenses;
            },

            // 見た目の向上
            // vscodeが呼ぶ
            resolveCodeLens: async(
                lens: CodeLens,
                token: CancellationToken
            ):Promise<CodeLens>=>{
                if(token.isCancellationRequested)return lens;
            
                const metaHash=lens.command?.arguments?.[0] as string | undefined;
                if(!metaHash)return lens;
            
                const metaData=await this.engine.getMetaData(metaHash);
                if(token.isCancellationRequested) return lens;
            
                /*const summary =
                  metaData?.sourcePath
                    ? `${metaHash.slice(0, 8)}… ← ${metaData.sourcePath}`
                    : `${metaHash.slice(0, 8)}…`;*/
            
                lens.command = {
                  title: `Trace-Pilot: ${metaHash}`,
                  command: "trace-pilot.openMeta",
                  arguments: [metaHash],
                };

            
                return lens;
            }
        };   
        this.codelensDisposable=languages.registerCodeLensProvider(selector,provider);
            
        this.context.subscriptions.push(this.codelensDisposable);
        this.disposables.push(this.codelensDisposable as any); 
    }

    private enableOpenMetaCommand(){
        if(this.openMetaDisposable)return;

        const openMetaCommandID="trace-pilot.openMeta";
        this.openMetaDisposable=commands.registerCommand("trace-pilot.openMeta",async(metaHash: string)=>{
            let ok:boolean=await this.engine.VSCodeShowInformation(metaHash);

            if(!ok){
                window.showWarningMessage(`Trace-Pilot: meta not found for ${metaHash}`);
                return;
            }
        });

        this.context.subscriptions.push(this.openMetaDisposable);
        this.disposables.push(this.openMetaDisposable);
    }

    private enableOpenPromptCardsCommand(){
      if(this.openPromptCardsDisposable)return;

        const openPromptCardsCommandID="trace-pilot.openPromptCards";
        this.openPromptCardsDisposable=commands.registerCommand("trace-pilot.openPromptCards",
                                                               async(metaHash:string)=>{
        /*let ok:boolean=await this.engine.VSCodeShowPromptCards(metaHash);

        if(!ok){
          window.showWarningMessage(`Trace-Pilot: prompt card not found for ${metaHash}`);
          return;
        }
        */
      });
      this.context.subscriptions.push(this.openPromptCardsDisposable);
      this.disposables.push(this.openPromptCardsDisposable);

    }
}


