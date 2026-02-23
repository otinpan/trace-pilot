import * as ts from 'typescript';

export enum WEB_INFO_SOURCE{
    CHAT_GPT="CHAT_GPT",
    CODING_AGENT="CODING_AGENT",
    CHROME_PDF="CHROME_PDF",
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
| GPTHash
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



export interface ThreadPair{
    id: string;
    time: number;
    prompt: string;
    response: string;
}
