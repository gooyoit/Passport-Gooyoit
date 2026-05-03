import { useState } from "react";
import { CheckCircle, Globe, LayoutGrid, List, Users } from "lucide-react";
import type { Application, User, ViewKey } from "../types";
import { Card, EmptyBlock, MetricCard, StatusBadge, btnOutline, cn } from "../components/ui";

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
