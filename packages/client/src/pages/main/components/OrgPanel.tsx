import { memo, useState } from 'react';
import type { OrgCompany, OrgGroup } from '../../../api';
import type { OnlinePresenceMap } from '../../../utils/presence';
import UICloseButton from '../../../components/ui/UICloseButton';
import OrgTree, { type OrgUserContextMenuHandler } from './OrgTree';
import {
  PanelNoDragWrap,
  PanelTitleRow,
  PanelToolbarRow,
  panelTitleRowBg,
} from '../../../components/PanelDragHeader';
import { cn } from '../../../utils/cn';
import { getOrgTheme, type OrgThemeId } from '../../../utils/orgTheme';

type OrgTab = 'org' | 'friends' | 'groups';
export type OrgSearchField = 'all' | 'name' | 'dept' | 'job' | 'email' | 'extension' | 'phone';

const SEARCH_FIELD_OPTIONS: { id: OrgSearchField; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'name', label: '이름' },
  { id: 'dept', label: '부서' },
  { id: 'job', label: '업무' },
  { id: 'email', label: '메일' },
  { id: 'extension', label: '내선' },
  { id: 'phone', label: '휴대폰' },
];

type OrgPanelProps = {
  isDark: boolean;
  /** 상단 영역·선택 부서·탭 강조색 테마 (라이트 모드에서만 적용) */
  accentTheme?: OrgThemeId;
  panelWrapStyle: (maxWidth: number) => { className: string; style: React.CSSProperties };
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  orgSearchField?: OrgSearchField;
  onOrgSearchFieldChange?: (field: OrgSearchField) => void;
  orgViewMode?: 'combined' | 'split';
  onOrgViewModeChange?: (mode: 'combined' | 'split') => void;
  showOnlineOnly: boolean;
  onToggleOnlineOnly: () => void;
  orgLoading: boolean;
  orgError: boolean;
  orgTree: OrgCompany[];
  orgGroups: OrgGroup[];
  companyMemberCounts?: Record<string, number>;
  treeOpen: Record<string, boolean>;
  selectedDeptId: string | null;
  onSelectDept: (id: string | null) => void;
  orgStarred: Set<string>;
  onToggleOrgStar: (id: string) => void;
  orgFriends: Set<string>;
  onToggleOrgFriend: (userId: string) => void;
  onlineUserIds: Set<string>;
  onlinePresence?: OnlinePresenceMap;
  myId?: string;
  myEmail?: string;
  socketConnected: boolean;
  onRetryOrg: () => void;
  onToggleTree: (key: string) => void;
  onOpenDirectMessage: (userId: string) => void | Promise<void>;
  onUserContextMenu: OrgUserContextMenuHandler;
  onCreateOrgGroup: () => void;
  onRenameOrgGroup: (group: OrgGroup) => void;
  onDeleteOrgGroup: (group: OrgGroup) => void;
  onCreateChatFromOrgGroup: (group: OrgGroup) => void;
  hasStatusIcon: (status?: string | null) => boolean;
  renderStatusIcon: (status: string, size?: number) => JSX.Element | null;
};

