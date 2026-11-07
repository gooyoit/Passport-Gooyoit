import React, { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import OtpInput from "../components/OtpInput";
import { api, normalizeCnPhone, redirectUriSchema, safeRedirect } from "../lib/utils";
import { useAliyunCaptcha } from "../lib/aliyunCaptcha";

type SetupContext = {
  provider: string;
  display_name: string | null;
  avatar_url: string | null;
  application_name: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
};

type BindingMode = "phone" | "email";

export default function AccountCompletePage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";
  const urlClientId = params.get("client_id") ?? "";
  const urlRedirectUri = params.get("redirect_uri") ?? "";
  const urlState = params.get("state") ?? "";
  const [context, setContext] = useState<SetupContext | null>(null);
  const [mode, setMode] = useState<BindingMode>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeMessage, setCodeMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const phoneRef = useRef(phone);
  const contextRef = useRef(context);
  phoneRef.current = phone;
  contextRef.current = context;

  useEffect(() => {
    if (!token) {
      setMessage("绑定链接无效，请重新发起微信登录。");
      return;
    }
    api<SetupContext>(`/auth/account-setup?token=${encodeURIComponent(token)}`)
      .then(setContext)
      .catch((error) => setMessage((error as Error).message));
  }, [token]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleCaptchaVerify(captchaVerifyParam: string) {
    const normalizedPhone = normalizeCnPhone(phoneRef.current);
    if (!normalizedPhone) {
      setCodeMessage("请输入正确的 11 位手机号");
      return { captchaResult: true, bizResult: false };
    }
    if (!contextRef.current) return { captchaResult: true, bizResult: false };
    try {
      const result = await api<{ sent: boolean; debug_code?: string }>(
        "/auth/sms/request-code",
        {
          method: "POST",
          body: JSON.stringify({
            client_id: contextRef.current.client_id,
            phone: normalizedPhone,
            purpose: "bind_phone",
            captcha_verify_param: captchaVerifyParam,
          }),
        },
      );
      setCodeSent(true);
      setCodeMessage(import.meta.env.DEV && result.debug_code ? `DEV: ${result.debug_code}` : "");
      setCooldown(60);
      return { captchaResult: true, bizResult: true };
    } catch (error) {
      const detail = (error as Error).message;
      if (detail.includes("Captcha verification failed")) {
        return { captchaResult: false, bizResult: false };
      }
      setCodeMessage(
        detail.includes("rate limit") || detail.includes("Too Many")
          ? "发送过于频繁，请稍后再试"
          : detail,
      );
      return { captchaResult: true, bizResult: false };
    }
  }

  const captcha = useAliyunCaptcha(handleCaptchaVerify);

  function requestCode() {
    if (cooldown > 0) return;
    if (!normalizeCnPhone(phone)) {
      setCodeMessage("请输入正确的 11 位手机号");
      return;
    }
    setCodeMessage("");
    if (!captcha.trigger()) setCodeMessage("人机验证暂不可用，请稍后再试");
  }

  async function finishBinding() {
    setLoading(true);
    setMessage("");
    try {
      const result = await api<{ redirect_uri: string }>("/auth/account-setup", {
        method: "POST",
        body: JSON.stringify({
          token,
          mode: "new",
          phone: mode === "phone" ? normalizeCnPhone(phone) : null,
          code: mode === "phone" ? code.trim() : null,
          email: mode === "email" ? email.trim() : null,
          password: mode === "email" ? password : null,
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

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "phone") {
      if (!normalizeCnPhone(phone)) {
        setMessage("请输入正确的 11 位手机号");
        return;
      }
      if (!code.trim()) {
        setMessage("请输入短信验证码");
        return;
      }
    } else if (!email.trim() || password.length < 8) {
      setMessage("请输入有效邮箱和至少 8 位密码");
      return;
    }
    void finishBinding();
  }

  // URL params cover fresh links; the token endpoint covers older links that
  // only carried a token. Either way we restore the originating app's login.
  const backClientId = urlClientId || context?.client_id || "";
  const backRedirectUri = urlRedirectUri || context?.redirect_uri || "";
  const backState = urlState || context?.state || "";
  const backToLogin =
    backClientId && backRedirectUri
      ? `/?${new URLSearchParams({
          client_id: backClientId,
          redirect_uri: backRedirectUri,
          ...(backState ? { state: backState } : {}),
        })}`
      : "/";

  return (
    <main className="binding-page">
      <div className="binding-shell">
        <div className="binding-brand">
          <div className="brand-mark"><ShieldCheck size={28} /></div>
          <strong>Gooyoit Passport</strong>
        </div>

        <section className="binding-card">
          <header className="binding-header">
            <h1>绑定登录方式</h1>
            <p>
              微信身份已验证。绑定手机号或邮箱后，继续访问
              {context ? `「${context.application_name}」` : "业务系统"}。
            </p>
          </header>

          <div className="binding-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "phone"}
              className={mode === "phone" ? "active" : ""}
              onClick={() => { setMode("phone"); setMessage(""); }}
            >
              绑定手机号
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "email"}
              className={mode === "email" ? "active" : ""}
              onClick={() => { setMode("email"); setMessage(""); }}
            >
              绑定邮箱
            </button>
          </div>

          <form className="binding-form" onSubmit={submit}>
            {mode === "phone" ? (
              <>
                <p className="binding-note">手机号已注册时，验证后会将微信并入该账号。</p>
                <label className="field">
                  <span>手机号</span>
                  <div className="phone-input">
                    <span className="phone-prefix" aria-hidden="true">+86</span>
                    <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="请输入手机号" autoComplete="tel" inputMode="tel" maxLength={20} required />
                  </div>
                </label>
                <label className="field">
                  <span>短信验证码</span>
                  <OtpInput value={code} onChange={setCode} />
                  <div className="otp-meta">
                    <span className="otp-hint">{codeSent ? "没收到验证码？" : ""}</span>
                    <button type="button" className="text-btn send-code-link" onClick={requestCode} disabled={loading || !phone || cooldown > 0}>
                      {cooldown > 0 ? `${cooldown}s 后重发` : codeSent ? "重新发送" : "发送验证码"}
                    </button>
                  </div>
                  {codeMessage && <span className="field-msg">{codeMessage}</span>}
                </label>
              </>
            ) : (
              <>
                <p className="binding-note">邮箱已注册时，请输入原密码，微信会并入该账号。</p>
                <label className="field">
                  <span>邮箱</span>
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入邮箱地址" autoComplete="email" required />
                </label>
                <label className="field">
                  <span>密码</span>
                  <div className="pwd-wrap">
                    <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="未注册邮箱将以此密码创建账号" autoComplete="current-password" minLength={8} required />
                    <button type="button" className="pwd-toggle" onClick={() => setShowPassword(!showPassword)} aria-label="显示或隐藏密码">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
              </>
            )}

            <button className="primary-btn" type="submit" disabled={loading}>
              {loading ? "处理中..." : "绑定并继续"}
            </button>
          </form>

          {message && <p className="msg">{message}</p>}
          <a className="binding-back" href={backToLogin}>返回登录页</a>
        </section>
      </div>

      <div id="aliyun-captcha-element" />
      <button ref={captcha.triggerRef} id="aliyun-captcha-trigger" type="button" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />
    </main>
  );
}
