import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { orgApi, type OrgCompany, type OrgDepartment, type OrgGroup, type OrgUser } from '../../../api';
import type { OnlinePresenceMap } from '../../../utils/presence';
import { cn } from '../../../utils/cn';
import { allOrgUsers, companyUsers, defaultOpenDepartmentIds, displayDepartmentUserCount, flattenDepartments, formatJobTitle } from '../../../utils/orgTree';
import { getOrgTheme, type OrgThemeId } from '../../../utils/orgTheme';

const ACTIVE_BLUE = '#5B8DEF';
const INACTIVE_GRAY = '#c5c9d0';
const FOLDER_BLUE = '#5B8DEF';

function FolderIcon({ size = 15, active = true, activeColor }: { size?: number; active?: boolean; activeColor?: string }) {
  const color = active ? (activeColor ?? FOLDER_BLUE) : INACTIVE_GRAY;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden style={{ flexShrink: 0 }}>
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function MobileIcon({ active }: { active: boolean }) {
  const color = active ? ACTIVE_BLUE : INACTIVE_GRAY;
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <line x1="12" y1="18" x2="12" y2="18.01" />
    </svg>
  );
}

function DesktopIcon({ active }: { active: boolean }) {
  const color = active ? ACTIVE_BLUE : INACTIVE_GRAY;
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function ExpandBox({ open, onClick, isDark }: { open: boolean; onClick: () => void; isDark: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center border p-0 text-[11px] leading-none cursor-pointer rounded-[2px]',
        isDark
          ? 'border-slate-500 bg-slate-800 text-slate-300'
          : 'border-slate-300 bg-white text-slate-600',
      )}
      aria-label={open ? '접기' : '펼치기'}
    >
      {open ? '−' : '+'}
    </button>
  );
}

export type OrgUserContextMenuHandler = (
  e: MouseEvent,
  user: OrgUser,
  opts?: { orgGroupId?: string; selectedUsers?: OrgUser[] },
) => void;