function OrgPanel({
  isDark,
  accentTheme = 'default',
  panelWrapStyle,
  searchQuery,
  onSearchQueryChange,
  orgSearchField = 'all',
  onOrgSearchFieldChange,
  orgViewMode = 'combined',
  onOrgViewModeChange,
  showOnlineOnly,
  onToggleOnlineOnly,
  orgLoading,
  orgError,
  orgTree,
  orgGroups,
  companyMemberCounts,
  treeOpen,
  selectedDeptId,
  onSelectDept,
  orgStarred,
  onToggleOrgStar,
  orgFriends,
  onToggleOrgFriend,
  onlineUserIds,
  onlinePresence = {},
  myId,
  myEmail,
  socketConnected,
  onRetryOrg,
  onToggleTree,
  onOpenDirectMessage,
  onUserContextMenu,
  onCreateOrgGroup,
  onRenameOrgGroup,
  onDeleteOrgGroup,
  onCreateChatFromOrgGroup,
  hasStatusIcon,
  renderStatusIcon,
}: OrgPanelProps) {
  const wrap = panelWrapStyle(820);
  const [tab, setTab] = useState<OrgTab>('org');

  const title =
    tab === 'org' ? '조직도' : tab === 'friends' ? '즐겨찾기(친구)' : '내 그룹';

  // 상단 영역(제목·탭) 배경 + 탭 강조색 테마. 다크 모드는 항상 기존 스타일 유지.
  const orgTheme = getOrgTheme(accentTheme);
  const useCustomAccent = !isDark && orgTheme.id !== 'default';

  const tabBtn = (id: OrgTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        'px-3.5 py-1.5 rounded-full text-[13px] font-semibold border-none cursor-pointer transition-colors',
        tab === id
          ? (useCustomAccent ? 'text-white' : 'bg-brand-dark text-white')
          : isDark
            ? 'bg-transparent text-slate-400 hover:bg-slate-700/60 hover:text-slate-200'
            : 'bg-transparent text-slate-500 hover:bg-slate-200/70 hover:text-slate-800',
      )}
      style={tab === id && useCustomAccent ? { background: orgTheme.accent } : undefined}
    >
      {label}
    </button>
  );

  return (
    <div
      className={cn(wrap.className, isDark ? 'bg-slate-900' : 'bg-[#f7f8fa]')}
      style={wrap.style}
    >
      <PanelTitleRow
        isDark={isDark}
        title={title}
        compact
        className={useCustomAccent ? undefined : panelTitleRowBg(isDark)}
        style={useCustomAccent ? { background: orgTheme.headerBg } : undefined}
      />

      <div
        className={cn(
          'flex items-center gap-1 px-3 py-2 border-b',
          isDark ? 'border-slate-700/80 bg-slate-900' : (useCustomAccent ? '' : 'border-slate-200/90 bg-[#f7f8fa]'),
          useCustomAccent && 'border-slate-200/90',
        )}
        style={useCustomAccent ? { background: orgTheme.headerBg } : undefined}
      >
        <PanelNoDragWrap className="flex flex-wrap items-center gap-1">
          {tabBtn('org', '조직도')}
          {tabBtn('friends', '친구')}
          {tabBtn('groups', '내 그룹')}
        </PanelNoDragWrap>
      </div>

      <PanelToolbarRow
        isDark={isDark}
        compact
        className={cn(
          '!h-auto !min-h-0 flex-col items-stretch gap-1.5 py-2',
          isDark ? 'bg-slate-900/80' : 'bg-white/70',
        )}
      >
        <PanelNoDragWrap className="flex w-full min-w-0 items-stretch">
          <select
            aria-label="검색 조건"
            value={orgSearchField}
            onChange={(e) => onOrgSearchFieldChange?.(e.target.value as OrgSearchField)}
            className={cn(
              'shrink-0 rounded-l-[6px] border border-r-0 px-2 text-[12px] font-semibold outline-none cursor-pointer',
              isDark
                ? 'border-slate-600 bg-slate-800 text-slate-200'
                : 'border-slate-200 bg-[#f1f4f8] text-slate-700',
            )}
          >
            {SEARCH_FIELD_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <div className="relative min-w-0 flex-1">
            <span
              className={cn(
                'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2',
                isDark ? 'text-slate-500' : 'text-slate-400',
              )}
              aria-hidden
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="검색"
              aria-label="조직 검색"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className={cn(
                'h-full w-full min-h-[32px] rounded-r-[6px] border py-1.5 pl-8 pr-8 text-[13px] font-medium outline-none',
                'focus-visible:ring-2 focus-visible:ring-brand-dark/20',
                isDark
                  ? 'border-slate-600 bg-slate-800 text-slate-200 placeholder:text-slate-500'
                  : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400',
              )}
            />
            {searchQuery.trim().length > 0 && (
              <span className="absolute right-1 top-1/2 -translate-y-1/2">
                <UICloseButton
                  size="sm"
                  variant="subtle"
                  onClick={() => onSearchQueryChange('')}
                  aria-label="검색어 지우기"
                  title="검색어 지우기"
                />
              </span>
            )}
          </div>
        </PanelNoDragWrap>
        <PanelNoDragWrap className="flex w-full flex-wrap items-center gap-1.5">
          {tab === 'org' && (
            <button
              type="button"
              title={orgViewMode === 'combined' ? '하나로보기' : '나눠서보기'}
              onClick={() => onOrgViewModeChange?.(orgViewMode === 'combined' ? 'split' : 'combined')}
              className={cn(
                'shrink-0 px-2.5 py-1 border rounded-2xl text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors',
                isDark
                  ? 'border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {orgViewMode === 'combined' ? '하나로보기' : '나눠서보기'}
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={showOnlineOnly}
            onClick={onToggleOnlineOnly}
            title="온라인만 보기"
            className={cn(
              'shrink-0 flex items-center gap-1.5 px-2.5 py-1 border rounded-2xl text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors',
              showOnlineOnly
                ? (useCustomAccent ? 'text-white' : 'border-brand-dark bg-brand-dark text-white')
                : isDark
                  ? 'border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
            style={showOnlineOnly && useCustomAccent ? { background: orgTheme.accent, borderColor: orgTheme.accent } : undefined}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                showOnlineOnly ? 'bg-emerald-300' : 'bg-emerald-500',
              )}
            />
            온라인
          </button>
          {tab === 'groups' && (
            <button
              type="button"
              onClick={onCreateOrgGroup}
              title="내 그룹 만들기"
              className={cn(
                'shrink-0 px-2.5 py-1 border rounded-2xl text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors',
                isDark
                  ? 'border-slate-600 bg-slate-800 text-brand-light hover:bg-slate-700'
                  : 'border-slate-200 bg-white text-brand-dark hover:bg-brand-dark/[0.06]',
              )}
              style={useCustomAccent ? { color: orgTheme.accent } : undefined}
            >
              + 그룹
            </button>
          )}
        </PanelNoDragWrap>
      </PanelToolbarRow>

      <div className={cn(
        'flex-1 min-h-0',
        tab === 'org' && orgViewMode === 'split' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto overflow-x-hidden',
        isDark ? 'bg-slate-900' : 'bg-white',
      )}>
        <OrgTree
          isDark={isDark}
          accentTheme={accentTheme}
          view={tab}
          viewMode={orgViewMode}
          orgLoading={orgLoading}
          orgError={orgError}
          orgTree={orgTree}
          orgGroups={orgGroups}
          companyMemberCounts={companyMemberCounts}
          treeOpen={treeOpen}
          selectedDeptId={selectedDeptId}
          onSelectDept={onSelectDept}
          orgStarred={orgStarred}
          onToggleOrgStar={onToggleOrgStar}
          orgFriends={orgFriends}
          onToggleOrgFriend={onToggleOrgFriend}
          onlineUserIds={onlineUserIds}
          showOnlineOnly={showOnlineOnly}
          onlinePresence={onlinePresence}
          myId={myId}
          myEmail={myEmail}
          socketConnected={socketConnected}
          onRetryOrg={onRetryOrg}
          onToggleTree={onToggleTree}
          onOpenDirectMessage={onOpenDirectMessage}
          onUserContextMenu={onUserContextMenu}
          onRenameOrgGroup={onRenameOrgGroup}
          onDeleteOrgGroup={onDeleteOrgGroup}
          onCreateChatFromOrgGroup={onCreateChatFromOrgGroup}
          hasStatusIcon={hasStatusIcon}
          renderStatusIcon={renderStatusIcon}
        />
      </div>
    </div>
  );
}

export default memo(OrgPanel);
