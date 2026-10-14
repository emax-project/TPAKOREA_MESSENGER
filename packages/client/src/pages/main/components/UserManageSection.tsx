import { memo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { orgApi, usersApi, type JobTitleItem, type OrgCompany, type OrgDepartment, type OrgUser } from '../../../api';
import { useAccentStyles } from '../../../hooks/useAccentStyles';
import { cn } from '../../../utils/cn';
import { companyUsers, departmentUsers, formatJobTitle } from '../../../utils/orgTree';
import UIPromptModal from '../../../components/ui/UIPromptModal';

type Props = {
  isDark: boolean;
  isNarrowLayout?: boolean;
  /** 로그인한 관리자 본인. 자기 자신은 고를 수 없게 한다. */
  currentUserId?: string;
  embedded?: boolean;
};

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const map: Record<string, string> = {
    CANNOT_DELETE_SELF: '자기 자신은 삭제할 수 없습니다.',
    CANNOT_DELETE_ADMIN: '관리자 계정은 삭제할 수 없습니다.',
    USER_NOT_FOUND: '사용자를 찾을 수 없습니다.',
    PASSWORD_TOO_SHORT: '비밀번호가 너무 짧습니다. LDAP 연동 시 12자 이상이어야 합니다.',
    PASSWORD_POLICY: '비밀번호 정책(12자, 대소문자·숫자·특수문자)을 확인해 주세요.',
    LDAP_USER_NOT_FOUND: 'LDAP에서 해당 계정을 찾을 수 없습니다.',
    LDAP_UNAVAILABLE: 'LDAP 서버에 연결할 수 없습니다.',
    MESSAGE_COUNT_MISMATCH: '화면을 띄운 사이 대화가 늘었습니다. 새로고침 후 다시 시도하세요.',
    'Admin only': '관리자만 사용할 수 있습니다.',
  };
  return map[msg] || msg;
}

/** 직급 지정 */
function BadgeIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/** 순번 올리기 / 내리기 */
function CaretIcon({ up }: { up: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: up ? undefined : 'rotate(180deg)' }}
    >
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

/** 비밀번호 초기화 */
function KeyIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.5 12.5 8-8" />
      <path d="m16 6 2 2" />
      <path d="m19 3 2 2" />
    </svg>
  );
}

