// ---- Sonar (legacy chat completions) contract, the shape this proxy exposes ----

export interface SonarMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SonarRequest {
  model: string;
  messages: SonarMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  search_domain_filter?: string[];
  search_recency_filter?: string;
  // Anything else Sonar accepted (return_images, return_related_questions,
  // web_search_options, ...) is dropped — the Agent API 400s on unknown fields.
  [key: string]: unknown;
}

export interface SonarSearchResult {
  title: string;
  url: string;
  date?: string | null;
  last_updated?: string | null;
  snippet?: string;
}

export interface SonarResponse {
  id: string;
  model: string;
  created: number;
  object: "chat.completion";
  citations: string[];
  search_results: SonarSearchResult[];
  choices: Array<{
    index: number;
    finish_reason: string;
    message: { role: "assistant"; content: string };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ---- Agent API contract, the upstream this proxy calls ----

export interface AgentRequest {
  preset?: string;
  model?: string;
  input: string | Array<{ role: string; content: string }>;
  instructions?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  tools?: Array<{ type: string; filters?: Record<string, unknown> }>;
}

export interface AgentOutputMessage {
  type: "message";
  role: string;
  status?: string;
  content: Array<{ type: string; text?: string }>;
}

export interface AgentOutputSearchResults {
  type: "search_results";
  queries?: string[];
  results?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    date?: string | null;
    last_updated?: string | null;
  }>;
}

export type AgentOutputItem =
  | AgentOutputMessage
  | AgentOutputSearchResults
  | { type: string; [key: string]: unknown };

export interface AgentResponse {
  id: string;
  created_at?: number;
  model?: string;
  object?: string;
  status: string; // "completed" | "failed" | "incomplete" | "cancelled"
  output?: AgentOutputItem[];
  output_text?: string;
  incomplete_details?: { reason?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string } | null;
}

export interface ProxyConfig {
  // sonar model name -> Agent API preset
  modelToPreset: Record<string, string>;
  // "array" sends the full message list as Responses-style input items;
  // "string" flattens the conversation into one prompt string.
  inputMode: "array" | "string";
}

export const DEFAULT_MODEL_TO_PRESET: Record<string, string> = {
  sonar: "fast",
  "sonar-pro": "low",
  "sonar-reasoning": "low",
  "sonar-reasoning-pro": "medium",
  "sonar-deep-research": "high",
};
