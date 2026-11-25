import { useState } from "react";
import { api, setToken } from "../api";
import { ErrorBox, useAction } from "../ui";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="login-bg">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api<{ token: string }>("POST", "/login", { username, password }), (r) => {
            setToken(r.token);
            onLogin();
          });
        }}
      >
        <div className="brand-mark dark">HIGH TECH</div>
        <h1>لوحة التحكم</h1>
        <p className="muted">إدارة تطبيقي القطاعي والجملة</p>
        <label className="field">
          <span>اسم المستخدم</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus name="username" autoComplete="username" />
        </label>
        <label className="field">
          <span>كلمة المرور</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} name="password" autoComplete="current-password" />
        </label>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy || !username || !password}>
          {busy ? "جارِ الدخول…" : "دخول"}
        </button>
      </form>
    </div>
  );
}
