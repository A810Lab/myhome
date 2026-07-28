import React, { useState, useEffect } from "react";
import { UserCheck, ShieldAlert, CheckCircle, Save, Plus, Trash2, Mail, Loader2, Copy, Check, KeyRound } from "lucide-react";
import { useBreakpoint } from "../useBreakpoint";
import { SectionCard } from "../components/SectionCard";
import { loadSystemConfig, saveSystemConfig, addUserAccount } from "../api";
import { copy } from "../locales/ko";

const locale = "ko";
const t = copy[locale];

export function AllowedAccountsPage({ onChanged, currentUserEmail }: { onChanged?: () => void; currentUserEmail?: string }) {
  const { isMobile } = useBreakpoint();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  
  // 상태 변수
  const [allowedEmails, setAllowedEmails] = useState<string[]>([]);
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [isAdminChecked, setIsAdminChecked] = useState(false);
  const [tempPassInfo, setTempPassInfo] = useState<{ email: string; tempPass: string } | null>(null);
  const [copied, setCopied] = useState(false);
 
  // 전체 설정 로드 후 이메일 목록만 추출
  const fetchConfig = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const data = await loadSystemConfig();
      
      const emailsStr = data.allowedEmails || "";
      const emailsArr = emailsStr
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      setAllowedEmails(emailsArr);

      const adminStr = data.adminEmails || "";
      const adminArr = adminStr
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      setAdminEmails(adminArr);
    } catch (err: any) {
      console.error("Failed to load allowed emails:", err);
      setErrorMsg(err.message || "설정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  // 이메일 유효성 검증
  const isValidEmail = (email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email.toLowerCase());
  };

  // 이메일 추가
  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailToAdd = newEmail.trim().toLowerCase();
    
    if (!emailToAdd) return;
    
    if (!isValidEmail(emailToAdd)) {
      setErrorMsg(t.invalidEmail);
      setTimeout(() => setErrorMsg(""), 3000);
      return;
    }

    if (allowedEmails.includes(emailToAdd)) {
      setErrorMsg(t.alreadyExists);
      setTimeout(() => setErrorMsg(""), 3000);
      return;
    }

    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");
    setTempPassInfo(null);
    try {
      const res = await addUserAccount(emailToAdd, isAdminChecked);
      if (res.ok) {
        setAllowedEmails((prev) => [...prev, emailToAdd]);
        if (isAdminChecked) {
          setAdminEmails((prev) => [...prev, emailToAdd]);
        }
        setSuccessMsg(t.addSuccess);
        setTimeout(() => setSuccessMsg(""), 3000);
        if (res.tempPassword) {
          setTempPassInfo({ email: emailToAdd, tempPass: res.tempPassword });
        }
        setNewEmail("");
        setIsAdminChecked(false);
        if (onChanged) onChanged();
      }
    } catch (err: any) {
      console.error("Failed to add user account:", err);
      setErrorMsg(err.message || t.settingsSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  // 이메일 삭제
  const handleDeleteEmail = async (emailToDelete: string) => {
    if (!window.confirm(t.deleteAccountConfirm)) {
      return;
    }

    // 본인 계정 삭제 제한
    if (currentUserEmail && emailToDelete.toLowerCase() === currentUserEmail.toLowerCase()) {
      setErrorMsg(t.cantRemoveSelfAdmin || "본인 계정은 삭제할 수 없습니다.");
      setTimeout(() => setErrorMsg(""), 3000);
      return;
    }

    // 마지막 관리자 삭제 방지
    const isToDeleteAdmin = adminEmails.includes(emailToDelete);
    if (isToDeleteAdmin && adminEmails.length <= 1) {
      setErrorMsg(t.atLeastOneAdmin || "최소 한 명 이상의 관리자가 존재해야 합니다.");
      setTimeout(() => setErrorMsg(""), 3000);
      return;
    }

    const updatedEmails = allowedEmails.filter((email) => email !== emailToDelete);
    const updatedAdmins = adminEmails.filter((email) => email !== emailToDelete);
    await saveConfig(updatedEmails, updatedAdmins, t.deleteSuccess);
  };

  // 임시 비밀번호 재발급
  const handleResetPassword = async (email: string) => {
    const confirmMsg = t.resetPasswordConfirm.replace("{email}", email);
    if (!window.confirm(confirmMsg)) {
      return;
    }

    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");
    setTempPassInfo(null);
    try {
      const isEmailAdmin = adminEmails.includes(email);
      const res = await addUserAccount(email, isEmailAdmin);
      if (res.ok && res.tempPassword) {
        setSuccessMsg(t.resetPasswordSuccess);
        setTimeout(() => setSuccessMsg(""), 3000);
        setTempPassInfo({ email, tempPass: res.tempPassword });
      }
    } catch (err: any) {
      console.error("Failed to reset password:", err);
      setErrorMsg(err.message || t.settingsSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  // 관리자 권한 토글
  const handleToggleAdmin = async (email: string) => {
    const isAdmin = adminEmails.includes(email);
    let updatedAdmins: string[];

    if (isAdmin) {
      // 본인의 관리자 권한 해제 제한
      if (currentUserEmail && email.toLowerCase() === currentUserEmail.toLowerCase()) {
        setErrorMsg(t.cantRemoveSelfAdmin || "본인의 관리자 권한은 해제할 수 없습니다.");
        setTimeout(() => setErrorMsg(""), 3000);
        return;
      }
      // 최소 1명의 관리자 유지 검증
      if (adminEmails.length <= 1) {
        setErrorMsg(t.atLeastOneAdmin || "최소 한 명 이상의 관리자가 존재해야 합니다.");
        setTimeout(() => setErrorMsg(""), 3000);
        return;
      }
      updatedAdmins = adminEmails.filter((e) => e !== email);
    } else {
      updatedAdmins = [...adminEmails, email];
    }

    await saveConfig(allowedEmails, updatedAdmins, t.toggleAdminSuccess || "권한이 성공적으로 변경되었습니다.");
  };

  // 서버에 저장하는 공통 함수
  const saveConfig = async (emailsArr: string[], adminsArr: string[], successNotification: string) => {
    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");
    try {
      const allowedEmailsStr = emailsArr.join(",");
      const adminEmailsStr = adminsArr.join(",");
      await saveSystemConfig({
        allowedEmails: allowedEmailsStr,
        adminEmails: adminEmailsStr
      });
      setAllowedEmails(emailsArr);
      setAdminEmails(adminsArr);
      setSuccessMsg(successNotification);
      setTimeout(() => setSuccessMsg(""), 3000);
      if (onChanged) onChanged();
    } catch (err: any) {
      console.error("Failed to save allowed emails:", err);
      setErrorMsg(err.message || t.settingsSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {!isMobile && (
        <header className="flex flex-col gap-1">
          <h2 className="text-2xl font-black text-strong tracking-tight mt-1 flex items-center gap-2">
            <UserCheck className="text-primary h-6 w-6" />
            {t.allowedAccountsTitle}
          </h2>
          <p className="text-sm text-neutral">{t.allowedAccountsSubtitle}</p>
        </header>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 이메일 추가 폼 */}
        <div className="lg:col-span-1">
          <SectionCard
            title={t.addAccount}
            right={<Plus className="h-4 w-4 text-primary" />}
          >
            <form onSubmit={handleAddEmail} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-neutral">Account Email</label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-3 h-4 w-4 text-assistive" />
                  <input
                    type="text"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder={t.emailPlaceholder}
                    disabled={loading || saving}
                    className="w-full bg-normal border border-normal rounded-lg pl-10 pr-3 py-2.5 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 px-1">
                <input
                  type="checkbox"
                  id="isAdmin"
                  checked={isAdminChecked}
                  onChange={(e) => setIsAdminChecked(e.target.checked)}
                  disabled={loading || saving}
                  className="h-4 w-4 cursor-pointer rounded border-slate-300/80 bg-white/50 text-primary transition-colors focus:ring-primary dark:border-slate-800/80 dark:bg-slate-950/40 dark:focus:ring-primary"
                />
                <label
                  htmlFor="isAdmin"
                  className="cursor-pointer select-none text-xs text-neutral hover:text-strong transition"
                >
                  {t.isAdminUser}
                </label>
              </div>

              <button
                type="submit"
                disabled={loading || saving || !newEmail.trim()}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-primary hover:bg-primary/80 text-white text-xs font-bold rounded-lg shadow-lg shadow-primary/20 transition disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                <span>{saving ? "저장 중..." : t.addAccount}</span>
              </button>
            </form>

            {tempPassInfo && (
              <div className="mt-4 p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 dark:bg-blue-500/10 space-y-2 animate-in fade-in slide-in-from-top duration-300">
                <div className="text-xs font-bold text-blue-500 flex items-center gap-1.5">
                  <ShieldAlert size={14} />
                  <span>{t.tempPasswordIssued}</span>
                </div>
                <p className="text-[11px] text-neutral leading-relaxed">
                  {t.tempPasswordAlert}
                </p>
                <div className="flex items-center gap-2 bg-normal/30 border border-normal p-2 rounded-lg mt-1">
                  <code className="text-xs font-mono font-bold text-strong select-all flex-grow break-all px-1">
                    {tempPassInfo.tempPass}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(tempPassInfo.tempPass);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="p-1.5 hover:bg-normal/50 rounded-md transition text-primary flex items-center gap-1 text-[11px] font-semibold flex-shrink-0"
                  >
                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    <span>{copied ? t.copySuccess : t.copyTempPassword}</span>
                  </button>
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        {/* 승인된 이메일 목록 리스트 */}
        <div className="lg:col-span-2">
          <SectionCard
            title={t.allowedAccountsListTitle}
            right={<UserCheck className="h-4 w-4 text-primary" />}
          >
            {successMsg && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs px-4 py-3 rounded-lg mb-4 animate-in fade-in duration-300">
                <CheckCircle size={14} />
                <span>{successMsg}</span>
              </div>
            )}
            {errorMsg && (
              <div className="flex items-center gap-2 bg-warn/10 border border-warn/30 text-warn text-xs px-4 py-3 rounded-lg mb-4 animate-in fade-in duration-300">
                <ShieldAlert size={14} />
                <span>{errorMsg}</span>
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : allowedEmails.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center bg-normal/10 border border-dashed border-normal rounded-xl p-6">
                <ShieldAlert className="h-10 w-10 text-warn mb-3" />
                <p className="text-sm font-semibold text-strong">{t.noAllowedAccounts}</p>
                <p className="text-xs text-neutral mt-1">접근 제한을 해제하려면 최소 1개 이상의 이메일을 등록해야 합니다.</p>
              </div>
            ) : (
              <div className="border border-normal rounded-xl overflow-hidden bg-normal/10 divide-y divide-normal">
                {allowedEmails.map((email) => {
                  const isEmailAdmin = adminEmails.includes(email);
                  return (
                    <div
                      key={email}
                      className="flex items-center justify-between px-4 py-3.5 hover:bg-normal/30 transition duration-150 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="bg-primary/10 text-primary p-2 rounded-lg flex-shrink-0">
                          <Mail className="h-4 w-4" />
                        </div>
                        <span className="text-sm font-medium text-strong truncate break-all pr-2">
                          {email}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleAdmin(email)}
                          disabled={saving}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                            isEmailAdmin 
                              ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" 
                              : "bg-normal border-normal text-neutral hover:text-strong hover:bg-normal/50"
                          }`}
                          title={isEmailAdmin ? "일반 사용자로 변경" : "관리자로 변경"}
                        >
                          {isEmailAdmin ? t.userRoleAdmin : t.userRoleNormal}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResetPassword(email)}
                          disabled={saving}
                          className="p-2 text-neutral hover:text-amber-600 hover:bg-amber-500/10 rounded-lg transition-colors flex-shrink-0"
                          title={t.resetPasswordTooltip}
                        >
                          <KeyRound size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEmail(email)}
                          disabled={saving}
                          className="p-2 text-neutral hover:text-rose-600 hover:bg-rose-500/10 rounded-lg transition-colors flex-shrink-0"
                          title="삭제"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-4 text-[10px] text-assistive">
              * 여기에 등록된 계정 이메일 주소로 구글 OAuth 인증 또는 발급된 임시 비밀번호를 통해 대시보드 시스템에 로그인할 수 있습니다.
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
