import { useEffect, useState } from "react";
import { Info, KeyRound, Trash2 } from "lucide-react";
import { request } from "../../lib/api";
import { EmptyBlock } from "../../components/ui";

interface PasskeyItem {
  id: number;
  user_id: number;
  user_email: string;
  user_display_name: string | null;
  credential_id: string;
  sign_count: number;
  transports: string[] | null;
  device_name: string | null;
  aaguid: string | null;
  created_at: string;
}

export default function PasskeysView({ appId, token }: { appId: number; token: string }) {
  const [items, setItems] = useState<PasskeyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  function fetchPasskeys() {
    setLoading(true);
    request<{ items: PasskeyItem[]; total: number }>(`/applications/${appId}/passkeys?per_page=100`, token)
      .then((data) => { setItems(data.items); setTotal(data.total); })
      .catch((err) => console.error("Failed to load passkeys:", err))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchPasskeys(); }, [appId, token]);

  async function deletePasskey(id: number) {
    if (!window.confirm("确认删除此 Passkey？用户将无法使用该设备登录。")) return;
    try {
      await request(`/applications/${appId}/passkeys/${id}`, token, { method: "DELETE" });
      fetchPasskeys();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm text-slate-500">
          <Info size={14} className="mr-1.5 inline-block align-[-2px]" />
          管理此应用下用户注册的 Passkey 凭证，共 {total} 个。
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyBlock text="暂无 Passkey 凭证" />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">设备</th>
                <th className="px-4 py-3">创建时间</th>
                <th className="px-4 py-3 min-w-[80px]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.map((item) => (
                <tr key={item.id} className="bg-white">
                  <td className="px-4 py-4 align-middle">
                    <p className="font-semibold text-slate-900">{item.user_email}</p>
                    {item.user_display_name && <p className="text-xs text-slate-500">{item.user_display_name}</p>}
                  </td>
                  <td className="px-4 py-4 align-middle">
                    <div className="flex items-center gap-2">
                      <KeyRound size={16} className="text-violet-500" />
                      <span className="text-xs text-slate-600">{item.transports?.join(", ") ?? "unknown"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 align-middle text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</td>
                  <td className="px-4 py-4 align-middle">
                    <button
                      onClick={() => deletePasskey(item.id)}
                      className="inline-flex h-8 items-center justify-center rounded-xl bg-danger/10 px-3 text-xs font-semibold text-danger hover:bg-danger/20 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
