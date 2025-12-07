import{
	commands,
	env,
	ExtensionContext,
	StatusBarAlignment,
	StatusBarItem,
	TextEditor,
	window,
}from 'vscode';


import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {logStore} from './logger';
class CopiedContent{
	copied_text:string;

	constructor(_copied_text: string){
		this.copied_text=_copied_text;
	}
}


export function activate(context: ExtensionContext) {

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
		const meta={
			hash,
			content: copiedText,
			filePath: editor.document.uri.fsPath,
		};
		// エスケープ
		const tracer = `${copiedText} // @trace-pilot${JSON.stringify(meta)}`;
		await env.clipboard.writeText(tracer);


		return true;
	}catch(err: any){
		window.showErrorMessage(`error: failed to store in repository: ${err?.message ?? err}`);
		return false;
	}
}


async function calculateHashAndStore(_content: CopiedContent):Promise<string>{
	const repoPath=getRepositoryPath();
	ensureGitRepo(repoPath);

	return new Promise<string> ((resolve,reject)=>{
		// シェルを叩く (出力をストリームとして少しずつ扱う)
		// printf '%s' "$CONTENT" | git hash-object -w --stdin でハッシュ値を生成
		// blobオブジェクトとして保存
		const git=cp.spawn('git',['hash-object','-w','--stdin'],{
			cwd:repoPath
		});

		let stdout='';
		let stderr='';

		// 標準出力
		git.stdout.on('data',(data)=>{
			stdout+=data.toString();
		})

		// 標準エラー出力
		git.stderr.on('data',(data)=>{
			stderr+=data.toString();
		})

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
		})

		// text書き込み
		git.stdin.write(_content.copied_text,'utf8');
		git.stdin.end();
	});
}

function getRepositoryPath():string{
	const home=os.homedir();
	return path.join(home,'.trace-pilot');
}

// リポジトリの存在確認・作成
function ensureGitRepo(_repoPath:string):void{
	// ファイル・ディレクトリが存在するかチェック (同期的)
	if(!fs.existsSync(_repoPath)){
		// 作成
		fs.mkdirSync(_repoPath,{recursive:true});
	}
	// .gitが存在するかチェック
	if(!fs.existsSync(path.join(_repoPath,'.git'))){
		// リポジトリ作成
		cp.execFileSync('git',['init'],{cwd:_repoPath});
	}
}


// ペーストトリガーがonになったら呼ばれる
async function mainPaste(): Promise<boolean>{
	// クリップボードの内容を取得
	const copiedText=await env.clipboard.readText();

	if(!copiedText){
		window.showInformationMessage("clipboard is empty!");
		return false;
	}

	return true;
}

function storeInRepository():void{
	return;
}

export function deactivate() {}