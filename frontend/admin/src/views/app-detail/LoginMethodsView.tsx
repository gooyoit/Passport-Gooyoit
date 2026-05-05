import { useEffect, useState } from "react";
import { Info, Key, Mail } from "lucide-react";
import { SiGoogle, SiGithub, SiWechat } from "react-icons/si";
import type { LoginMethod } from "../../types";
import { request } from "../../lib/api";
import { methodDescription, methodLabel } from "../../lib/utils";
import { EmptyBlock, cn } from "../../components/ui";

const METHOD_ICONS: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  email_code: { icon: Mail, color: "text-blue-600", bg: "bg-blue-50" },
  email_password: { icon: Key, color: "text-blue-600", bg: "bg-blue-50" },
  wechat: { icon: SiWechat, color: "text-green-500", bg: "bg-green-50" },
  google: { icon: SiGoogle, color: "text-red-500", bg: "bg-red-50" },
  github: { icon: SiGithub, color: "text-gray-800", bg: "bg-gray-100" },
};

export default function LoginMethodsView({
  appId,
  token,
}: {
  appId: number;
  token: string;
}) {
  const [methods, setMethods] = useState<LoginMethod[]>([]);
  const [loading, setLoading] = useState(true);

  function fetchMethods() {
    setLoading(true);
    request<LoginMethod[]>(
      `/applications/${appId}/login-methods`,
      token,
    ).then((data) => {
      setMethods(data);
    }).catch((err) => {
      console.error("Failed to load login methods:", err);
    }).finally(() => {
      setLoading(false);
    });
  }

  useEffect(() => { fetchMethods(); }, [appId, token]);

  async function toggle(method: LoginMethod) {
    setMethods((prev) =>
      prev.map((m) => (m.id === method.id ? { ...m, enabled: !m.enabled } : m)),
    );
    try {
      await request(`/applications/${appId}/login-methods`, token, {
        method: "POST",
        body: JSON.stringify({ method: method.method, enabled: !method.enabled }),
      });
    } catch (e) {
      window.alert((e as Error).message);
      fetchMethods();
    }
  }

  async function addMethod(method: string) {
    try {
      await request(`/applications/${appId}/login-methods`, token, {
        method: "POST",
        body: JSON.stringify({ method, enabled: true }),
      });
      fetchMethods();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  const allMethods = ["email_code", "email_password", "wechat", "google", "github"];
  const existingKeys = new Set(methods.map((m) => m.method));
  const missing = allMethods.filter((m) => !existingKeys.has(m));

  if (loading) return <div className="py-8 text-center text-sm text-slate-400">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm text-slate-500">
          <Info size={14} className="mr-1.5 inline-block align-[-2px]" />
          管理该应用支持的登录方式，已启用的方式将在登录页展示。
        </p>
        {missing.length > 0 && (
          <select
            className="h-11 rounded-xl border border-brand/30 bg-white px-3 text-sm text-brand outline-none hover:border-brand focus:ring-2 focus:ring-brand/20"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) addMethod(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              添加方式…
            </option>
            {missing.map((m) => (
              <option key={m} value={m}>
                {methodLabel(m)}
              </option>
            ))}
          </select>
        )}
      </div>
      {methods.length === 0 ? (
        <EmptyBlock text="暂未配置登录方式，请点击右上角添加" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {methods.map((m) => {
            const meta = METHOD_ICONS[m.method] ?? { icon: Key, color: "text-slate-400", bg: "bg-slate-50" };
            const MethodIcon = meta.icon;
            return (
              <div
                key={m.id}
                className={cn(
                  "group rounded-2xl border p-4 transition-all",
                  m.enabled
                    ? "border-brand/30 bg-brand-light/30"
                    : "border-slate-200 bg-white opacity-60",
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", meta.bg)}>
                      <MethodIcon size={20} className={meta.color} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{methodLabel(m.method)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{methodDescription(m.method)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggle(m)}
                    className={cn(
                      "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                      m.enabled ? "bg-brand" : "bg-gray-300",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                        m.enabled && "translate-x-5",
                      )}
                    />
                  </button>
                </div>
                <p className={cn(
                  "mt-3 text-xs font-medium",
                  m.enabled ? "text-success" : "text-slate-400",
                )}>
                  {m.enabled ? "已启用" : "未启用"}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
