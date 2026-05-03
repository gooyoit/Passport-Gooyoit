import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  ChevronRight,
  Globe,
  Key,
  LayoutDashboard,
  Link2,
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

/* ─── Toast ─────────────────────────────────────────────────── */

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
}: {
  applications: Application[];
  users: User[];
  onNavigate: (key: ViewKey) => void;
}) {
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
        <SectionHeader
          title="最近应用"
          action={
            <button onClick={() => onNavigate("applications")} className={cn(btnOutline, "text-xs")}>
              查看全部
            </button>
          }
        />
        {applications.length === 0 ? (
          <EmptyBlock text="暂无应用" />
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {applications.slice(0, 5).map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface"
                onClick={() => onNavigate("app-detail")}
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
  onSelect,
}: {
  applications: Application[];
  onLoad: () => void;
  onCreate: (name: string, redirectUris: string[]) => void;
  onSelect: (app: Application) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [uris, setUris] = useState("");

  function handleCreate() {
    if (!name.trim()) return;
    onCreate(name.trim(), uris.split("\n").map((s) => s.trim()).filter(Boolean));
    setName("");
    setUris("");
    setOpen(false);
    onLoad();
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title="应用列表"
          action={
            <button onClick={() => setOpen(true)} className={btnPrimary}>
              <Plus size={16} /> 新建应用
            </button>
          }
        />
        {applications.length === 0 ? (
          <EmptyBlock text="暂无应用，点击右上角创建" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">名称</th>
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
                    <td className="px-4 py-3">
                      <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">
                        {app.client_id}
                      </code>
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
                      <button
                        onClick={() => onSelect(app)}
                        className="rounded-md px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-light"
                      >
                        管理
                      </button>
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
            <button onClick={() => setOpen(false)} className={btnOutline}>
              取消
            </button>
            <button onClick={handleCreate} className={btnPrimary}>
              创建
            </button>
          </>
        }
      >
        <Field label="应用名称">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：MyApp" />
        </Field>
        <Field label="回调地址（每行一个）">
          <textarea
            className={cn(inputCls, "min-h-20 resize-y")}
            value={uris}
            onChange={(e) => setUris(e.target.value)}
            placeholder="https://example.com/callback"
          />
        </Field>
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
}: {
  app: Application;
  activeTab: ViewKey;
  onTabChange: (key: ViewKey) => void;
  onBack: () => void;
  children: React.ReactNode;
}) {
  const tabs: { key: ViewKey; label: string; icon: React.ElementType }[] = [
    { key: "login-methods", label: "登录方式", icon: Key },
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

  const allMethods = ["email_code", "wechat", "google", "github"];
  const existingKeys = new Set(methods.map((m) => m.method));
  const missing = allMethods.filter((m) => !existingKeys.has(m));

  if (loading) return <div className="py-8 text-center text-sm text-muted">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">管理该应用支持的登录方式，已启用的方式将在登录页展示。</p>
        {missing.length > 0 && (
          <select
            className={cn(inputCls, "w-auto text-sm")}
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
  const [toasts, setToasts] = useState<ToastItem[]>([]);

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
    setAccessToken(null);
    setRefreshToken(null);
    setUserEmail(null);
    setAuthenticated(false);
    setApplications([]);
    setUsers([]);
    setSelectedApp(null);
    setView("dashboard");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("userEmail");
  }, []);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [apps, userList] = await Promise.all([
        request<Application[]>("/applications", accessToken),
        request<User[]>("/users", accessToken),
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
          load();
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

  async function createApplication(name: string, redirectUris: string[]) {
    const created = await request<ApplicationCreated>("/applications", accessToken, {
      method: "POST",
      body: JSON.stringify({
        name,
        redirect_uris: redirectUris.length > 0 ? redirectUris : [],
        enable_public_users: true,
        enable_sso: true,
      }),
    });
    toast(`应用「${name}」创建成功！Client Secret: ${created.client_secret}`, "success");
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
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
              <div className="ml-3 mt-3 border-l border-gray-700 pl-3">
                <button
                  onClick={() => openAppDetail(selectedApp)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-sidebar-hover hover:text-white"
                >
                  <Globe size={16} />
                  {selectedApp.name}
                  <ChevronRight size={14} />
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
            <DashboardView applications={applications} users={users} onNavigate={navigate} />
          )}
          {view === "applications" && (
            <ApplicationsView
              applications={applications}
              onLoad={load}
              onCreate={(name, uris) => createApplication(name, uris).catch((e) => toast(e.message))}
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

      <ToastContainer items={toasts} />
    </div>
  );
}
