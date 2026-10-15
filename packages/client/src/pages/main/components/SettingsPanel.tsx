import { memo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import UserAvatar from '../../../components/UserAvatar';
import { PanelTitleRow, panelTitleRowBg } from '../../../components/PanelDragHeader';
import { cn } from '../../../utils/cn';
import { useAuthStore } from '../../../store';
import { usersApi, authApi } from '../../../api';
import { formatJobTitle } from '../../../utils/orgTree';
import { ORG_THEMES, type OrgThemeId } from '../../../utils/orgTheme';
import UIModal from '../../../components/ui/UIModal';
import { useAccentStyles } from '../../../hooks/useAccentStyles';
import AdminSection from './AdminSection';
import PasswordChangeModal from './PasswordChangeModal';

type StatusOption = { id: string; label: string };

/** 연락처 수정 모달 */
function ProfileEditModal({ isDark, onClose }: { isDark: boolean; onClose: () => void }) {
  const accent = useAccentStyles(isDark);
  const authUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState(authUser?.phone ?? '');
  const [deskPhone, setDeskPhone] = useState(authUser?.deskPhone ?? '');
  const [extension, setExtension] = useState(authUser?.extension ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${isDark ? '#475569' : '#e2e8f0'}`, background: isDark ? '#1e293b' : '#fff', color: isDark ? '#e2e8f0' : '#333', fontSize: 14, boxSizing: 'border-box' as const };
  const labelStyle = { display: 'block', fontSize: 12, color: isDark ? '#94a3b8' : '#64748b', marginBottom: 4 };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await usersApi.updateProfile({
        phone: phone.trim() || null,
        deskPhone: deskPhone.trim() || null,
        extension: extension.trim() || null,
      });
      const { user: u } = await authApi.me();
      if (u) useAuthStore.getState().setAuth(u, useAuthStore.getState().token);
      queryClient.invalidateQueries({ queryKey: ['org'] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '프로필 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <UIModal title="프로필 수정" onClose={onClose} width={380}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
        <div>
          <label style={labelStyle}>휴대전화</label>
          <input
            autoFocus
            type="text"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            placeholder="010-1234-5678"
            maxLength={50}
            style={{ ...inputStyle, ...accent.inputStyle }}
          />
        </div>
        <div>
          <label style={labelStyle}>자리 전화번호</label>
          <input
            type="text"
            value={deskPhone}
            onChange={(e) => { setDeskPhone(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            placeholder="02-1234-5678"
            maxLength={30}
            style={{ ...inputStyle, ...accent.inputStyle }}
          />
        </div>
        <div>
          <label style={labelStyle}>내선번호</label>
          <input
            type="text"
            value={extension}
            onChange={(e) => { setExtension(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            placeholder="1234"
            maxLength={30}
            style={{ ...inputStyle, ...accent.inputStyle }}
          />
        </div>
        {error && <div style={{ fontSize: 12, color: '#ef4444' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button
            type="button"
            className="flex-1 px-4 py-2 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-semibold cursor-pointer disabled:opacity-60"
            style={accent.primaryStyle}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'px-4 py-2 rounded-lg border text-[13px] font-semibold cursor-pointer',
              isDark ? 'border-slate-600 bg-transparent text-slate-200' : accent.custom ? 'border-[var(--color-brand-dark)] bg-transparent text-[var(--color-brand-dark)]' : 'border-slate-200 bg-transparent text-slate-700',
            )}
          >
            취소
          </button>
        </div>
      </div>
    </UIModal>
  );
}

/** 아바타 카드 안에 들어가는 내 정보 수정 버튼들. */
function ProfileActions({ isDark }: { isDark: boolean }) {
  const accent = useAccentStyles(isDark);
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const btnStyle = {
    flex: 1,
    minWidth: 0,
    padding: '9px 12px',
    borderRadius: 10,
    border: `1px solid ${isDark ? 'rgba(226,232,240,0.16)' : 'rgba(23,32,51,0.10)'}`,
    background: isDark ? 'rgba(226,232,240,0.06)' : 'rgba(255,255,255,0.72)',
    color: isDark ? '#dbe4f0' : '#3b4a61',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  };

  return (
    <>
      <button
        type="button"
        style={{ ...btnStyle, ...accent.secondaryStyle }}
        className="transition-colors hover:brightness-95"
        onClick={() => setEditOpen(true)}
      >
        프로필 수정
      </button>
      <button
        type="button"
        style={{ ...btnStyle, ...accent.secondaryStyle }}
        className="transition-colors hover:brightness-95"
        onClick={() => setPwOpen(true)}
      >
        비밀번호 변경
      </button>
      {editOpen && <ProfileEditModal isDark={isDark} onClose={() => setEditOpen(false)} />}
      {pwOpen && <PasswordChangeModal isDark={isDark} onClose={() => setPwOpen(false)} />}
    </>
  );
}

type SettingsPanelProps = {
  panelWrapStyle: (maxWidth: number) => { className: string; style: React.CSSProperties };
  isDark: boolean;
  isNarrowLayout: boolean;
  user: { id: string; name?: string | null; email?: string | null; avatarUrl?: string | null; isAdmin?: boolean; phone?: string | null; jobTitle?: string | null } | null | undefined;
  notificationsSnoozedUntil: number;
  notificationSoundEnabled: boolean;
  notificationPopupEnabled: boolean;
  snoozeNotifications: (minutes: number) => void;
  clearSnooze: () => void;
  toggleNotificationSound: () => void;
  toggleNotificationPopup: () => void;
  toggleDark: () => void;
  accentTheme: OrgThemeId;
  onAccentThemeChange: (id: OrgThemeId) => void;
  hasElectron: boolean;
  canCheckUpdates: boolean;
  appVersion: string | null;
  updateStatus: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'latest';
  updateVersion: string | null;
  updateError: string | null;
  requiresManualInstall: boolean;
  handleCheckForUpdates: () => void | Promise<void>;
  handleQuitAndInstall: () => void | Promise<void>;
  handleOpenUpdateDownload: () => void | Promise<void>;
  handleOpenReleasesPage: () => void;
  statusInput: string;
  statusNote?: string;
  onStatusNoteChange?: (value: string) => void;
  extensionInput?: string;
  onExtensionChange?: (value: string) => void;
  deskPhoneInput?: string;
  onDeskPhoneChange?: (value: string) => void;
  onSaveStatusProfile?: () => void;
  awayMinutes?: number;
  onAwayMinutesChange?: (minutes: number) => void;
  downloadPath?: string | null;
  askSaveAs?: boolean;
  onPickDownloadPath?: () => void;
  onClearDownloadPath?: () => void;
  onToggleAskSaveAs?: () => void;
  statusOptions: StatusOption[];
  renderStatusIcon: (status: string, size?: number) => ReactNode;
  handleSetStatus: (msg: string) => Promise<void> | void;
  notificationStatus: string;
  onSelectAvatarFile: (file: File) => void;
  onDeleteAvatar: () => Promise<void>;
  onTestNotification: () => void;
  onRequestNotificationPermission: () => Promise<void> | void;
  onLogout: () => void;
  onQuit?: () => void;
};

function SettingsPanel({
  panelWrapStyle,
  isDark,
  isNarrowLayout,
  user,
  notificationsSnoozedUntil,
  notificationSoundEnabled,
  notificationPopupEnabled,
  snoozeNotifications,
  clearSnooze,
  toggleNotificationSound,
  toggleNotificationPopup,
  toggleDark,
  accentTheme,
  onAccentThemeChange,
  hasElectron,
  canCheckUpdates,
  appVersion,
  updateStatus,
  updateVersion,
  updateError,
  requiresManualInstall,
  handleCheckForUpdates,
  handleQuitAndInstall,
  handleOpenUpdateDownload,
  handleOpenReleasesPage,
  statusInput,
  statusNote = '',
  onStatusNoteChange,
  extensionInput = '',
  onExtensionChange,
  deskPhoneInput = '',
  onDeskPhoneChange,
  onSaveStatusProfile,
  awayMinutes = 10,
  onAwayMinutesChange,
  downloadPath = null,
  askSaveAs = false,
  onPickDownloadPath,
  onClearDownloadPath,
  onToggleAskSaveAs,
  statusOptions,
  renderStatusIcon,
  handleSetStatus,
  notificationStatus,
  onSelectAvatarFile,
  onDeleteAvatar,
  onTestNotification,
  onRequestNotificationPermission,
  onLogout,
  onQuit,
}: SettingsPanelProps) {
  const wrap = panelWrapStyle(760);
  const accent = useAccentStyles(isDark, accentTheme);
  const toggleColor = accent.custom ? accent.theme.accent : '#171717';
  return (
    <div className={wrap.className} style={wrap.style}>
      <PanelTitleRow
        isDark={isDark}
        title="설정"
        className={accent.custom ? '[&_h3]:text-[var(--color-brand-dark)] border-[rgba(var(--color-brand-dark-rgb),0.2)]' : panelTitleRowBg(isDark)}
        style={accent.custom ? { background: accent.theme.headerBg } : undefined}
      />
      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-3" style={{ padding: isNarrowLayout ? 14 : 24 }}>
        <div
          style={{
            position: 'relative',
            padding: '26px 20px 20px',
            borderRadius: 14,
            border: `1px solid ${isDark ? '#3f4d63' : accent.custom ? accent.theme.activeBg : '#e3e9fb'}`,
            background: isDark
              ? 'linear-gradient(160deg, #3a4759 0%, #2f3a4b 100%)'
              : accent.custom ? `linear-gradient(160deg, ${accent.theme.headerBg} 0%, ${accent.theme.activeBg} 100%)` : 'linear-gradient(160deg, #f6f8ff 0%, #eaf0fd 100%)',
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            gap: 14,
          }}
        >
          {/* 아바타 + 사진 동작. 버튼을 따로 두지 않고 아바타 위에 얹는다 */}
          <div style={{ position: 'relative', width: 88, height: 88, flexShrink: 0 }}>
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: 24,
                background: isDark ? '#4a5769' : accent.custom ? accent.theme.activeBg : '#dfe6f5',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isDark
                  ? '0 6px 18px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.06)'
                  : '0 6px 18px rgba(37,64,128,0.10), inset 0 0 0 1px rgba(255,255,255,0.7)',
              }}
            >
              {user?.avatarUrl ? (
                <UserAvatar
                  userId={user.id}
                  name={user.name || ''}
                  avatarUrlPath={user.avatarUrl}
                  imgStyle={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 24 }}
                  initialStyle={{ fontSize: 34, fontWeight: 700, color: isDark ? '#e2e8f0' : accent.custom ? accent.theme.activeText : 'rgba(60,30,30,0.85)' }}
                />
              ) : (
                <span style={{ fontSize: 34, fontWeight: 700, color: isDark ? '#e2e8f0' : accent.custom ? accent.theme.activeText : 'rgba(60,30,30,0.85)' }}>
                  {user?.name?.trim()[0]?.toUpperCase() || '?'}
                </span>
              )}
            </div>

            <label
              title="사진 변경"
              className={cn(
                'absolute flex items-center justify-center rounded-full cursor-pointer transition-transform hover:scale-105',
              )}
              style={{
                right: -2,
                bottom: -2,
                width: 30,
                height: 30,
                background: isDark ? '#e2e8f0' : toggleColor,
                color: isDark ? '#1e293b' : '#fff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14.5 4h-5L8 6H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-4l-1.5-2Z" />
                <circle cx="12" cy="12.5" r="3.5" />
              </svg>
              <span className="sr-only">사진 변경</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onSelectAvatarFile(f);
                  e.target.value = '';
                }}
              />
            </label>

            {user?.avatarUrl && (
              <button
                type="button"
                title="사진 삭제"
                aria-label="사진 삭제"
                onClick={() => void onDeleteAvatar()}
                className="absolute flex items-center justify-center rounded-full border-none cursor-pointer transition-transform hover:scale-105"
                style={{
                  // 사진 위에 얹히므로 어떤 색 위에서도 읽히도록 어두운 반투명으로 둔다
                  right: 3,
                  top: 3,
                  width: 22,
                  height: 22,
                  background: 'rgba(15,23,42,0.55)',
                  color: '#fff',
                  backdropFilter: 'blur(2px)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* 이름 · 직급 · 연락 정보 */}
          <div style={{ textAlign: 'center' as const, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, justifyContent: 'center' }}>
              <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', color: isDark ? '#f1f5f9' : '#172033' }}>
                {user?.name || '사용자'}
              </span>
              {formatJobTitle(user?.jobTitle) && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    background: isDark ? 'rgba(226,232,240,0.12)' : 'rgba(23,32,51,0.06)',
                    color: isDark ? '#cbd5e1' : '#475569',
                  }}
                >
                  {formatJobTitle(user?.jobTitle)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: isDark ? '#9fb0c6' : '#64748b' }}>{user?.email}</div>
            {user?.phone && (
              <div style={{ fontSize: 12.5, color: isDark ? '#9fb0c6' : '#64748b' }}>{user.phone}</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 320 }}>
            <ProfileActions isDark={isDark} />
          </div>
        </div>

        {user?.isAdmin && <AdminSection isDark={isDark} isNarrowLayout={isNarrowLayout} currentUserId={user?.id} />}

        {notificationsSnoozedUntil > Date.now() && <div style={{ padding: '6px 10px', borderRadius: 999, background: isDark ? '#171717' : accent.custom ? accent.theme.accent : '#0f172a', color: '#fff', fontSize: 11, fontWeight: 700, alignSelf: 'flex-start' }}>알림 일시 중지 중</div>}
        <div style={{ padding: '12px 14px', borderRadius: 10, background: isDark ? '#334155' : '#f8fafc', display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: isDark ? '#e2e8f0' : '#0f172a' }}>알림 일시 중지</div>
          {notificationsSnoozedUntil > Date.now() ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 8, fontSize: 12, color: isDark ? '#64748b' : '#64748b' }}>
              <span>해제: {new Date(notificationsSnoozedUntil).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
              <button type="button" className="px-4 py-2 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-semibold cursor-pointer" style={accent.primaryStyle} onClick={clearSnooze}>해제</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
              <button type="button" className="px-4 py-2 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-semibold cursor-pointer" style={accent.primaryStyle} onClick={() => snoozeNotifications(10)}>10분</button>
              <button type="button" className="px-4 py-2 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-semibold cursor-pointer" style={accent.primaryStyle} onClick={() => snoozeNotifications(60)}>1시간</button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 10, padding: '12px 14px', borderRadius: 10, background: isDark ? '#334155' : '#f8fafc' }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: isDark ? '#e2e8f0' : '#0f172a' }}>알림 소리</span>
          <button type="button" onClick={toggleNotificationSound} style={{ width: 48, height: 28, borderRadius: 14, border: 'none', background: notificationSoundEnabled ? toggleColor : (isDark ? '#475569' : '#e2e8f0'), cursor: 'pointer', position: 'relative' as const, padding: 0, flexShrink: 0 }}>
            <span style={{ position: 'absolute' as const, top: 3, left: notificationSoundEnabled ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 10, padding: '12px 14px', borderRadius: 10, background: isDark ? '#334155' : '#f8fafc' }}>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: isDark ? '#e2e8f0' : '#0f172a' }}>알림 팝업</span>
            <span style={{ fontSize: 11.5, color: isDark ? '#94a3b8' : '#64748b' }}>화면 우측 하단에 새 메시지 알림 창을 띄웁니다</span>
          </div>
          <button type="button" onClick={toggleNotificationPopup} style={{ width: 48, height: 28, borderRadius: 14, border: 'none', background: notificationPopupEnabled ? toggleColor : (isDark ? '#475569' : '#e2e8f0'), cursor: 'pointer', position: 'relative' as const, padding: 0, flexShrink: 0 }}>
            <span style={{ position: 'absolute' as const, top: 3, left: notificationPopupEnabled ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 10, padding: '12px 14px', borderRadius: 10, background: isDark ? '#334155' : '#f8fafc' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>다크 모드</span>
          <button type="button" onClick={toggleDark} style={{ width: 48, height: 28, borderRadius: 14, border: 'none', background: isDark ? '#171717' : '#e2e8f0', cursor: 'pointer', position: 'relative' as const, padding: 0, flexShrink: 0 }}>
            <span style={{ position: 'absolute' as const, top: 3, left: isDark ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </button>
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: isDark ? '#334155' : '#f8fafc', display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>조직도 색상 테마</div>
          <div style={{ fontSize: 12, color: isDark ? '#94a3b8' : '#64748b' }}>
            {isDark
              ? '다크 모드에서는 항상 기본 색상이 적용됩니다.'
              : '조직도와 일정, 메모장, 설정 등의 강조색을 바꿉니다. 나만 보이는 화면 설정이에요.'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
            {ORG_THEMES.map((t) => {
              const selected = accentTheme === t.id;
              const swatchBg = t.id === 'default' ? '#000F9F' : t.accent;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onAccentThemeChange(t.id)}
                  title={t.label}
                  disabled={isDark}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: selected ? `2px solid ${swatchBg}` : `1px solid ${isDark ? '#475569' : '#e2e8f0'}`,
                    background: isDark ? '#1e293b' : '#fff',
                    cursor: isDark ? 'default' : 'pointer',
                    opacity: isDark ? 0.5 : 1,
                    fontSize: 12,
                    fontWeight: selected ? 700 : 500,
                    color: isDark ? '#e2e8f0' : '#334155',
                  }}
                >
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: swatchBg, flexShrink: 0 }} />
                  {t.label}
                  {selected && <span style={{ color: swatchBg }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: isDark ? '#334155' : '#f8fafc', display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>자리비움 자동 전환</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            <select
              value={awayMinutes}
              onChange={(e) => onAwayMinutesChange?.(Number(e.target.value))}
              className={cn('rounded-lg border px-2.5 py-1.5 text-[13px] font-semibold', isDark ? 'border-slate-600 bg-slate-800 text-slate-200' : accent.custom ? 'border-[rgba(var(--color-brand-dark-rgb),0.3)] bg-white text-slate-900 focus:border-[var(--color-brand-dark)]' : 'border-slate-200 bg-white text-slate-800')}
            >
              {[5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>{m}분</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: isDark ? '#94a3b8' : '#64748b' }}>입력 없으면 자리비움으로 전환</span>
          </div>
        </div>

        {hasElectron && (
          <div style={{ padding: '12px 14px', borderRadius: 10, background: isDark ? '#334155' : '#f8fafc', display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>첨부파일 저장 경로</div>
            <div style={{ fontSize: 12, color: isDark ? '#94a3b8' : '#64748b', wordBreak: 'break-all' as const }}>
              {downloadPath || '브라우저 기본 다운로드 폴더'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
              <button type="button" className="px-3 py-1.5 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[12px] font-bold cursor-pointer" style={accent.primaryStyle} onClick={onPickDownloadPath}>폴더 선택</button>
              {downloadPath && (
                <button type="button" className={cn('px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer border', isDark ? 'border-slate-600 bg-slate-800 text-slate-200' : accent.custom ? 'border-[var(--color-brand-dark)] bg-white text-[var(--color-brand-dark)]' : 'border-slate-200 bg-white text-slate-700')} onClick={onClearDownloadPath}>초기화</button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#e2e8f0' : '#0f172a' }}>다른 이름으로 저장</span>
              <button type="button" onClick={onToggleAskSaveAs} style={{ width: 48, height: 28, borderRadius: 14, border: 'none', background: askSaveAs ? toggleColor : (isDark ? '#475569' : '#e2e8f0'), cursor: 'pointer', position: 'relative' as const, padding: 0, flexShrink: 0 }} aria-pressed={askSaveAs}>
                <span style={{ position: 'absolute' as const, top: 3, left: askSaveAs ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: isDark ? '#94a3b8' : '#64748b' }}>켜면 파일을 받을 때마다 저장 위치를 고릅니다.</div>
          </div>
        )}

        <div style={{ padding: '12px 14px', borderRadius: 10, background: isDark ? '#334155' : '#f8fafc', display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: isDark ? '#e2e8f0' : '#0f172a' }}>업데이트</h4>
          {!hasElectron ? (
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: isDark ? '#94a3b8' : '#64748b' }}>
              업데이트 확인은 .dmg / .exe로 설치한 TPA-Korea 데스크톱 앱에서만 가능합니다.
              브라우저(localhost)나 개발 서버 창에서는 표시되지 않습니다.
            </p>
          ) : !canCheckUpdates ? (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              <span style={{ fontSize: 13, color: isDark ? '#94a3b8' : '#64748b' }}>
                {appVersion ? `현재 버전 v${appVersion} (개발 모드)` : '버전 확인 중...'}
              </span>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: isDark ? '#94a3b8' : '#64748b' }}>
                npm run dev:app 개발 창에서는 업데이트 확인이 불가합니다.
                Applications에 설치한 TPA-Korea 앱을 실행하거나, 아래에서 릴리즈 페이지에서 .dmg를 받으세요.
                (설치된 앱이 이미 실행 중이면 dev Electron 창이 열리지 않을 수 있습니다.)
              </p>
              <button
                type="button"
                className="self-start px-4 py-2 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-semibold cursor-pointer"
                style={accent.primaryStyle}
                onClick={handleOpenReleasesPage}
              >
                GitHub 릴리즈 페이지
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 8 }}>
                <span style={{ fontSize: 13, color: isDark ? '#94a3b8' : '#64748b' }}>
                  {appVersion ? `현재 버전 v${appVersion}` : '버전 확인 중...'}
                  {updateStatus === 'downloading' && updateVersion && ` · 새 버전 v${updateVersion} 다운로드 중`}
                  {updateStatus === 'ready' && updateVersion && ` · v${updateVersion} 설치 가능`}
                  {updateStatus === 'latest' && ' · 최신 버전입니다'}
                  {updateStatus === 'error' && updateError && ` · ${updateError}`}
                </span>
                {updateStatus !== 'ready' ? (
                  <button type="button" className="px-4 py-2 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-semibold cursor-pointer" style={accent.primaryStyle} disabled={updateStatus === 'checking'} onClick={() => void handleCheckForUpdates()}>
                    {updateStatus === 'checking' ? '확인 중...' : '업데이트 확인'}
                  </button>
                ) : requiresManualInstall ? (
                  <button type="button" className="px-4 py-2 border-none rounded-lg bg-[#16a34a] text-white text-[13px] font-semibold cursor-pointer" style={accent.primaryStyle} onClick={() => void handleOpenUpdateDownload()}>
                    DMG 다운로드
                  </button>
                ) : (
                  <button type="button" className="px-4 py-2 border-none rounded-lg bg-[#16a34a] text-white text-[13px] font-semibold cursor-pointer" style={accent.primaryStyle} onClick={() => void handleQuitAndInstall()}>
                    지금 재시작하여 업데이트
                  </button>
                )}
              </div>
              {updateStatus === 'ready' && requiresManualInstall && (
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: isDark ? '#94a3b8' : '#64748b' }}>
                  macOS는 코드 서명이 없어 자동 설치가 되지 않습니다. DMG를 받아 Applications 폴더의 TPA-Korea를 교체해 설치해 주세요.
                </p>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: isDark ? '#334155' : '#f8fafc' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>상태</h4>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 2 }}>
            {statusOptions.map((opt) => {
              const isSelected = statusInput === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => void handleSetStatus(opt.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: isSelected ? (isDark ? 'rgba(23,23,23,0.12)' : accent.custom ? accent.theme.activeBg : 'rgba(23,23,23,0.06)') : 'transparent',
                    width: '100%', textAlign: 'left' as const,
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${isSelected ? (accent.custom ? accent.theme.accent : '#0f172a') : (isDark ? '#64748b' : '#cbd5e1')}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent.custom ? accent.theme.accent : '#0f172a', display: 'block' }} />}
                  </span>
                  {opt.id ? renderStatusIcon(opt.id, 18) : <span style={{ width: 18, height: 18, display: 'block' }} />}
                  <span style={{ fontSize: 13, color: isDark ? '#cbd5e1' : '#334155', fontWeight: isSelected ? 700 : 500 }}>{opt.label}</span>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: isDark ? '#94a3b8' : '#64748b' }}>상태 메시지</label>
            <input
              value={statusNote}
              onChange={(e) => onStatusNoteChange?.(e.target.value)}
              placeholder="상태 메시지 입력"
              maxLength={200}
              className={cn('rounded-lg border px-3 py-2 text-[13px] font-medium outline-none', isDark ? 'border-slate-600 bg-slate-800 text-slate-100' : accent.custom ? 'border-[rgba(var(--color-brand-dark-rgb),0.3)] bg-white text-slate-900 focus:border-[var(--color-brand-dark)]' : 'border-slate-200 bg-white text-slate-900')}
            />
            <label style={{ fontSize: 12, fontWeight: 700, color: isDark ? '#94a3b8' : '#64748b' }}>사내 내선번호</label>
            <input
              value={extensionInput}
              onChange={(e) => onExtensionChange?.(e.target.value)}
              placeholder="내선번호"
              maxLength={30}
              className={cn('rounded-lg border px-3 py-2 text-[13px] font-medium outline-none', isDark ? 'border-slate-600 bg-slate-800 text-slate-100' : accent.custom ? 'border-[rgba(var(--color-brand-dark-rgb),0.3)] bg-white text-slate-900 focus:border-[var(--color-brand-dark)]' : 'border-slate-200 bg-white text-slate-900')}
            />
            <label style={{ fontSize: 12, fontWeight: 700, color: isDark ? '#94a3b8' : '#64748b' }}>자리 전화번호</label>
            <input
              value={deskPhoneInput}
              onChange={(e) => onDeskPhoneChange?.(e.target.value)}
              placeholder="자리 전화번호"
              maxLength={30}
              className={cn('rounded-lg border px-3 py-2 text-[13px] font-medium outline-none', isDark ? 'border-slate-600 bg-slate-800 text-slate-100' : accent.custom ? 'border-[rgba(var(--color-brand-dark-rgb),0.3)] bg-white text-slate-900 focus:border-[var(--color-brand-dark)]' : 'border-slate-200 bg-white text-slate-900')}
            />
            <button
              type="button"
              onClick={onSaveStatusProfile}
              className="self-start px-3 py-1.5 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[12px] font-bold cursor-pointer"
              style={accent.primaryStyle}
            >
              메시지·내선·전화 저장
            </button>
          </div>
        </div>

        <div style={{ padding: '10px 12px', borderRadius: 10, background: isDark ? '#334155' : '#f8fafc', color: isDark ? '#94a3b8' : '#334155', fontSize: 13 }}>알림 상태: {notificationStatus}</div>

        {hasElectron && <button type="button" className={cn('w-full px-4 py-3 border-none rounded-[10px] text-sm font-semibold cursor-pointer', isDark ? 'bg-slate-700 text-slate-200' : accent.custom ? 'bg-[rgba(var(--color-brand-dark-rgb),0.1)] text-[var(--color-brand-dark)] hover:bg-[rgba(var(--color-brand-dark-rgb),0.15)]' : 'bg-slate-100 text-slate-800')} onClick={onTestNotification}>알림 테스트</button>}
        {!hasElectron && <button type="button" className={cn('w-full px-4 py-3 border-none rounded-[10px] text-sm font-semibold cursor-pointer', isDark ? 'bg-slate-700 text-slate-200' : accent.custom ? 'bg-[rgba(var(--color-brand-dark-rgb),0.1)] text-[var(--color-brand-dark)] hover:bg-[rgba(var(--color-brand-dark-rgb),0.15)]' : 'bg-slate-100 text-slate-800')} onClick={() => void onRequestNotificationPermission()}>알림 권한 요청</button>}
        <button type="button" className={cn('w-full px-4 py-3 border-none rounded-[10px] text-sm font-semibold cursor-pointer text-[#c62828]', isDark ? 'bg-slate-700' : 'bg-slate-100')} onClick={onLogout}>로그아웃</button>
        {onQuit && (
          <button type="button" className={cn('w-full px-4 py-3 border-none rounded-[10px] text-sm font-semibold cursor-pointer', isDark ? 'bg-slate-700 text-slate-200' : accent.custom ? 'bg-[rgba(var(--color-brand-dark-rgb),0.1)] text-[var(--color-brand-dark)] hover:bg-[rgba(var(--color-brand-dark-rgb),0.15)]' : 'bg-slate-100 text-slate-800')} onClick={onQuit}>프로그램 종료</button>
        )}
      </div>
    </div>
  );
}

export default memo(SettingsPanel);
