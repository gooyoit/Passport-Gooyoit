import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { ApplicationUser, Role } from "../../types";
import { request } from "../../lib/api";
import { EmptyBlock, Field, Modal, StatusBadge, btnPrimary, btnOutline, cn, inputCls } from "../../components/ui";

export default function AppUsersView({
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      request<{ items: ApplicationUser[]; total: number }>(`/applications/${appId}/users`, token).then(r => r.items),
      request<Role[]>(`/applications/${appId}/roles`, token),
    ])
      .then(([m, r]) => {
        if (!cancelled) {
          setMembers(m);
          setRoles(r);
        }
      })
      .catch((err) => {
        console.error("Failed to load app users:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [appId, token]);

  async function toggleStatus(userId: number, currentStatus: string) {
    await request(`/applications/${appId}/users/${userId}/status`, token, {
      method: "PATCH",
      body: JSON.stringify({ status: currentStatus === "active" ? "disabled" : "active" }),
    });
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
