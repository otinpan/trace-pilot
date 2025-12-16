import * as ts from 'typescript';

export enum WEB_INFO_SOURCE{
    CHAT_GPT="CHAT_GPT",
    VSCODE="VSCODE",
    OTHER="OTHER"
}

export interface Metadata{
    code: string;
    hash: string;
    url: string;
    type: WEB_INFO_SOURCE;
    timeCopied: number;
    id: string;
    additionalMetaData: AdditionalMetadata;
}

export type AdditionalMetadata=
| ChatGptCopyBuffer
| null;

export interface ChatGptCopyBuffer{ 
    messageCopied: ThreadPair;
}

export interface ThreadPair{
    id: string;
    time: number;
    prompt: string;
    response: string;
}