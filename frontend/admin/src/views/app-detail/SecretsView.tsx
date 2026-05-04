import { useEffect, useState } from "react";
import { Info, RefreshCw } from "lucide-react";
import type { ClientSecretItem } from "../../types";
import { request } from "../../lib/api";
import { btnOutline, cn } from "../../components/ui";

export default function SecretsView({
  appId,
  token,
  version,
  onRegenerate,
  onDelete,
}: {
  appId: number;
  token: string;
  version: number;
  onRegenerate: () => void;
  onDelete: (secretId: number) => void;
}) {
  const [secrets, setSecrets] = useState<ClientSecretItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    request<{ items: ClientSecretItem[]; total: number }>(
      `/applications/${appId}/secrets`,
      token,
    ).then((data) => {
      if (!cancelled) setSecrets(data.items);
    }).catch((err) => {
      console.error("Failed to load secrets:", err);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [appId, token, version]);

  if (loading) return <div className="py-8 text-center text-sm text-muted">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface/50 px-4 py-3">
        <p className="text-sm text-muted">
          <Info size={14} className="mr-1.5 inline-block align-[-2px]" />
          客户端密钥用于后端 Token 交换，请妥善保管。密钥明文仅在创建时展示一次。
        </p>
        <button onClick={onRegenerate} className={cn(btnOutline, "text-xs gap-1.5 text-brand border-brand/30 hover:bg-brand-light")}>
          <RefreshCw size={14} /> 生成新密钥
        </button>
      </div>
      {secrets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted">
          暂无密钥，请点击上方"生成新密钥"
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {secrets.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-mono text-muted">
                  {s.secret_prefix && s.secret_suffix
                    ? `${s.secret_prefix}••••••••••••${s.secret_suffix}`
                    : "••••••••••••••••••••••••••••••"}
                  <span className="ml-2 text-xs text-muted/60">#{s.id}</span>
                </p>
                <p className="text-xs text-muted/60">
                  创建于 {new Date(s.created_at).toLocaleString("zh-CN")}
                </p>
              </div>
              <button
                onClick={() => { if (window.confirm("确定删除该密钥？删除后使用该密钥的系统将无法完成 Token 交换。")) onDelete(s.id); }}
                className="rounded-md px-2.5 py-1 text-xs text-red-500 hover:bg-red-50"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
