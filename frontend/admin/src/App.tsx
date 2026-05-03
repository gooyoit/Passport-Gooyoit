import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
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
