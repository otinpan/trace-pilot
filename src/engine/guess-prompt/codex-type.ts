export enum CodexEventType{
  session_meta="session_meta",
  event_msg="event_msg",
  response_item="response_item",
  turn_context="turn_context",
  other="other",
}
export interface CodexEvent{
  timestamp: string;
  type: CodexEventType;
  payload: Payload;
}

export type Payload=
| SessionMeta
| EventMsg
| ResponseItem
| TurnContext
| Other

// session情報
export interface SessionMeta{
  id?: string;
  timestamp?: string;
  cwd?: string;
  originator?: string;
  cli_version?: string;
  source?: string;
  model_provider?: string;
  base_instructions?: {
    text?: string;
  };
  git?: {
    commit_hash?: string;
    branch?: string;
    repository_url?: string;
  };
}

// 状態ログ
export interface EventMsg{
  type: EventMsgType | string;
  turn_id?: string;
  started_at?: number;
  completed_at?: number;
  message?: string;
  phase?: string;
  model_context_window?: number;
  collaboration_mode_kind?: string;
  info?: unknown;
  rate_limits?: unknown;
  call_id?: string;
  process_id?: string;
  command?: string[];
  cwd?: string;
  parsed_cmd?: unknown[];
  source?: string;
  stdout?: string;
  stderr?: string;
  aggregated_output?: string;
  exit_code?: number;
  formatted_output?: string;
  status?: string;
  duration_ms?: number;
  time_to_first_token_ms?: number;
  thread_id?: string;
  thread_name?: string;
  changes?: Record<string, unknown>;
  success?: boolean;
  [key: string]: unknown;
}

// 環境
export interface TurnContext{
  turn_id?: string;
  cwd?: string;
  current_date?: string;
  timezone?: string;
  approval_policy?: string;
  sandbox_policy?: {
    type?: string;
    network_access?: boolean;
    exclude_tmpdir_env_var?: boolean;
    exclude_slash_tmp?: boolean;
  };
  permission_profile?: unknown;
  file_system_sandbox_policy?: unknown;
  model?: string;
  personality?: string;
  collaboration_mode?: {
    mode?: string;
    settings?: Record<string, unknown>;
  };
  realtime_active?: boolean;
  effort?: string;
  summary?: string;
  truncation_policy?: {
    mode?: string;
    limit?: number;
  };
  [key: string]: unknown;
}

export interface Other{
  type?: string;
  [key: string]: unknown;
}

export enum EventMsgType{
  task_started="task_started",
  user_message="user_message",
  token_count="token_count",
  agent_message="agent_message",
  exec_command_end="exec_command_end",
  thread_name_updated="thread_name_updated",
  patch_apply_end="patch_apply_end",
  task_complete="task_complete",
}

export enum ResponseItemType{
  message="message",
  reasoning="reasoning",
  function_call="function_call",
  function_call_output="function_call_output",
  custom_tool_call="custom_tool_call",
  custom_tool_call_output="custom_tool_call_output",
}

export interface ResponseItemContent{
  type?: string;
  text?: string;
  [key: string]: unknown;
}

// 本体
export interface ResponseItem{
  type: ResponseItemType | string;
  role?: string;
  content?: ResponseItemContent[];
  phase?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  status?: string;
  output?: string;
  summary?: unknown[];
  encrypted_content?: string | null;
  [key: string]: unknown;
}
