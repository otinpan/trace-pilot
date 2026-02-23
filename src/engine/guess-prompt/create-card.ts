import OpenAI from "openai";
import { LinkableRecord } from "./diff-tracer";
import {
  workspace,
  window,
}from "vscode"
import { calculateHashAndStore } from "../hash-and-store";
import { 
  Metadata,
  WEB_INFO_SOURCE,
  CodingAgentHash, 
  CodingAgentMetadata
} from "../../constants/types";

if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile("/home/hase/thesis/trace-pilot/.env");
}

const apiKey=process.env.OPENAI_API_KEY ?? 
  workspace.getConfiguration("tracePilot").get<string>("openaiApiKey");

if(!apiKey){
  throw new Error("OpenAI API key is missing");
  window.showWarningMessage("OpenAI API key is missing");
}

const client=new OpenAI({apiKey});

type JSONSchemaObject=Record<string,unknown>;
export type GuessedOutput={
  time: number;
  guessed_prompt: string;
  guessed_generated: string;
};
export const OutputJSONSchema={
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["guessed_prompt","guessed_generated"],
  properties:{
    guessed_prompt: {type: "string",minLength:1, maxLength:2000},
    guessed_generated: {type: "string",minLength: 1,maxLength: 4000},
  },
} as const;


// トークン過多を防ぐ
function digestUnifiedDiff(unified: string, maxChars = 7000): string {
  const lines = unified.split("\n");
  const out: string[] = [];

  // 空行と//@trace-pilotを無視
  const ignorable = (l: string) => {
    if (!(l.startsWith("+") || l.startsWith("-"))) return false;
    const body = l.slice(1).trim();
    if (body === "") return true;
    if (body.startsWith("// @trace-pilot")) return true;
    return false;
  };

  for (const l of lines) {
    if (l.startsWith("@@")) out.push(l);
    else if (l.startsWith("+") || l.startsWith("-")) {
      if (!ignorable(l)) out.push(l);
    }
  }

  let s = out.join("\n");
  if (s.length > maxChars) s = s.slice(0, maxChars) + "\n...TRUNCATED_DIGEST...\n";
  return s;
}

function buildUserPrompt(records: LinkableRecord[]):string{
  const byUri=new Map<string,LinkableRecord>();
  for(const r of records) byUri.set(r.uri,r);

  const fileBlocks=[...byUri.values()]
    .slice(0,5)
    .map((r,i)=>{
      return [
        `# File ${i+1}`,
        `uri: ${r.uri}`,
        `diff: \n${digestUnifiedDiff(r.diff_unified)}`,
      ].join("\n")
  });

  return [
    "Infer the most likely user prompt that caused these diffs",
    "Also infer what the LLM likely generated (high-level), based only on the diffs",
    "Return JSON strictly matching the schema.",
    "",
    ...fileBlocks,
  ].join("\n\n");
}


async function callLLMJSONSchema(args:{
  system: string;
  userPrompt: string;
  schema: JSONSchemaObject;
}):Promise<unknown>{
  const res=await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {role: "system", content: args.system},
      {role: "user", content: args.userPrompt},
    ],
    text:{
      format:{
        type:"json_schema",
        name: "PromptInferenceOutput",
        strict: true,
        schema: args.schema,
      },
    },
  });

  const jsonText=res.output_text;
  if(!jsonText)throw new Error("No output_text from model");

  try{
    return JSON.parse(jsonText);
  }catch (e){
    throw new Error(`Failed to parse JSON output: ${String(e)}\n Raw:\n ${jsonText}`);
  }
}

export async function createGuessedOutput(
  records: LinkableRecord[],
  opts?: {now?:number}
): Promise<GuessedOutput>{
  const now=opts?.now??Date.now();

  const system=[
    "You are a software assistant that infers a user's likely prompt from code diffs.",
    "Do not hallucinate code outside the provided diffs",
    "Output must strictly match the provided JSON Schema.",
  ].join("\n");

  const userPrompt=buildUserPrompt(records);

  const result=await callLLMJSONSchema({
    system,
    userPrompt,
    schema: OutputJSONSchema,
  });

  const out=result as GuessedOutput;

  out.time=now;

  if(!out.guessed_prompt||!out.guessed_generated){
    throw new Error("LLM output missing required fields");
  }

  return out;

}

export async function createPromptCard(
  records: Map<string,LinkableRecord>,
  opts?: {now?: number}
):Promise<string>{
  const r=Array.from(records.values());
  const out=await createGuessedOutput(r,opts);

  const uris=Array.from(records.keys()).join(`\n`);
  const originalText="";
  const originalHash=await calculateHashAndStore(originalText);

  const promptText=out.guessed_prompt;
  const promptHash=await calculateHashAndStore(promptText);

  const recordsCodeBlock=r.map((r, i) => [
    `# Record ${i + 1}: ${r.uri}`,
    "```diff",
    r.diff_unified,
    "```",
  ].join("\n")).join("\n\n");
  const generatedText=`${recordsCodeBlock}\n\n${out.guessed_generated}`;
  const generatedHash=await calculateHashAndStore(generatedText);
  const codeBlockHashes=JSON.stringify(
    Array.from(records.values()).map((record) => record.diff_unified)
  );
  const meta:Metadata={
    originalHash: originalHash,
    additionalHash: {
      promptHash,
      generatedHash,
      codeBlockHashes,
    } as CodingAgentHash,
    url: uris,
    timeCopied: new Date(out.time).toISOString(),
    timeCopiedNumber: out.time,
    type: WEB_INFO_SOURCE.CODING_AGENT,
    additionalMetaData: {
      isText: true,
    } as CodingAgentMetadata,
  };
  const metaJSON=JSON.stringify(meta);
  const metaHash=await calculateHashAndStore(metaJSON);
  return metaHash;

}
