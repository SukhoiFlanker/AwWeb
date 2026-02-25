import { NextResponse } from "next/server";

export async function GET() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase() || null;
  const contact = (process.env.ADMIN_CONTACT ?? "").trim() || null;
  return NextResponse.json({ email, contact }, { status: 200 });
}
