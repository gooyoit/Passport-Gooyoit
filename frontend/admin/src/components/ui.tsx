import { useState } from "react";
import { CheckCircle, Copy, Download, Shield, X } from "lucide-react";
import { cn, statusColor, statusLabel } from "../lib/utils";
export { cn };

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-white p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-semibold text-[#17202a]">{title}</h2>
      {action}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  color = "text-brand",
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card className="flex items-center gap-4">
      <div className={cn("flex h-11 w-11 items-center justify-center rounded-lg bg-brand-light", color)}>
        <Icon size={22} />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-sm text-muted">{label}</p>
      </div>
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", statusColor(status))}>
      {statusLabel(status)}
    </span>
  );
}

export function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="py-12 text-center text-sm text-muted">{text}</div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl border border-border bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-surface">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3">{children}</div>
        {actions && <div className="mt-5 flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

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
        className={cn("rounded p-1 text-muted hover:text-gray-700 hover:bg-surface transition-colors", cls)}
        title="复制"
      >
        {copied ? <CheckCircle size={sz} className="text-success" /> : <Copy size={sz} />}
      </button>
      {copied && (
        <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-0.5 text-xs text-white shadow-lg animate-in fade-in">
          已复制
        </span>
      )}
    </span>
  );
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          <Shield size={20} className="text-brand" />
          <h3 className="text-lg font-bold">保存应用密钥</h3>
        </div>
        <p className="mb-4 text-xs text-muted">Client Secret 仅显示一次，请立即复制或下载保存。</p>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Client ID</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <code className="flex-1 truncate text-sm font-mono">{clientId}</code>
              <CopyButton text={clientId} />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Client Secret</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <code className="flex-1 break-all text-sm font-mono">{clientSecret}</code>
              <CopyButton text={clientSecret} />
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={download} className={cn(btnOutline, "flex-1 gap-1.5")}>
            <Download size={14} /> 下载
          </button>
          <button onClick={onClose} className={cn(btnPrimary, "flex-1")}>我已保存</button>
        </div>
      </div>
    </div>
  );
}

export const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
export const btnCls =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors";
export const btnPrimary = cn(btnCls, "bg-brand text-white hover:bg-brand-dark");
export const btnOutline = cn(btnCls, "border border-border bg-white hover:bg-surface");
