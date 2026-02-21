import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ChatBody = {
  message?: string;
  sessionId?: string;
};

type OllamaMsg = { role: "system" | "user" | "assistant"; content: string };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as ChatBody | null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const sessionIdRaw =
      typeof body?.sessionId === "string" ? body.sessionId.trim() : null;
    const sessionId = sessionIdRaw && isUuid(sessionIdRaw) ? sessionIdRaw : null;

    if (!message) {
      return NextResponse.json(
        { success: false, error: "message is required" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient();

    // 1) 确保 session
    let sid = sessionId;

    if (sid) {
      const { data: existing, error: selErr } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("id", sid)
        .maybeSingle();

      if (selErr) {
        return NextResponse.json(
          { success: false, error: selErr.message },
          { status: 500 }
        );
      }

      // 兼容历史数据/手动带入 sid：如果 session 不存在，则补建同 ID 的 session，
      // 避免出现“messages 有但 sessions 为空/看不到”的情况。
      if (!existing?.id) {
        const { error: createErr } = await supabase.from("chat_sessions").upsert(
          {
            id: sid,
            title: message.slice(0, 30),
          },
          { onConflict: "id" }
        );

        if (createErr) {
          return NextResponse.json(
            { success: false, error: createErr.message },
            { status: 500 }
          );
        }
      }
    } else {
      const { data: created, error: createErr } = await supabase
        .from("chat_sessions")
        .insert({ title: message.slice(0, 30) })
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

    // 2) 写入用户消息（先写入）
    const { error: insUserErr } = await supabase.from("chat_messages").insert({
      session_id: sid,
      role: "user",
      content: message,
      model: "qwen2.5:3b",
    });

    if (insUserErr) {
      return NextResponse.json(
        { success: false, error: insUserErr.message },
        { status: 500 }
      );
    }

    // 3) 读取最近的历史消息（包括刚写入的这条），组装 messages
    // 为了不太吃内存，先取最近 12 条，再反转成时间正序。
    const { data: history, error: histErr } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", sid)
      .order("created_at", { ascending: false })
      .limit(12);

    if (histErr) {
      return NextResponse.json(
        { success: false, error: histErr.message },
        { status: 500 }
      );
    }

    const system: OllamaMsg = {
      role: "system",
      content: "你是一个中文为主的AI助手，回答要简洁、直接、有帮助。",
    };

    const msgs: OllamaMsg[] = [system];

    // history 是倒序，反转成正序
    const ordered = (history ?? []).slice().reverse();

    for (const m of ordered) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      msgs.push({ role: m.role, content: m.content });
    }

    // 4) 调用 Ollama（带上下文）
    const ollamaRes = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:3b",
        stream: false,
        messages: msgs,
      }),
    });

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text().catch(() => "");
      return NextResponse.json(
        { success: false, error: `Ollama error: ${ollamaRes.status} ${text}` },
        { status: 500 }
      );
    }

    const data = await ollamaRes.json();
    const reply = data?.message?.content ?? "";

    // 5) 写入 assistant 消息
    const { error: insAsstErr } = await supabase.from("chat_messages").insert({
      session_id: sid,
      role: "assistant",
      content: reply,
      model: "qwen2.5:3b",
    });

    if (insAsstErr) {
      return NextResponse.json(
        { success: false, error: insAsstErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, sessionId: sid, reply });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
