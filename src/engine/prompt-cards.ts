import{
  ExtensionContext,
} from 'vscode';
import * as fs from "fs";
import * as path from "path";
import { Metadata,WEB_INFO_SOURCE,GPTHash, CodingAgentHash } from "../constants/types";
import { getRepositoryPathOrNull } from "../repository/repository";
import { ensureWorktree } from "../repository/worktree";
import { PromptCardItem, showPromptCards } from './show-promptcards';
import { restoreTextByHash } from './engine';
interface PromptMetadata{
  timeCopied: string;
  metaHashes: string[];
};

const ALLOWED_SOURCES=new Set<WEB_INFO_SOURCE>([
  WEB_INFO_SOURCE.CHAT_GPT,
  WEB_INFO_SOURCE.CODING_AGENT,
]);

function isAllowedSource(t:WEB_INFO_SOURCE):boolean{
  return ALLOWED_SOURCES.has(t);
}

function getPromptAndGeneratedHash(meta: Metadata): {promptHash: string; generatedHash: string} {
  const ah=meta.additionalHash;
  if(!ah||typeof ah!=="object"||!("promptHash" in ah)||!("generatedHash" in ah)){
    throw new Error("promptHash or generatedHash is not available for this metadata");
  }

  switch(meta.type){
  case WEB_INFO_SOURCE.CHAT_GPT:
    return {
      promptHash: (ah as GPTHash).promptHash,
      generatedHash: (ah as GPTHash).generatedHash,
    };
  case WEB_INFO_SOURCE.CODING_AGENT:
    return {
      promptHash: (ah as CodingAgentHash).promptHash,
      generatedHash: (ah as CodingAgentHash).generatedHash,
    };
  default:
    throw new Error(`Unsupported metadata type for prompt cards: ${meta.type}`);
  }
}

export class PromptCards{
  public times: number[]; //ソート用の配列
  public timesToHash: Map<number,string>; // timeからpromptHash+generatedHashへの変換
  public hashToPromptMetadata: Map<string,PromptMetadata>; // promptHash+generatedHashからPromptMetadataへの変換
  private initialized: boolean;

  constructor(){
    this.times=[];
    this.timesToHash=new Map<number,string>();
    this.hashToPromptMetadata=new Map<string,PromptMetadata>();
    this.initialized=false;
  }

  add(meta: Metadata,hash:string): boolean{
    if(!isAllowedSource(meta.type)){
      return false;
    }
    const { promptHash, generatedHash }=getPromptAndGeneratedHash(meta);
    const pairHash=`${promptHash}:${generatedHash}`;
    // すでにこのpairが存在する場合
    const pm=this.hashToPromptMetadata.get(pairHash);
    if(pm){
      pm.metaHashes.push(hash);
      return true;
    } 
    const time:number=meta.timeCopiedNumber;
    const time_s:string=meta.timeCopied;
    this.insertTimeSorted(time);
    this.timesToHash.set(time,pairHash);
    const new_pm:PromptMetadata={
      timeCopied: time_s,
      metaHashes: [hash],
    };
    this.hashToPromptMetadata.set(pairHash,new_pm);
    return true;
  }

  async remakePromptCards():Promise<boolean>{
    this.times=[];
    this.timesToHash.clear();
    this.hashToPromptMetadata.clear();

    const repoPath=await getRepositoryPathOrNull();
    if(!repoPath){
      console.log("no git repository");
      return false;
    }
    const isWorktree=await ensureWorktree(repoPath);
    if(!isWorktree){
      console.log("no worktree path");
      return false;
    }

    const blobsPath=path.join(repoPath,".trace-worktree","blobs");
    if(!fs.existsSync(blobsPath)){
      console.log("no files in blobs");
      return false;
    }

    const files=fs.readdirSync(blobsPath);
    for(const fileName of files){
      if(!fileName.endsWith(".bin")){
        continue;
      }
      const blobPath=path.join(blobsPath,fileName);
      if(!fs.statSync(blobPath).isFile()){
        continue;
      }

      const raw=fs.readFileSync(blobPath,"utf8");
      try{
        const parsed=JSON.parse(raw);
        if(!isMetadata(parsed)){
          continue;
        }
        const hash=fileName.slice(0,-".bin".length);
        // metadataがllm由来の物かどうかのチェック
        const ok=this.add(parsed as Metadata,hash);
        if(ok){
          console.log("added to prompt cards",hash);
        }else{
          continue;
        }
      }catch{
        continue;
      }
    }
    this.initialized=true;
    return true;
  }

  // blobPathからmatadataとhash値をaddに渡す
  async addPromptCards(blobPath:string):Promise<boolean>{
    if(!this.initialized){
      return false;
    }
    if(!blobPath.endsWith(".bin")){
      return false;
    }
    const raw=fs.readFileSync(blobPath,"utf8");
    try{
      const parsed=JSON.parse(raw);
      if(!isMetadata(parsed)){
        return false;
      }

      const hash=path.parse(blobPath).name;
      const ok=this.add(parsed as Metadata,hash);
      if(ok){
        console.log("added to prompt cards",hash);
        return true;
      }else{
        return false;
      }
    }catch{
      console.log("failed to add to prompt cards");
      return false;
    }
    
  }

  async showPromptCards(
    context: ExtensionContext,
    meta:Metadata
  ):Promise<boolean>{
    if(!isAllowedSource(meta.type)){
      return false;
    }
    if(!this.initialized){
      const ok=await this.remakePromptCards();
      if(!ok){
        return false;
      }
    }
    const { promptHash, generatedHash }=getPromptAndGeneratedHash(meta);
    const pairHash=`${promptHash}:${generatedHash}`;
    await showPromptCards(context,{
      selectedPairHash: pairHash,
      cards: await this.toPromptCardItems(),
    });
    return true;
  }

  private async toPromptCardItems(): Promise<PromptCardItem[]>{
    const cards: PromptCardItem[]=[];

    for(const time of this.times){
      const pairHash=this.timesToHash.get(time);
      if(!pairHash){
        continue;
      }

      const pm=this.hashToPromptMetadata.get(pairHash);
      if(!pm){
        continue;
      }

      const [promptHash,generatedHash]=pairHash.split(":");
      if(!promptHash||!generatedHash){
        continue;
      }

      const promptText:string=await restoreTextByHash(promptHash);
      const generatedText:string=await restoreTextByHash(generatedHash);

      cards.push({
        promptHash,
        promptText,
        generatedHash,
        generatedText,
        metaHashes: [...pm.metaHashes],
        copiedTime: pm.timeCopied,
        copiedTimeNumber: time,
      });
    }

    return cards;
  }

  private lowerBound(arr: number[],x:number):number{
    let l=0;
    let r=arr.length;
    while(l<r){
      const m=(l+r)>>1;
      if(arr[m]<x){
        l=m+1;
      }else{
        r=m;
      }
    }
    return l;
  }

  private insertTimeSorted(time:number):void{
    const i=this.lowerBound(this.times,time);

    let j=i;
    while(j<this.times.length&&this.times[j]===time){
      j++;
    }
    this.times.splice(j,0,time);
  }
}

function isMetadata(value: unknown): value is Metadata{
  if(!value || typeof value!=="object"){
    return false;
  }
  const candidate=value as Partial<Metadata>;
  return (
    typeof candidate.originalHash==="string" &&
    typeof candidate.url==="string" &&
    typeof candidate.type==="string" &&
    typeof candidate.timeCopied==="string" &&
    typeof candidate.timeCopiedNumber==="number" &&
    "additionalHash" in candidate &&
    "additionalMetaData" in candidate
  );
}