function UserManageSection({ isDark, isNarrowLayout = false, currentUserId, embedded = false }: Props) {
  const accent = useAccentStyles(isDark);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Electron에서 window.prompt가 동작하지 않아 모달로 값을 받는다
  const [prompting, setPrompting] = useState<
    { kind: 'jobTitle' | 'password'; user: OrgUser } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: orgTree = [] } = useQuery<OrgCompany[]>({
    queryKey: ['org', 'tree'],
    queryFn: orgApi.tree,
  });
  const { data: jobTitles = [] } = useQuery<JobTitleItem[]>({
    queryKey: ['org', 'job-titles'],
    queryFn: orgApi.jobTitles,
  });

  const selectable = (u: OrgUser) => String(u.id) !== String(currentUserId);

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleMany = (users: OrgUser[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      users.filter(selectable).forEach((u) => (on ? next.add(u.id) : next.delete(u.id)));
      return next;
    });

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const applyJobTitle = async (user: OrgUser, raw: string) => {
    setPrompting(null);
    setError(null);
    setNotice(null);
    const jobTitle = raw.trim() || null;
    setBusy(true);
    try {
      const r = await usersApi.setJobTitle(user.id, jobTitle);
      queryClient.invalidateQueries({ queryKey: ['org'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setNotice(
        r.jobTitle ? `'${r.name}'의 직급을 '${r.jobTitle}'로 지정했습니다.` : `'${r.name}'의 직급을 지웠습니다.`,
      );
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const applyPasswordReset = async (user: OrgUser, raw: string) => {
    const password = raw.trim();
    if (password.length < 4) {
      setError('비밀번호가 너무 짧습니다.');
      return;
    }
    setPrompting(null);
    setError(null);
    setNotice(null);
    if (!window.confirm(`'${user.name}'의 비밀번호를 바꿉니다.\n이 사용자의 로그인 세션이 모두 끊기고 새 비밀번호로 다시 로그인해야 합니다.`)) {
      return;
    }
    setBusy(true);
    try {
      const r = await usersApi.resetPassword(user.id, password);
      setNotice(`'${r.name}'의 비밀번호를 바꿨습니다. 새 비밀번호로 다시 로그인하도록 안내해 주세요.`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const reorderUser = async (user: OrgUser, direction: 'up' | 'down') => {
    setError(null);
    setNotice(null);
    try {
      const r = await orgApi.reorderUser(user.id, direction);
      queryClient.invalidateQueries({ queryKey: ['org'] });
      if (!r.moved) setNotice(`'${user.name}'는 이미 부서 안에서 ${direction === 'up' ? '맨 위' : '맨 아래'}입니다.`);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  const onDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setError(null);
    setNotice(null);

    let impacts;
    try {
      impacts = await Promise.all(ids.map((id) => usersApi.deleteImpact(id)));
    } catch (e) {
      setError(friendlyError(e));
      return;
    }

    const totalMessages = impacts.reduce((sum, i) => sum + i.messageCount, 0);
    const lines = impacts
      .map((i) => `· ${i.name} (${i.email}) — 메시지 ${i.messageCount}건`)
      .join('\n');
    const warn =
      totalMessages > 0
        ? `\n\n보낸 메시지 ${totalMessages}건이 함께 삭제되며, 같은 대화방의 다른 사람에게도 사라집니다.`
        : '';
    if (!window.confirm(`아래 ${ids.length}명을 삭제합니다. 되돌릴 수 없습니다.\n\n${lines}${warn}`)) {
      return;
    }

    setBusy(true);
    const done: string[] = [];
    const failed: string[] = [];
    for (const impact of impacts) {
      try {
        await usersApi.remove(impact.id, impact.messageCount);
        done.push(impact.name);
      } catch (e) {
        failed.push(`${impact.name}: ${friendlyError(e)}`);
      }
    }
    setBusy(false);
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['org'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    if (done.length > 0) setNotice(`${done.length}명을 삭제했습니다. (${done.join(', ')})`);
    if (failed.length > 0) setError(failed.join(' / '));
  };

  const border = isDark ? 'border-slate-600' : 'border-slate-200';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const text = isDark ? 'text-slate-200' : 'text-slate-700';
  const sectionBg = isDark ? 'bg-slate-700' : 'bg-slate-50';
  const rowBg = isDark ? 'bg-slate-800' : 'bg-white';
  const line = isDark ? 'bg-slate-600' : 'bg-slate-300';

  const ExpandBox = ({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) => (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        'flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[3px] border text-[10px] leading-none cursor-pointer',
        border,
        muted,
        isDark ? 'bg-slate-900' : 'bg-white',
      )}
    >
      {open ? '−' : '+'}
    </button>
  );

  const renderDept = (dept: OrgDepartment, depth: number) => {
    const key = `dept-${dept.id}`;
    const isOpen = !collapsed.has(key);
    const users = departmentUsers(dept);
    const pickable = users.filter(selectable);
    const allPicked = pickable.length > 0 && pickable.every((u) => selected.has(u.id));

    return (
      <div key={dept.id}>
        <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: depth * 16 }}>
          <ExpandBox open={isOpen} onClick={() => toggleCollapse(key)} label={`${dept.name} 접기/펼치기`} />
          <input
            type="checkbox"
            checked={allPicked}
            disabled={pickable.length === 0}
            onChange={(e) => toggleMany(users, e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:opacity-40"
            style={accent.custom ? { accentColor: accent.theme.accent } : undefined}
          />
          <span className={cn('min-w-0 truncate text-[13px] font-medium', text)}>{dept.name}</span>
          <span className={cn('shrink-0 text-[11px] tabular-nums', muted)}>{users.length}</span>
        </div>
        {isOpen && (
          <div className="relative" style={{ marginLeft: depth * 16 + 7 }}>
            <span className={cn('absolute left-0 top-0 h-full w-px', line)} aria-hidden />
            {dept.users.map((u) => (
              <div key={u.id} className="flex items-center gap-1.5 py-1 pl-4">
                <input
                  type="checkbox"
                  checked={selected.has(u.id)}
                  disabled={!selectable(u)}
                  onChange={() => toggleOne(u.id)}
                  className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:opacity-40"
                  style={accent.custom ? { accentColor: accent.theme.accent } : undefined}
                />
                <span className={cn('min-w-0 truncate text-[13px]', text)}>
                  {u.name}
                  {formatJobTitle(u.jobTitle) && <span className={cn('ml-1 text-[11px]', muted)}>{formatJobTitle(u.jobTitle)}</span>}
                </span>
                <span className={cn('min-w-0 flex-1 truncate text-[11px]', muted)}>{u.email}</span>
                {!selectable(u) && <span className={cn('shrink-0 text-[11px]', muted)}>본인</span>}
                {u.primary !== false && (
                  <>
                    <button
                      type="button"
                      title="부서 안 순번 올리기"
                      aria-label={`${u.name} 순번 올리기`}
                      disabled={busy}
                      onClick={() => void reorderUser(u, 'up')}
                      className={cn(
                        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border-none bg-transparent p-0 cursor-pointer disabled:opacity-40',
                        isDark ? 'text-slate-300 hover:bg-slate-700' : accent.custom ? 'text-[var(--color-brand-dark)] hover:bg-[rgba(var(--color-brand-dark-rgb),0.1)]' : 'text-slate-500 hover:bg-slate-200',
                      )}
                    >
                      <CaretIcon up />
                    </button>
                    <button
                      type="button"
                      title="부서 안 순번 내리기"
                      aria-label={`${u.name} 순번 내리기`}
                      disabled={busy}
                      onClick={() => void reorderUser(u, 'down')}
                      className={cn(
                        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border-none bg-transparent p-0 cursor-pointer disabled:opacity-40',
                        isDark ? 'text-slate-300 hover:bg-slate-700' : accent.custom ? 'text-[var(--color-brand-dark)] hover:bg-[rgba(var(--color-brand-dark-rgb),0.1)]' : 'text-slate-500 hover:bg-slate-200',
                      )}
                    >
                      <CaretIcon up={false} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  title="직급 지정"
                  aria-label={`${u.name} 직급 지정`}
                  disabled={busy}
                  onClick={() => setPrompting({ kind: 'jobTitle', user: u })}
                  className={cn(
                    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border-none bg-transparent p-0 cursor-pointer disabled:opacity-40',
                    isDark ? 'text-slate-300 hover:bg-slate-700' : accent.custom ? 'text-[var(--color-brand-dark)] hover:bg-[rgba(var(--color-brand-dark-rgb),0.1)]' : 'text-slate-500 hover:bg-slate-200',
                  )}
                >
                  <BadgeIcon />
                </button>
                <button
                  type="button"
                  title="비밀번호 초기화"
                  aria-label={`${u.name} 비밀번호 초기화`}
                  disabled={busy}
                  onClick={() => setPrompting({ kind: 'password', user: u })}
                  className={cn(
                    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border-none bg-transparent p-0 cursor-pointer disabled:opacity-40',
                    isDark ? 'text-slate-300 hover:bg-slate-700' : accent.custom ? 'text-[var(--color-brand-dark)] hover:bg-[rgba(var(--color-brand-dark-rgb),0.1)]' : 'text-slate-500 hover:bg-slate-200',
                  )}
                >
                  <KeyIcon />
                </button>
              </div>
            ))}
            {(dept.children ?? []).map((child) => renderDept(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn('flex flex-col gap-3', !embedded && cn('rounded-[10px] px-3.5 py-3', sectionBg))}>
      <div>
        {!embedded && (
          <h4 className={cn('m-0 text-sm font-semibold', isDark ? 'text-slate-200' : 'text-slate-800')}>
            사용자 관리
          </h4>
        )}
        <p className={cn(embedded ? 'mt-0' : 'mt-1', 'mb-0 text-xs leading-relaxed', muted)}>
          조직도에서 사용자를 골라 직급 지정·비밀번호 초기화·삭제를 합니다. 삭제하면 그 사람이 보낸
          메시지도 함께 사라지므로 되돌릴 수 없습니다.
        </p>
      </div>

      {orgTree.length === 0 ? (
        <p className={cn('m-0 text-xs', muted)}>표시할 사용자가 없습니다.</p>
      ) : (
        <div className={cn('max-h-[320px] overflow-auto rounded-lg border px-2 py-1.5', border, rowBg)}>
          {orgTree.map((company) => {
            const key = `company-${company.id}`;
            const isOpen = !collapsed.has(key);
            const users = companyUsers(company);
            const pickable = users.filter(selectable);
            const allPicked = pickable.length > 0 && pickable.every((u) => selected.has(u.id));
            return (
              <div key={company.id}>
                <div className="flex items-center gap-1.5 py-1">
                  <ExpandBox open={isOpen} onClick={() => toggleCollapse(key)} label={`${company.name} 접기/펼치기`} />
                  <input
                    type="checkbox"
                    checked={allPicked}
                    disabled={pickable.length === 0}
                    onChange={(e) => toggleMany(users, e.target.checked)}
                    className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:opacity-40"
                    style={accent.custom ? { accentColor: accent.theme.accent } : undefined}
                  />
                  <span className={cn('min-w-0 truncate text-[13px] font-semibold', text)}>{company.name}</span>
                  <span className={cn('shrink-0 text-[11px] tabular-nums', muted)}>{users.length}</span>
                </div>
                {isOpen && company.departments.map((d) => renderDept(d, 1))}
              </div>
            );
          })}
        </div>
      )}

      <div className={cn('flex items-center gap-2', isNarrowLayout && 'flex-col items-stretch')}>
        <span className={cn('text-xs', muted)}>{selected.size}명 선택됨</span>
        <button
          type="button"
          onClick={() => void onDelete()}
          disabled={selected.size === 0 || busy}
          className={cn(
            'rounded-lg border-none px-4 py-2.5 text-[13px] font-semibold cursor-pointer disabled:opacity-50',
            isDark ? 'bg-red-500/90 text-white' : 'bg-red-600 text-white',
          )}
        >
          {busy ? '삭제 중...' : `선택한 사용자 삭제`}
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className={cn('border-none bg-transparent px-2 py-1 text-xs font-semibold cursor-pointer', muted)}
          >
            선택 해제
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red-500">{error}</div>}
      {notice && <div className={cn('text-xs', isDark ? 'text-emerald-400' : 'text-emerald-600')}>{notice}</div>}

      {prompting?.kind === 'jobTitle' && (
        <UIPromptModal
          isDark={isDark}
          title="직급 지정"
          message={`'${prompting.user.name}'의 직급을 고르거나 직접 입력하세요.\n비우고 확인하면 직급이 없어집니다.`}
          options={jobTitles.map((j) => ({ value: j.name, label: `${j.name} (${j.userCount}명)` }))}
          defaultValue={prompting.user.jobTitle ?? ''}
          placeholder="직급명"
          confirmLabel="지정"
          allowEmpty
          onSubmit={(v) => void applyJobTitle(prompting.user, v)}
          onClose={() => setPrompting(null)}
        />
      )}

      {prompting?.kind === 'password' && (
        <UIPromptModal
          isDark={isDark}
          title="비밀번호 초기화"
          message={`'${prompting.user.name}' (${prompting.user.email})의 새 비밀번호를 입력하세요.\nLDAP 연동 시 12자 이상, 대소문자·숫자·특수문자 포함. 기존 비밀번호는 몰라도 됩니다.`}
          defaultValue=""
          placeholder="새 비밀번호"
          confirmLabel="초기화"
          onSubmit={(v) => void applyPasswordReset(prompting.user, v)}
          onClose={() => setPrompting(null)}
        />
      )}
    </div>
  );
}

export default memo(UserManageSection);
