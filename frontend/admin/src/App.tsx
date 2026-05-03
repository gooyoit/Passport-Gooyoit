import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
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
  Menu,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Users,
  X,
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
import { cn, methodDescription, methodLabel, statusColor, statusLabel } from "./lib/utils";

/* ─── Reusable Components ──────────────────────────────────── */

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-white p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

function SectionHeader({
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

function MetricCard({
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

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", statusColor(status))}>
      {statusLabel(status)}
    </span>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="py-12 text-center text-sm text-muted">{text}</div>
  );
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
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors";
const btnPrimary = cn(btnCls, "bg-brand text-white hover:bg-brand-dark");
const btnOutline = cn(btnCls, "border border-border bg-white hover:bg-surface");

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
  onClick,
}: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-active text-white"
          : "text-gray-400 hover:bg-sidebar-hover hover:text-white",
      )}
    >
      <Icon size={18} />
      {label}
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="应用总数" value={applications.length} icon={Globe} />
        <MetricCard label="活跃应用" value={activeApps} icon={CheckCircle} color="text-success" />
        <MetricCard label="用户总数" value={users.length} icon={Users} />
        <MetricCard label="活跃用户" value={activeUsers} icon={CheckCircle} color="text-success" />
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">最近应用</h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setAppLayout("grid")}
              className={cn(
                "rounded-md p-1.5 transition-colors",
                appLayout === "grid" ? "bg-brand-light text-brand" : "text-muted hover:text-gray-600",
              )}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => setAppLayout("list")}
              className={cn(
                "rounded-md p-1.5 transition-colors",
                appLayout === "list" ? "bg-brand-light text-brand" : "text-muted hover:text-gray-600",
              )}
            >
              <List size={15} />
            </button>
            <span className="mx-1 h-4 w-px bg-border" />
            <button onClick={() => onNavigate("applications")} className={cn(btnOutline, "text-xs")}>
              查看全部
            </button>
          </div>
        </div>
        {applications.length === 0 ? (
          <EmptyBlock text="暂无应用" />
        ) : appLayout === "grid" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {applications.slice(0, 8).map((app) => (
              <div
                key={app.id}
                className="group cursor-pointer rounded-xl border border-border p-4 transition-all hover:border-brand/40 hover:shadow-sm"
                onClick={() => onSelectApp(app)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Globe size={14} className="shrink-0 text-brand" />
                    <p className="truncate text-sm font-semibold">{app.name}</p>
                  </div>
                  <StatusBadge status={app.status} />
                </div>
                {app.description && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-muted leading-relaxed">{app.description}</p>
                )}
                <p className="mt-1.5 truncate text-xs text-muted">{app.client_id}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {applications.slice(0, 8).map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface"
                onClick={() => onSelectApp(app)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light text-brand">
                    <Globe size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{app.name}</p>
                    <p className="text-xs text-muted">{app.client_id}</p>
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
  onSelect,
  canCreate,
}: {
  applications: Application[];
  onLoad: () => void;
  onCreate: (name: string, redirectUris: string[], enableSSO: boolean, enablePublicUsers: boolean, description?: string) => void;
  onUpdate: (id: number, data: { name?: string; description?: string | null; redirect_uris?: string[]; enable_sso?: boolean; enable_public_users?: boolean; status?: string }) => void;
  onRegenerateSecret: (appId: number, clientId: string) => void;
  onSelect: (app: Application) => void;
  canCreate: boolean;
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
          action={canCreate ? (
            <button onClick={() => { resetForm(); setOpen(true); }} className={btnPrimary}>
              <Plus size={16} /> 新建应用
            </button>
          ) : undefined}
        />
        {applications.length === 0 ? (
          <EmptyBlock text="暂无应用，点击右上角创建" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">名称</th>
                  <th className="px-4 py-2 font-medium">描述</th>
                  <th className="px-4 py-2 font-medium">Client ID</th>
                  <th className="px-4 py-2 font-medium">用户池</th>
                  <th className="px-4 py-2 font-medium">SSO</th>
                  <th className="px-4 py-2 font-medium">状态</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {applications.map((app) => (
                  <tr key={app.id} className="hover:bg-surface">
                    <td className="px-4 py-3 font-medium">{app.name}</td>
                    <td className="px-4 py-3 text-xs text-muted max-w-48 truncate">{app.description ?? "-"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">{app.client_id}</code>
                        <CopyButton text={app.client_id} size={12} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs">{app.enable_public_users ? "公共" : "私有"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs">{app.enable_sso ? "开启" : "关闭"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={app.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(app)}
                          className="rounded-md px-2.5 py-1 text-xs text-muted hover:bg-surface hover:text-gray-700"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => onSelect(app)}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-light"
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
      <SectionHeader title="全局用户" />
      <div className="mb-4 flex items-center gap-2">
        <Search size={16} className="text-muted" />
        <input
          className={cn(inputCls, "max-w-xs")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索邮箱或名称…"
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyBlock text="暂无用户" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">邮箱</th>
                <th className="px-4 py-2 font-medium">显示名</th>
                <th className="px-4 py-2 font-medium">状态</th>
                <th className="px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((user) => (
                <tr key={user.id} className="hover:bg-surface">
                  <td className="px-4 py-3 font-medium">{user.email}</td>
                  <td className="px-4 py-3 text-muted">{user.display_name ?? "-"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onToggleStatus(user.id, user.status)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium",
                        user.status === "active"
                          ? "bg-danger-light text-danger hover:bg-danger hover:text-white"
                          : "bg-success-light text-success hover:bg-success hover:text-white",
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
  showSecretsTab,
}: {
  app: Application;
  activeTab: ViewKey;
  onTabChange: (key: ViewKey) => void;
  onBack: () => void;
  children: React.ReactNode;
  showSecretsTab?: boolean;
}) {
  const tabs: { key: ViewKey; label: string; icon: React.ElementType }[] = [
    { key: "login-methods", label: "登录方式", icon: Key },
    ...(showSecretsTab ? [{ key: "secrets" as ViewKey, label: "密钥管理", icon: Shield }] : []),
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
        <div className="border-b border-border px-6 pt-3">
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
                      ? "bg-surface text-brand border-b-2 border-brand -mb-px"
                      : "text-muted hover:text-[#17202a] hover:bg-surface/50",
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
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface/50 px-4 py-3">
        <p className="text-sm text-muted">
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
        <div className="divide-y divide-border rounded-lg border border-border">
          {secrets.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-mono text-muted">
                  {s.secret_prefix && s.secret_suffix
                    ? `${s.secret_prefix}••••••••••••${s.secret_suffix}`
                    : "••••••••••••••••••••••••••••••"}
                  <span className="ml-2 text-xs text-muted/60">#{s.id}</span>
                </p>
                <p className="text-xs text-muted/60">
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
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface/50 px-4 py-3">
        <p className="text-sm text-muted">
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
                  "group rounded-xl border p-4 transition-all",
                  m.enabled
                    ? "border-brand/30 bg-brand-light/30"
                    : "border-border bg-white opacity-60",
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", meta.bg)}>
                      <MethodIcon size={20} className={meta.color} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{methodLabel(m.method)}</p>
                      <p className="mt-0.5 text-xs text-muted">{methodDescription(m.method)}</p>
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
                <p className={cn(
                  "mt-3 text-xs font-medium",
                  m.enabled ? "text-success" : "text-muted",
                )}>
                  {m.enabled ? "已启用" : "未启用"}
                </p>
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
        <p className="text-sm text-muted">管理应用内的角色，角色可关联权限并分配给用户。</p>
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
                "rounded-xl border p-4 transition-all hover:shadow-md",
                role.is_default ? "border-brand/30 bg-brand-light/20" : "border-border bg-white",
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  role.is_default ? "bg-brand text-white" : "bg-surface text-muted",
                )}>
                  <Shield size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate">{role.name}</span>
                    {role.is_default && (
                      <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs text-white font-medium">
                        默认
                      </span>
                    )}
                  </div>
                  <code className="mt-0.5 block text-xs text-muted">{role.code}</code>
                </div>
              </div>
              {role.description && (
                <p className="mt-2.5 text-xs text-muted leading-relaxed">{role.description}</p>
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
        <p className="text-sm text-muted">定义细粒度权限，并将其分配给角色。</p>
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
            <thead>
              <tr className="border-b border-border bg-surface/50 text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">名称</th>
                <th className="px-4 py-2.5 font-medium">标识</th>
                <th className="px-4 py-2.5 font-medium">描述</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {perms.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-surface/50">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3">
                    <code className="rounded-md bg-surface px-2 py-0.5 text-xs font-mono text-muted">{p.code}</code>
                  </td>
                  <td className="px-4 py-3 text-muted">{p.description ?? "-"}</td>
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
            {roles.filter((r) => r.code !== "super_admin").map((r) => (
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
        <p className="text-sm text-muted">已加入此应用的用户列表，可管理角色和状态。</p>
        <button onClick={() => setAssignOpen(true)} className={btnPrimary}>
          <Plus size={16} /> 分配角色
        </button>
      </div>
      {members.length === 0 ? (
        <EmptyBlock text="暂无用户加入此应用" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50 text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">用户</th>
                <th className="px-4 py-2.5 font-medium">邮箱</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">角色</th>
                <th className="px-4 py-2.5 font-medium">权限</th>
                <th className="px-4 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.id} className="transition-colors hover:bg-surface/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand text-xs font-semibold">
                        {(m.user_display_name ?? m.user_email ?? "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{m.user_display_name ?? "-"}</p>
                        <p className="text-xs text-muted">ID: {m.user_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{m.user_email}</td>
                  <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {m.roles.length > 0
                        ? m.roles.map((r) => (
                            <span key={r} className="rounded-md bg-brand-light px-2 py-0.5 text-xs font-medium text-brand">{r}</span>
                          ))
                        : <span className="text-xs text-muted">-</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {m.permissions.length > 0
                        ? m.permissions.slice(0, 3).map((p) => (
                            <span key={p} className="rounded-md bg-surface px-2 py-0.5 text-xs text-muted">{p}</span>
                          ))
                        : <span className="text-xs text-muted">-</span>}
                      {m.permissions.length > 3 && (
                        <span className="rounded-md bg-surface px-2 py-0.5 text-xs text-muted">+{m.permissions.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
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
            {roles.filter((r) => r.code !== "super_admin").map((r) => (
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
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("userRoles");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const isSuperAdmin = userRoles.includes("super_admin");

  const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem("userEmail"));
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userRoles");
    localStorage.removeItem("refreshToken");
    setUserRoles([]);
    const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
    fetch(`${API_BASE}/logout`, { method: "POST", credentials: "include" }).catch(() => {});
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
          setUserEmail(data.user.email);
          localStorage.setItem("userRoles", JSON.stringify(data.roles));
          setUserRoles(data.roles);
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
    const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
    fetch(`${API_BASE}/token-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("refresh failed");
        return res.json();
      })
      .then((data) => {
        setAccessToken(data.access_token);
        setUserEmail(data.user.email);
        setUserRoles(data.roles);
        localStorage.setItem("userRoles", JSON.stringify(data.roles));
        setAuthenticated(true);
        setAuthChecked(true);
        load(data.access_token);
      })
      .catch(() => {
        const redirectUri = window.location.origin + window.location.pathname;
        window.location.href = buildAuthorizeUrl(redirectUri);
      });
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setAccessToken(e.detail.access_token);
      if (e.detail.user?.email) setUserEmail(e.detail.user.email);
      if (e.detail.roles) {
        setUserRoles(e.detail.roles);
        localStorage.setItem("userRoles", JSON.stringify(e.detail.roles));
      }
    };
    window.addEventListener("token-refreshed", handler as EventListener);
    return () => window.removeEventListener("token-refreshed", handler as EventListener);
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

  if (!authenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-surface">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-60 bg-sidebar text-white transition-transform lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-full flex-col p-4">
          <div className="mb-6 flex items-center gap-2.5">
            <Shield size={24} className="text-brand" />
            <span className="text-lg font-bold">Passport</span>
          </div>
          {authenticated && userEmail && (
            <p className="mb-4 text-xs text-gray-500 truncate">{userEmail}</p>
          )}
          <nav className="flex-1 space-y-1">
            {NAV_ITEMS.map((item) => (
              <SidebarItem
                key={item.key}
                active={
                  item.key === view ||
                  (item.key === "applications" && !!selectedApp)
                }
                icon={item.icon}
                label={item.label}
                onClick={() => navigate(item.key)}
              />
            ))}
            {selectedApp && (
              <div className="mx-2 mt-1">
                <button
                  onClick={() => openAppDetail(selectedApp)}
                  className="flex w-full items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-sidebar-hover hover:text-white"
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand/20">
                    <Globe size={13} className="text-brand" />
                  </div>
                  <span className="truncate">{selectedApp.name}</span>
                  <ChevronRight size={14} className="ml-auto shrink-0 text-gray-500" />
                </button>
              </div>
            )}
          </nav>
          <div className="border-t border-gray-700 pt-3">
            <button
              onClick={() => {
                clearAuth();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-sidebar-hover hover:text-white"
            >
              <LogOut size={16} />
              退出登录
            </button>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border bg-white px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-1.5 hover:bg-surface lg:hidden">
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-lg font-bold">
                {view === "dashboard" && "仪表盘"}
                {view === "applications" && "应用管理"}
                {view === "users" && "用户管理"}
                {selectedApp && ["login-methods", "roles", "permissions", "app-users"].includes(view) && selectedApp.name}
              </h1>
              <p className="text-xs text-muted">
                {view === "dashboard" && "系统概览与统计数据"}
                {view === "applications" && "管理 OAuth 接入系统"}
                {view === "users" && "管理全局用户状态"}
                {view === "login-methods" && "配置应用的登录方式"}
                {view === "roles" && "管理应用角色"}
                {view === "permissions" && "管理应用权限与角色分配"}
                {view === "app-users" && "管理应用用户与角色"}
              </p>
            </div>
          </div>
          <button
            onClick={() => load()}
            className="rounded-lg p-2 hover:bg-surface"
            title="刷新数据"
          >
            <RefreshCw size={18} className={loading ? "animate-spin text-muted" : "text-muted"} />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
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
              onSelect={openAppDetail}
              canCreate={isSuperAdmin}
            />
          )}
          {view === "users" && (
            <UsersView users={users} onToggleStatus={toggleUserStatus} />
          )}
          {selectedApp && view === "login-methods" && (
            <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps} showSecretsTab={isSuperAdmin}>
              <LoginMethodsView appId={selectedApp.id} token={accessToken ?? ""} onLoad={load} />
            </AppDetailLayout>
          )}
          {selectedApp && view === "secrets" && (
            <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps} showSecretsTab={isSuperAdmin}>
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
            <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps} showSecretsTab={isSuperAdmin}>
              <RolesView appId={selectedApp.id} token={accessToken ?? ""} onLoad={load} />
            </AppDetailLayout>
          )}
          {selectedApp && view === "permissions" && (
            <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps} showSecretsTab={isSuperAdmin}>
              <PermissionsView appId={selectedApp.id} token={accessToken ?? ""} onLoad={load} />
            </AppDetailLayout>
          )}
          {selectedApp && view === "app-users" && (
            <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps} showSecretsTab={isSuperAdmin}>
              <AppUsersView appId={selectedApp.id} token={accessToken ?? ""} />
            </AppDetailLayout>
          )}
        </main>
      </div>

      <ToastContainer items={toasts} />
      {secretModal && <SecretModal clientId={secretModal.clientId} clientSecret={secretModal.clientSecret} onClose={() => setSecretModal(null)} />}
    </div>
  );
}
