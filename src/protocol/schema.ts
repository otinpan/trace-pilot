// schema.ts (TS定義に合わせた版)
import { z } from "zod";

export const WebInfoSourceSchema = z.enum(["CHAT_GPT", "CHROME_PDF", "VSCODE", "OTHER"]);

export const VSCodeHashSchema = z.object({
  fullTextHash: z.string(),
});

export const ChromePDFHashSchema = z.object({
  fullTextHash: z.string(),
});

export const CodeBlockHashSchema = z.object({
  index: z.number().int().min(0),
  codeHash: z.string(),
  // TSは optional string なので null は使わない
  language: z.string().optional(),
  parentId: z.string().optional(),
  turnParentId: z.string().optional(),
});

export const GPTHashSchema = z.object({
  promptHash: z.string(),
  generatedHash: z.string(),
  // TSは必須配列。defaultで埋めるなら OK（入力省略を許すかどうかの話）
  codeBlockHashes: z.array(CodeBlockHashSchema),
});

export const AdditionalHashSchema = z.union([VSCodeHashSchema, ChromePDFHashSchema, GPTHashSchema]);

export const GPTMetadataSchema = z.object({ isText: z.boolean() });
export const VSCodeMetadataSchema = z.object({ isText: z.boolean() });
export const ChromePDFMetadataSchema = z.object({ isText: z.boolean() });

export const AdditionalMetadataSchema = z.union([
  GPTMetadataSchema,
  VSCodeMetadataSchema,
  ChromePDFMetadataSchema,
]);

export const MetadataSchema = z.object({
  originalHash: z.string(),

  additionalHash: AdditionalHashSchema.nullable(),

  url: z.string(),
  type: WebInfoSourceSchema,
  timeCopied: z.string(),
  timeCopiedNumber: z.number().int(),

  // TSも同様に必須だけど null 可
  additionalMetaData: AdditionalMetadataSchema.nullable(),
});

export type Metadata = z.output<typeof MetadataSchema>;
