import { readFile, readdir, stat } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { BurstState, LinkableRecord } from "./diff-tracer";
import { calculateHashAndStore } from "../hash-and-store";
import {
  CodeBlockHash,
  CodingAgentHash,
  Metadata,
  ThreadPair,
  WEB_INFO_SOURCE,
} from "../../constants/types";
import {
  CodexEvent,
  CodexEventType,
  EventMsg,
  EventMsgType,
  ResponseItem,
  ResponseItemContent,
  ResponseItemType,
  SessionMeta,
  TurnContext,
} from "./codex-type";

import { logMethodMessage } from "../../constants/logger";

interface CodexPromptPair {
  id: string;
  cwd?: string;
  prompt: string;
  generated: string;
  time: number;
}

interface CollectedPatch {
  path: string;
  diff_unified: string;
}

interface SessionScanState {
  cwd?: string;
  currentTurnId?: string;
  userMessages: string[];
  assistantMessages: string[];
  lastTurnTime?: number;
}

const PATCH_MATCH_RATIO_THRESHOLD = 0.8;

export async function createHashFromCodex(burst: BurstState): Promise<string | null> {
  if (burst.burst_time == null) {
    return null;
  }

  const d = new Date(burst.burst_time);
  const files = await getFilesFromCodexSessions(d);
  if (files.length === 0) {
    return null;
  }

  for (const file of files) {
    const matched: CodexPromptPair[]|null = await scanCodexSession(file, burst);
    if (!matched) {
      continue;
    }

    return createMetaHashFromTurn(matched, burst.records);
  }

  return null;
}

// 各ファイルからCodexPromptPairを作成する
// 直近3つのthread pairがあるなら取ってくる
async function scanCodexSession(filePath: string, burst: BurstState): Promise<CodexPromptPair[] | null> {

  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  const state: SessionScanState = {
    userMessages: [],
    assistantMessages: [],
  };

  let codexPromptPairs: CodexPromptPair[]=[];

  let isContainingCollectPatches:boolean=false;

  for (const line of lines) {
    const event = parseCodexEvent(line);
    if (!event) {
      continue;
    }

    if (event.type === CodexEventType.session_meta) {
      const payload = event.payload as SessionMeta;
      if (typeof payload.cwd === "string") {
        state.cwd = payload.cwd;
      }
      continue;
    }

    if (event.type === CodexEventType.turn_context) {
      const payload = event.payload as TurnContext;
      if (typeof payload.cwd === "string") {
        state.cwd = payload.cwd;
      }
      if (typeof payload.turn_id === "string") {
        state.currentTurnId = payload.turn_id;
      }
      continue;
    }

    if (event.type === CodexEventType.response_item) {
      const payload = event.payload as ResponseItem;
      if (payload.type !== ResponseItemType.message) {
        continue;
      }
      const text = extractResponseItemText(payload.content);
      if (!text) {
        continue;
      }
      if (payload.role === "user") {
        state.userMessages.push(text);
      } else if (payload.role === "assistant") {
        state.assistantMessages.push(text);
      }
      continue;
    }

    if (event.type === CodexEventType.event_msg) {
      const payload = event.payload as EventMsg;

      if (typeof payload.turn_id === "string") {
        state.currentTurnId = payload.turn_id;
      }

      if (payload.type === EventMsgType.task_started) {
        // 一度リセット
        isContainingCollectPatches=false;
        state.userMessages = [];
        state.assistantMessages = [];
        state.lastTurnTime = typeof payload.started_at === "number" ? payload.started_at * 1000 : undefined;
        continue;
      }

      // 終了
      if (payload.type===EventMsgType.task_complete){
        const prompt = state.userMessages.join("\n\n").trim();
        const generated = state.assistantMessages.join("\n\n").trim();
        if (!prompt || !generated) {
          return null;
        }
        const eventTime = resolveEventTime(event.timestamp, payload, state.lastTurnTime);

        // 古いものからpushしていく
        const completedPromptPair: CodexPromptPair={
          id: state.currentTurnId ?? `turn-${eventTime}`,
          cwd: state.cwd,
          prompt,
          generated,
          time: eventTime,
        }

        codexPromptPairs.push(completedPromptPair);

        // サイズが3になるようにpop
        if(codexPromptPairs.length>=4){
          while(codexPromptPairs.length>=4){
            codexPromptPairs.shift();
          }
        }

        if(isContainingCollectPatches){
          return codexPromptPairs;
        }
      }

      if (payload.type !== EventMsgType.patch_apply_end) {
        continue;
      }

      const patches=extractPatches(payload.changes);
      if (!patches){
        continue;
      }

      const isCollectPatches=checkCollectPatches(patches, burst);
      if (isCollectPatches){
        console.log("collect patches\n",patches);
        isContainingCollectPatches=true;
      }
    }
  }

  return null;
}