function FriendStar({
  active,
  isDark,
  onClick,
}: {
  active: boolean;
  isDark: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={active ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      aria-label={active ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-none bg-transparent p-0 cursor-pointer transition-colors',
        active
          ? 'text-amber-400'
          : isDark
            ? 'text-slate-500 hover:text-slate-300'
            : 'text-slate-400 hover:text-slate-600',
      )}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}

export type OrgTreeProps = {
  isDark: boolean;
  /** 선택 부서 배경/텍스트 강조색 테마. 라이트 모드에서만 적용된다. */
  accentTheme?: OrgThemeId;
  orgLoading: boolean;
  orgError: boolean;
  orgTree: OrgCompany[];
  orgGroups?: OrgGroup[];
  view?: 'org' | 'friends' | 'groups';
  /** combined: 부서 아래 사원 / split: 부서 트리와 선택 부서 사원 분리 */
  viewMode?: 'combined' | 'split';
  companyMemberCounts?: Record<string, number>;
  treeOpen: Record<string, boolean>;
  /** "나눠서보기"에서 고른 부서. 접혀 있어도 이 부서의 인원은 계속 지연 로드된다(Main.tsx openDeptIdList 참고). */
  selectedDeptId: string | null;
  onSelectDept: (id: string | null) => void;
  orgStarred: Set<string>;
  onToggleOrgStar: (id: string) => void;
  orgFriends: Set<string>;
  onToggleOrgFriend: (userId: string) => void;
  onlineUserIds: Set<string>;
  /** 켜져 있으면 조직도(org) 탭에서 부서 트리 대신 온라인인 사람만 평평한 목록으로 보여준다. */
  showOnlineOnly?: boolean;
  onlinePresence?: OnlinePresenceMap;
  myId?: string;
  myEmail?: string;
  socketConnected: boolean;
  onRetryOrg: () => void;
  onToggleTree: (key: string) => void;
  onOpenDirectMessage: (userId: string) => void | Promise<void>;
  onUserContextMenu: OrgUserContextMenuHandler;
  onRenameOrgGroup?: (group: OrgGroup) => void;
  onDeleteOrgGroup?: (group: OrgGroup) => void;
  onCreateChatFromOrgGroup?: (group: OrgGroup) => void;
  hasStatusIcon: (status?: string | null) => boolean;
  renderStatusIcon: (status: string, size?: number) => JSX.Element | null;
};

const countCompanyUsers = (company: OrgCompany) => companyUsers(company).length;

function OrgUserRow({
  u,
  isDark,
  onlinePresence,
  onlineUserIds,
  myId,
  myEmail,
  socketConnected,
  selected,
  selectedUsers,
  isFriend,
  onToggleFriend,
  onToggleSelect,
  onOpenDirectMessage,
  onUserContextMenu,
  orgGroupId,
  hasStatusIcon,
  renderStatusIcon,
  accentColor,
}: {
  u: OrgUser;
  isDark: boolean;
  onlinePresence: OnlinePresenceMap;
  onlineUserIds: Set<string>;
  myId?: string;
  myEmail?: string;
  socketConnected: boolean;
  selected: boolean;
  selectedUsers: OrgUser[];
  isFriend: boolean;
  onToggleFriend: (userId: string) => void;
  onToggleSelect: (userId: string) => void;
  onOpenDirectMessage: (userId: string) => void | Promise<void>;
  onUserContextMenu: OrgUserContextMenuHandler;
  orgGroupId?: string;
  hasStatusIcon: (status?: string | null) => boolean;
  renderStatusIcon: (status: string, size?: number) => JSX.Element | null;
  /** 선택 시 배경/체크박스 강조색 테마 (라이트 모드 커스텀 테마일 때만 전달됨) */
  accentColor?: { bg: string; checkbox: string };
}) {
  const isMe = String(u.id) === String(myId) || u.email === myEmail;
  const devices = onlinePresence[String(u.id)];
  const selfDesktop = isMe && socketConnected && detectSelfDesktop();
  const selfMobile = isMe && socketConnected && detectSelfMobile();
  const pcActive = devices ? !!devices.desktop : (selfDesktop || (onlineUserIds.has(String(u.id)) && !selfMobile));
  const mobileActive = devices ? !!devices.mobile : selfMobile;
  const isOnline = pcActive || mobileActive || onlineUserIds.has(String(u.id)) || (isMe && socketConnected);
  const jobLabel = formatJobTitle(u.jobTitle);

  const openContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const multi =
      selected && selectedUsers.length > 1
        ? selectedUsers
        : [u];
    onUserContextMenu(e, u, {
      orgGroupId,
      selectedUsers: multi,
    });
  };

  return (
    <li className="list-none">
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded px-1.5 py-[3px] transition-colors',
          selected
            ? (isDark ? 'bg-brand-dark/20' : 'bg-brand-dark/[0.10]')
            : (isDark ? 'hover:bg-slate-800/70' : 'hover:bg-[#f3f6fa]'),
        )}
        style={selected && accentColor ? { background: accentColor.bg } : undefined}
        onContextMenu={openContextMenu}
      >
        <label className="flex shrink-0 cursor-pointer items-center" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(u.id)}
            className="h-3.5 w-3.5 cursor-pointer accent-brand"
            style={accentColor ? { accentColor: accentColor.checkbox } : undefined}
          />
        </label>
        {u.statusMessage && hasStatusIcon(u.statusMessage) && (
          <span className="inline-flex shrink-0" title={u.statusMessage}>
            {renderStatusIcon(u.statusMessage, 12)}
          </span>
        )}
        <button
          type="button"
          title="더블 클릭하면 대화창이 열립니다"
          className={cn(
            'min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left text-[13px] cursor-pointer',
            isOnline
              ? (isDark ? 'text-slate-100 font-medium' : 'text-slate-800 font-medium')
              : (isDark ? 'text-slate-200' : 'text-slate-600'),
          )}
          onClick={() => onToggleSelect(u.id)}
          onDoubleClick={() => void onOpenDirectMessage(u.id)}
          onContextMenu={openContextMenu}
        >
          {jobLabel ? `[${jobLabel}]` : ''}
          {u.name}
          {isMe ? ' (나)' : ''}
        </button>
        <span className="inline-flex shrink-0 items-center gap-0.5">
          <span title={mobileActive ? '모바일 접속 중' : '모바일 오프라인'}>
            <MobileIcon active={mobileActive} />
          </span>
          <span title={pcActive ? 'PC 접속 중' : 'PC 오프라인'}>
            <DesktopIcon active={pcActive} />
          </span>
        </span>
        <FriendStar active={isFriend} isDark={isDark} onClick={() => onToggleFriend(u.id)} />
      </div>
    </li>
  );
}

