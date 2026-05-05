import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Shield,
  Users,
} from "lucide-react";
import type {
  Application,
  ApplicationCreated,
  TokenExchangeResponse,
  User,
  ViewKey,
} from "./types";
import { request, buildAuthorizeUrl } from "./lib/api";
import { tokenResponseSchema } from "./lib/schemas";
import { cn } from "./lib/utils";
import { SecretModal } from "./components/ui";
import DashboardView from "./views/DashboardView";
import ApplicationsView from "./views/ApplicationsView";
import UsersView from "./views/UsersView";
import AppDetailLayout from "./views/AppDetailLayout";
import SecretsView from "./views/app-detail/SecretsView";
import LoginMethodsView from "./views/app-detail/LoginMethodsView";
import RolesView from "./views/app-detail/RolesView";
import PermissionsView from "./views/app-detail/PermissionsView";
import AppUsersView from "./views/app-detail/AppUsersView";

/* ─── View metadata ────────────────────────────────── */

const viewMeta: Record<string, { title: string; subtitle: string; icon: React.ElementType }> = {
  dashboard: { title: "仪表盘", subtitle: "系统概览与统计数据", icon: LayoutDashboard },
  applications: { title: "应用管理", subtitle: "管理 OAuth 接入系统", icon: Globe },
  users: { title: "用户管理", subtitle: "管理全局用户状态", icon: Users },
  "login-methods": { title: "登录方式", subtitle: "配置应用的登录方式", icon: Shield },
  secrets: { title: "密钥管理", subtitle: "管理应用密钥", icon: Shield },
  roles: { title: "角色", subtitle: "管理应用角色", icon: Shield },
  permissions: { title: "权限", subtitle: "管理应用权限与角色分配", icon: Shield },
  "app-users": { title: "应用用户", subtitle: "管理应用用户与角色", icon: Users },
};

/* ─── Toast ────────────────────────────────────────── */

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
            "toast-enter rounded-2xl px-4 py-3 text-sm font-medium shadow-lg",
            t.type === "success" ? "bg-slate-900 text-white" : "bg-brand text-white",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ─── Sidebar ──────────────────────────────────────── */

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
      <span className="shrink-0 text-slate-700"><Icon size={20} /></span>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

