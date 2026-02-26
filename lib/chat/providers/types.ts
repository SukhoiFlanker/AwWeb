export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type GenerateOpts = {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  signal?: AbortSignal;
};

export type GenerateResult =
  | { type: "text"; text: string }
  | { type: "stream"; stream: AsyncGenerator<string> };

export type ChatProvider = {
  id: "ollama" | "groq" | "openrouter";
  generate: (opts: GenerateOpts) => Promise<GenerateResult>;
};
