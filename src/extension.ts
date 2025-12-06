import{
	commands,
	env,
	ExtensionContext,
	StatusBarAlignment,
	StatusBarItem,
	TextEditor,
	window
}from 'vscode';

// ペーストされたときにポップアップ表示
let myStatusBarItem: StatusBarItem; 

export function activate(context: ExtensionContext) {
	// ペーストアイテムのクリック時に呼ばれる関数の定義
	const pasteCommandID:string='trace-pilot.store-in-repository';
	context.subscriptions.push(commands.registerCommand(pasteCommandID,()=>{
		// ハッシュ値の計算＋貼り付け＋リポジトリ保存

		// メッセージの表示
		window.showInformationMessage("Store copied text in repository")
	}));

	
}


function calculateHash():number{
	return 0;
}

function storeInRepository():void{
	return;
}



// This method is called when your extension is deactivated
export function deactivate() {}
