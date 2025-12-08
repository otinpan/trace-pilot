import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { window } from 'vscode';
import {TraceMetaEntry} from './common';

// index.jsonのパスを取得
function getIndexPath():string{
    const home=os.homedir();
    return path.join(home,'.trace-pilot','index.json');
}

// index.jsonファイルの存在確認・作成
function ensureIndexFile(_filePath:string):void{
    if(!fs.existsSync(_filePath)){
        fs.writeFileSync(_filePath,"{}",'utf8');
    }
}

// index.jsonの読み込み
function loadIndex():TraceMetaEntry[]{
    // パスの取得
    const indexPath=getIndexPath();
    ensureIndexFile(indexPath);

    try{
        const raw=fs.readFileSync(indexPath,'utf8'); //文字列として読み込む
        const data=JSON.parse(raw); //parseしてオブジェクトに変換
        if(Array.isArray(data)){
            return data;
        }
    }catch(e){
        window.showErrorMessage('Failed to load index.json');
        console.error("Failed to load index.json",e);
    }

    return [];
}

// index.jsonへ保存
function saveIndex(_eintries:TraceMetaEntry[]):void{
    const indexPath=getIndexPath();
    const dir=path.dirname(indexPath);

    if(!fs.existsSync(dir)){
        fs.mkdirSync(dir,{recursive:true});
    }
    // ファイルに書き込み (オブジェクト、プロパティ、インデント)
    fs.writeFileSync(indexPath,JSON.stringify(_eintries,null,2),'utf8'); 

}

export async function addTraceMetadata(_entry:TraceMetaEntry):Promise<void>{
    const entries=loadIndex();
    entries.push(_entry);
    saveIndex(entries);
}
