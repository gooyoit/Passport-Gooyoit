export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function statusColor(status: string): string {
  if (status === "active") return "text-success bg-success-light";
  if (status === "disabled") return "text-muted";
  return "text-warning bg-warning-light";
}

export function statusLabel(status: string): string {
  if (status === "active") return "正常";
  if (status === "disabled") return "已禁用";
  return status;
}

const METHOD_LABELS: Record<string, string> = {
  email_code: "邮箱验证码",
  wechat: "微信",
  google: "Google",
  github: "GitHub",
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}
