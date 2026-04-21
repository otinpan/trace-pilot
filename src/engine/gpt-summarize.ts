import OpenAI from "openai";
import {
  ExtensionContext,
} from "vscode";
import {
  Metadata,
  WEB_INFO_SOURCE,
  GPTHash,
  CodingAgentHash,
  ThreadPair,
} from "../constants/types";
import { getOrPromptOpenAIKey } from "../openai-api-key";
import { restoreTextByHash } from "./engine";
import { showSummary as renderSummary } from "./show-summary";

function trimForModel(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n...TRUNCATED...`;
}

function formatContextThreadPairs(threadPairs: ThreadPair[]): string {
  return threadPairs
    .slice(-8)
    .map((pair, index) => [
      `## Prior Pair ${index + 1}`,
      `id: ${pair.id}`,
      `time: ${pair.time}`,
      "",
      "### Prompt",
      trimForModel(pair.prompt, 3000),
      "",
      "### Response",
      trimForModel(pair.response, 5000),
    ].join("\n"))
    .join("\n\n");
}

function buildSummaryPrompt(
  prompt: string,
  generated: string,
  contextThreadPairs?: ThreadPair[],
): string {
  const sections: string[] = [
    "Summarize the current assistant exchange in Markdown.",
    "Focus primarily on the current prompt and the current generated response.",
    "Do not invent missing details.",
    "Keep the summary concise but useful for later recall.",
    "Match the output language to the dominant language of the input.",
    "",
    "Return markdown with these sections:",
    "## Summary",
    "## KeyPoints",
    "## Important Context",
    "",
    "Return markdown with clear section headings in the same language as the output.",
    "",
  ];

  if (contextThreadPairs && contextThreadPairs.length > 0) {
    sections.push(
      "Use the following prior thread pairs only as supporting context.",
      "If they are not relevant, say so briefly in Important Context.",
      "",
      "# Prior Thread Context",
      formatContextThreadPairs(contextThreadPairs),
      "",
    );
  }

  sections.push(
    "# Current Prompt",
    trimForModel(prompt, 6000),
    "",
    "# Current Generated Response",
    trimForModel(generated, 10000),
  );

  return sections.join("\n");
}

function getPromptAndGeneratedHashes(meta: Metadata): {
  promptHash: string;
  generatedHash: string;
  contextThreadPairsHash?: string;
} {
  const ah = meta.additionalHash;
  if (!ah || typeof ah !== "object" || !("promptHash" in ah) || !("generatedHash" in ah)) {
    throw new Error("promptHash or generatedHash is not available for this metadata");
  }

  switch (meta.type) {
    case WEB_INFO_SOURCE.CHAT_GPT:
      return {
        promptHash: (ah as GPTHash).promptHash,
        generatedHash: (ah as GPTHash).generatedHash,
        contextThreadPairsHash: (ah as GPTHash).contextThreadPairsHash,
      };
    case WEB_INFO_SOURCE.CODING_AGENT:
      return {
        promptHash: (ah as CodingAgentHash).promptHash,
        generatedHash: (ah as CodingAgentHash).generatedHash,
      };
    default:
      throw new Error(`Unsupported metadata type for summary: ${meta.type}`);
  }
}

function parseThreadPairs(raw: string): ThreadPair[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("contextThreadPairs is not an array");
  }

  return parsed.filter((value): value is ThreadPair => {
    if (!value || typeof value !== "object") {
      return false;
    }
    const pair = value as Partial<ThreadPair>;
    return (
      typeof pair.id === "string" &&
      typeof pair.time === "number" &&
      typeof pair.prompt === "string" &&
      typeof pair.response === "string"
    );
  });
}

export async function showSummary(
  context: ExtensionContext,
  meta: Metadata,
): Promise<boolean> {
  if (
    meta.type !== WEB_INFO_SOURCE.CHAT_GPT &&
    meta.type !== WEB_INFO_SOURCE.CODING_AGENT
  ) {
    return false;
  }

  const {
    promptHash,
    generatedHash,
    contextThreadPairsHash,
  } = getPromptAndGeneratedHashes(meta);

  const prompt = await restoreTextByHash(promptHash);
  const generated = await restoreTextByHash(generatedHash);

  let contextThreadPairs: ThreadPair[] | undefined;
  if (contextThreadPairsHash) {
    const raw = await restoreTextByHash(contextThreadPairsHash);
    contextThreadPairs = parseThreadPairs(raw);
  }

  const summarizedMarkdown = await summary(prompt, generated, contextThreadPairs);
  await renderSummary(context, generatedHash, prompt, summarizedMarkdown);

  return true;
}

async function summary(
  prompt: string,
  generated: string,
  contextThreadPairs?: ThreadPair[],
): Promise<string> {
  const apiKey = await getOrPromptOpenAIKey();
  const client = new OpenAI({ apiKey });
  const userPrompt = buildSummaryPrompt(prompt, generated, contextThreadPairs);

  const res = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          "You summarize LLM conversations for later retrieval.",
          "Your output must be markdown only.",
          "Match the output language to the dominant language of the input.",
          "Be faithful to the input and avoid speculation.",
        ].join("\n"),
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const output = res.output_text?.trim();
  if (!output) {
    throw new Error("No summary returned from model");
  }

  return output;
}
