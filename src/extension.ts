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

	const container=await Container.create(context);


	// ペーストアイテムのクリック時に呼ばれる関数
	/*const pasteCommandID:string="trace-pilot.paste";
	context.subscriptions.push(commands.registerCommand(pasteCommandID,async ()=>{
		let ok:boolean=await mainPaste();
		// メッセージの表示
		if(ok){
			window.showInformationMessage("success: paste content!");
		}
	}));*/

	
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