import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Globe,
  Info,
  Key,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  List,
  LogOut,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Users,
} from "lucide-react";
import type {
  Application,
  ApplicationUser,
  ApplicationCreated,
  ClientSecretItem,
  LoginMethod,
  Permission,
  Role,
  TokenExchangeResponse,
  User,
  ViewKey,
} from "./types";
import { request, buildAuthorizeUrl } from "./lib/api";
import { cn, methodDescription, methodLabel } from "./lib/utils";

/* ─── Reusable Components ──────────────────────────────────── */

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]", className)}>
      {children}
    </section>
  );
}

function SectionHeader({
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

function MetricCard({
  label,
  value,
  icon: Icon,
  color = "text-brand",
  action,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <Card className="p-5">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className={cn("mt-3 text-4xl font-bold text-slate-950", color === "text-success" && "text-success")}>{value}</div>
      {action && onClick ? (
        <button type="button" className="mt-4 text-sm font-medium text-[#1a73e8]" onClick={onClick}>
          {action}
        </button>
      ) : null}
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-14 items-center justify-center rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap",
        status === "active" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600",
      )}
    >
      {status === "active" ? "正常" : "已禁用"}
    </span>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">{text}</div>;
}

function Modal({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" onClick={onClose}>
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <h3 className="text-xl font-bold text-slate-950">{title}</h3>
          <button type="button" onClick={onClose} className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">
            ×
          </button>
        </div>
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-5 py-5">{children}</div>
        {actions && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">{actions}</div>}
      </div>
    </div>
  );
}

function Field({
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

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
const btnCls =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition";
const btnPrimary = cn(btnCls, "bg-[#1a73e8] text-white hover:bg-[#1557b0]");
const btnOutline = cn(btnCls, "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50");

/* ─── CopyButton ──────────────────────────────────────── */

function CopyButton({ text, size: sz = 14, className: cls }: { text: string; size?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
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
  );
}

/* ─── SecretModal ────────────────────────────────────── */

function SecretModal({ clientId, clientSecret, onClose }: { clientId: string; clientSecret: string; onClose: () => void }) {
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

/* ─── Toast ──────────────────────────────────────────── */

interface ToastItem {
  id: number;
  message: string;
  type: "error" | "success";
}

let toastId = 0;

function ToastContainer({ items }: { items: ToastItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="fixed right-4 top-4 z-[60] flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "toast-enter flex items-center gap-2 rounded-lg px-4 py-3 text-sm shadow-lg",
            t.type === "error" ? "bg-danger-light text-danger" : "bg-success-light text-success",
          )}
        >
          {t.type === "error" ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ─── Sidebar ───────────────────────────────────────────────── */

const NAV_ITEMS: { key: ViewKey; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { key: "applications", label: "应用管理", icon: Globe },
  { key: "users", label: "用户管理", icon: Users },
];

function SidebarItem({
  active,
  icon: Icon,
  label,
  collapsed,
  onClick,
}: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-14 items-center gap-3 rounded-2xl px-4 text-left text-[1.05rem] font-medium transition",
        collapsed ? "justify-center md:px-0" : "",
        active ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50",
      )}
      title={collapsed ? label : undefined}
    >
      <span className={cn("shrink-0", active ? "text-[#1a73e8]" : "text-slate-700")}>{<Icon className="size-5" />}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

/* ─── Views ─────────────────────────────────────────────────── */

function DashboardView({
  applications,
  users,
  onNavigate,
  onSelectApp,
}: {
  applications: Application[];
  users: User[];
  onNavigate: (key: ViewKey) => void;
  onSelectApp: (app: Application) => void;
}) {
  const [appLayout, setAppLayout] = useState<"grid" | "list">("grid");
  const activeUsers = users.filter((u) => u.status === "active").length;
  const activeApps = applications.filter((a) => a.status === "active").length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <MetricCard label="应用总数" value={applications.length} icon={Globe} action="查看全部" onClick={() => onNavigate("applications")} />
        <MetricCard label="活跃应用" value={activeApps} icon={CheckCircle} color="text-success" />
        <MetricCard label="用户总数" value={users.length} icon={Users} action="查看全部" onClick={() => onNavigate("users")} />
        <MetricCard label="活跃用户" value={activeUsers} icon={CheckCircle} color="text-success" />
      </div>

      <Card>
        <SectionHeader
          title="最近应用"
          description="展示最近创建或更新的接入系统"
          action={
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setAppLayout("grid")}
                className={cn(
                  "rounded-xl p-2 transition-colors",
                  appLayout === "grid" ? "bg-brand-light text-brand" : "text-muted hover:bg-slate-50",
                )}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                onClick={() => setAppLayout("list")}
                className={cn(
                  "rounded-xl p-2 transition-colors",
                  appLayout === "list" ? "bg-brand-light text-brand" : "text-muted hover:bg-slate-50",
                )}
              >
                <List size={16} />
              </button>
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <button onClick={() => onNavigate("applications")} className={cn(btnOutline, "text-xs")}>
                查看全部
              </button>
            </div>
          }
        />
        {applications.length === 0 ? (
          <EmptyBlock text="暂无应用" />
        ) : appLayout === "grid" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {applications.slice(0, 8).map((app) => (
              <div
                key={app.id}
                className="group cursor-pointer rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-all hover:border-[#1a73e8]/40 hover:shadow-sm"
                onClick={() => onSelectApp(app)}
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand">
                  <Globe size={20} />
                </div>
                <p className="truncate text-sm font-semibold text-slate-900">{app.name}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{app.client_id}</p>
                <div className="mt-2">
                  <StatusBadge status={app.status} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {applications.slice(0, 8).map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between px-5 py-4 cursor-pointer transition hover:bg-slate-50"
                onClick={() => onSelectApp(app)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light text-brand">
                    <Globe size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{app.name}</p>
                    <p className="text-xs text-slate-500">{app.client_id}</p>
                  </div>
                </div>
                <StatusBadge status={app.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ApplicationsView({
  applications,
  onLoad,
  onCreate,
  onUpdate,
  onRegenerateSecret,
  onDeleteSecret,
  onSelect,
}: {
  applications: Application[];
  onLoad: () => void;
  onCreate: (name: string, redirectUris: string[], enableSSO: boolean, enablePublicUsers: boolean, description?: string) => void;
  onUpdate: (id: number, data: { name?: string; description?: string | null; redirect_uris?: string[]; enable_sso?: boolean; enable_public_users?: boolean; status?: string }) => void;
  onRegenerateSecret: (appId: number, clientId: string) => void;
  onDeleteSecret: (appId: number, secretId: number) => void;
  onSelect: (app: Application) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [uris, setUris] = useState("");
  const [enableSSO, setEnableSSO] = useState(true);
  const [enablePublicUsers, setEnablePublicUsers] = useState(false);
  const [appStatus, setAppStatus] = useState("active");

  function resetForm() {
    setName("");
    setDesc("");
    setUris("");
    setEnableSSO(true);
    setEnablePublicUsers(false);
    setAppStatus("active");
  }

  function openEdit(app: Application) {
    setEditingApp(app);
    setName(app.name);
    setDesc(app.description ?? "");
    setUris(app.redirect_uris.join("\n"));
    setEnableSSO(app.enable_sso);
    setEnablePublicUsers(app.enable_public_users);
    setAppStatus(app.status);
  }

  function handleCreate() {
    if (!name.trim()) return;
    onCreate(name.trim(), uris.split("\n").map((s) => s.trim()).filter(Boolean), enableSSO, enablePublicUsers, desc.trim() || undefined as string | undefined);
    resetForm();
    setOpen(false);
    onLoad();
  }

  function handleUpdate() {
    if (!editingApp || !name.trim()) return;
    onUpdate(editingApp.id, {
      name: name.trim(),
      description: desc.trim() || null,
      redirect_uris: uris.split("\n").map((s) => s.trim()).filter(Boolean),
      enable_sso: enableSSO,
      enable_public_users: enablePublicUsers,
      status: appStatus,
    });
    setEditingApp(null);
    resetForm();
    onLoad();
  }

  const formFields = (
    <>
      <Field label="应用名称">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：MyApp" />
      </Field>
      <Field label="应用描述">
        <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="可选" />
      </Field>
      <Field label="回调地址（每行一个）">
        <textarea
          className={cn(inputCls, "min-h-20 resize-y")}
          value={uris}
          onChange={(e) => setUris(e.target.value)}
          placeholder="https://example.com/callback"
        />
      </Field>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enableSSO} onChange={(e) => setEnableSSO(e.target.checked)} className="h-4 w-4 rounded border-border accent-brand" />
          启用 SSO 单点登录
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enablePublicUsers} onChange={(e) => setEnablePublicUsers(e.target.checked)} className="h-4 w-4 rounded border-border accent-brand" />
          允许公开注册
        </label>
      </div>
      <Field label="应用状态">
        <select className={inputCls} value={appStatus} onChange={(e) => setAppStatus(e.target.value)}>
          <option value="active">启用</option>
          <option value="disabled">禁用</option>
        </select>
      </Field>
    </>
  );

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title="应用列表"
          description="管理所有 OAuth 接入系统"
          action={
            <button onClick={() => { resetForm(); setOpen(true); }} className={btnPrimary}>
              <Plus size={16} /> 新建应用
            </button>
          }
        />
        {applications.length === 0 ? (
          <EmptyBlock text="暂无应用，点击右上角创建" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-5 py-3">应用</th>
                  <th className="px-4 py-3">用户池</th>
                  <th className="px-4 py-3">SSO</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {applications.map((app) => (
                  <tr key={app.id} className="bg-white hover:bg-slate-50">
                    <td className="px-5 py-5 align-middle">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{app.name}</div>
                          {app.description && (
                            <div className="mt-1 text-xs text-slate-500">{app.description}</div>
                          )}
                          <div className="mt-1.5 flex items-center gap-1">
                            <code className="text-xs font-mono text-slate-400">{app.client_id}</code>
                            <CopyButton text={app.client_id} size={12} />
                          </div>
                        </div>
                        <StatusBadge status={app.status} />
                      </div>
                    </td>
                    <td className="px-4 py-5 text-slate-500 align-middle">
                      <span className="text-xs">{app.enable_public_users ? "公共" : "私有"}</span>
                    </td>
                    <td className="px-4 py-5 text-slate-500 align-middle">
                      <span className="text-xs">{app.enable_sso ? "开启" : "关闭"}</span>
                    </td>
                    <td className="px-4 py-5 align-middle">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(app)}
                          className="rounded-md px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-gray-700 transition-colors"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => onSelect(app)}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-light transition-colors"
                        >
                          管理
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="新建应用"
        actions={
          <>
            <button onClick={() => setOpen(false)} className={btnOutline}>取消</button>
            <button onClick={handleCreate} className={btnPrimary}>创建</button>
          </>
        }
      >
        {formFields}
      </Modal>

      <Modal
        open={editingApp !== null}
        onClose={() => { setEditingApp(null); resetForm(); }}
        title="编辑应用"
        actions={
          <>
            <button onClick={() => { setEditingApp(null); resetForm(); }} className={btnOutline}>取消</button>
            <button onClick={handleUpdate} className={btnPrimary}>保存</button>
            {editingApp && (
              <button
                onClick={() => { onRegenerateSecret(editingApp.id, editingApp.client_id); setEditingApp(null); resetForm(); }}
                className="rounded-lg px-3 py-2 text-xs font-medium text-danger hover:bg-danger-light"
              >
                重新生成密钥
              </button>
            )}
          </>
        }
      >
        {formFields}
      </Modal>
    </div>
  );
}

function UsersView({
  users,
  onToggleStatus,
}: {
  users: User[];
  onToggleStatus: (userId: number, currentStatus: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.display_name ?? "").toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Card>
      <SectionHeader title="全局用户" description="管理 Passport 注册用户状态" />
      <div className="relative mx-5 mb-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className={cn(inputCls, "max-w-xs pl-9")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索邮箱或名称…"
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyBlock text="暂无用户" />
      ) : (
        <div className="overflow-x-auto px-5">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">邮箱</th>
                <th className="px-4 py-3">显示名</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((user) => (
                <tr key={user.id} className="bg-white hover:bg-slate-50">
                  <td className="px-4 py-5 font-medium text-slate-900">{user.email}</td>
                  <td className="px-4 py-5 text-slate-500">{user.display_name ?? "-"}</td>
                  <td className="px-4 py-5">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="px-4 py-5">
                    <button
                      onClick={() => onToggleStatus(user.id, user.status)}
                      className={cn(
                        "inline-flex h-8 items-center justify-center rounded-xl border px-3 text-xs font-semibold whitespace-nowrap transition",
                        user.status === "active"
                          ? "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100"
                          : "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100",
                      )}
                    >
                      {user.status === "active" ? "禁用" : "启用"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ─── App Detail Sub-Views ──────────────────────────────────── */

function AppDetailLayout({
  app,
  activeTab,
  onTabChange,
  onBack,
  children,
}: {
  app: Application;
  activeTab: ViewKey;
  onTabChange: (key: ViewKey) => void;
  onBack: () => void;
  children: React.ReactNode;
}) {
  const tabs: { key: ViewKey; label: string; icon: React.ElementType }[] = [
    { key: "login-methods", label: "登录方式", icon: Key },
    { key: "secrets", label: "密钥管理", icon: Shield },
    { key: "roles", label: "角色", icon: Shield },
    { key: "permissions", label: "权限", icon: Key },
    { key: "app-users", label: "应用用户", icon: Users },
  ];
  return (
    <div className="space-y-5">
      <button onClick={onBack} className={cn(btnOutline, "text-xs gap-1.5")}>
        <ArrowLeft size={14} /> 返回应用列表
      </button>
      <Card className="overflow-hidden p-0">
        <div className="bg-gradient-to-r from-brand to-brand-dark px-6 py-5 text-white">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
              <Globe size={28} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold truncate">{app.name}</h2>
                <StatusBadge status={app.status} />
              </div>
              <p className="mt-1 text-sm text-white/70">{app.description ?? "暂无描述"}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs">
                  <Link2 size={12} />
                  <code className="font-mono">{app.client_id}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(app.client_id)}
                    className="ml-1 rounded p-0.5 hover:bg-white/20 transition-colors"
                    title="复制"
                  >
                    <Copy size={11} className="text-white/70" />
                  </button>
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs">
                  <Users size={12} />
                  {app.enable_public_users ? "公共用户池" : "私有用户池"}
                </span>
                {app.enable_sso && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs">
                    <Shield size={12} />
                    SSO 已开启
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="border-b border-slate-200 px-5 pt-3">
          <div className="flex gap-1">
            {tabs.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => onTabChange(tab.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors",
                    activeTab === tab.key
                      ? "bg-[#f6f7f8] text-[#1a73e8] border-b-2 border-[#1a73e8] -mb-px"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
                  )}
                >
                  <TabIcon size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-5">{children}</div>
      </Card>
    </div>
  );
}

const METHOD_ICONS: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  email_code: { icon: Mail, color: "text-blue-600", bg: "bg-blue-50" },
  wechat: { icon: MessageCircle, color: "text-green-600", bg: "bg-green-50" },
  google: { icon: Globe, color: "text-red-500", bg: "bg-red-50" },
  github: { icon: Key, color: "text-gray-800", bg: "bg-gray-100" },
};

function SecretsView({
  appId,
  token,
  version,
  onRegenerate,
  onDelete,
}: {
  appId: number;
  token: string;
  version: number;
  onRegenerate: () => void;
  onDelete: (secretId: number) => void;
}) {
  const [secrets, setSecrets] = useState<ClientSecretItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await request<ClientSecretItem[]>(
        `/applications/${appId}/secrets`,
        token,
      );
      setSecrets(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [appId, version]);

  if (loading) return <div className="py-8 text-center text-sm text-muted">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm text-slate-500">
          <Info size={14} className="mr-1.5 inline-block align-[-2px]" />
          客户端密钥用于后端 Token 交换，请妥善保管。密钥明文仅在创建时展示一次。
        </p>
        <button onClick={onRegenerate} className={cn(btnOutline, "text-xs gap-1.5 text-brand border-brand/30 hover:bg-brand-light")}>
          <RefreshCw size={14} /> 生成新密钥
        </button>
      </div>
      {secrets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted">
          暂无密钥，请点击上方"生成新密钥"
        </div>
      ) : (
        <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200">
          {secrets.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-3.5">
              <div>
                <p className="text-sm font-mono text-slate-500">
                  {s.secret_prefix && s.secret_suffix
                    ? `${s.secret_prefix}••••••••••••${s.secret_suffix}`
                    : "••••••••••••••••••••••••••••••"}
                  <span className="ml-2 text-xs text-slate-400">#{s.id}</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  创建于 {new Date(s.created_at).toLocaleString("zh-CN")}
                </p>
              </div>
              <button
                onClick={() => { if (window.confirm("确定删除该密钥？删除后使用该密钥的系统将无法完成 Token 交换。")) onDelete(s.id); }}
                className="rounded-md px-2.5 py-1 text-xs text-red-500 hover:bg-red-50"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LoginMethodsView({
  appId,
  token,
  onLoad,
}: {
  appId: number;
  token: string;
  onLoad: () => void;
}) {
  const [methods, setMethods] = useState<LoginMethod[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await request<LoginMethod[]>(
        `/applications/${appId}/login-methods`,
        token,
      );
      setMethods(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [appId]);

  async function toggle(method: LoginMethod) {
    await request(`/applications/${appId}/login-methods`, token, {
      method: "POST",
      body: JSON.stringify({ method: method.method, enabled: !method.enabled }),
    });
    await load();
    onLoad();
  }

  async function addMethod(method: string) {
    await request(`/applications/${appId}/login-methods`, token, {
      method: "POST",
      body: JSON.stringify({ method, enabled: true }),
    });
    await load();
    onLoad();
  }

  const allMethods = ["email_code", "email_password", "wechat", "google", "github"];
  const existingKeys = new Set(methods.map((m) => m.method));
  const missing = allMethods.filter((m) => !existingKeys.has(m));

  if (loading) return <div className="py-8 text-center text-sm text-muted">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm text-slate-500">
          <Info size={14} className="mr-1.5 inline-block align-[-2px]" />
          管理该应用支持的登录方式，已启用的方式将在登录页展示。
        </p>
        {missing.length > 0 && (
          <select
            className="rounded-lg border border-brand/30 bg-white px-3 py-1.5 text-sm text-brand outline-none hover:border-brand focus:ring-2 focus:ring-brand/20"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) addMethod(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              添加方式…
            </option>
            {missing.map((m) => (
              <option key={m} value={m}>
                {methodLabel(m)}
              </option>
            ))}
          </select>
        )}
      </div>
      {methods.length === 0 ? (
        <EmptyBlock text="暂未配置登录方式，请点击右上角添加" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {methods.map((m) => {
            const meta = METHOD_ICONS[m.method] ?? { icon: Key, color: "text-muted", bg: "bg-surface" };
            const MethodIcon = meta.icon;
            return (
              <div
                key={m.id}
                className={cn(
                  "group rounded-2xl border p-5 transition-all",
                  m.enabled
                    ? "border-brand/30 bg-brand-light/30"
                    : "border-slate-200 bg-white opacity-60",
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", meta.bg)}>
                      <MethodIcon size={20} className={meta.color} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{methodLabel(m.method)}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">{methodDescription(m.method)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggle(m)}
                    className={cn(
                      "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                      m.enabled ? "bg-brand" : "bg-gray-300",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                        m.enabled && "translate-x-5",
                      )}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RolesView({
  appId,
  token,
  onLoad,
}: {
  appId: number;
  token: string;
  onLoad: () => void;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await request<Role[]>(`/applications/${appId}/roles`, token);
      setRoles(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [appId]);

  async function create() {
    if (!code.trim() || !name.trim()) return;
    await request(`/applications/${appId}/roles`, token, {
      method: "POST",
      body: JSON.stringify({
        code: code.trim(),
        name: name.trim(),
        description: desc.trim() || null,
        is_default: isDefault,
      }),
    });
    setCode("");
    setName("");
    setDesc("");
    setIsDefault(false);
    setOpen(false);
    await load();
    onLoad();
  }

  if (loading) return <div className="py-8 text-center text-sm text-muted">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">管理应用内的角色，角色可关联权限并分配给用户。</p>
        <button onClick={() => setOpen(true)} className={btnPrimary}>
          <Plus size={16} /> 新建角色
        </button>
      </div>
      {roles.length === 0 ? (
        <EmptyBlock text="暂无角色，点击右上角创建" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <div
              key={role.id}
              className={cn(
                "rounded-2xl border p-5 transition-all hover:shadow-md",
                role.is_default ? "border-brand/30 bg-brand-light/20" : "border-slate-200 bg-white",
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  role.is_default ? "bg-brand text-white" : "bg-slate-100 text-slate-400",
                )}>
                  <Shield size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 truncate">{role.name}</span>
                    {role.is_default && (
                      <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs text-white font-medium">
                        默认
                      </span>
                    )}
                  </div>
                  <div className="mt-1">
                    <code className="text-xs text-slate-500">{role.code}</code>
                  </div>
                </div>
              </div>
              {role.description && (
                <p className="mt-3 text-xs leading-relaxed text-slate-500">{role.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="新建角色"
        actions={
          <>
            <button onClick={() => setOpen(false)} className={btnOutline}>取消</button>
            <button onClick={create} className={btnPrimary}>创建</button>
          </>
        }
      >
        <Field label="角色标识 (code)">
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="admin" />
        </Field>
        <Field label="角色名称">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="管理员" />
        </Field>
        <Field label="描述">
          <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="可选" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          设为默认角色
        </label>
      </Modal>
    </div>
  );
}

function PermissionsView({
  appId,
  token,
  onLoad,
}: {
  appId: number;
  token: string;
  onLoad: () => void;
}) {
  const [perms, setPerms] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [selRole, setSelRole] = useState("");
  const [selPerm, setSelPerm] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([
        request<Permission[]>(`/applications/${appId}/permissions`, token),
        request<Role[]>(`/applications/${appId}/roles`, token),
      ]);
      setPerms(p);
      setRoles(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [appId]);

  async function create() {
    if (!code.trim() || !name.trim()) return;
    await request(`/applications/${appId}/permissions`, token, {
      method: "POST",
      body: JSON.stringify({
        code: code.trim(),
        name: name.trim(),
        description: desc.trim() || null,
      }),
    });
    setCode("");
    setName("");
    setDesc("");
    setOpen(false);
    await load();
    onLoad();
  }

  async function assignPerm() {
    if (!selRole || !selPerm) return;
    await request(
      `/applications/${appId}/roles/${selRole}/permissions/${selPerm}`,
      token,
      { method: "POST" },
    );
    setSelRole("");
    setSelPerm("");
    setAssignOpen(false);
    await load();
  }

  if (loading) return <div className="py-8 text-center text-sm text-muted">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">定义细粒度权限，并将其分配给角色。</p>
        <div className="flex gap-2">
          <button onClick={() => setAssignOpen(true)} className={btnOutline}>
            分配权限
          </button>
          <button onClick={() => setOpen(true)} className={btnPrimary}>
            <Plus size={16} /> 新建权限
          </button>
        </div>
      </div>
      {perms.length === 0 ? (
        <EmptyBlock text="暂无权限" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">标识</th>
                <th className="px-4 py-3">描述</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {perms.map((p) => (
                <tr key={p.id} className="bg-white hover:bg-slate-50">
                  <td className="px-4 py-5 font-medium text-slate-900">{p.name}</td>
                  <td className="px-4 py-5">
                    <code className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-500">{p.code}</code>
                  </td>
                  <td className="px-4 py-5 text-slate-500">{p.description ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="新建权限"
        actions={
          <>
            <button onClick={() => setOpen(false)} className={btnOutline}>取消</button>
            <button onClick={create} className={btnPrimary}>创建</button>
          </>
        }
      >
        <Field label="权限标识 (code)">
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="users:read" />
        </Field>
        <Field label="权限名称">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="查看用户" />
        </Field>
        <Field label="描述">
          <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="可选" />
        </Field>
      </Modal>

      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="分配权限到角色"
        actions={
          <>
            <button onClick={() => setAssignOpen(false)} className={btnOutline}>取消</button>
            <button onClick={assignPerm} className={btnPrimary}>分配</button>
          </>
        }
      >
        <Field label="选择角色">
          <select className={inputCls} value={selRole} onChange={(e) => setSelRole(e.target.value)}>
            <option value="">请选择…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
            ))}
          </select>
        </Field>
        <Field label="选择权限">
          <select className={inputCls} value={selPerm} onChange={(e) => setSelPerm(e.target.value)}>
            <option value="">请选择…</option>
            {perms.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </Field>
      </Modal>
    </div>
  );
}

function AppUsersView({
  appId,
  token,
}: {
  appId: number;
  token: string;
}) {
  const [members, setMembers] = useState<ApplicationUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [m, r] = await Promise.all([
        request<ApplicationUser[]>(`/applications/${appId}/users`, token),
        request<Role[]>(`/applications/${appId}/roles`, token),
      ]);
      setMembers(m);
      setRoles(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [appId]);

  async function toggleStatus(userId: number, currentStatus: string) {
    await request(`/applications/${appId}/users/${userId}/status`, token, {
      method: "PATCH",
      body: JSON.stringify({ status: currentStatus === "active" ? "disabled" : "active" }),
    });
    await load();
  }

  async function assignRole() {
    if (!userId || !roleId) return;
    await request(
      `/applications/${appId}/users/${userId}/roles/${roleId}`,
      token,
      { method: "POST" },
    );
    setUserId("");
    setRoleId("");
    setAssignOpen(false);
    await load();
  }

  if (loading) return <div className="py-8 text-center text-sm text-muted">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">已加入此应用的用户列表，可管理角色和状态。</p>
        <button onClick={() => setAssignOpen(true)} className={btnPrimary}>
          <Plus size={16} /> 分配角色
        </button>
      </div>
      {members.length === 0 ? (
        <EmptyBlock text="暂无用户加入此应用" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">邮箱</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3">权限</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {members.map((m) => (
                <tr key={m.id} className="bg-white hover:bg-slate-50">
                  <td className="px-4 py-5 align-middle">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand text-xs font-semibold">
                        {(m.user_display_name ?? m.user_email ?? "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{m.user_display_name ?? "-"}</p>
                        <p className="mt-0.5 text-xs text-slate-500">ID: {m.user_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-5 text-slate-500 align-middle">{m.user_email}</td>
                  <td className="px-4 py-5 align-middle"><StatusBadge status={m.status} /></td>
                  <td className="px-4 py-5 align-middle">
                    <div className="flex flex-wrap gap-1">
                      {m.roles.length > 0
                        ? m.roles.map((r) => (
                            <span key={r} className="rounded-md bg-brand-light px-2 py-0.5 text-xs font-medium text-brand">{r}</span>
                          ))
                        : <span className="text-xs text-slate-400">-</span>}
                    </div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="flex flex-wrap gap-1">
                      {m.permissions.length > 0
                        ? m.permissions.slice(0, 3).map((p) => (
                            <span key={p} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{p}</span>
                          ))
                        : <span className="text-xs text-slate-400">-</span>}
                      {m.permissions.length > 3 && (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">+{m.permissions.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <button
                      onClick={() => toggleStatus(m.user_id, m.status)}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        m.status === "active"
                          ? "bg-danger-light text-danger hover:bg-danger hover:text-white"
                          : "bg-success-light text-success hover:bg-success hover:text-white",
                      )}
                    >
                      {m.status === "active" ? "禁用" : "启用"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="为用户分配角色"
        actions={
          <>
            <button onClick={() => setAssignOpen(false)} className={btnOutline}>取消</button>
            <button onClick={assignRole} className={btnPrimary}>分配</button>
          </>
        }
      >
        <Field label="用户 ID">
          <input
            type="number"
            className={inputCls}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="输入用户 ID"
          />
        </Field>
        <Field label="选择角色">
          <select className={inputCls} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">请选择…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
            ))}
          </select>
        </Field>
      </Modal>
    </div>
  );
}

/* ─── Main App ──────────────────────────────────────────────── */

export default function App() {
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem("accessToken"));
  const [_refreshToken, setRefreshToken] = useState<string | null>(localStorage.getItem("refreshToken"));

  const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem("userEmail"));
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [secretModal, setSecretModal] = useState<{ clientId: string; clientSecret: string } | null>(null);
  const [secretsVersion, setSecretsVersion] = useState(0);

  const [applications, setApplications] = useState<Application[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(false);

  const toast = useCallback((message: string, type: "error" | "success" = "error") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("userEmail");
    const redirectUri = window.location.origin + window.location.pathname;
    window.location.href = buildAuthorizeUrl(redirectUri);
  }, []);

  const load = useCallback(async (token?: string | null) => {
    const t = token ?? accessToken;
    if (!t) return;
    setLoading(true);
    try {
      const [apps, userList] = await Promise.all([
        request<Application[]>("/applications", t),
        request<User[]>("/users", t),
      ]);
      setApplications(apps);
      setUsers(userList);
      setAuthenticated(true);
    } catch (err) {
      clearAuth();
      toast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, toast, clearAuth]);

  useEffect(() => {
    // Handle OAuth callback: check for ?code= in URL
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      // Clean the URL
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
      // Exchange code for tokens
      request<TokenExchangeResponse>("/token-exchange", null, {
        method: "POST",
        body: JSON.stringify({ code, redirect_uri: cleanUrl }),
      })
        .then((data) => {
          setAccessToken(data.access_token);
          setRefreshToken(data.refresh_token);
          setUserEmail(data.user.email);
          localStorage.setItem("accessToken", data.access_token);
          localStorage.setItem("refreshToken", data.refresh_token);
          localStorage.setItem("userEmail", data.user.email);
          setAuthenticated(true);
          setAuthChecked(true);
          load(data.access_token);
        })
        .catch((err) => {
          toast((err as Error).message);
          setAuthChecked(true);
        });
      return;
    }
    // Restore session from localStorage
    if (accessToken) {
      load().catch(() => clearAuth());
    } else {
      // Not logged in — redirect to Passport login
      const redirectUri = window.location.origin + window.location.pathname;
      window.location.href = buildAuthorizeUrl(redirectUri);
      return;
    }
    setAuthChecked(true);
  }, []);

  const navigate = useCallback(
    (key: ViewKey) => {
      setView(key);
      setSidebarOpen(false);
    },
    [],
  );

  function openAppDetail(app: Application) {
    setSelectedApp(app);
    setView("login-methods");
    setSidebarOpen(false);
  }

  function backToApps() {
    setSelectedApp(null);
    setView("applications");
  }

  async function createApplication(name: string, redirectUris: string[], enableSSO: boolean, enablePublicUsers: boolean, description?: string) {
    const created = await request<ApplicationCreated>("/applications", accessToken, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description || null,
        redirect_uris: redirectUris.length > 0 ? redirectUris : [],
        enable_public_users: enablePublicUsers,
        enable_sso: enableSSO,
      }),
    });
    setSecretModal({ clientId: created.client_id, clientSecret: created.client_secret });
    toast(`应用「${name}」创建成功`, "success");
  }

  async function updateApplication(id: number, data: { name?: string; description?: string | null; redirect_uris?: string[]; enable_sso?: boolean; enable_public_users?: boolean; status?: string }) {
    await request(`/applications/${id}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    toast("应用已更新", "success");
    await load();
    const app = applications.find((a) => a.id === id);
    if (app && app === selectedApp) {
      setSelectedApp(app);
    }
  }

  async function regenerateSecret(appId: number, clientId: string) {
    const data = await request<{ client_secret: string }>(`/applications/${appId}/regenerate-secret`, accessToken, { method: "POST" });
    setSecretModal({ clientId, clientSecret: data.client_secret });
    setSecretsVersion((v) => v + 1);
  }

  async function deleteSecret(appId: number, secretId: number) {
    await request(`/applications/${appId}/secrets/${secretId}`, accessToken, { method: "DELETE" });
    toast("密钥已删除", "success");
    setSecretsVersion((v) => v + 1);
  }

  async function toggleUserStatus(userId: number, currentStatus: string) {
    try {
      await request(`/users/${userId}/status`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ status: currentStatus === "active" ? "disabled" : "active" }),
      });
      toast("用户状态已更新", "success");
      await load();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  const viewMeta: Record<ViewKey, { title: string; subtitle: string; icon: React.ElementType }> = {
    dashboard: { title: "仪表盘", subtitle: "系统概览与统计数据", icon: LayoutDashboard },
    applications: { title: "应用管理", subtitle: "管理 OAuth 接入系统", icon: Globe },
    users: { title: "用户管理", subtitle: "管理全局用户状态", icon: Users },
    "login-methods": { title: "登录方式", subtitle: "配置应用的登录方式", icon: Key },
    secrets: { title: "密钥管理", subtitle: "管理应用的密钥", icon: Shield },
    roles: { title: "角色管理", subtitle: "管理应用角色", icon: List },
    permissions: { title: "权限管理", subtitle: "管理应用权限与角色分配", icon: Key },
    "app-users": { title: "应用用户", subtitle: "管理应用用户与角色", icon: Users },
  };

  const currentView = viewMeta[view] ?? viewMeta.dashboard;

  if (!authenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#f6f7f8] text-slate-900">
      <div
        className={cn(
          "min-h-screen md:grid",
          sidebarCollapsed ? "md:grid-cols-[88px_minmax(0,1fr)]" : "md:grid-cols-[272px_minmax(0,1fr)]",
        )}
      >
        <aside
          className={cn(
            "border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r",
            sidebarCollapsed && "md:px-0",
          )}
        >
          <div className="flex items-center justify-between px-4 py-4 md:px-5">
            <div className={cn("min-w-0", sidebarCollapsed && "md:hidden")}>
              <div className="truncate whitespace-nowrap text-[1.15rem] leading-tight font-bold text-slate-950">
                Passport 管理台
              </div>
              <div className="mt-2 text-sm text-slate-500">统一认证管理</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 md:hidden"
                onClick={() => setSidebarOpen((v) => !v)}
              >
                {sidebarOpen ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
              </button>
              <button
                type="button"
                className="hidden size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 md:inline-flex"
                onClick={() => setSidebarCollapsed((v) => !v)}
              >
                {sidebarCollapsed ? <ChevronRight className="size-5" /> : <ChevronLeft className="size-5" />}
              </button>
            </div>
          </div>

          <div className={cn("border-t border-slate-100 px-3 pb-4 pt-3 md:border-t-0", !sidebarOpen && "hidden md:block")}>
            <div className={cn("mb-3 px-3 text-xs font-semibold tracking-[0.14em] text-slate-400", sidebarCollapsed && "md:hidden")}>
              管理导航
            </div>
            <nav className="grid gap-1.5">
              {NAV_ITEMS.map((item) => (
                <SidebarItem
                  key={item.key}
                  active={item.key === view || (item.key === "applications" && !!selectedApp)}
                  icon={item.icon}
                  label={item.label}
                  collapsed={sidebarCollapsed}
                  onClick={() => { navigate(item.key); setSidebarOpen(false); }}
                />
              ))}
            </nav>

            {selectedApp && (
              <>
                <div className="my-5 border-t border-slate-200" />
                <div className={cn("mb-3 px-3 text-xs font-semibold tracking-[0.14em] text-slate-400", sidebarCollapsed && "md:hidden")}>
                  当前应用
                </div>
                <button
                  type="button"
                  onClick={() => openAppDetail(selectedApp)}
                  className={cn(
                    "flex h-14 w-full items-center gap-3 rounded-2xl px-4 text-left text-[1.05rem] font-medium transition",
                    sidebarCollapsed ? "justify-center md:px-0" : "",
                    "text-slate-700 hover:bg-slate-50",
                  )}
                  title={sidebarCollapsed ? selectedApp.name : undefined}
                >
                  <span className="shrink-0 text-[#1a73e8]"><Globe className="size-5" /></span>
                  {!sidebarCollapsed && <span className="truncate">{selectedApp.name}</span>}
                </button>
              </>
            )}

            <div className="my-5 border-t border-slate-200" />
            <button
              type="button"
              onClick={clearAuth}
              className={cn(
                "flex h-14 w-full items-center gap-3 rounded-2xl px-4 text-left text-[1.05rem] font-medium transition",
                sidebarCollapsed ? "justify-center md:px-0" : "",
                "text-slate-700 hover:bg-slate-50",
              )}
              title={sidebarCollapsed ? "退出登录" : undefined}
            >
              <span className="shrink-0 text-slate-700"><LogOut className="size-5" /></span>
              {!sidebarCollapsed && <span>退出登录</span>}
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur md:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <currentView.icon className="size-6 text-[#1a73e8]" />
                  <h1 className="text-[2rem] leading-none font-bold text-slate-950">{currentView.title}</h1>
                </div>
                <div className="mt-2 text-sm text-slate-500">{currentView.subtitle}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => load()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                >
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                  刷新
                </button>
              </div>
            </div>
          </header>

          <main className="space-y-5 p-4 md:p-6">
          {view === "dashboard" && (
            <DashboardView applications={applications} users={users} onNavigate={navigate} onSelectApp={openAppDetail} />
          )}
          {view === "applications" && (
            <ApplicationsView
              applications={applications}
              onLoad={load}
              onCreate={(name, uris, sso, pub, desc) => createApplication(name, uris, sso, pub, desc).catch((e) => toast(e.message))}
              onUpdate={updateApplication}
              onRegenerateSecret={regenerateSecret}
              onDeleteSecret={deleteSecret}
              onSelect={openAppDetail}
            />
          )}
          {view === "users" && (
            <UsersView users={users} onToggleStatus={toggleUserStatus} />
          )}
          {selectedApp && view === "login-methods" && (
            <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps}>
              <LoginMethodsView appId={selectedApp.id} token={accessToken ?? ""} onLoad={load} />
            </AppDetailLayout>
          )}
          {selectedApp && view === "secrets" && (
            <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps}>
              <SecretsView
                appId={selectedApp.id}
                token={accessToken ?? ""}
                version={secretsVersion}
                onRegenerate={() => regenerateSecret(selectedApp.id, selectedApp.client_id)}
                onDelete={(secretId) => deleteSecret(selectedApp.id, secretId)}
              />
            </AppDetailLayout>
          )}
          {selectedApp && view === "roles" && (
            <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps}>
              <RolesView appId={selectedApp.id} token={accessToken ?? ""} onLoad={load} />
            </AppDetailLayout>
          )}
          {selectedApp && view === "permissions" && (
            <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps}>
              <PermissionsView appId={selectedApp.id} token={accessToken ?? ""} onLoad={load} />
            </AppDetailLayout>
          )}
          {selectedApp && view === "app-users" && (
            <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps}>
              <AppUsersView appId={selectedApp.id} token={accessToken ?? ""} />
            </AppDetailLayout>
          )}
        </main>
        </div>
      </div>

      <ToastContainer items={toasts} />
      {secretModal && <SecretModal clientId={secretModal.clientId} clientSecret={secretModal.clientSecret} onClose={() => setSecretModal(null)} />}
    </div>
  );
}
