import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';

export function getRepositoryPath():string{
    const home=os.homedir();
    return path.join(home,'.trace-pilot');
}

// リポジトリの存在確認・作成
export function ensureGitRepo(_repoPath:string):void{
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