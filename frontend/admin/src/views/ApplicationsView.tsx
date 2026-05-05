import { useState } from "react";
import { Plus } from "lucide-react";
import type { Application } from "../types";
import { Card, CopyButton, EmptyBlock, Field, Modal, SectionHeader, StatusBadge, ActionButton, ChipButton, btnPrimary, btnOutline, cn } from "../components/ui";

export default function ApplicationsView({
  applications,
  onLoad,
  onCreate,
  onUpdate,
  onRegenerateSecret,
  onDeleteSecret,
  onSelect,
  canCreate,
}: {
  applications: Application[];
  onLoad: () => void;
  onCreate: (name: string, redirectUris: string[], enableSSO: boolean, enablePublicUsers: boolean, description?: string) => void;
  onUpdate: (id: number, data: { name?: string; description?: string | null; redirect_uris?: string[]; enable_sso?: boolean; enable_public_users?: boolean; status?: string }) => void;
  onRegenerateSecret: (appId: number, clientId: string) => void;
  onDeleteSecret?: (appId: number, secretId: number) => void;
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
        <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：MyApp" />
      </Field>
      <Field label="应用描述">
        <input className="app-input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="可选" />
      </Field>
      <Field label="回调地址（每行一个）">
        <textarea
          className="app-textarea min-h-20"
          value={uris}
          onChange={(e) => setUris(e.target.value)}
          placeholder="https://example.com/callback"
        />
      </Field>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={enableSSO} onChange={(e) => setEnableSSO(e.target.checked)} className="size-4 accent-brand" />
          启用 SSO 单点登录
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={enablePublicUsers} onChange={(e) => setEnablePublicUsers(e.target.checked)} className="size-4 accent-brand" />
          允许公开注册
        </label>
      </div>
      <Field label="应用状态">
        <select className="app-input" value={appStatus} onChange={(e) => setAppStatus(e.target.value)}>
          <option value="active">启用</option>
          <option value="disabled">禁用</option>
        </select>
      </Field>
    </>
  );

  return (
    <div className="space-y-5">
      <Card>
        <SectionHeader
          title="应用列表"
          description="管理所有 OAuth 接入应用"
          action={
            canCreate ? (
              <ActionButton variant="primary" onClick={() => { resetForm(); setOpen(true); }}>
                <Plus size={16} /> 新建应用
              </ActionButton>
            ) : undefined
          }
        />
        {applications.length === 0 ? (
          <div className="p-5"><EmptyBlock text="暂无应用，点击右上角创建" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">描述</th>
                  <th className="px-4 py-3">Client ID</th>
                  <th className="px-4 py-3">用户池</th>
                  <th className="px-4 py-3">SSO</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 min-w-[180px]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {applications.map((app) => (
                  <tr key={app.id} className="bg-white">
                    <td className="px-4 py-4 align-middle font-semibold text-slate-900">{app.name}</td>
                    <td className="px-4 py-4 align-middle text-xs text-slate-500 max-w-48 truncate">{app.description ?? "-"}</td>
                    <td className="px-4 py-4 align-middle">
                      <div className="flex items-center gap-1">
                        <code className="rounded-lg bg-slate-50 px-2 py-0.5 text-xs font-mono text-slate-500">{app.client_id}</code>
                        <CopyButton text={app.client_id} size={12} />
                      </div>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <span className="text-xs text-slate-600">{app.enable_public_users ? "公共" : "私有"}</span>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <span className="text-xs text-slate-600">{app.enable_sso ? "开启" : "关闭"}</span>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <StatusBadge status={app.status} />
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <div className="flex items-center gap-1.5">
                        <ChipButton onClick={() => openEdit(app)}>编辑</ChipButton>
                        <ChipButton onClick={() => onSelect(app)}>管理</ChipButton>
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
        subtitle="填写应用基本信息和 OAuth 回调地址"
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
        subtitle="修改应用配置信息"
        actions={
          <>
            <button onClick={() => { setEditingApp(null); resetForm(); }} className={btnOutline}>取消</button>
            <button onClick={handleUpdate} className={btnPrimary}>保存</button>
            {editingApp && (
              <ChipButton danger onClick={() => { onRegenerateSecret(editingApp.id, editingApp.client_id); setEditingApp(null); resetForm(); }}>
                重新生成密钥
              </ChipButton>
            )}
          </>
        }
      >
        {formFields}
      </Modal>
    </div>
  );
}
