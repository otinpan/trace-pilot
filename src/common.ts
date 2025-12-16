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

export function makeID(): string{
	return crypto.randomBytes(8).toString("hex");
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