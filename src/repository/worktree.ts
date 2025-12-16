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


    // worktreeがある場合はcheckoutする
    try{
        await execAsync('git worktree add .trace-worktree trace-store',cwd);
    }catch(e1){
        const msg1=(e1 as Error).message;

        // ブランチがないなら作成してcheckoutする
        try{
            await execAsync('git worktree add -b trace-store .trace-worktree',cwd);
            return true;
        }catch(e2){
            const msg2=(e2 as Error).message;

            if(!fs.existsSync(worktreeDir)){
                throw new Error(
                    `Failed to ensure worktree.\n` +
                    `First attempt: ${msg1}\n` +
                    `Second attempt: ${msg2}`
                );
            }
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