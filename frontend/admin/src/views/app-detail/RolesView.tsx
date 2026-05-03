import { useEffect, useState } from "react";
import { Plus, Shield } from "lucide-react";
import type { Role } from "../../types";
import { request } from "../../lib/api";
import { EmptyBlock, Field, Modal, btnPrimary, btnOutline, cn, inputCls } from "../../components/ui";

export default function RolesView({
  appId,
  token,
  onLoad,
}: {
  appId: number;
  token: string;
  onLoad: () => void;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    request<Role[]>(`/applications/${appId}/roles`, token)
      .then((data) => {
        if (!cancelled) setRoles(data);
      })
      .catch((err) => {
        console.error("Failed to load roles:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [appId, token]);

  async function create() {
    if (!code.trim() || !name.trim()) return;
    await request(`/applications/${appId}/roles`, token, {
      method: "POST",
      body: JSON.stringify({
        code: code.trim(),
        name: name.trim(),
        description: desc.trim() || null,
        is_default: isDefault,
      }),
    });
    setCode("");
    setName("");
    setDesc("");
    setIsDefault(false);
    setOpen(false);
    onLoad();
  }

  if (loading) return <div className="py-8 text-center text-sm text-muted">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">管理应用内的角色，角色可关联权限并分配给用户。</p>
        <button onClick={() => setOpen(true)} className={btnPrimary}>
          <Plus size={16} /> 新建角色
        </button>
      </div>
      {roles.length === 0 ? (
        <EmptyBlock text="暂无角色，点击右上角创建" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <div
              key={role.id}
              className={cn(
                "rounded-xl border p-4 transition-all hover:shadow-md",
                role.is_default ? "border-brand/30 bg-brand-light/20" : "border-border bg-white",
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  role.is_default ? "bg-brand text-white" : "bg-surface text-muted",
                )}>
                  <Shield size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate">{role.name}</span>
                    {role.is_default && (
                      <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs text-white font-medium">
                        默认
                      </span>
                    )}
                  </div>
                  <code className="mt-0.5 block text-xs text-muted">{role.code}</code>
                </div>
              </div>
              {role.description && (
                <p className="mt-2.5 text-xs text-muted leading-relaxed">{role.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="新建角色"
        actions={
          <>
            <button onClick={() => setOpen(false)} className={btnOutline}>取消</button>
            <button onClick={create} className={btnPrimary}>创建</button>
          </>
        }
      >
        <Field label="角色标识 (code)">
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="admin" />
        </Field>
        <Field label="角色名称">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="管理员" />
        </Field>
        <Field label="描述">
          <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="可选" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          设为默认角色
        </label>
      </Modal>
    </div>
  );
}
