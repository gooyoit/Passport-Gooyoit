import { useState } from "react";
import { CheckCircle, Copy, Download, Shield, X } from "lucide-react";
import { cn, statusColor, statusLabel } from "../lib/utils";
export { cn };

/* ─── Card ──────────────────────────────────────────── */

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]", className)}>
      {children}
    </section>
  );
}

/* ─── SectionHeader ─────────────────────────────────── */

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h2 className="text-xl font-bold text-slate-950">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* ─── MetricCard ────────────────────────────────────── */

export function MetricCard({
  title,
  value,
  secondary,
  action,
  onClick,
}: {
  title: string;
  value: string;
  secondary?: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <Card>
      <div className="p-5">
        <div className="text-sm font-medium text-slate-500">{title}</div>
        <div className="mt-3 text-4xl font-bold text-slate-950">{value}</div>
        {secondary && <div className="mt-2 text-sm text-slate-500">{secondary}</div>}
        {action && (
          <button type="button" className="mt-4 text-sm font-medium text-brand" onClick={onClick}>
            {action}
          </button>
        )}
      </div>
    </Card>
  );
}

/* ─── StatusBadge ───────────────────────────────────── */

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex min-w-14 items-center justify-center rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap", statusColor(status))}>
      {statusLabel(status)}
    </span>
  );
}

/* ─── EmptyBlock ────────────────────────────────────── */

export function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}

/* ─── Modal ─────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" onClick={onClose}>
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xl font-bold text-slate-950">{title}</div>
            {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-5 py-5">
          <div className="space-y-4">{children}</div>
          {actions && <div className="flex justify-end gap-2 pt-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/* ─── Field ─────────────────────────────────────────── */

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}

/* ─── CopyButton ────────────────────────────────────── */

export function CopyButton({ text, size: sz = 14, className: cls }: { text: string; size?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className={cn("rounded p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors", cls)}
        title="复制"
      >
        {copied ? <CheckCircle size={sz} className="text-success" /> : <Copy size={sz} />}
      </button>
      {copied && (
        <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-xs text-white shadow-lg animate-in fade-in">
          已复制
        </span>
      )}
    </span>
  );
}

/* ─── SecretModal ──────────────────────────────────── */

export function SecretModal({ clientId, clientSecret, onClose }: { clientId: string; clientSecret: string; onClose: () => void }) {
  function download() {
    const content = `Client ID:\n${clientId}\n\nClient Secret:\n${clientSecret}\n\n⚠ 请妥善保管 Client Secret，关闭此窗口后将无法再次查看完整内容。`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${clientId}_credentials.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" onClick={onClose}>
      <div className="mx-4 w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-xl font-bold text-slate-950">
              <Shield size={20} className="text-brand" />
              保存应用密钥
            </div>
            <div className="mt-1 text-sm text-slate-500">Client Secret 仅显示一次，请立即复制或下载保存。</div>
          </div>
          <button type="button" className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-5">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Client ID</p>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <code className="flex-1 truncate text-sm font-mono">{clientId}</code>
              <CopyButton text={clientId} />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Client Secret</p>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <code className="flex-1 break-all text-sm font-mono">{clientSecret}</code>
              <CopyButton text={clientSecret} />
            </div>
          </div>
        </div>
        <div className="flex gap-2 border-t border-slate-200 px-5 py-4">
          <button onClick={download} className={cn(btnOutline, "flex-1 gap-1.5")}>
            <Download size={14} /> 下载
          </button>
          <button onClick={onClose} className={cn(btnPrimary, "flex-1")}>我已保存</button>
        </div>
      </div>
    </div>
  );
}

/* ─── ActionButton ──────────────────────────────────── */

export function ActionButton({
  children,
  variant = "primary",
  onClick,
  className,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition",
        variant === "primary"
          ? "bg-brand text-white hover:bg-brand-dark"
          : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ─── ChipButton ────────────────────────────────────── */

export function ChipButton({
  children,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-xl border px-3 text-xs font-semibold whitespace-nowrap transition",
        danger
          ? "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100"
          : "border-slate-200 bg-slate-100 text-slate-900 hover:bg-slate-200",
      )}
    >
      {children}
    </button>
  );
}

/* ─── Shared classes ────────────────────────────────── */

export const inputCls =
  "w-full h-12 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";

export const btnCls =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-colors";

export const btnPrimary = cn(btnCls, "bg-brand text-white hover:bg-brand-dark");

export const btnOutline = cn(btnCls, "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50");
