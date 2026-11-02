import React, { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Link2, ShieldCheck, UserRound } from "lucide-react";
import Showcase from "../components/Showcase";
import { api, redirectUriSchema, safeRedirect } from "../lib/utils";

type SetupContext = {
  provider: string;
  display_name: string | null;
  avatar_url: string | null;
  application_name: string;
  client_id: string;
};

export default function AccountCompletePage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [context, setContext] = useState<SetupContext | null>(null);
  const [mode, setMode] = useState<"new" | "link">("new");
  const [form, setForm] = useState({ username: "", password: "", email: "", contactPhone: "", identifier: "", existingPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setMessage("账号完善链接无效，请重新发起微信登录。");
      return;
    }
    api<SetupContext>(`/auth/account-setup?token=${encodeURIComponent(token)}`)
      .then(setContext)
      .catch((error) => setMessage((error as Error).message));
  }, [token]);

  function update(key: keyof typeof form) {
    return (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  async function finish(selectedMode: "new" | "link" | "skip") {
    setLoading(true);
    setMessage("");
    try {
      const result = await api<{ redirect_uri: string }>("/auth/account-setup", {
        method: "POST",
        body: JSON.stringify({
          token,
          mode: selectedMode,
          username: selectedMode === "new" ? form.username || null : null,
          password: selectedMode === "new" ? form.password || null : null,
          email: selectedMode === "new" ? form.email || null : null,
          contact_phone: selectedMode === "new" ? form.contactPhone || null : null,
          identifier: selectedMode === "link" ? form.identifier : null,
          existing_password: selectedMode === "link" ? form.existingPassword : null,
        }),
      });
      const parsed = redirectUriSchema.safeParse(result);
      if (parsed.success) safeRedirect(parsed.data.redirect_uri);
      else setMessage("业务系统回调地址无效");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <Showcase />
      <section className="auth-side account-setup-side">
        <div className="auth-card account-setup-card">
          <div className="auth-header">
            <div className="brand-mark"><ShieldCheck size={28} /></div>
            <h1>完善 Passport 账号</h1>
            {context && <p className="setup-lead">微信身份已验证，完成后继续访问「{context.application_name}」</p>}
          </div>

          <div className="setup-steps" aria-hidden="true">
            <span className="step done"><CheckCircle2 size={14} /> 微信验证</span>
            <span className="step-line" />
            <span className="step current"><UserRound size={14} /> 完善资料</span>
          </div>

          {context?.display_name && (
            <div className="provider-confirmation">
              {context.avatar_url ? <img src={context.avatar_url} alt="微信头像" /> : <CheckCircle2 size={22} />}
              <div><strong>{context.display_name}</strong><span>微信身份已确认</span></div>
            </div>
          )}

          <div className="setup-tabs" role="tablist">
            <button className={mode === "new" ? "active" : ""} onClick={() => setMode("new")}>完善新账号</button>
            <button className={mode === "link" ? "active" : ""} onClick={() => setMode("link")}>绑定已有账号</button>
          </div>

          {mode === "new" ? (
            <form onSubmit={(event) => { event.preventDefault(); void finish("new"); }}>
              <p className="field-group-title">登录凭据</p>
              <label className="field"><span>用户名（可选）</span><input value={form.username} onChange={update("username")} placeholder="3-64 位字母、数字、下划线或连字符" autoComplete="username" /></label>
              <label className="field"><span>密码（设置用户名时必填）</span><div className="pwd-wrap"><input type={showPassword ? "text" : "password"} value={form.password} onChange={update("password")} placeholder="至少 8 位，包含三类字符" autoComplete="new-password" /><button type="button" className="pwd-toggle" onClick={() => setShowPassword(!showPassword)} aria-label="显示或隐藏密码">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
              <p className="field-group-title">邮箱与联系方式（可选）</p>
              <label className="field"><span>邮箱</span><input type="email" value={form.email} onChange={update("email")} placeholder="m@example.com" autoComplete="email" /><small className="field-hint">可用于登录；若邮箱已属于某个账号，会把微信绑定到该账号。</small></label>
              <label className="field"><span>联系电话（暂不验证）</span><input type="tel" value={form.contactPhone} onChange={update("contactPhone")} placeholder="例如 +8613800138000" autoComplete="tel" /></label>
              <button className="primary-btn" type="submit" disabled={loading}>{loading ? "处理中…" : "保存并继续"}</button>
              <button className="skip-btn" type="button" onClick={() => void finish("skip")} disabled={loading}>暂时跳过，仅使用微信登录</button>
              <p className="skip-hint">跳过后仍可随时在 Passport 账号设置中补全</p>
            </form>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); void finish("link"); }}>
              <div className="link-note"><Link2 size={18} /><span>验证现有账号后，微信将成为该账号的新登录方式。</span></div>
              <label className="field"><span>用户名或邮箱</span><input value={form.identifier} onChange={update("identifier")} required autoComplete="username" /></label>
              <label className="field"><span>现有密码</span><input type="password" value={form.existingPassword} onChange={update("existingPassword")} required autoComplete="current-password" /></label>
              <button className="primary-btn" type="submit" disabled={loading}>{loading ? "验证中…" : "验证并绑定"}</button>
            </form>
          )}
          {message && <p className="msg">{message}</p>}
        </div>
      </section>
    </main>
  );
}
