import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {createTwoFilesPatch} from "diff";
import { log } from "console";
import { NumberLiteralType } from "typescript";

type UriKey=string;

interface Snapshot{
  text:string;
  version: number;
  ts: number; 
};

interface ChangeRecord{
  range: {
    start:{line: number; character: number};
    end:{line: number; character:number};
  }; // どこが変更されたか
  rangeOffset: number; // 何文字目か
  rangeLength: number; // 何文字が変更されたか
  text: string; // 挿入テキスト
};

interface EditBurstRecord{
  type: "edit_burst";
  uri: string;
  languageId: string;
  ts_start: number; //startのtimestamp
  ts_end: number; // endのtimestamp
  before_version: number; // 変更ごとにversionが更新される
  after_version: number;
  stats:{
    changeCount: number; // このburstで何文字変化したか
    insertedChars: number;
    deletedChars: number;
    insertedLinesApprox: number; // このburstで何行くらい増えたか
    deletedLinesApprox: number;
  };
  changes: ChangeRecord[];
  diff_unified: string;
}
// burstごとに空になる
interface PendingBatch{
  changes: ChangeRecord[];
  ts_start: number;
  ts_last: number;
  timer?: NodeJS.Timeout;
};


const BURST_IDLE_MS=2000;
const MAX_DIFF_CHARS=200_000;

export class DiffTracer{
  private snapshots=new Map<UriKey,Snapshot>(); // 現在のファイルを保存
  private pending=new Map<UriKey,PendingBatch>(); // flushまでの変更を保存 -> flust -> del

  constructor(private readonly ctx: vscode.ExtensionContext){

  }

  private shouldTrackDocument(doc: vscode.TextDocument): boolean{
    if(doc.isUntitled)return false;
    if(doc.uri.scheme!=="file")return false;

    // Avoid tracing tracer output itself to prevent recursive flush loops.
    const normalized=doc.uri.fsPath.replace(/\\/g,"/");
    if(normalized.includes("/.intent-tracer/"))return false;
    return true;
  }

  ensureSnapshot(doc: vscode.TextDocument){
    if(!this.shouldTrackDocument(doc))return;

    const key=doc.uri.toString();
    if(!this.snapshots.has(key)){
      this.snapshots.set(
        key,
        {
          text: doc.getText(),
          version: doc.version,
          ts: Date.now(),
        }
      );
    }
  }

  onClose(doc: vscode.TextDocument){
    if(!this.shouldTrackDocument(doc))return;

    const key=doc.uri.toString();
    
    const batch=this.pending.get(key);
    if(batch&&batch.changes.length>0){
      void this.flush(doc,"close").finally(()=>{
        this.snapshots.delete(key);
      });
      return;
    }

    this.pending.delete(key);
    this.snapshots.delete(key);
  }
  // 変更されたときに呼ばれる
  onChange(e: vscode.TextDocumentChangeEvent){
    const doc=e.document;
    if(!this.shouldTrackDocument(doc))return;

    this.ensureSnapshot(doc);

    const key=doc.uri.toString();

    const changeRecords: ChangeRecord[]=e.contentChanges.map((c)=>({
      range:{
        start: {line: c.range.start.line, character: c.range.start.character},
        end: {line: c.range.end.line, character: c.range.end.character},
      },
      rangeOffset: c.rangeOffset,
      rangeLength: c.rangeLength,
      text: c.text,
    }));

    const now=Date.now();
    let batch=this.pending.get(key);
    if(!batch){
      batch={changes: [], ts_start: now, ts_last: now};
      this.pending.set(key,batch);
    }
    batch.changes.push(...changeRecords);
    batch.ts_last=now;

    if(batch.timer)clearTimeout(batch.timer); // idleタイマーをキャンセル
    batch.timer=setTimeout(()=>{
      const liveDoc=vscode.workspace.textDocuments.find((d)=>d.uri.toString()===key);
      if(liveDoc)void this.flush(liveDoc,"idle");
    },BURST_IDLE_MS);
  }

  async flushAll(reason: "manual" | "shutdown", notify=true){
    for(const doc of vscode.workspace.textDocuments){
      const key=doc.uri.toString();
      const batch=this.pending.get(key);
      if(batch && batch.changes.length>0){
        await this.flush(doc,reason);
      }
    }

    if(notify){
      vscode.window.showInformationMessage(`Trace Pilot: flushed all (${reason})`);
    }
  }

  async shutdownAndClear(): Promise<void>{
    await this.flushAll("shutdown",false);
    await this.removeTracerDir();
  }

  private async flush(doc: vscode.TextDocument, reason: "idle"|"close"|"manual"|"shutdown"){
    const key=doc.uri.toString();
    const batch=this.pending.get(key);
    if(!batch||batch.changes.length===0)return;

    if(batch.timer)clearTimeout(batch.timer);
    
    const snap=this.snapshots.get(key);
    if(!snap)return;

    const before=snap.text;
    const after=doc.getText();

    if(before===after){
      this.pending.delete(key);
      return;
    }

    const diff=createTwoFilesPatch(
      path.basename(doc.fileName) + " (before)",
      path.basename(doc.fileName) + " (after)",
      before,
      after,
      "snapshot",
      reason
    );

    const stats=estimateStats(batch.changes);

    const record:EditBurstRecord={
      type: "edit_burst",
      uri: doc.uri.fsPath,
      languageId: doc.languageId,
      ts_start: batch.ts_start,
      ts_end: batch.ts_last,
      before_version: snap.version,
      after_version: doc.version,
      stats,
      changes: batch.changes,
      diff_unified: diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + "\n...TRUNCATED... \n" : diff,
    };

    await this.appendJsonl(record);

    this.snapshots.set(key,{text:after,version: doc.version, ts: Date.now()});
    this.pending.delete(key);
  }


  private async appendJsonl(obj: unknown){
    const file=this.getEventsFilePath();
    if(!file)return;

    await fs.promises.mkdir(path.dirname(file),{recursive:true});
    const line=JSON.stringify(obj)+"\n";
    await fs.promises.appendFile(file,line,{encoding: "utf8"});
  }

  private getEventsFilePath(): string | null{
    const ws=vscode.workspace.workspaceFolders?.[0];
    if(!ws)return null;
    return path.join(ws.uri.fsPath,".intent-tracer","events.jsonl");
  }

  private async removeTracerDir(): Promise<void>{
    const file=this.getEventsFilePath();
    if(!file)return;
    const dir=path.dirname(file);
    await fs.promises.rm(dir,{recursive:true,force:true});
  }

}


function estimateStats(changes: ChangeRecord[]){
  let insertedChars=0;
  let deletedChars=0;
  let insertedLinesApprox=0;
  let deletedLinesApprox=0;

  for(const c of changes){
    insertedChars+=c.text.length;
    deletedChars+=c.rangeLength;

    insertedLinesApprox+=countNewlines(c.text);
    const deletedLineDelta=Math.max(0,c.range.end.line-c.range.start.line);
    deletedLinesApprox+=deletedLineDelta;
  }

  return {
    changeCount: changes.length,
    insertedChars,
    deletedChars,
    insertedLinesApprox,
    deletedLinesApprox,
  };
}

function countNewlines(s: string){
  let n=0;
  for(let i=0;i<s.length;i++){
    if(s.charCodeAt(i)===10)n++;
  }
  return n;
}
