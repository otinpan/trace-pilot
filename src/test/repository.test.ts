import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { TraceEngine } from "../engine/engine"; 
import * as repository from "../repository/repository";
import {Metadata, WEB_INFO_SOURCE} from '../constants/types';
import {execGit} from "../common";
import { 
calculateHashAndStore,
calculateHashAndStoreFromBuffer,
stageBlobObject,
createBlobObject,
commitBlobObject,
pushBlobObject,
} from "../engine/hash-and-store";


async function isPathStaged(cwd: string, targetPath: string, expectedHash: string): Promise<boolean> {
  const { stdout } = await execGit(["ls-files", "--stage", "--", targetPath], cwd);
  // 出力例: "100644 <hash> 0    blobs/<hash>.bin"
  if (!stdout) return false;
  return stdout.includes(expectedHash) && stdout.includes(targetPath);
}

async function catFileJSON<T>(hash: string,repoPath:string):Promise<T>{
  const {stdout}=await execGit(["cat-file","-p",hash],repoPath);
  return JSON.parse(stdout.trim()) as T;
}

async function catFileBlob(hash: string,repoPath:string):Promise<string>{
  const {stdout}=await execGit(["cat-file","-p",hash],repoPath);
  return stdout;
}

async function ensureTraceStoreWorktree(repoPath: string): Promise<string> {
  const worktreeRoot = path.join(repoPath, ".trace-worktree");

  if (!fs.existsSync(worktreeRoot)) {
    try {
      await execGit(["worktree", "add", worktreeRoot, "trace-store"], repoPath);
    } catch {
      await execGit(["worktree", "add", "--orphan", "-b", "trace-store", worktreeRoot], repoPath);
    }
  }

  try {
    await execGit(["reset", "--hard"], worktreeRoot);
  } catch {
    // orphan branch may be unborn on first creation
  }

  await execGit(["clean", "-fd"], worktreeRoot);
  await execGit(["config", "user.name", "trace-test"], worktreeRoot);
  await execGit(["config", "user.email", "trace-test@example.com"], worktreeRoot);

  return worktreeRoot;
}

// .gitが存在するフォルダにたどり着いているか
suite("Get Git repository path", () => {
  test("getRepositoryPath from ~/thesis/trace-pilot/src/engine", async () => {
    const home = os.homedir();

    const gitRoot = path.join(home, "thesis", "trace-pilot");
    const cwdPath = path.join(home, "thesis", "trace-pilot", "src", "engine");

    // フォルダが無い環境でもテストが爆発しないように（
    assert.ok(fs.existsSync(cwdPath), `Test folder does not exist: ${cwdPath}`);

    const detectedRoot = await repository.getRepositoryPath(cwdPath);

    console.log(detectedRoot);
    console.log(gitRoot);

    assert.strictEqual(
      path.resolve(detectedRoot),
      path.resolve(gitRoot),
    );
  });

  test("getRepositoryPath from ~/thesis/private_for_thesis/Papers/Assets", async () => {
    const home = os.homedir();

    const gitRoot = path.join(home, "thesis", "private_for_thesis");
    const cwdPath = path.join(home, "thesis", "private_for_thesis","Papers","Assets");

    // フォルダが無い環境でもテストが爆発しないように（
    assert.ok(fs.existsSync(cwdPath), `Test folder does not exist: ${cwdPath}`);

    const detectedRoot = await repository.getRepositoryPath(cwdPath);

    console.log(detectedRoot);
    console.log(gitRoot);

    assert.strictEqual(
      path.resolve(detectedRoot),
      path.resolve(gitRoot),
    );
  });
});



// blobオブジェクトが作成され、ステージングされている

