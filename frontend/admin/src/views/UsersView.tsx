import { useState } from "react";
import { Search } from "lucide-react";
import type { User } from "../types";
import { Card, EmptyBlock, SectionHeader, StatusBadge, cn, inputCls } from "../components/ui";

export default function UsersView({
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
