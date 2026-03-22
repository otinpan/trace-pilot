import * as ts from 'typescript';

export enum WEB_INFO_SOURCE{
    CHAT_GPT="CHAT_GPT",
    CODING_AGENT="CODING_AGENT",
    CHROME_PDF="CHROME_PDF",
    CHROME_STATIC="CHROME_STATIC",
    GOOGLE_SHEETS="GOOGLE_SHEETS",
    VSCODE="VSCODE",
    OTHER="OTHER"
}

export interface Metadata{
    originalHash: string;
    additionalHash: AdditionalHash;
    url: string;
    type: WEB_INFO_SOURCE;
    timeCopied: string;
    timeCopiedNumber: number;
    additionalMetaData: AdditionalMetadata;
}

export type AdditionalHash=
| VSCodeHash
| CodingAgentHash
| ChromePDFHash
| ChromeStaticHash
| GPTHash
| GoogleSheetsHash
| null;

export interface VSCodeHash{
    fullTextHash:string;
}

export interface CodingAgentHash{
  promptHash: string,
  generatedHash: string,
  codeBlockHashes: CodeBlockHash[],
}

export interface ChromePDFHash{
    fullTextHash: string;
}

export interface ChromeStaticHash{
  mhtmlHash: string;
}

export interface GoogleSheetsHash{
  selectedHash: string,
  snapshotHash: string,
}

export interface GPTHash{
    promptHash: string;
    generatedHash: string;
    codeBlockHashes: CodeBlockHash[],

}

export interface CodeBlockHash{
    index: number;
    codeHash: string;

    language?: string;
    parentId?: string;
    turnParentId?: string;
}

export interface RestoredCodeBlock{
    index: number;
    code: string;
    language?: string;
    parentId?: string;
    turnParentId?: string;
}

export type AdditionalMetadata=
| GPTMetadata
| CodingAgentMetadata
| VSCodeMetadata
| ChromePDFMetadata
| ChromeStaticMetadata
| GoogleSheetsMetadata
| null;

export interface GPTMetadata{
    isText: boolean;
}


export interface CodingAgentMetadata{
  isText:boolean;
}
export interface VSCodeMetadata{
    isText:boolean;
}

export interface ChromePDFMetadata{
    isText:boolean;
}

export interface ChromeStaticMetadata{
  isText: boolean;
  encoding: string;
  title?: string;
}

export interface GoogleSheetsMetadata{
  isText: boolean;
  name?: string;
}

export interface ThreadPair{
    id: string;
    time: number;
    prompt: string;
    response: string;
}
