import * as ts from 'typescript';

export enum WEB_INFO_SOURCE{
    CHAT_GPT="CHAT_GPT",
    VSCODE="VSCODE",
    OTHER="OTHER"
}

export interface Metadata{
    originalHash: string;
    fullTextHash: string,
    url: string;
    type: WEB_INFO_SOURCE;
    timeCopied: string;
    timeCopiedNumber: number;
    additionalMetaData: AdditionalMetadata;
}

export type AdditionalMetadata=
| ChatGptCopyBuffer
| VSCodeCopyMedia
| null;

export interface VSCodeCopyMedia{
    isText: boolean;
}
export interface ChatGptCopyBuffer{ 
    messageCopied: ThreadPair;
}

export interface ThreadPair{
    id: string;
    time: number;
    prompt: string;
    response: string;
}