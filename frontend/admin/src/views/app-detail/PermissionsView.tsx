import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { Permission, Role } from "../../types";
import { request } from "../../lib/api";
import { EmptyBlock, Field, Modal, btnPrimary, btnOutline, inputCls } from "../../components/ui";

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

  if (loading) return <div className="py-8 text-center text-sm text-muted">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">定义细粒度权限，并将其分配给角色。</p>
        <div className="flex gap-2">
          <button onClick={() => setAssignOpen(true)} className={btnOutline}>
            分配权限
          </button>
          <button onClick={() => setOpen(true)} className={btnPrimary}>
            <Plus size={16} /> 新建权限
          </button>
        </div>
      </div>
      {perms.length === 0 ? (
        <EmptyBlock text="暂无权限" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50 text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">名称</th>
                <th className="px-4 py-2.5 font-medium">标识</th>
                <th className="px-4 py-2.5 font-medium">描述</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {perms.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-surface/50">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3">
                    <code className="rounded-md bg-surface px-2 py-0.5 text-xs font-mono text-muted">{p.code}</code>
                  </td>
                  <td className="px-4 py-3 text-muted">{p.description ?? "-"}</td>
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
        actions={
          <>
            <button onClick={() => setOpen(false)} className={btnOutline}>取消</button>
            <button onClick={create} className={btnPrimary}>创建</button>
          </>
        }
      >
        <Field label="权限标识 (code)">
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="users:read" />
        </Field>
        <Field label="权限名称">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="查看用户" />
        </Field>
        <Field label="描述">
          <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="可选" />
        </Field>
      </Modal>

      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="分配权限到角色"
        actions={
          <>
            <button onClick={() => setAssignOpen(false)} className={btnOutline}>取消</button>
            <button onClick={assignPerm} className={btnPrimary}>分配</button>
          </>
        }
      >
        <Field label="选择角色">
          <select className={inputCls} value={selRole} onChange={(e) => setSelRole(e.target.value)}>
            <option value="">请选择…</option>
            {roles.filter((r) => r.code !== "super_admin").map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
            ))}
          </select>
        </Field>
        <Field label="选择权限">
          <select className={inputCls} value={selPerm} onChange={(e) => setSelPerm(e.target.value)}>
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
