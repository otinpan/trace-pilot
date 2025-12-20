import * as crypto from "crypto";
import * as fs from 'fs';
import * as cp from 'child_process';
import path from 'path';
import { error } from 'console';

export class CopiedContent{
	copied_text:string;
	hash?:string;

	constructor(_copied_text: string){
		this.copied_text=_copied_text;
	}
}

export class MetaData{
	content: CopiedContent;
	filePath: string;
    date: string;

	constructor(_content: CopiedContent,_filePath:string,_date:string){
		this.content=_content;
		this.filePath=_filePath;
        this.date=_date;
	}
}

export type TraceMetaEntry={
    start:{line:number,character:number}; //選択範囲の開始位置 (行、列)
    end:{line:number,character:number};
    meta: MetaData
}





export function execAsync(cmd: string,cwd:string): Promise<{stdout: string,stderr: string}>{
	return new Promise((resolve,reject)=>{
		cp.exec(cmd, { cwd }, (err, stdout, stderr) => {
			if(err){
				reject(new Error((stderr || stdout || err.message).toString()));
				return;
			}
			resolve({ stdout: stdout.toString(), stderr: (stderr ?? '').toString() });
		});
	});
}

export function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = cp.spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";

    p.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    p.stderr.on("data", (d) => (stderr += d.toString("utf8")));

    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
    });
  });
}