function detectSelfDesktop() {
  if (typeof window === 'undefined') return true;
  if (window.electronAPI) return true;
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

function detectSelfMobile() {
  return !detectSelfDesktop();
}

function OrgTree({
  isDark,
  accentTheme = 'default',
  orgLoading,
  orgError,
  orgTree,
  orgGroups = [],
  view = 'org',
  viewMode = 'combined',
  companyMemberCounts,
  treeOpen,
  selectedDeptId,
  onSelectDept,
  orgFriends,
  onToggleOrgFriend,
  onlineUserIds,
  showOnlineOnly = false,
  onlinePresence = {},
  myId,
  myEmail,
  socketConnected,
  onRetryOrg,
  onToggleTree,
  onOpenDirectMessage,
  onUserContextMenu,
  onRenameOrgGroup,
  onDeleteOrgGroup,
  onCreateChatFromOrgGroup,
  hasStatusIcon,
  renderStatusIcon,
}: OrgTreeProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // 본부·팀 단계는 접어둔 적이 없다면 기본으로 펼쳐 보인다(매번 본부를 눌러야 하는 불편 방지).
  const defaultOpenDeptIds = useMemo(() => defaultOpenDepartmentIds(orgTree), [orgTree]);
  const [splitRatio, setSplitRatio] = useState(() => {
    try {
      const n = Number(localStorage.getItem('emax_org_split_ratio'));
      return Number.isFinite(n) && n > 0.2 && n < 0.8 ? n : 0.45;
    } catch {
      return 0.45;
    }
  });
  const splitRootRef = useRef<HTMLDivElement | null>(null);
  const draggingSplit = useRef(false);
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingSplit.current || !splitRootRef.current) return;
      const rect = splitRootRef.current.getBoundingClientRect();
      if (rect.height < 40) return;
      const next = (e.clientY - rect.top) / rect.height;
      setSplitRatio(Math.min(0.75, Math.max(0.25, next)));
    };
    const onUp = () => {
      if (!draggingSplit.current) return;
      draggingSplit.current = false;
      try { localStorage.setItem('emax_org_split_ratio', String(splitRatioRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const toggleSelect = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleSelectMany = (ids: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  /**
   * 접혀서 아직 지연 로드가 안 된 부서(usersLoaded === false)의 인원을 "전체 선택"용으로 따로 받아 둔 캐시.
   * 트리 자체(펼침 상태)는 건드리지 않고, 선택 상태·체크 표시·다건 액션 대상 계산에만 쓴다.
   */
  const [fetchedDeptUsers, setFetchedDeptUsers] = useState<Map<string, OrgUser[]>>(() => new Map());

  /** 부서 트리에서 현재 알고 있는 모든 인원 (로드된 부서는 d.users, 안 된 부서는 캐시). */
  const knownUsers = (departments: OrgDepartment[]): OrgUser[] => {
    const byId = new Map<string, OrgUser>();
    flattenDepartments(departments).forEach((d) => {
      const users = d.usersLoaded === false ? (fetchedDeptUsers.get(d.id) ?? []) : (d.users ?? []);
      users.forEach((u) => byId.set(u.id, u));
    });
    return [...byId.values()];
  };

  /**
   * 부서/회사 "전체 선택"용: 접혀서 아직 지연 로드가 안 된 부서는 users가 비어 있으므로,
   * 그 부서들만 GET /org/departments/:id/users로 따로 받아와 캐시에 넣은 뒤 완전한 인원 목록을 돌려준다.
   * (펼쳐본 부서만 선택되고 나머지는 빠지는 문제 방지)
   */
  const resolveAllUsers = async (departments: OrgDepartment[]): Promise<OrgUser[]> => {
    const flat = flattenDepartments(departments);
    const toFetch = flat.filter((d) => d.usersLoaded === false && !fetchedDeptUsers.has(d.id));
    const fetched = new Map<string, OrgUser[]>();
    if (toFetch.length > 0) {
      const results = await Promise.all(
        toFetch.map((d) => orgApi.departmentUsers(d.id).catch(() => null)),
      );
      // 실패한 부서는 캐시에 넣지 않아 다음 체크 때 다시 시도한다.
      toFetch.forEach((d, i) => { const r = results[i]; if (r) fetched.set(d.id, r); });
      if (fetched.size > 0) {
        setFetchedDeptUsers((prev) => {
          const next = new Map(prev);
          fetched.forEach((users, id) => next.set(id, users));
          return next;
        });
      }
    }
    const byId = new Map<string, OrgUser>();
    flat.forEach((d) => {
      const users = d.usersLoaded === false
        ? (fetched.get(d.id) ?? fetchedDeptUsers.get(d.id) ?? [])
        : (d.users ?? []);
      users.forEach((u) => byId.set(u.id, u));
    });
    return [...byId.values()];
  };

  const usersById = (() => {
    const map = new Map<string, OrgUser>();
    if (view === 'groups') {
      orgGroups.forEach((g) => g.members.forEach((u) => map.set(u.id, u)));
    } else {
      // 지연 로드 전이라 트리에 없는 인원도 "전체 선택"으로 선택됐을 수 있으므로 캐시도 포함
      fetchedDeptUsers.forEach((users) => users.forEach((u) => map.set(u.id, u)));
      allOrgUsers(orgTree).forEach((u) => map.set(u.id, u));
    }
    return map;
  })();

  const selectedUsers = [...selectedIds]
    .map((id) => usersById.get(id))
    .filter(Boolean) as OrgUser[];

  // 조직도 강조색 테마. 친구/내 그룹 탭을 포함해 이 컴포넌트 전체에서 쓴다.
  // 파스텔 배경은 라이트 모드 전제로 만들어져 있어 다크 모드에서는 테마
  // 선택과 무관하게 기존 브랜드 블루 스타일을 그대로 쓴다.
  const orgTheme = getOrgTheme(accentTheme);
  const useCustomAccent = !isDark && orgTheme.id !== 'default';
  const rowAccentColor = useCustomAccent ? { bg: orgTheme.activeBg, checkbox: orgTheme.accent } : undefined;

  if (orgLoading && view !== 'groups') {
    return <p className={cn('p-4 text-[13px]', isDark ? 'text-slate-400' : 'text-slate-500')}>로딩 중...</p>;
  }
  if (orgError && view !== 'groups') {
    return (
      <div className="p-5 text-center">
        <p className="mb-1.5 text-sm font-semibold text-red-600">조직 데이터를 불러올 수 없습니다</p>
        <button
          type="button"
          onClick={onRetryOrg}
          className="cursor-pointer rounded-lg border-none bg-brand-dark px-4 py-2 text-[13px] font-semibold text-white"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const userRowProps = {
    isDark,
    onlinePresence,
    onlineUserIds,
    myId,
    myEmail,
    socketConnected,
    selectedUsers,
    onToggleSelect: toggleSelect,
    onToggleFriend: onToggleOrgFriend,
    onOpenDirectMessage,
    onUserContextMenu,
    hasStatusIcon,
    renderStatusIcon,
    accentColor: rowAccentColor,
  };

  // "온라인만 보기"가 켜져 있으면 조직도(org) 탭에서도 부서 트리를 펼쳐 보여주는 대신
  // 온라인인 사람만 평평한 목록으로 보여준다. orgTree는 이미 Main.tsx에서 온라인(+검색어)
  // 조건으로 걸러진 트리라 allOrgUsers로 훑으면 곧 "지금 온라인인 사람 전체" 목록이 된다.
  if (view === 'org' && showOnlineOnly) {
    const online = allOrgUsers(orgTree).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));

    if (online.length === 0) {
      return (
        <p className={cn('p-6 text-center text-[13px] leading-relaxed', isDark ? 'text-slate-400' : 'text-slate-500')}>
          온라인인 사람이 없습니다.
        </p>
      );
    }

    return (
      <div className="px-2.5 py-2">
        <div className={cn('mb-1.5 px-1 text-[12px] tabular-nums', isDark ? 'text-slate-500' : 'text-slate-400')}>
          {online.length}명 온라인
        </div>
        <ul className="m-0 list-none space-y-0.5 p-0">
          {online.map((u) => (
            <OrgUserRow
              key={u.id}
              u={u}
              selected={selectedIds.has(u.id)}
              isFriend={orgFriends.has(String(u.id))}
              {...userRowProps}
            />
          ))}
        </ul>
      </div>
    );
  }

  if (view === 'friends') {
    const friends = allOrgUsers(orgTree)
      .filter((u) => orgFriends.has(String(u.id)))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));

    if (orgFriends.size === 0) {
      return (
        <p className={cn('p-6 text-center text-[13px] leading-relaxed', isDark ? 'text-slate-400' : 'text-slate-500')}>
          즐겨찾기한 친구가 없습니다.<br />
          조직도에서 ★ 또는 우클릭으로 추가하세요.
        </p>
      );
    }

    if (friends.length === 0) {
      return (
        <p className={cn('p-6 text-center text-[13px]', isDark ? 'text-slate-400' : 'text-slate-500')}>
          검색·온라인 필터에 맞는 친구가 없습니다.
        </p>
      );
    }

    return (
      <div className="px-2.5 py-2">
        <div className={cn('mb-1.5 px-1 text-[12px] tabular-nums', isDark ? 'text-slate-500' : 'text-slate-400')}>
          {friends.length}명
        </div>
        <ul className="m-0 list-none space-y-0.5 p-0">
          {friends.map((u) => (
            <OrgUserRow
              key={u.id}
              u={u}
              selected={selectedIds.has(u.id)}
              isFriend
              {...userRowProps}
            />
          ))}
        </ul>
      </div>
    );
  }

  if (view === 'groups') {
    if (orgGroups.length === 0) {
      return (
        <p className={cn('p-4 text-[13px]', isDark ? 'text-slate-400' : 'text-slate-500')}>
          그룹이 없습니다. 상단 + 그룹으로 만들어 보세요.
        </p>
      );
    }
    return (
      <div className="px-2.5 py-1">
        {orgGroups.map((group) => {
          const groupKey = `orggroup-${group.id}`;
          const groupOpen = treeOpen[groupKey] !== false;
          const memberIds = group.members.map((m) => m.id);
          const allSelected = memberIds.length > 0 && memberIds.every((id) => selectedIds.has(id));
          return (
            <div key={group.id} className="mb-0.5">
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <ExpandBox isDark={isDark} open={groupOpen} onClick={() => onToggleTree(groupKey)} />
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleSelectMany(memberIds, e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-brand"
                  style={useCustomAccent ? { accentColor: orgTheme.accent } : undefined}
                />
                <FolderIcon active={groupOpen} activeColor={groupOpen && useCustomAccent ? orgTheme.accent : undefined} />
                <button
                  type="button"
                  onClick={() => onToggleTree(groupKey)}
                  className={cn(
                    'min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left text-[13px] font-semibold cursor-pointer',
                    !(groupOpen && useCustomAccent) &&
                      (groupOpen
                        ? (isDark ? 'text-brand-light' : 'text-brand-dark')
                        : (isDark ? 'text-slate-100' : 'text-slate-900')),
                  )}
                  style={groupOpen && useCustomAccent ? { color: orgTheme.accent } : undefined}
                >
                  {group.name}
                </button>
                <span
                  className={cn(
                    'shrink-0 text-[11px] tabular-nums',
                    !(groupOpen && useCustomAccent) && (isDark ? 'text-slate-500' : 'text-slate-400'),
                  )}
                  style={groupOpen && useCustomAccent ? { color: orgTheme.accent } : undefined}
                >
                  {group.members.length}
                </span>
                {onCreateChatFromOrgGroup && (
                  <button
                    type="button"
                    title="그룹 채팅 만들기"
                    onClick={() => onCreateChatFromOrgGroup(group)}
                    className={cn(
                      'shrink-0 border-none bg-transparent px-1 text-[11px] font-semibold cursor-pointer',
                      !useCustomAccent && (isDark ? 'text-brand-light' : 'text-brand-dark'),
                    )}
                    style={useCustomAccent ? { color: orgTheme.accent } : undefined}
                  >
                    채팅
                  </button>
                )}
                {onRenameOrgGroup && (
                  <button
                    type="button"
                    onClick={() => onRenameOrgGroup(group)}
                    className={cn('shrink-0 border-none bg-transparent px-1 text-[11px] cursor-pointer', isDark ? 'text-slate-400' : 'text-slate-500')}
                  >
                    수정
                  </button>
                )}
                {onDeleteOrgGroup && (
                  <button
                    type="button"
                    onClick={() => onDeleteOrgGroup(group)}
                    className="shrink-0 border-none bg-transparent px-1 text-[11px] text-red-600 cursor-pointer"
                  >
                    삭제
                  </button>
                )}
              </div>
              {groupOpen && (
                <ul className={cn(
                  'm-0 list-none border-l border-dashed py-0.5 pl-3 ml-[7px]',
                  isDark ? 'border-slate-600' : 'border-slate-200',
                )}>
                  {group.members.length === 0 ? (
                    <li className={cn('px-2 py-1 text-xs', isDark ? 'text-slate-500' : 'text-slate-400')}>
                      멤버 없음 · 조직도 탭에서 우클릭으로 추가
                    </li>
                  ) : (
                    group.members.map((u) => (
                      <OrgUserRow
                        key={u.id}
                        u={u}
                        orgGroupId={group.id}
                        selected={selectedIds.has(u.id)}
                        isFriend={orgFriends.has(String(u.id))}
                        {...userRowProps}
                      />
                    ))
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (orgTree.length === 0) {
    return <p className={cn('p-4 text-[13px]', isDark ? 'text-slate-400' : 'text-slate-500')}>표시할 조직이 없습니다.</p>;
  }

  /**
   * 부서는 하위 부서를 가질 수 있으므로 재귀로 그린다.
   * 체크박스는 하위 부서 인원까지 포함해 한 번에 선택되게 한다.
   */
  const renderDept = (dept: OrgDepartment) => {
    const deptKey = `dept-${dept.id}`;
    const deptOpen = treeOpen[deptKey] !== undefined ? !!treeOpen[deptKey] : defaultOpenDeptIds.has(dept.id);
    const children = dept.children ?? [];
    // 이 부서 + 모든 하위 부서의 인원 (아직 로드 안 된 부서가 섞여 있으면 선택 가능한 건 로드된 사람만)
    const deptIds = knownUsers([dept]).map((u) => u.id);
    const deptAllSelected = deptIds.length > 0 && deptIds.every((id) => selectedIds.has(id));
    // 표시용 인원수: 아직 지연 로드 전이면 정확한 참고용 총원(userCount)을, 로드가 끝났으면
    // 실제로 화면에 보이는(필터링된) 인원수를 보여준다 — "온라인만 보기" 등으로 걸러진 뒤에도
    // 총원이 그대로 떠서 필터가 안 먹힌 것처럼 보이는 걸 방지.
    const deptTotalCount = displayDepartmentUserCount(dept);
    const hasContent = viewMode === 'split'
      ? children.length > 0
      : (deptTotalCount > 0 || children.length > 0);
    const isSelectedDept = selectedDeptId === dept.id;
    // 펼쳤는데 이 부서 직속 인원이 아직 안 왔으면(지연 로드 중) 잠깐 로딩 표시.
    // dept.users.length === 0만 보면 "로딩 중"과 "다 왔는데 필터(온라인만 보기 등)로 전부
    // 걸러짐"을 구분 못 해 후자일 때도 로딩 표시가 영원히 남는다 — usersLoaded로 구분.
    // (userCount가 없는 전체 로드 트리에서는 애초에 이 표시 자체가 필요 없음.)
    const ownUsersLoading = deptOpen && dept.userCount !== undefined && !dept.usersLoaded;

    return (
      <div key={dept.id} className="mt-0.5">
        <div
          className={cn(
            'flex items-center gap-1.5 px-1 py-0.5 rounded',
            isSelectedDept && !useCustomAccent && (isDark ? 'bg-brand-dark/20' : 'bg-brand-dark/[0.08]'),
          )}
          style={isSelectedDept && useCustomAccent ? { background: orgTheme.activeBg } : undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void resolveAllUsers([dept]).then((users) => {
              if (users.length === 0) return;
              toggleSelectMany(users.map((u) => u.id), true);
              onUserContextMenu(e, users[0], { selectedUsers: users });
            });
          }}
        >
          <ExpandBox isDark={isDark} open={deptOpen} onClick={() => onToggleTree(deptKey)} />
          <input
            type="checkbox"
            checked={deptAllSelected}
            onChange={(e) => {
              const checked = e.target.checked;
              void resolveAllUsers([dept]).then((users) => toggleSelectMany(users.map((u) => u.id), checked));
            }}
            className="h-3.5 w-3.5 cursor-pointer accent-brand"
            style={useCustomAccent ? { accentColor: orgTheme.accent } : undefined}
          />
          <FolderIcon
            active={deptOpen || isSelectedDept}
            activeColor={(deptOpen || isSelectedDept) && useCustomAccent ? orgTheme.accent : undefined}
          />
          <button
            type="button"
            onClick={() => {
              onSelectDept(dept.id);
              onToggleTree(deptKey);
            }}
            className={cn(
              'min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left text-[13px] font-semibold cursor-pointer',
              !(isSelectedDept && useCustomAccent) &&
                (isSelectedDept
                  ? (isDark ? 'text-brand-light' : 'text-brand-dark')
                  : (isDark ? 'text-slate-300' : 'text-slate-600')),
            )}
            style={isSelectedDept && useCustomAccent ? { color: orgTheme.activeText } : undefined}
          >
            {dept.name}
            <span
              className={cn(
                'ml-0.5 font-normal tabular-nums',
                !(isSelectedDept && useCustomAccent) && (isDark ? 'text-slate-500' : 'text-slate-400'),
              )}
              style={isSelectedDept && useCustomAccent ? { color: orgTheme.activeText } : undefined}
            >
              ({deptTotalCount})
            </span>
          </button>
        </div>
        {deptOpen && hasContent && (
          <div className={cn(
            'ml-[7px] border-l border-dashed pl-2',
            isDark ? 'border-slate-600' : 'border-slate-200',
          )}>
            {viewMode === 'combined' && dept.users.length > 0 && (
              <ul className="m-0 list-none py-0.5 pl-1">
                {dept.users.map((u) => (
                  <OrgUserRow
                    key={u.id}
                    u={u}
                    selected={selectedIds.has(u.id)}
                    isFriend={orgFriends.has(String(u.id))}
                    {...userRowProps}
                  />
                ))}
              </ul>
            )}
            {viewMode === 'combined' && ownUsersLoading && (
              <p className={cn('m-0 py-1 pl-2 text-[12px]', isDark ? 'text-slate-500' : 'text-slate-400')}>불러오는 중…</p>
            )}
            {children.map((child) => renderDept(child))}
          </div>
        )}
      </div>
    );
  };

  const findDept = (depts: OrgDepartment[], id: string): OrgDepartment | null => {
    for (const d of depts) {
      if (d.id === id) return d;
      const found = findDept(d.children ?? [], id);
      if (found) return found;
    }
    return null;
  };

  const selectedDept = selectedDeptId
    ? orgTree.map((c) => findDept(c.departments ?? [], selectedDeptId)).find(Boolean) ?? null
    : null;
  const splitUsers = selectedDept ? (selectedDept.users ?? []) : [];

  return (
    <div
      ref={viewMode === 'split' ? splitRootRef : undefined}
      className={cn('px-2.5 py-1', viewMode === 'split' && 'flex h-full min-h-0 flex-col')}
    >
      <div
        className={viewMode === 'split' ? 'min-h-[80px] overflow-y-auto' : undefined}
        style={viewMode === 'split' ? { height: `${Math.round(splitRatio * 1000) / 10}%` } : undefined}
      >
      {orgTree.map((company) => {
        const companyKey = `company-${company.id}`;
        const companyOpen = treeOpen[companyKey] !== false;
        const memberCount = companyMemberCounts?.[company.id] ?? countCompanyUsers(company);
        const companyUserIds = knownUsers(company.departments ?? []).map((u) => u.id);
        const companyAllSelected =
          companyUserIds.length > 0 && companyUserIds.every((id) => selectedIds.has(id));
        const rootDepts = company.departments ?? [];

        return (
          <div key={company.id} className="mb-0.5">
            <div className="flex items-center gap-1.5 px-1 py-0.5">
              <ExpandBox isDark={isDark} open={companyOpen} onClick={() => onToggleTree(companyKey)} />
              <input
                type="checkbox"
                checked={companyAllSelected}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void resolveAllUsers(rootDepts).then((users) => toggleSelectMany(users.map((u) => u.id), checked));
                }}
                className="h-3.5 w-3.5 cursor-pointer accent-brand"
                style={useCustomAccent ? { accentColor: orgTheme.accent } : undefined}
              />
              <FolderIcon active={companyOpen} activeColor={companyOpen && useCustomAccent ? orgTheme.accent : undefined} />
              <button
                type="button"
                onClick={() => onToggleTree(companyKey)}
                className={cn(
                  'min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left text-[13px] font-bold cursor-pointer',
                  !(companyOpen && useCustomAccent) &&
                    (companyOpen
                      ? (isDark ? 'text-brand-light' : 'text-brand-dark')
                      : (isDark ? 'text-slate-100' : 'text-slate-900')),
                )}
                style={companyOpen && useCustomAccent ? { color: orgTheme.accent } : undefined}
              >
                {company.name}
                <span
                  className={cn(
                    'ml-0.5 font-normal tabular-nums',
                    !(companyOpen && useCustomAccent) && (isDark ? 'text-slate-500' : 'text-slate-400'),
                  )}
                  style={companyOpen && useCustomAccent ? { color: orgTheme.accent } : undefined}
                >
                  ({memberCount})
                </span>
              </button>
            </div>

            {companyOpen && (
              <div className={cn(
                'ml-[7px] border-l border-dashed pl-2',
                isDark ? 'border-slate-600' : 'border-slate-200',
              )}>
                {rootDepts.map((dept) => renderDept(dept))}
              </div>
            )}
          </div>
        );
      })}
      </div>
      {viewMode === 'split' && (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="조직도 영역 크기 조절"
            className={cn(
              'mx-1 my-0.5 h-1.5 shrink-0 cursor-row-resize rounded-full',
              isDark ? 'bg-slate-600 hover:bg-brand' : 'bg-slate-200 hover:bg-brand',
            )}
            onPointerDown={(e) => {
              e.preventDefault();
              draggingSplit.current = true;
            }}
          />
        <div className={cn(
          'min-h-[80px] flex-1 overflow-y-auto rounded-lg border px-2 py-2',
          isDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50',
        )}>
          <div className={cn('mb-1.5 px-1 text-[12px] font-bold', isDark ? 'text-slate-300' : 'text-slate-600')}>
            {selectedDept ? `${selectedDept.name} · ${splitUsers.length}명` : '부서를 선택하세요'}
          </div>
          {selectedDept && splitUsers.length === 0 && selectedDept.userCount !== undefined && !selectedDept.usersLoaded && (
            <p className={cn('px-1 text-[12px]', isDark ? 'text-slate-500' : 'text-slate-400')}>불러오는 중...</p>
          )}
          {selectedDept && splitUsers.length === 0 && (selectedDept.userCount === undefined || selectedDept.usersLoaded) && (
            <p className={cn('px-1 text-[12px]', isDark ? 'text-slate-500' : 'text-slate-400')}>소속 사원이 없습니다.</p>
          )}
          <ul className="m-0 list-none space-y-0.5 p-0">
            {splitUsers.map((u) => (
              <OrgUserRow
                key={u.id}
                u={u}
                selected={selectedIds.has(u.id)}
                isFriend={orgFriends.has(String(u.id))}
                {...userRowProps}
              />
            ))}
          </ul>
        </div>
        </>
      )}
    </div>
  );
}

export default memo(OrgTree);
