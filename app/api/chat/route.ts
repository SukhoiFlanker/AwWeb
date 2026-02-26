import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient, supabaseServer } from "@/lib/supabase/server";
import { findModelById, getAvailableModels, getDefaultModelId } from "@/lib/chat/models";
import { ollamaProvider } from "@/lib/chat/providers/ollama";
import { groqProvider } from "@/lib/chat/providers/groq";
import { openrouterProvider } from "@/lib/chat/providers/openrouter";
import type { ChatMessage } from "@/lib/chat/providers/types";
import { z } from "zod";

const ChatBodySchema = z.object({
  message: z.string().trim().min(1),
  sessionId: z.string().trim().optional(),
  model: z.string().trim().optional(),
  stream: z.boolean().optional(),
});

type SessionRow = {
  id: string;
  user_id: string | null;
  metadata: unknown;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function pickSessionKey(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const v = (meta as Record<string, unknown>).session_key;
  return typeof v === "string" && v ? v : null;
}

export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json().catch(() => null);
    const parsedBody = ChatBodySchema.safeParse(raw);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid body", issues: parsedBody.error.issues },
        { status: 400 }
      );
    }
    const message = parsedBody.data.message;
    const sessionIdRaw = parsedBody.data.sessionId ?? null;
    const sessionId = sessionIdRaw && isUuid(sessionIdRaw) ? sessionIdRaw : null;
    const requestedModelId = parsedBody.data.model || getDefaultModelId();
    const stream = parsedBody.data.stream === true;

    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const userId = u.user?.id ?? null;
    const sessionKey = (req.headers.get("x-chat-key") || "").trim() || null;

    if (!userId && !sessionKey) {
      return NextResponse.json({ success: false, error: "Missing x-chat-key" }, { status: 401 });
    }

    const supabase = createSupabaseServiceRoleClient();

    // 1) 确保 session
    let sid = sessionId;

    if (sid) {
      const { data: existing, error: selErr } = await supabase
        .from("chat_sessions")
        .select("id, user_id, metadata")
        .eq("id", sid)
        .maybeSingle();

      if (selErr) {
        return NextResponse.json(
          { success: false, error: selErr.message },
          { status: 500 }
        );
      }

      if (!existing?.id) {
        if (!userId && !sessionKey) {
          return NextResponse.json({ success: false, error: "Missing x-chat-key" }, { status: 401 });
        }
        const { error: createErr } = await supabase.from("chat_sessions").upsert(
          {
            id: sid,
            title: message.slice(0, 30),
            user_id: userId,
            metadata: sessionKey ? { session_key: sessionKey } : {},
          },
          { onConflict: "id" }
        );

        if (createErr) {
          return NextResponse.json(
            { success: false, error: createErr.message },
            { status: 500 }
          );
        }
      } else {
        const row = existing as SessionRow;
        const existingKey = pickSessionKey(row.metadata);
        if (row.user_id) {
          if (!userId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
          if (row.user_id !== userId) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
          }
        } else {
          if (!sessionKey) return NextResponse.json({ success: false, error: "Missing x-chat-key" }, { status: 401 });
          if (existingKey && existingKey !== sessionKey) {
            return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
          }
          if (!existingKey || userId) {
            await supabase
              .from("chat_sessions")
              .update({ user_id: userId, metadata: { session_key: sessionKey } })
              .eq("id", sid);
          }
        }
      }
    } else {
      if (!userId && !sessionKey) {
        return NextResponse.json({ success: false, error: "Missing x-chat-key" }, { status: 401 });
      }
      const { data: created, error: createErr } = await supabase
        .from("chat_sessions")
        .insert({ title: message.slice(0, 30), user_id: userId, metadata: sessionKey ? { session_key: sessionKey } : {} })
        .select("id")
        .single();

      if (createErr || !created?.id) {
        return NextResponse.json(
          { success: false, error: createErr?.message || "Failed to create session" },
          { status: 500 }
        );
      }
      sid = created.id;
    }

    const availableModels = getAvailableModels();
    const modelItem = findModelById(requestedModelId);
    if (!modelItem) {
      return NextResponse.json({ success: false, error: "Invalid model" }, { status: 400 });
    }
    if (!availableModels.find((m) => m.id === modelItem.id)) {
      return NextResponse.json({ success: false, error: "Model not available" }, { status: 400 });
    }

    const providerMap = {
      ollama: ollamaProvider,
      groq: groqProvider,
      openrouter: openrouterProvider,
    } as const;

    async function generateWithFallback() {
      const provider = providerMap[modelItem.provider];
      try {
        const result = await provider.generate({
          model: modelItem.model,
          messages: buildPromptMessages(await loadHistory(sid), message),
          stream,
        });
        return { result, modelUsed: modelItem.id };
      } catch (err) {
        if (modelItem.provider === "ollama") {
          const fallback = availableModels.find((m) => m.provider !== "ollama");
          if (!fallback) throw err;
          const fallbackProvider = providerMap[fallback.provider];
          const result = await fallbackProvider.generate({
            model: fallback.model,
            messages: buildPromptMessages(await loadHistory(sid), message),
            stream,
          });
          return { result, modelUsed: fallback.id };
        }
        throw err;
      }
    }

    // 2) 写入用户消息（先写入）
    const { error: insUserErr } = await supabase.from("chat_messages").insert({
      session_id: sid,
      role: "user",
      content: message,
      model: modelItem.id,
    });

    if (insUserErr) {
      return NextResponse.json(
        { success: false, error: insUserErr.message },
        { status: 500 }
      );
    }

    const { result, modelUsed } = await generateWithFallback();

    if (result.type === "text") {
      const reply = result.text;
      const { error: insAsstErr } = await supabase.from("chat_messages").insert({
        session_id: sid,
        role: "assistant",
        content: reply,
        model: modelUsed,
      });
      if (insAsstErr) {
        return NextResponse.json(
          { success: false, error: insAsstErr.message },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, sessionId: sid, reply, model: modelUsed });
    }

    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        send({ type: "meta", sessionId: sid, model: modelUsed });
        let reply = "";
        try {
          for await (const delta of result.stream) {
            reply += delta;
            send({ type: "delta", delta });
          }
          await supabase.from("chat_messages").insert({
            session_id: sid,
            role: "assistant",
            content: reply,
            model: modelUsed,
          });
          send({ type: "done" });
          controller.close();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          send({ type: "error", error: msg });
          controller.close();
        }
      },
    });

    return new Response(streamBody, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

async function loadHistory(sessionId: string) {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw new Error(error.message);
  return (data ?? []).slice().reverse();
}

function buildPromptMessages(history: Array<{ role: string; content: string }>, latestMessage: string): ChatMessage[] {
  const system: ChatMessage = {
    role: "system",
    content: "你是一个中文为主的AI助手，回答要简洁、直接、有帮助。",
  };
  const msgs: ChatMessage[] = [system];
  for (const m of history) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    msgs.push({ role: m.role, content: m.content });
  }
  if (history.length === 0 || history[history.length - 1]?.content !== latestMessage) {
    msgs.push({ role: "user", content: latestMessage });
  }
  return msgs;
}
