import { useState } from "react";
import { Plus } from "lucide-react";
import type { Application } from "../types";
import { Card, CopyButton, EmptyBlock, Field, Modal, SectionHeader, StatusBadge, btnOutline, btnPrimary, cn, inputCls } from "../components/ui";

export default function ApplicationsView({
  applications,
  onLoad,
  onCreate,
  onUpdate,
  onRegenerateSecret,
  onSelect,
  canCreate,
}: {
  applications: Application[];
  onLoad: () => void;
  onCreate: (name: string, redirectUris: string[], enableSSO: boolean, enablePublicUsers: boolean, description?: string) => void;
  onUpdate: (id: number, data: { name?: string; description?: string | null; redirect_uris?: string[]; enable_sso?: boolean; enable_public_users?: boolean; status?: string }) => void;
  onRegenerateSecret: (appId: number, clientId: string) => void;
  onSelect: (app: Application) => void;
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [uris, setUris] = useState("");
  const [enableSSO, setEnableSSO] = useState(true);
  const [enablePublicUsers, setEnablePublicUsers] = useState(false);
  const [appStatus, setAppStatus] = useState("active");

  function resetForm() {
    setName("");
    setDesc("");
    setUris("");
    setEnableSSO(true);
    setEnablePublicUsers(false);
    setAppStatus("active");
  }

  function openEdit(app: Application) {
    setEditingApp(app);
    setName(app.name);
    setDesc(app.description ?? "");
    setUris(app.redirect_uris.join("\n"));
    setEnableSSO(app.enable_sso);
    setEnablePublicUsers(app.enable_public_users);
    setAppStatus(app.status);
  }

  function handleCreate() {
    if (!name.trim()) return;
    onCreate(name.trim(), uris.split("\n").map((s) => s.trim()).filter(Boolean), enableSSO, enablePublicUsers, desc.trim() || undefined as string | undefined);
    resetForm();
    setOpen(false);
    onLoad();
  }

  function handleUpdate() {
    if (!editingApp || !name.trim()) return;
    onUpdate(editingApp.id, {
      name: name.trim(),
      description: desc.trim() || null,
      redirect_uris: uris.split("\n").map((s) => s.trim()).filter(Boolean),
      enable_sso: enableSSO,
      enable_public_users: enablePublicUsers,
      status: appStatus,
    });
    setEditingApp(null);
    resetForm();
    onLoad();
  }

  const formFields = (
    <>
      <Field label="应用名称">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：MyApp" />
      </Field>
      <Field label="应用描述">
        <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="可选" />
      </Field>
      <Field label="回调地址（每行一个）">
        <textarea
          className={cn(inputCls, "min-h-20 resize-y")}
          value={uris}
          onChange={(e) => setUris(e.target.value)}
          placeholder="https://example.com/callback"
        />
      </Field>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enableSSO} onChange={(e) => setEnableSSO(e.target.checked)} className="h-4 w-4 rounded border-border accent-brand" />
          启用 SSO 单点登录
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enablePublicUsers} onChange={(e) => setEnablePublicUsers(e.target.checked)} className="h-4 w-4 rounded border-border accent-brand" />
          允许公开注册
        </label>
      </div>
      <Field label="应用状态">
        <select className={inputCls} value={appStatus} onChange={(e) => setAppStatus(e.target.value)}>
          <option value="active">启用</option>
          <option value="disabled">禁用</option>
        </select>
      </Field>
    </>
  );

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title="应用列表"
          action={canCreate ? (
            <button onClick={() => { resetForm(); setOpen(true); }} className={btnPrimary}>
              <Plus size={16} /> 新建应用
            </button>
          ) : undefined}
        />
        {applications.length === 0 ? (
          <EmptyBlock text="暂无应用，点击右上角创建" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">名称</th>
                  <th className="px-4 py-2 font-medium">描述</th>
                  <th className="px-4 py-2 font-medium">Client ID</th>
                  <th className="px-4 py-2 font-medium">用户池</th>
                  <th className="px-4 py-2 font-medium">SSO</th>
                  <th className="px-4 py-2 font-medium">状态</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {applications.map((app) => (
                  <tr key={app.id} className="hover:bg-surface">
                    <td className="px-4 py-3 font-medium">{app.name}</td>
                    <td className="px-4 py-3 text-xs text-muted max-w-48 truncate">{app.description ?? "-"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">{app.client_id}</code>
                        <CopyButton text={app.client_id} size={12} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs">{app.enable_public_users ? "公共" : "私有"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs">{app.enable_sso ? "开启" : "关闭"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={app.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(app)}
                          className="rounded-md px-2.5 py-1 text-xs text-muted hover:bg-surface hover:text-gray-700"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => onSelect(app)}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-light"
                        >
                          管理
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="新建应用"
        actions={
          <>
            <button onClick={() => setOpen(false)} className={btnOutline}>取消</button>
            <button onClick={handleCreate} className={btnPrimary}>创建</button>
          </>
        }
      >
        {formFields}
      </Modal>

      <Modal
        open={editingApp !== null}
        onClose={() => { setEditingApp(null); resetForm(); }}
        title="编辑应用"
        actions={
          <>
            <button onClick={() => { setEditingApp(null); resetForm(); }} className={btnOutline}>取消</button>
            <button onClick={handleUpdate} className={btnPrimary}>保存</button>
            {editingApp && (
              <button
                onClick={() => { onRegenerateSecret(editingApp.id, editingApp.client_id); setEditingApp(null); resetForm(); }}
                className="rounded-lg px-3 py-2 text-xs font-medium text-danger hover:bg-danger-light"
              >
                重新生成密钥
              </button>
            )}
          </>
        }
      >
        {formFields}
      </Modal>
    </div>
  );
}
