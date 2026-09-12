"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok)
        throw new Error((await response.json()).error ?? "Đăng nhập thất bại.");
      router.push("/manage-image");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Đăng nhập thất bại.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-orbit login-orbit-one" />
      <div className="login-orbit login-orbit-two" />
      <section className="login-shell" aria-labelledby="login-title">
        <div className="login-mark" aria-hidden="true">
          MI
        </div>
        <p className="login-kicker">PRIVATE IMAGE VAULT</p>
        <h1 id="login-title">Kho ảnh cá nhân</h1>
        <p className="login-description">
          Đăng nhập để quản lý ảnh lưu trên Telegram.
        </p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="password">Mật khẩu quản trị</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Đang kiểm tra..." : "Đăng nhập →"}
          </button>
        </form>
        <p className="login-message" role="alert">
          {message}
        </p>
      </section>
    </main>
  );
}
