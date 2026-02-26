import type { ChatProvider, GenerateOpts, GenerateResult } from "./types";

async function* streamOpenAICompat(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        continue;
      }
    }
  }
}

export const groqProvider: ChatProvider = {
  id: "groq",
  async generate(opts: GenerateOpts): Promise<GenerateResult> {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("Missing GROQ_API_KEY");

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: opts.stream,
        temperature: 0.7,
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Groq error: ${res.status} ${text}`);
    }

    if (opts.stream) {
      return { type: "stream", stream: streamOpenAICompat(res) };
    }

    const data = await res.json().catch(() => ({}));
    const reply = data?.choices?.[0]?.message?.content ?? "";
    return { type: "text", text: reply };
  },
};