suite("Is Blob object staged", () => {
  let repoPath: string;
  let worktreeRoot: string;
  const engine = new TraceEngine(null as any);
  let hash: string;

  suiteSetup(async () => {
    // repoPath を決める（あなたの test でやってるのと同じ）
    const home = os.homedir();
    const cwdPath = path.join(home, "thesis", "trace-pilot", "src", "engine");
    repoPath = await repository.getRepositoryPath(cwdPath);

    worktreeRoot = await ensureTraceStoreWorktree(repoPath);
  });

  // ステージングされたかどうか
  test("hash-object creates blob and update-index stages it (without creating real file)", async () => {

    const worktreeRoot=path.join(repoPath,'.trace-worktree');
    const text = "hello trace-pilot\nline2\n";
    hash = await createBlobObject(worktreeRoot, text);

    assert.ok(/^[0-9a-f]{40}$/.test(hash), `hash looks invalid: ${hash}`);

    const targetPath = `blobs/${hash}.bin`;
    await stageBlobObject(worktreeRoot, hash,text);

    const staged = await isPathStaged(worktreeRoot, targetPath, hash);
    assert.ok(staged, `expected ${targetPath} to be staged with hash ${hash}`);
  });

  // コミットされたか
  test("commit contains the staged blobs/<hash>.bin entry", async () => {
    const text = `commit-test-${Date.now()}`;
    const hash2 = await createBlobObject(worktreeRoot, text);
    const targetPath = `blobs/${hash2}.bin`;

    await stageBlobObject(worktreeRoot, hash2,text);

    // stagedがあることを念押しチェック（これがあると原因切り分けも楽）
    const cached = await execGit(["diff", "--cached", "--name-status"], worktreeRoot);
    assert.ok(cached.stdout.includes(targetPath), `not staged:\n${cached.stdout}`);

    await commitBlobObject(worktreeRoot);

    const { stdout } = await execGit(["ls-tree", "-r", "HEAD", "--", targetPath], worktreeRoot);
    assert.ok(stdout.includes(hash2), `expected HEAD tree to include ${hash2}, got: ${stdout}`);
  });

});


// メタデータの保存
suite("Is metadata stored correctly",function (){
  this.timeout(20000);
  const engine = new TraceEngine(null as any);
  let worktreeRoot:string;
  let repoPath:string;
  let restoredMeta:any;
  let text:string;
  suiteSetup(async () => {
    // repoPath を決める（あなたの test でやってるのと同じ）
    const home = os.homedir();
    const cwdPath = path.join(home, "thesis", "trace-pilot", "src", "engine");
    repoPath = await repository.getRepositoryPath(cwdPath);

    worktreeRoot = await ensureTraceStoreWorktree(repoPath);

    console.error("worktreeRoot top:", (await execGit(["rev-parse", "--show-toplevel"], worktreeRoot)).stdout.trim());
  });
  test("Is metadata stored",async()=>{
    text=`test - -${Date.now()}`;

    const originalHash=await calculateHashAndStore(text);

    const meta: Metadata={
               originalHash: originalHash,
               additionalHash:{
                   fullTextHash:"fulltexthash",
               },
               url: "vscode/test",
               type: WEB_INFO_SOURCE.VSCODE,
               timeCopied: new Date().toISOString(),
               timeCopiedNumber: Date.now(),
               additionalMetaData: {
                   isText:true,
               },
           };
    const metaJSON=JSON.stringify(meta);
    const metaHash=await calculateHashAndStore(metaJSON);

    restoredMeta=await catFileJSON(metaHash,worktreeRoot);

    console.error("### TRACE-PILOT TEST LOG ###", restoredMeta);
    process.stderr.write("### STDERR MARK ###\n");

    assert.deepStrictEqual(restoredMeta,meta);

  });

  test("output original text",async()=>{
    if(restoredMeta===null){
      console.error("### restoredMeta is null");
      return;
    }

    const originalHash=restoredMeta.hash;

    const restoredText=await catFileBlob(originalHash,worktreeRoot);

    console.error("### TRACE-PILOT TEST LOG ###",restoredText);
    process.stderr.write("### STDERR MARK ###\n");

    assert.deepStrictEqual(restoredText,text);
  });
});
