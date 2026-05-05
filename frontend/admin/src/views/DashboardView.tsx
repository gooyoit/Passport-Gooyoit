import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import type { Application, User, ViewKey } from "../types";
import { Card, EmptyBlock, MetricCard, StatusBadge, ActionButton, cn } from "../components/ui";

export default function DashboardView({
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
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <MetricCard
          title="应用总数"
          value={`${applications.length}`}
          secondary={`活跃 ${activeApps}`}
          action="查看应用列表"
          onClick={() => onNavigate("applications")}
        />
        <MetricCard
          title="用户总数"
          value={`${users.length}`}
          secondary={`活跃 ${activeUsers}`}
          action="查看用户列表"
          onClick={() => onNavigate("users")}
        />
      </div>

      <Card>
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-xl font-bold text-slate-950">最近应用</h3>
            <p className="mt-1 text-sm text-slate-500">最近创建或更新的 OAuth 应用</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setAppLayout("grid")}
              className={cn(
                "rounded-xl p-2 transition-colors",
                appLayout === "grid" ? "bg-brand-light text-brand" : "text-slate-400 hover:text-slate-600",
              )}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setAppLayout("list")}
              className={cn(
                "rounded-xl p-2 transition-colors",
                appLayout === "list" ? "bg-brand-light text-brand" : "text-slate-400 hover:text-slate-600",
              )}
            >
              <List size={16} />
            </button>
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <ActionButton variant="secondary" onClick={() => onNavigate("applications")}>
              查看全部
            </ActionButton>
          </div>
        </div>
        {applications.length === 0 ? (
          <EmptyBlock text="暂无应用" />
        ) : appLayout === "grid" ? (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
            {applications.slice(0, 8).map((app) => (
              <div
                key={app.id}
                className="group cursor-pointer rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-all hover:border-brand/40 hover:shadow-sm"
                onClick={() => onSelectApp(app)}
              >
                <div className="flex items-start justify-between">
                  <p className="truncate text-sm font-semibold text-slate-900">{app.name}</p>
                  <StatusBadge status={app.status} />
                </div>
                {app.description && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-slate-500 leading-relaxed">{app.description}</p>
                )}
                <p className="mt-1.5 truncate text-xs text-slate-400">{app.client_id}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {applications.slice(0, 8).map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50"
                onClick={() => onSelectApp(app)}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{app.name}</p>
                  <p className="text-xs text-slate-500">{app.client_id}</p>
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
