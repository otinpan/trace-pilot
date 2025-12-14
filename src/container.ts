import{
    ExtensionContext,
    Disposable,
    commands,
    TextEditor,
    TextEditorEdit,
} from 'vscode';
import {TraceEngine} from "./engine/TraceEngine";

export class Container{
    private readonly engine: TraceEngine;
    private readonly disposables: Disposable[]=[];

    constructor(
        readonly context: ExtensionContext,
    ){
        this.engine=new TraceEngine(context);
    }
}