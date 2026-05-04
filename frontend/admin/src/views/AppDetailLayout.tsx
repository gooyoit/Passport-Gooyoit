import { ArrowLeft, Globe, Key, Link2, Shield, Users } from "lucide-react";
import type { Application, ViewKey } from "../types";
import { Card, CopyButton, StatusBadge, btnOutline, cn } from "../components/ui";

export default function AppDetailLayout({
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
                  <CopyButton text={app.client_id} size={11} className="ml-1 !text-white/70 hover:!bg-white/20" />
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