// CodexPromptPairからhash値を生成する
async function createMetaHashFromTurn(
  pairs: CodexPromptPair[],
  records: Map<string, LinkableRecord>,
): Promise<string> {
  if (pairs.length === 0) {
    throw new Error("No Codex prompt pairs found");
  }

  const matched = pairs[pairs.length - 1];
  const priorPairs = pairs.slice(0, -1);
  const originalHash = await calculateHashAndStore("");
  const promptHash = await calculateHashAndStore(matched.prompt);
  const recordEntries = Array.from(records.entries());
  const recordsCodeBlock = recordEntries
    .map(([uri, record], index) =>
      [
        `# Record ${index + 1}: ${uri}`,
        "```diff",
        record.diff_unified,
        "```",
      ].join("\n"),
    )
    .join("\n\n");
  const generatedText = recordsCodeBlock
    ? `${recordsCodeBlock}\n\n${matched.generated}`.trim()
    : matched.generated;
  const generatedHash = await calculateHashAndStore(generatedText);
  const codeBlockHashes: CodeBlockHash[] = await Promise.all(
    recordEntries.map(async ([, record], index) => ({
      index,
      codeHash: await calculateHashAndStore(record.diff_unified),
      language: "diff",
    })),
  );

  // ThreadPairをつなげてJSONにし、Hash化
  const contextThreadPairsHash = priorPairs.length > 0
    ? await calculateHashAndStore(JSON.stringify(toThreadPairs(priorPairs)))
    : undefined;

  const additionalHash: CodingAgentHash = {
    promptHash,
    generatedHash,
    codeBlockHashes,
    contextThreadPairsHash,
  };

  const meta: Metadata = {
    originalHash,
    additionalHash,
    url: Array.from(records.keys()).join("\n"),
    type: WEB_INFO_SOURCE.CODING_AGENT,
    timeCopied: new Date(matched.time).toISOString(),
    timeCopiedNumber: matched.time,
    additionalMetaData: {
      isText: true,
    },
  };

  return calculateHashAndStore(JSON.stringify(meta));
}

function toThreadPairs(pairs: CodexPromptPair[]): ThreadPair[] {
  return pairs.map((pair) => ({
    id: pair.id,
    time: pair.time,
    userMessage: pair.prompt,
    botResponse: pair.generated,
    codeBlocks: [],
  }));
}

function parseCodexEvent(line: string): CodexEvent | null {
  try {
    return JSON.parse(line) as CodexEvent;
  } catch {
    return null;
  }
}

// response_itemからcontentを取る
function extractResponseItemText(content: ResponseItemContent[] | undefined): string {
  if (!content || content.length === 0) {
    return "";
  }

  return content
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .join("")
    .trim();
}

// patch_apply_endからchangesからdiffを抽出する
function extractPatches(
  changes: Record<string, unknown> | undefined,
): CollectedPatch[] | null {
  if (!changes) {
    return null;
  }

  const patches: CollectedPatch[] = [];
  for (const [filePath, value] of Object.entries(changes)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const patch = value as Record<string, unknown>;
    const unifiedDiff = typeof patch.unified_diff === "string" ? patch.unified_diff : null;
    if (!unifiedDiff) {
      continue;
    }

    patches.push({
      path: normalizePath(filePath),
      diff_unified: normalizeDiff(unifiedDiff),
    });
  }

  return patches.length > 0 ? patches : null;

}

// patchの一定割合がburstのどれかに内包されていればtrue
function checkCollectPatches(
  patches: CollectedPatch[],
  burst: BurstState,
): boolean {
  if (burst.burst_time == null) {
    return false;
  }


  const burstPatches = Array.from(burst.records.values()).map((record) => ({
    path: normalizePath(record.uri),
    diff_unified: normalizeDiff(record.diff_unified),
  }));

  const matchedCount = patches.filter((patch) =>
    burstPatches.some(
      (burstPatch) =>
        burstPatch.path === patch.path &&
        diffContainsPatch(burstPatch.diff_unified, patch.diff_unified),
    ),
  ).length;

  const matchRatio = matchedCount / patches.length;
  const isMatched = matchRatio >= PATCH_MATCH_RATIO_THRESHOLD;

  if (isMatched) {
    console.log("collect patches\n", patches);
    console.log("match burst\n", burst);
    console.log("patch match ratio\n", matchRatio);
  }

  return isMatched;
}

function normalizePath(filePath: string): string {
  const normalized = path.normalize(filePath).replace(/\\/g, "/");
  return normalized.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
}

function normalizeDiff(diff: string): string {
  const lines = diff.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith("===================================================================") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }

    if (line.startsWith("@@")) {
      continue;
    }

    // Keep only the actual changed body plus blank context lines immediately around it.
    if (line.startsWith("+") || line.startsWith("-") || line.trim() === "") {
      kept.push(line);
    }
  }

  while (kept.length > 0 && kept[0].trim() === "") {
    kept.shift();
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
    kept.pop();
  }

  return kept.join("\n").trim();
}


// burstDiffにpatchDiffが内包されて入ればtrue
function diffContainsPatch(burstDiff: string, patchDiff: string): boolean {
  if (!burstDiff || !patchDiff) {
    return false;
  }

  if (burstDiff === patchDiff) {
    return true;
  }

  const burstAdded = extractChangedBodyLines(burstDiff);
  const patchAdded = extractChangedBodyLines(patchDiff);
  if (patchAdded.length === 0) {
    return false;
  }

  return containsContiguousSubsequence(burstAdded, patchAdded);
}

function extractChangedBodyLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((line) => line.startsWith("+"))
    .map((line) => line.slice(1));
}

function containsContiguousSubsequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || haystack.length < needle.length) {
    return false;
  }

  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }

  return false;
}

function resolveEventTime(
  eventTimestamp: string,
  payload: EventMsg,
  fallback?: number,
): number {
  if (typeof payload.completed_at === "number") {
    return payload.completed_at * 1000;
  }

  const parsed = Date.parse(eventTimestamp);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  return fallback ?? Date.now();
}

async function getFilesFromCodexSessions(d: Date): Promise<string[]> {
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const date = String(d.getDate()).padStart(2, "0");
  const dir = path.join(os.homedir(), ".codex", "sessions", year, month, date);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = await Promise.all(
    entries
      .filter((file) => file.endsWith(".jsonl"))
      .map(async (file) => {
        const fullPath = path.join(dir, file);
        const info = await stat(fullPath);
        return { fullPath, mtimeMs: info.mtimeMs };
      }),
  );

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.map((file) => file.fullPath);
}
