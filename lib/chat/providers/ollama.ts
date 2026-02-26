import type { ChatProvider, GenerateOpts, GenerateResult } from "./types";

type OllamaStreamChunk = {
  message?: { role?: string; content?: string };
  done?: boolean;
};

async function* streamOllama(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed) as OllamaStreamChunk;
        if (json.message?.content) yield json.message.content;
        if (json.done) return;
      } catch {
        continue;
      }
    }
  }
}

export const ollamaProvider: ChatProvider = {
  id: "ollama",
  async generate(opts: GenerateOpts): Promise<GenerateResult> {
    const res = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        stream: opts.stream,
        messages: opts.messages,
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama error: ${res.status} ${text}`);
    }

    if (opts.stream) {
      return { type: "stream", stream: streamOllama(res) };
    }

    const data = await res.json().catch(() => ({}));
    const reply = data?.message?.content ?? "";
    return { type: "text", text: reply };
  },
};
