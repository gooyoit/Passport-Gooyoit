import { useState } from "react";
import { Search } from "lucide-react";
import type { User } from "../types";
import { Card, EmptyBlock, SectionHeader, StatusBadge, ChipButton } from "../components/ui";

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
      <SectionHeader
        title="全局用户"
        description="管理所有注册用户的状态"
        action={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-brand sm:w-80"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索邮箱或名称…"
            />
          </div>
        }
      />
      {filtered.length === 0 ? (
        <div className="p-5"><EmptyBlock text="暂无用户" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">邮箱</th>
                <th className="px-4 py-3">显示名</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 min-w-[100px]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((user) => (
                <tr key={user.id} className="bg-white">
                  <td className="px-4 py-4 align-middle font-semibold text-slate-900">{user.email}</td>
                  <td className="px-4 py-4 align-middle text-slate-500">{user.display_name ?? "-"}</td>
                  <td className="px-4 py-4 align-middle"><StatusBadge status={user.status} /></td>
                  <td className="px-4 py-4 align-middle">
                    <ChipButton
                      danger={user.status === "active"}
                      onClick={() => onToggleStatus(user.id, user.status)}
                    >
                      {user.status === "active" ? "禁用" : "启用"}
                    </ChipButton>
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
