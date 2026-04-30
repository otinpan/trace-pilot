import * as fs from 'fs';
import * as cp from 'child_process';
import path from 'path';
import { error } from 'console';
import { createCipheriv } from 'crypto';
import { execAsync } from '../common';

// フォルダ内のworktreeを列挙する
function findRepoRootFromWorktreeListProcelain(porcelain:string):string|null{
    const lines = porcelain.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        return line.slice('worktree '.length).trim();
      }
    }
    return null;
}

// worktreeの作成
export async function ensureWorktree(cwd:string):Promise<boolean>{
    const worktreeDir=path.join(cwd,'.trace-worktree');

    let repoRoot=cwd;
    try{
        const { stdout } = await execAsync('git worktree list --porcelain', cwd);
        repoRoot=findRepoRootFromWorktreeListProcelain(stdout)?? cwd;
    }catch{
        throw new Error('Not a git repository or git is unavailable');
    }

    // worktreeが存在するか
    if(fs.existsSync(worktreeDir)){
        // worktreeがすでに登録されているか
        ensureGitignore(repoRoot);
        return true;
    }

    const traceStoreExists = cp
        .spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/trace-store'], { cwd })
        .status === 0;

    // ブランチがあれば既存ブランチを使い、なければ orphan worktree を作る
    try{
        if(traceStoreExists){
            await execAsync('git worktree add .trace-worktree trace-store',cwd);
        }else{
            await execAsync('git worktree add --orphan -b trace-store .trace-worktree',cwd);
        }
    }catch(e){
        const msg=(e as Error).message;

        if(!fs.existsSync(worktreeDir)){
            const mode = traceStoreExists ? 'existing branch' : 'create orphan branch';
            throw new Error(`Failed to ensure worktree (${mode}): ${msg}`);
        }
    }

    ensureGitignore(repoRoot);
    return true;
}

// .gitignoreに.trace-workspaceを追記
function ensureGitignore(repoRoot:string){
    const gitignorePath=path.join(repoRoot,'.gitignore');
    const entry='.trace-worktree/';

    let content = '';
    if(fs.existsSync(gitignorePath)){
        content=fs.readFileSync(gitignorePath,'utf8');

        const lines = content.split(/\r?\n/).map((s) => s.trim());
        if(lines.includes(entry)||lines.includes('.trace-worktree'))return;

        if(content.length>0 && !content.endsWith('\n'))content+='\n';
    }

    content+=`${entry}\n`;
    fs.writeFileSync(gitignorePath,content,'utf8');
}