/* ─── Main App ─────────────────────────────────────── */

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [secretModal, setSecretModal] = useState<{ clientId: string; clientSecret: string } | null>(null);
  const [secretsVersion, setSecretsVersion] = useState(0);

  const [applications, setApplications] = useState<Application[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);

  const toast = useCallback((message: string, type: "error" | "success" = "error") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userRoles");
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
      const [appsRes, usersRes] = await Promise.all([
        request<{ items: Application[]; total: number }>("/applications", t),
        request<{ items: User[]; total: number }>("/users", t),
      ]);
      setApplications(appsRes.items);
      setUsers(usersRes.items);
      setAuthenticated(true);
    } catch (err) {
      clearAuth();
      toast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, toast, clearAuth]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
      request<TokenExchangeResponse>("/token-exchange", null, {
        method: "POST",
        body: JSON.stringify({ code, redirect_uri: cleanUrl }),
      })
        .then((data) => {
          if (cancelled) return;
          const result = tokenResponseSchema.safeParse(data);
          if (!result.success) {
            if (import.meta.env.DEV) console.error("Invalid token response:", result.error);
            return;
          }
          setAccessToken(data.access_token);
          setUserEmail(data.user.email);
          localStorage.setItem("userRoles", JSON.stringify(data.roles));
          setUserRoles(data.roles);
          setAuthenticated(true);
          setAuthChecked(true);
          load(data.access_token);
        })
        .catch((err) => {
          if (cancelled) return;
          toast((err as Error).message);
          setAuthChecked(true);
        });
      return () => { cancelled = true; };
    }
    const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
    fetch(`${API_BASE}/token-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error("refresh failed");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const result = tokenResponseSchema.safeParse(data);
        if (!result.success) {
          if (import.meta.env.DEV) console.error("Invalid token response:", result.error);
          const redirectUri = window.location.origin + window.location.pathname;
          window.location.href = buildAuthorizeUrl(redirectUri);
          return;
        }
        setAccessToken(data.access_token);
        setUserEmail(data.user.email);
        setUserRoles(data.roles);
        localStorage.setItem("userRoles", JSON.stringify(data.roles));
        setAuthenticated(true);
        setAuthChecked(true);
        load(data.access_token);
      })
      .catch(() => {
        if (cancelled) return;
        const redirectUri = window.location.origin + window.location.pathname;
        window.location.href = buildAuthorizeUrl(redirectUri);
      });
    return () => { cancelled = true; };
  }, []);

  const navigate = useCallback(
    (key: ViewKey) => {
      setView(key);
      setMobileSidebarOpen(false);
    },
    [],
  );

  function openAppDetail(app: Application) {
    setSelectedApp(app);
    setView("login-methods");
    setMobileSidebarOpen(false);
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
    setSelectedApp((prev) => {
      if (!prev || prev.id !== id) return prev;
      const fresh = applications.find((a) => a.id === id);
      return fresh ?? prev;
    });
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

  const currentMeta = viewMeta[view] ?? { title: selectedApp?.name ?? "", subtitle: "", icon: Globe };

  return (
    <div className="min-h-screen bg-surface text-slate-900">
      {loading && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-transparent">
          <div className="h-full w-1/3 animate-[loading_1.2s_ease-in-out_infinite] rounded-r-full bg-brand" />
        </div>
      )}

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-30 bg-slate-950/35 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />
      )}

      <div
        className={cn(
          "min-h-screen md:grid",
          sidebarCollapsed ? "md:grid-cols-[88px_minmax(0,1fr)]" : "md:grid-cols-[272px_minmax(0,1fr)]",
        )}
      >
        {/* ─── Sidebar ──────────────────────────────── */}
        <aside
          className={cn(
            "border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r",
            sidebarCollapsed && "md:px-0",
            mobileSidebarOpen ? "fixed inset-y-0 left-0 z-40 w-72 border-r border-slate-200" : "hidden md:block",
          )}
        >
          <div className="flex items-center justify-between px-4 py-4 md:px-5">
            <div className={cn("min-w-0", sidebarCollapsed && "md:hidden")}>
              <div className="flex items-center gap-2.5 truncate whitespace-nowrap text-[1.15rem] leading-tight font-bold text-slate-950">
                <Shield size={22} className="shrink-0 text-brand" />
                Passport
              </div>
              <div className="mt-2 text-sm text-slate-500">统一认证管理台</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 md:hidden"
                onClick={() => setMobileSidebarOpen(false)}
              >
                <ChevronLeft className="size-5" />
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

          {authenticated && userEmail && (
            <div className={cn("px-5 pb-3 text-sm text-slate-500", sidebarCollapsed && "md:hidden")}>
              {userEmail}
            </div>
          )}

          <div className={cn("border-t border-slate-100 px-3 pb-4 pt-3 md:border-t-0", !mobileSidebarOpen && "hidden md:block", mobileSidebarOpen && "!block")}>
            <div className={cn("mb-3 px-3 text-xs font-semibold tracking-[0.14em] text-slate-400", sidebarCollapsed && "md:hidden")}>
              管理导航
            </div>
            <nav className="grid gap-1.5">
              {NAV_ITEMS.map((item) => (
                <SidebarItem
                  key={item.key}
                  active={
                    item.key === view ||
                    (item.key === "applications" && !!selectedApp)
                  }
                  icon={item.icon}
                  label={item.label}
                  collapsed={sidebarCollapsed}
                  onClick={() => navigate(item.key)}
                />
              ))}
              {selectedApp && (
                <button
                  type="button"
                  onClick={() => openAppDetail(selectedApp)}
                  className={cn(
                    "flex h-14 items-center gap-3 rounded-2xl px-4 text-left text-[1.05rem] font-medium transition",
                    sidebarCollapsed ? "justify-center md:px-0" : "",
                    "bg-brand-light text-brand",
                  )}
                >
                  <Globe size={20} />
                  {!sidebarCollapsed && <span className="truncate">{selectedApp.name}</span>}
                </button>
              )}
            </nav>

            <div className="my-5 border-t border-slate-200" />

            <button
              type="button"
              onClick={clearAuth}
              className={cn(
                "flex h-14 items-center gap-3 rounded-2xl px-4 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-50",
                sidebarCollapsed && "md:justify-center md:px-0",
              )}
            >
              <LogOut size={18} />
              {!sidebarCollapsed && "退出登录"}
            </button>
          </div>
        </aside>

        {/* ─── Main content ────────────────────────── */}
        <div className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur md:px-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 lg:hidden"
                >
                  <Menu size={20} />
                </button>
                <div>
                  <div className="flex items-center gap-3">
                    <currentMeta.icon className="size-6 text-brand" />
                    <h1 className="text-[2rem] leading-none font-bold text-slate-950">{currentMeta.title}</h1>
                  </div>
                  <div className="mt-2 text-sm text-slate-500">{currentMeta.subtitle}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => load()}
                className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50"
                title="刷新数据"
              >
                <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
              </button>
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
                canCreate={isSuperAdmin}
              />
            )}
            {view === "users" && (
              <UsersView users={users} onToggleStatus={toggleUserStatus} />
            )}
            {selectedApp && view === "login-methods" && (
              <AppDetailLayout app={selectedApp} activeTab={view} onTabChange={setView} onBack={backToApps} showSecretsTab={isSuperAdmin}>
                <LoginMethodsView appId={selectedApp.id} token={accessToken ?? ""} />
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
      </div>

      <ToastContainer items={toasts} />
      {secretModal && <SecretModal clientId={secretModal.clientId} clientSecret={secretModal.clientSecret} onClose={() => setSecretModal(null)} />}
    </div>
  );
}
