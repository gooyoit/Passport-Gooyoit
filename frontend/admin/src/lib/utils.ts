export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function statusColor(status: string): string {
  if (status === "active") return "bg-sky-50 text-sky-700";
  if (status === "disabled") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-700";
}

export function statusLabel(status: string): string {
  if (status === "active") return "正常";
  if (status === "disabled") return "已禁用";
  return status;
}

const METHOD_LABELS: Record<string, string> = {
  email_code: "邮箱验证码",
  email_password: "邮箱密码",
  wechat: "微信",
  google: "Google",
  github: "GitHub",
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

const METHOD_DESCRIPTIONS: Record<string, string> = {
  email_code: "用户通过邮箱接收验证码登录",
  email_password: "用户通过邮箱和密码登录",
  wechat: "用户通过微信扫码登录",
  google: "用户通过 Google 账号登录",
  github: "用户通过 GitHub 账号登录",
};

export function methodDescription(method: string): string {
  return METHOD_DESCRIPTIONS[method] ?? "";
}
