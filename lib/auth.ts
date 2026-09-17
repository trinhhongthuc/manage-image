import { cookies } from "next/headers";

const COOKIE_NAME = "manage-image-session";

function expectedSession() {
  const password = process.env.ADMIN_PASSWORD;
  return password ? `authenticated:${password}` : "";
}

export async function isAdminAuthenticated() {
  const expected = expectedSession();
  if (!expected) return false;
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value === expected;
}

export function sessionCookie(value: string) {
  return {
    name: COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function sessionValue(password: string) {
  return `authenticated:${password}`;
}
