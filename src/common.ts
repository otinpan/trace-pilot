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