import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {createTwoFilesPatch} from "diff";

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

interface FileCreatedRecord{
  type: "file_created";
  uri: string;
  ts: number;
}
// burstごとに空になる
interface PendingBatch{
  changes: ChangeRecord[];
  ts_start: number;
  ts_last: number;
  timer?: NodeJS.Timeout;
};

interface HunkTarget{
  line0: number;
}


const BURST_IDLE_MS=2000;
const MAX_DIFF_CHARS=200_000;
const CREATED_DEDUPE_WINDOW_MS=1000;


export class DiffTracer{
  private snapshots=new Map<UriKey,Snapshot>(); // 現在のファイルを保存
  private pending=new Map<UriKey,PendingBatch>(); // flushまでの変更を保存 -> flust -> del
  private suppress=new Set<UriKey>(); // stickLinkによる編集を無視する
  private lastRecords= new Map<UriKey,EditBurstRecord>();
  private recentCreatedAt=new Map<UriKey,number>();
  constructor(private readonly ctx: vscode.ExtensionContext){

  }

  private shouldTrackDocument(doc: vscode.TextDocument): boolean{
    if(doc.isUntitled)return false;
    return this.shouldTrackUri(doc.uri);
  }

  private shouldTrackUri(uri: vscode.Uri): boolean{
    if(uri.scheme!=="file")return false;
    // Avoid tracing tracer output itself to prevent recursive flush loops.
    const normalized=uri.fsPath.replace(/\\/g,"/");
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

  async onCreate(e: vscode.FileCreateEvent): Promise<void>{
    await this.recordCreatedUris(e.files);
  }

  async onFsCreate(uri: vscode.Uri): Promise<void>{
    await this.recordCreatedUris([uri]);
  }

  private async recordCreatedUris(uris: readonly vscode.Uri[]): Promise<void>{
    const now=Date.now();
    for(const uri of uris){
      if(!this.shouldTrackUri(uri))continue;
      const key=uri.toString();
      const lastTs=this.recentCreatedAt.get(key);
      if(lastTs&&now-lastTs<CREATED_DEDUPE_WINDOW_MS)continue;
      this.recentCreatedAt.set(key,now);
      const record: FileCreatedRecord={
        type: "file_created",
        uri: uri.fsPath,
        ts: now,
      };
      await this.appendJsonl(record);
    }
  }

  // 変更されたときに呼ばれる
  onChange(e: vscode.TextDocumentChangeEvent){
    const doc=e.document;
    if(!this.shouldTrackDocument(doc))return;

    const key=doc.uri.toString();
    // stickLinkのイベントで呼ばれないようにする
    if(this.suppress.has(key))return;

    this.ensureSnapshot(doc);

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
    
    this.lastRecords.set(key,record);

    this.snapshots.set(key,{text:after,version: doc.version, ts: Date.now()});
    this.pending.delete(key);

    vscode.window.showInformationMessage("Trace-Pilot: flush",doc.uri.fsPath);
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

  async stickAllLink():Promise<void>{
    if(this.lastRecords.size===0)return;
    for(const key of this.lastRecords.keys()){
      await this.stickLink(key);
    }
    return;
  }

  async stickLink(uriKey: string): Promise<void>{
    const record=this.lastRecords.get(uriKey);
    if(!record)return;

    const doc=vscode.workspace.textDocuments.find(
      d=>d.uri.toString()===uriKey
    );
    if(!doc)return;
    const key=uriKey;

    // TRUNCATED だとhunkが取れない
    if(record.diff_unified.includes("...TRUNCATED...")){
      vscode.window.showWarningMessage("diff_unified is truncated: some hunks may be missing");
    }

    const targets:HunkTarget[]=parseHunkTargetsFromUnifiedDiff(record.diff_unified);
    if(targets.length===0)return;

    targets.sort((a,b)=>b.line0-a.line0);
    try{
      this.suppress.add(key);

      const edit= new vscode.WorkspaceEdit();

      for(const t of targets){
        const line0=Math.max(0,Math.min(t.line0, doc.lineCount));

        const hash:string="x0123456789";
        const insertText=`// @trace-pilot ${hash}\n`;
        edit.insert(doc.uri,new vscode.Position(line0,0),insertText);
      }

      this.lastRecords.delete(key); // @trace-pilotが2重に書けないようにする
      await vscode.workspace.applyEdit(edit);
    }finally{
      setTimeout(()=>this.suppress.delete(key),0);
    }

  }

} // @trace-piが2重に書けないようにする

// diff_unifiedから変更された最上行を計算
function parseHunkTargetsFromUnifiedDiff(diff:string):HunkTarget[]{
  const lines=diff.split("\n");
  const targets: HunkTarget[]=[];

  let i=0;

  // 先頭で無視する行
  const isIgnorableChangedLine=(diffLine: string)=>{
    const body=diffLine.slice(1);
    const trimmed=body.trim();

    if(trimmed==="")return true;

    if(trimmed.startsWith("// @trace-pilot")) return true;

      return false;
  };

  while(i<lines.length){
    const header=lines[i];
    if(!header.startsWith("@@")){
      i++;
      continue;
    }

    const m = header.match(/@@\s*-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
    if(!m){
      i++;
      continue;
    }

    // 編集後の位置
    let afterLine0=parseInt(m[1],10)-1;

    // +/-の行にいるか
    let inChangeBlock=false;

    // 編集ブロックの中にいるか
    let emittedForThisBlock=false;

    i++;
    while(i<lines.length&&!lines[i].startsWith("@@")){
      const l=lines[i];

      // ファイルヘッダをskip
      if(l.startsWith("+++ ")||l.startsWith("--- ")){
        i++;
        continue;
      }

      const isPlus=l.startsWith("+");
      const isMinus=l.startsWith("-");
      const isContext=l.startsWith(" ");

      if(isPlus){
        if(!inChangeBlock){
          inChangeBlock=true;
          emittedForThisBlock=false;
        }

        if(!emittedForThisBlock&&!isIgnorableChangedLine(l)){
          targets.push({line0: afterLine0});
          emittedForThisBlock=true;
        }
      }
      
      if(isPlus){
        afterLine0++;
      }else if(isMinus){
        
      }else{
        inChangeBlock=false;
        emittedForThisBlock=false;
        afterLine0++;
      }
      i++;
    }
  }

  const uniq=new Map<number,HunkTarget>();
  for(const t of targets) if(!uniq.has(t.line0)) uniq.set(t.line0,t);
  return [...uniq.values()];
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
