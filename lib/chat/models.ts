export type ChatModel = {
  id: string;
  label: string;
  provider: "ollama" | "groq" | "openrouter";
  model: string;
};

const ALL_MODELS: ChatModel[] = [
  { id: "ollama:qwen2.5:3b", label: "Qwen2.5 3B (local)", provider: "ollama", model: "qwen2.5:3b" },
  { id: "ollama:llama3.1:8b", label: "Llama3.1 8B (local)", provider: "ollama", model: "llama3.1:8b" },
  { id: "groq:llama-3.1-8b-instant", label: "Llama3.1 8B (groq free)", provider: "groq", model: "llama-3.1-8b-instant" },
  { id: "openrouter:meta-llama/llama-3.1-8b-instruct:free", label: "Llama3.1 8B (openrouter free)", provider: "openrouter", model: "meta-llama/llama-3.1-8b-instruct:free" },
];

export function getAvailableModels(): ChatModel[] {
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  return ALL_MODELS.filter((m) => {
    if (m.provider === "groq") return hasGroq;
    if (m.provider === "openrouter") return hasOpenRouter;
    return true;
  });
}

export function getDefaultModelId(): string {
  const available = getAvailableModels();
  return available[0]?.id || "ollama:qwen2.5:3b";
}

export function findModelById(id: string | null | undefined): ChatModel | null {
  if (!id) return null;
  return ALL_MODELS.find((m) => m.id === id) || null;
}
