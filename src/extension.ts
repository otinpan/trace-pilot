import {
	commands,
	env,
	ExtensionContext,
	StatusBarAlignment,
	StatusBarItem,
	TextEditor,
	window,
	languages,
	CodeLens,
	CodeLensProvider,
	Range,
	TextDocument,
	TextEditorCursorStyle,
} from 'vscode';


import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {logStore} from './logger';
import {Container} from './container';
import {getRepositoryPath, getRepositoryPathOrNull} from './repository/repository';
import * as index_repository from './repository/index-repository';
import { markAsUntransferable } from 'worker_threads';
import {MetaData,CopiedContent,TraceMetaEntry} from './common';

const simbolTracePilot:string='@trace-pilot';


export async function activate(context: ExtensionContext) {

	const container=await Container.create
	// コピーアイテムのクリック時に呼ばれる関数の定義
	const copyCommandID:string='trace-pilot.store-in-repository';
	context.subscriptions.push(commands.registerCommand(copyCommandID,async()=>{
		// ハッシュ値の計算＋貼り付け＋リポジトリ保存
		let ok:boolean=await mainCopy();

		// メッセージの表示
		if(ok){
			window.showInformationMessage("success: store copied text in repository!");
		}
	}));

	// ペーストアイテムのクリック時に呼ばれる関数
	const pasteCommandID:string="trace-pilot.paste";
	context.subscriptions.push(commands.registerCommand(pasteCommandID,async ()=>{
		let ok:boolean=await mainPaste();
		// メッセージの表示
		if(ok){
			window.showInformationMessage("success: paste content!");
		}
	}));

	
}


// コピートリガーがonになったら呼ばれる
async function mainCopy(): Promise<boolean>{
	const editor=window.activeTextEditor;
	if(!editor){
		window.showInformationMessage("error: window is invalid");
		return false;
	}
	// 選択した範囲のtext
	const copiedText:string=editor.document.getText(editor.selection);

	if(!copiedText){
		window.showInformationMessage("error: select no contennts");
		return false;
	}

	const content=new CopiedContent(copiedText);

	try{
		// git保存＋ハッシュ値計算
		const hash=await calculateHashAndStore(content);

		// log
		logStore({
			hash,
			content: copiedText,
			filePath: editor.document.uri.fsPath,
		});

		// クリップボードに書き込むメタデータ
		const metaData=new MetaData(content,editor.document.uri.fsPath,new Date().toISOString());

		// エスケープ
		const tracer = `${copiedText} // ${simbolTracePilot} ${JSON.stringify(metaData)}`;
		await env.clipboard.writeText(tracer);


		return true;
	}catch(err: any){
		window.showErrorMessage(`error: failed to store in repository: ${err?.message ?? err}`);
		return false;
	}
}


async function calculateHashAndStore(_content: CopiedContent):Promise<string>{
	const repoPath=await getRepositoryPathOrNull();
	if(!repoPath){
		throw new Error("Not a git repository. Open a folder that has .git (or init first).");
	}

	return new Promise<string> ((resolve,reject)=>{
		// シェルを叩く (出力をストリームとして少しずつ扱う)
		// printf '%s' "$CONTENT" | git hash-object -w --stdin でハッシュ値を生成
		// blobオブジェクト (バイト列) として保存
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
		git.stdin.write(_content.copied_text,'utf8');
		git.stdin.end();
	});
}




// ペーストトリガーがonになったら呼ばれる
async function mainPaste(): Promise<boolean>{
	const editor=window.activeTextEditor;
	if(!editor){
		window.showInformationMessage("error: window is invalid");
		return false;
	}

	// クリップボードの内容を取得
	const raw=await env.clipboard.readText();

	if(!raw){
		window.showInformationMessage("clipboard is empty!");
		return false;
	}

	// 行からsimbolTracePilotを探す
	const marker= '// ' + simbolTracePilot;
	const idx=raw.indexOf(marker);

	let pasteText:string=raw;
	let meta:any=undefined;
	if(idx!==-1){
		// 元のコピーしたテキスト部分とメタデータの分離
		pasteText=raw.slice(0,idx);
		const jsonPart=raw.slice(idx+marker.length);

		try{
			meta=JSON.parse(jsonPart);
		}catch(err){
			window.showInformationMessage("error: failed to parse trace-pilot metadata");
			console.error("Failed to parse trace-pilot metadata:", err);
			return false;
		}

		const selection=editor.selection;
		const start=selection.start; // ペースト前のカーソルの位置

		// 選択している範囲を置換 (ペースト)
		await editor.edit(editBuilder=>{
			editBuilder.replace(selection,pasteText);
		});

		const end=editor.selection.active; //replace後のカーソル位置

		console.log("MetaData:",meta);
		if(meta!==undefined){
			const entry: TraceMetaEntry={
				start,
				end,
				meta: meta,
			};
			// index.jsonにメタデータの保存
			index_repository.addTraceMetadata(entry);
		}

	}

	return true;
}

function storeInRepository():void{
	return;
}

export function deactivate() {}


//めも
/** blobからpdfへの復元
git cat-file -p <hash値> > output.pdf
* 中身の確認
cd ~/.trace-pilot
git cat-file -p <ハッシュ値>
* tracerの部分の非表示化
printf("%d", 0); // trace-pilot {hash: x0123, content: "printf.."}
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                 ここだけ click to collapse で消したい
これは無理

Copyボタン（trace-pilot.store-in-repository）
・選択範囲を取得
・ハッシュ計算（git blobなど）
・メタデータ生成（元ファイルパス・時刻・hash等）
・クリップボードに「本文＋メタデータ」を書き込む（今の方式）
・ついでに index.json（またはストア）に「コピーイベント」も保存しておくと後で検索しやすい

Pasteボタン（trace-pilot.paste）
・クリップボードを読む
・// @trace-pilot {...} をパース
・本文を貼り付け
・「貼り付け位置（Range）＋hash/metadata」を index.json に保存
・必要なら CodeLens/Decoration を貼って “リンク” を見える化

				 */