import { useEffect, useState } from "react";
import type { ApplicationUser, Role } from "../../types";
import { request } from "../../lib/api";
import { EmptyBlock, Field, Modal, StatusBadge, ChipButton, btnPrimary, btnOutline } from "../../components/ui";

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
  const [editingUser, setEditingUser] = useState<ApplicationUser | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([]);

  function loadMembers() {
    setLoading(true);
    request<{ items: ApplicationUser[]; total: number }>(`/applications/${appId}/users`, token)
      .then((r) => setMembers(r.items))
      .catch((err) => console.error("Failed to load app users:", err))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    request<Role[]>(`/applications/${appId}/roles`, token)
      .then((r) => {
        if (!cancelled) setRoles(r);
      })
      .catch((err) => console.error("Failed to load roles:", err));
    loadMembers();
    return () => { cancelled = true; };
  }, [appId, token]);

  async function toggleStatus(userId: number, currentStatus: string) {
    await request(`/applications/${appId}/users/${userId}/status`, token, {
      method: "PATCH",
      body: JSON.stringify({ status: currentStatus === "active" ? "disabled" : "active" }),
    });
    loadMembers();
  }

  function openRoleEditor(member: ApplicationUser) {
    setEditingUser(member);
    setSelectedRoleIds(
      roles
        .filter((r) => r.code !== "super_admin" && member.roles.includes(r.code))
        .map((r) => r.id),
    );
  }

  async function saveRoles() {
    if (!editingUser) return;
    await request(`/applications/${appId}/users/${editingUser.user_id}/roles`, token, {
      method: "PUT",
      body: JSON.stringify({ role_ids: selectedRoleIds }),
    });
    setEditingUser(null);
    loadMembers();
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">已加入此应用的用户列表，可管理角色和状态。</p>
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
                    <div className="flex gap-2">
                      <ChipButton onClick={() => openRoleEditor(m)}>角色</ChipButton>
                      <ChipButton
                        danger={m.status === "active"}
                        onClick={() => toggleStatus(m.user_id, m.status)}
                      >
                        {m.status === "active" ? "禁用" : "启用"}
                      </ChipButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={editingUser !== null}
        onClose={() => setEditingUser(null)}
        title="管理用户角色"
        subtitle={editingUser ? editingUser.user_email : undefined}
        actions={
          <>
            <button onClick={() => setEditingUser(null)} className={btnOutline}>取消</button>
            <button onClick={saveRoles} className={btnPrimary}>保存</button>
          </>
        }
      >
        <Field label={`角色（可多选，当前生效角色已勾选）`}>
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {roles.filter((r) => r.code !== "super_admin").length === 0 && (
              <p className="text-xs text-slate-400">此应用还没有角色，请先在"角色权限"页创建。</p>
            )}
            {roles.filter((r) => r.code !== "super_admin").map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-brand"
                  checked={selectedRoleIds.includes(r.id)}
                  onChange={(e) =>
                    setSelectedRoleIds((prev) =>
                      e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id),
                    )
                  }
                />
                <span className="text-sm text-slate-900">{r.name}</span>
                <span className="text-xs text-slate-400">{r.code}</span>
              </label>
            ))}
          </div>
        </Field>
      </Modal>
    </div>
  );
}
