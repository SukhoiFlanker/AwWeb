import { z } from "zod";

const VisitorKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);

export function parseVisitorKey(req: Request): string | null {
  const raw = req.headers.get("x-visitor-id") || "";
  const parsed = VisitorKeySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function requireVisitorKey(req: Request): string {
  const v = parseVisitorKey(req);
  if (!v) {
    throw new Error("Missing or invalid x-visitor-id");
  }
  return v;
}

