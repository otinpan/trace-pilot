import * as fs from "fs";
import * as path from "path";
import {getRepositoryPath,getRepositoryPathOrNull} from '../repository/repository';
import { spawn } from 'child_process';
import { ensureWorktree } from '../repository/worktree';
import * as cp from 'child_process';
import {execGit} from '../common'

// textの保存
export async function calculateHashAndStore(_copied_text: string): Promise<string>{
        const repoPath=await getRepositoryPathOrNull();
        if(!repoPath){
            throw new Error("Not a git repository. Open a folder that has .git (or init first).");
        }
        

        // worktreeの作成
        await ensureWorktree(repoPath);

        // ブランチの移動
        const worktreePath=path.join(repoPath,'.trace-worktree');

        // コマンドの実行
        // blobオブジェクトの作成
        let hash=await createBlobObject(worktreePath,_copied_text);
        // stage
        await stageBlobObject(worktreePath,hash,_copied_text);
        // commit
        await commitBlobObject(worktreePath);
        // push
        //await this.pushBlobObject(worktreePath);

        return hash;
    }

    // pdfの保存
export async function calculateHashAndStoreFromBuffer(data: Buffer):Promise<string>{
    const repoPath=await getRepositoryPathOrNull();
    if(!repoPath){
        throw new Error("Not a git repository. Open a folder that has .git (or init first).");
    }
    
    // worktreeの作成
    await ensureWorktree(repoPath);
    // ブランチの移動
    const worktreePath=path.join(repoPath,'.trace-worktree');
    // コマンドの実行
    // blobオブジェクトの作成
    let hash=await createBlobObjectFromBuffer(worktreePath,data);
    // stage
    await stageBlobObjectFromBuffer(worktreePath,hash,data);
    // commit
    await commitBlobObject(worktreePath);
    // push
    //await this.pushBlobObject(worktreePath);
    return hash;
}
    
export async function createBlobObjectFromBuffer(worktreePath: string,data: Buffer):Promise<string>{
    return new Promise((resolve,reject)=>{
        const git=cp.spawn("git",["hash-object","--stdin"],{cwd:worktreePath});
        let stdout="";
        let stderr="";
        git.stdout?.on("data",(d)=>(stdout+=d.toString("utf8")));
        git.stderr?.on("data",(d)=>(stderr+=d.toString("utf8")));
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
        // バイナリの書き込み
        git.stdin.write(data);
        git.stdin.end();
    });
}

export async function createBlobObject(worktreePath:string,text:string):Promise<string>{
    return new Promise((resolve,reject)=>{
        const git=cp.spawn("git",["hash-object","--stdin"],{cwd:worktreePath});
        let stdout="";
        let stderr="";
        git.stdout?.on("data",(d)=>(stdout+=d.toString("utf8")));
        git.stderr?.on("data",(d)=>(stderr+=d.toString("utf8")));
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
        git.stdin.write(text,'utf8');
        git.stdin.end();
    });
}

export async function stageBlobObject(worktreePath:string,hash:string,text:string){
    const dir=path.join(worktreePath,"blobs");
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,`${hash}.bin`),text,"utf8");
    await execGit(["add","-f",`blobs/${hash}.bin`],worktreePath);
}

export async function stageBlobObjectFromBuffer(worktreePath:string,hash:string,data:Buffer){
    const dir=path.join(worktreePath,"blobs");
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,`${hash}.bin`),data);
    await execGit(["add","-f",`blobs/${hash}.bin`],worktreePath);
}

export async function commitBlobObject(worktreePath:string){
    return new Promise((resolve,reject)=>{
    const git=cp.spawn(
            "git",
            ["commit","-m","store copied content"],
            {cwd:worktreePath}
        );
        let stdout="";
        let stderr="";
        git.stdout?.on("data",(d)=>(stdout+=d.toString("utf8")));
        git.stderr?.on("data", (d) => (stderr += d.toString("utf8")));
        git.on("error",reject);
        git.on("close", (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(`git commit exited with code ${code}: ${stderr || stdout}`));
        });
    });
}

export async function pushBlobObject(worktreePath:string){
    return new Promise((resolve,reject)=>{
        const git=cp.spawn(
            "git",
            ["push","origin","trace-store"],
            {cwd:worktreePath}
        );
        let stdout="";
        let stderr="";
        git.stdout?.on("data",(d)=>(stdout+=d.toString("utf8")));
        git.stderr?.on("data", (d) => (stderr += d.toString("utf8")));
        git.on("error",reject);
        git.on("close", (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(`git push exited with code ${code}: ${stderr || stdout}`));
        });
    });
}
