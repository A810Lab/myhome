import { useState, type FormEvent } from "react";
import { AlertCircle, Lock, KeyRound, Check, Loader2 } from "lucide-react";
import { updateCredentials } from "../api";
import { copy } from "../locales/ko";
import ShaderBackground from "./ui/ShaderBackground";

const locale = navigator.language.startsWith("ko") ? "ko" : "en";
const t = copy[locale];

interface TempPasswordResetModalProps {
  email: string;
  onResetSuccess: () => void;
}

export function TempPasswordResetModal({ email, onResetSuccess }: TempPasswordResetModalProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (password.length < 8) {
      setError(t.passwordMinLength);
      return;
    }

    if (password !== confirmPassword) {
      setError(t.passwordMismatch);
      return;
    }

    setLoading(true);
    try {
      const res = await updateCredentials(email, password);
      if (res.ok) {
        setSuccess(t.changePasswordSuccess);
        setTimeout(() => {
          onResetSuccess();
        }, 1500);
      }
    } catch (err: any) {
      console.error("Failed to reset password:", err);
      setError(err.message || t.changePasswordFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative font-app-ui flex min-h-screen flex-col items-center justify-center p-4 overflow-hidden z-50">
      <ShaderBackground />
      <div className="absolute inset-0 bg-white/40 dark:bg-slate-950/60 pointer-events-none -z-10" />

      <div className="w-full max-w-sm relative z-10 animate-fade-in-up">
        {/* 서비스 타이틀 */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 p-3 shadow-lg shadow-orange-500/30 dark:from-amber-400 dark:to-orange-500">
            <Lock size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-600 to-orange-600 dark:from-amber-400 dark:to-orange-300 drop-shadow-sm">
            {t.changePasswordTitle}
          </h1>
          <p className="mt-2 text-xs font-medium text-slate-600 dark:text-slate-400/80 px-4 leading-relaxed">
            {t.changePasswordSubtitle}
          </p>
        </div>

        {/* 모달 카드 */}
        <div className="rounded-2xl border border-white/40 bg-white/30 p-6 shadow-2xl shadow-orange-950/10 backdrop-blur-2xl ring-1 ring-white/10 dark:border-slate-700/40 dark:bg-slate-900/30 dark:shadow-orange-950/30">
          {error && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700 dark:border-rose-800/30 dark:bg-rose-950/20 dark:text-rose-400 animate-fade-in">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="font-medium leading-relaxed">{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-700 dark:border-emerald-800/30 dark:bg-emerald-950/20 dark:text-emerald-400 animate-fade-in">
              <Check size={14} className="shrink-0 mt-0.5 text-emerald-500" />
              <span className="font-medium leading-relaxed">{success}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t.newPassword}
              </label>
              <div className="relative flex items-center">
                <KeyRound className="absolute left-3 h-4 w-4 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading || !!success}
                  className="w-full rounded-xl border border-slate-200/60 bg-white/50 pl-10 pr-3.5 py-2.5 text-sm text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 dark:border-slate-800/60 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-amber-400/50 dark:focus:border-amber-400/50"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t.confirmNewPassword}
              </label>
              <div className="relative flex items-center">
                <KeyRound className="absolute left-3 h-4 w-4 text-slate-400" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading || !!success}
                  className="w-full rounded-xl border border-slate-200/60 bg-white/50 pl-10 pr-3.5 py-2.5 text-sm text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 dark:border-slate-800/60 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-amber-400/50 dark:focus:border-amber-400/50"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !!success || !password.trim()}
              className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition-all hover:from-amber-400 hover:to-orange-500 hover:shadow-orange-500/30 active:scale-[0.98] disabled:opacity-60 disabled:pointer-events-none"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check size={16} />
              )}
              <span>{loading ? "변경 중..." : "비밀번호 변경 완료"}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
