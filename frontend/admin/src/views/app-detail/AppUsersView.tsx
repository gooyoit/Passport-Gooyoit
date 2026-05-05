import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { ApplicationUser, Role } from "../../types";
import { request } from "../../lib/api";
import { EmptyBlock, Field, Modal, StatusBadge, ActionButton, ChipButton, btnPrimary, btnOutline } from "../../components/ui";

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

  if (loading) return <div className="py-8 text-center text-sm text-slate-400">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">已加入此应用的用户列表，可管理角色和状态。</p>
        <ActionButton variant="primary" onClick={() => setAssignOpen(true)}>
          <Plus size={16} /> 分配角色
        </ActionButton>
      </div>
      {members.length === 0 ? (
        <EmptyBlock text="暂无用户加入此应用" />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">邮箱</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3">权限</th>
                <th className="px-4 py-3 min-w-[100px]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {members.map((m) => (
                <tr key={m.id} className="bg-white">
                  <td className="px-4 py-4 align-middle">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand text-xs font-semibold">
                        {(m.user_display_name ?? m.user_email ?? "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{m.user_display_name ?? "-"}</p>
                        <p className="text-xs text-slate-500">ID: {m.user_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 align-middle text-slate-500">{m.user_email}</td>
                  <td className="px-4 py-4 align-middle"><StatusBadge status={m.status} /></td>
                  <td className="px-4 py-4 align-middle">
                    <div className="flex flex-wrap gap-1">
                      {m.roles.length > 0
                        ? m.roles.map((r) => (
                            <span key={r} className="rounded-lg bg-brand-light px-2 py-0.5 text-xs font-medium text-brand">{r}</span>
                          ))
                        : <span className="text-xs text-slate-400">-</span>}
                    </div>
                  </td>
                  <td className="px-4 py-4 align-middle">
                    <div className="flex flex-wrap gap-1">
                      {m.permissions.length > 0
                        ? m.permissions.slice(0, 3).map((p) => (
                            <span key={p} className="rounded-lg bg-slate-50 px-2 py-0.5 text-xs text-slate-500">{p}</span>
                          ))
                        : <span className="text-xs text-slate-400">-</span>}
                      {m.permissions.length > 3 && (
                        <span className="rounded-lg bg-slate-50 px-2 py-0.5 text-xs text-slate-400">+{m.permissions.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 align-middle">
                    <ChipButton
                      danger={m.status === "active"}
                      onClick={() => toggleStatus(m.user_id, m.status)}
                    >
                      {m.status === "active" ? "禁用" : "启用"}
                    </ChipButton>
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
        subtitle="将角色绑定到指定用户"
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
            className="app-input"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="输入用户 ID"
          />
        </Field>
        <Field label="选择角色">
          <select className="app-input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
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
