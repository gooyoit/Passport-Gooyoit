import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { Permission, Role } from "../../types";
import { request } from "../../lib/api";
import { EmptyBlock, Field, Modal, ActionButton, btnPrimary, btnOutline } from "../../components/ui";

export default function PermissionsView({
  appId,
  token,
  onLoad,
}: {
  appId: number;
  token: string;
  onLoad: () => void;
}) {
  const [perms, setPerms] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [selRole, setSelRole] = useState("");
  const [selPerm, setSelPerm] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      request<Permission[]>(`/applications/${appId}/permissions`, token),
      request<Role[]>(`/applications/${appId}/roles`, token),
    ])
      .then(([p, r]) => {
        if (!cancelled) {
          setPerms(p);
          setRoles(r);
        }
      })
      .catch((err) => {
        console.error("Failed to load permissions:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [appId, token]);

  async function create() {
    if (!code.trim() || !name.trim()) return;
    await request(`/applications/${appId}/permissions`, token, {
      method: "POST",
      body: JSON.stringify({
        code: code.trim(),
        name: name.trim(),
        description: desc.trim() || null,
      }),
    });
    setCode("");
    setName("");
    setDesc("");
    setOpen(false);
    onLoad();
  }

  async function assignPerm() {
    if (!selRole || !selPerm) return;
    await request(
      `/applications/${appId}/roles/${selRole}/permissions/${selPerm}`,
      token,
      { method: "POST" },
    );
    setSelRole("");
    setSelPerm("");
    setAssignOpen(false);
    onLoad();
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">定义细粒度权限，并将其分配给角色。</p>
        <div className="flex gap-2">
          <ActionButton variant="secondary" onClick={() => setAssignOpen(true)}>
            分配权限
          </ActionButton>
          <ActionButton variant="primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> 新建权限
          </ActionButton>
        </div>
      </div>
      {perms.length === 0 ? (
        <EmptyBlock text="暂无权限" />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">标识</th>
                <th className="px-4 py-3">描述</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {perms.map((p) => (
                <tr key={p.id} className="bg-white">
                  <td className="px-4 py-4 align-middle font-semibold text-slate-900">{p.name}</td>
                  <td className="px-4 py-4 align-middle">
                    <code className="rounded-lg bg-slate-50 px-2 py-0.5 text-xs font-mono text-slate-500">{p.code}</code>
                  </td>
                  <td className="px-4 py-4 align-middle text-slate-500">{p.description ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="新建权限"
        subtitle="定义一个新的细粒度权限"
        actions={
          <>
            <button onClick={() => setOpen(false)} className={btnOutline}>取消</button>
            <button onClick={create} className={btnPrimary}>创建</button>
          </>
        }
      >
        <Field label="权限标识 (code)">
          <input className="app-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="users:read" />
        </Field>
        <Field label="权限名称">
          <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="查看用户" />
        </Field>
        <Field label="描述">
          <input className="app-input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="可选" />
        </Field>
      </Modal>

      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="分配权限到角色"
        subtitle="将权限绑定到指定角色"
        actions={
          <>
            <button onClick={() => setAssignOpen(false)} className={btnOutline}>取消</button>
            <button onClick={assignPerm} className={btnPrimary}>分配</button>
          </>
        }
      >
        <Field label="选择角色">
          <select className="app-input" value={selRole} onChange={(e) => setSelRole(e.target.value)}>
            <option value="">请选择…</option>
            {roles.filter((r) => r.code !== "super_admin").map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
            ))}
          </select>
        </Field>
        <Field label="选择权限">
          <select className="app-input" value={selPerm} onChange={(e) => setSelPerm(e.target.value)}>
            <option value="">请选择…</option>
            {perms.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </Field>
      </Modal>
    </div>
  );
}
