import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Socket } from 'socket.io-client';
import { useAuthStore, useThemeStore, useToastStore } from '../store';
import { roomsApi, orgApi, announcementApi, eventsApi, usersApi, mentionsApi, memosApi, foldersApi, orgGroupsApi, authApi, appSettingsApi, type Room, type OrgCompany, type OrgDepartment, type OrgUser, type OrgGroup, type Event, type Folder, type UserAffiliation } from '../api';
import MemoComposeModal from '../components/MemoComposeModal';
import ToastProvider from '../components/ui/ToastProvider';
import TitleBar, { MacInsetChromeTools } from '../components/TitleBar';
import AppLockOverlay from '../components/AppLockOverlay';
import { applyWindowPinClass, isMacElectron, isWinElectron } from '../utils/electronChrome';
import {
  normalizeTimeRange,
  startOfMonth,
  toLocalDateKey,
} from './main/utils/date';
import { useUpdateManager } from './main/hooks/useUpdateManager';
import { useNotificationPrefs } from './main/hooks/useNotificationPrefs';
import { playNotificationSound } from '../utils/notificationSound';
import { useMainSocket } from './main/hooks/useMainSocket';
import { useMainContentActions } from './main/hooks/useMainContentActions';
import LeftSidebar from './main/components/LeftSidebar';
import RoomListItem from './main/components/RoomListItem';
import { type MentionItem } from './main/components/MentionPanel';
import { type MemoItem } from './main/components/MemoPanel';
import RightContentRouter from './main/components/RightContentRouter';
import { hasUnreadAnnouncements, getNewestUnreadAnnouncement } from './main/components/AnnouncementPanel';
import MainOverlays from './main/components/MainOverlays';
import PasswordChangeModal from './main/components/PasswordChangeModal';
import { cn } from '../utils/cn';
import { filterDepartments, flattenDepartments, defaultOpenDepartmentIds, companyUserCount, visibleOpenDepartmentIds } from '../utils/orgTree';
import { APP_MAX_WIDTH, APP_WINDOW_HEIGHT } from '../layout/constants';
import { presenceFromList, type OnlinePresenceMap } from '../utils/presence';
import { openChatRoomWindow } from '../utils/chatPopout';

const STATUS_OPTIONS = [
  { id: '온라인', label: '온라인' },
  { id: '자리 비움', label: '자리 비움' },
  { id: '다른 용무 중', label: '다른 용무 중' },
  { id: '회의 중', label: '회의 중' },
  { id: '외근 중', label: '외근 중' },
];

const AWAY_MINUTES_KEY = 'emax_away_minutes';
const ORG_SEARCH_FIELD_KEY = 'emax_org_search_field';

export type OrgSearchField = 'all' | 'name' | 'dept' | 'job' | 'email' | 'extension' | 'phone';

function StatusIcon({ status, size = 16 }: { status: string; size?: number }) {
  // 온라인: 초록 점
  if (status === '온라인') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: 'block', flexShrink: 0 }}>
        <circle cx="8" cy="8" r="7" fill="#22c55e" />
        <circle cx="8" cy="8" r="3" fill="white" />
      </svg>
    );
  }
  // 자리 비움: 주황 시계
  if (status === '자리 비움') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: 'block', flexShrink: 0 }}>
        <circle cx="8" cy="8" r="7" fill="#f97316" />
        <circle cx="8" cy="8" r="3.5" fill="none" stroke="white" strokeWidth="1.3" />
        <line x1="8" y1="8" x2="8" y2="5.3" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
        <line x1="8" y1="8" x2="10" y2="8" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  // 다른 용무 중: 보라 바
  if (status === '다른 용무 중') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: 'block', flexShrink: 0 }}>
        <circle cx="8" cy="8" r="7" fill="#8b5cf6" />
        <rect x="4.5" y="7" width="7" height="2" rx="1" fill="white" />
      </svg>
    );
  }
  // 회의 중: 파란 말풍선
  if (status === '회의 중') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: 'block', flexShrink: 0 }}>
        <circle cx="8" cy="8" r="7" fill="var(--color-brand)" />
        <rect x="4.5" y="5.5" width="7" height="4.5" rx="1.2" fill="white" opacity="0.95" />
        <polygon points="6,10 5,12 7.5,10" fill="white" opacity="0.95" />
      </svg>
    );
  }
  // 외근/외근 중: 빨간 자동차
  if (status === '외근 중' || status === '외근' || status === '외출') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: 'block', flexShrink: 0 }}>
        <circle cx="8" cy="8" r="7" fill="#ef4444" />
        <rect x="3.5" y="7.5" width="9" height="3" rx="0.8" fill="white" />
        <path d="M5 7.5 L6.5 5.5 H9.5 L11 7.5Z" fill="white" />
        <circle cx="5.5" cy="10.5" r="1" fill="#ef4444" />
        <circle cx="10.5" cy="10.5" r="1" fill="#ef4444" />
      </svg>
    );
  }
  // 휴가(레거시): 초록 태양
  if (status === '휴가') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: 'block', flexShrink: 0 }}>
        <circle cx="8" cy="8" r="7" fill="#22c55e" />
        <circle cx="8" cy="7" r="2.3" fill="white" opacity="0.95" />
      </svg>
    );
  }
  return null;
}

function openChatWindow(roomId: string) {
  if (window.electronAPI?.openChatWindow) {
    window.electronAPI.openChatWindow(roomId);
  } else {
    window.open(`${window.location.origin}/chat/${roomId}`, '_blank', 'width=480,height=680');
  }
}

export default function Main() {
  const { roomId: selectedRoomId } = useParams<{ roomId?: string }>();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);

  // Electron: 메인 화면에서는 모바일 규격 창 크기를 일관되게 유지한다.
  useEffect(() => {
    if (!token || !window.electronAPI) return;
    void window.electronAPI.setWindowUiMode?.('main');
    const resize = () => window.electronAPI!.windowResize(APP_MAX_WIDTH, APP_WINDOW_HEIGHT);
    resize();
    const t = setTimeout(resize, 300);
    return () => clearTimeout(t);
  }, [token]);
  const user = useAuthStore((s) => s.user);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  const setMustChangePassword = useAuthStore((s) => s.setMustChangePassword);
  const myId = user?.id;
  const myEmail = user?.email;
  const logout = useAuthStore((s) => s.logout);
  const isDark = useThemeStore((s) => s.isDark);
  const toggleDark = useThemeStore((s) => s.toggleDark);
  const accentTheme = useThemeStore((s) => s.accentTheme);
  const setAccentTheme = useThemeStore((s) => s.setAccentTheme);

  useEffect(() => {
    window.electronAPI?.setTitleBarTheme?.(isDark);
  }, [isDark]);

  // --- Layout state ---
  const [activePanel, setActivePanel] = useState<'none' | 'notifications' | 'memo' | 'rooms' | 'schedule' | 'settings' | 'notepad'>('none');
  const [searchQuery, setSearchQuery] = useState('');
  const [orgSearchField, setOrgSearchField] = useState<OrgSearchField>(() => {
    try {
      const raw = localStorage.getItem(ORG_SEARCH_FIELD_KEY);
      if (raw === 'all' || raw === 'name' || raw === 'dept' || raw === 'job' || raw === 'email' || raw === 'extension' || raw === 'phone') return raw;
    } catch { /* ignore */ }
    return 'all';
  });
  const [awayMinutes, setAwayMinutes] = useState(() => {
    try {
      const n = Number(localStorage.getItem(AWAY_MINUTES_KEY));
      return Number.isFinite(n) && n > 0 ? n : 10;
    } catch {
      return 10;
    }
  });
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [extensionInput, setExtensionInput] = useState('');
  const [deskPhoneInput, setDeskPhoneInput] = useState('');
  const [notepadValue, setNotepadValue] = useState('');
  const [notepadSaveStatus, setNotepadSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const notepadTouchedRef = useRef(false);
  const notepadSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [orgViewMode, setOrgViewMode] = useState<'combined' | 'split'>(() => {
    try {
      return localStorage.getItem('emax_org_view_mode') === 'combined' ? 'combined' : 'split';
    } catch {
      return 'split';
    }
  });
  const [screenLocked, setScreenLocked] = useState(false);
  const [askSaveAs, setAskSaveAs] = useState(false);
  const autoAwayRef = useRef(false);
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [showOnlineOnly, setShowOnlineOnly] = useState(false);
  const [sectionOpen, setSectionOpen] = useState<{ topic: boolean; chat: boolean }>({ topic: true, chat: true });
  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({});
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [createGroupFor, setCreateGroupFor] = useState<'topic' | 'chat'>('topic');
  const recentTopicRoomRef = useRef<{ id: string; at: number } | null>(null);
  const [announcementEdit, setAnnouncementEdit] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [eventForm, setEventForm] = useState({ title: '', startAt: '', endAt: '', description: '' });
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });
  const [treeOpen, setTreeOpen] = useState<Record<string, boolean>>({});
  // 조직도 "나눠서보기"에서 고른 부서. 트리 펼침 상태(treeOpen)와는 별개라, 고른 뒤
  // 접어도(아래 openDeptIdList에서 따로 챙겨 주지 않으면) 인원이 안 불러와져 "0명"으로
  // 보이는 문제가 있었다 — 접혀 있어도 선택된 부서는 항상 지연 로드 대상에 포함시킨다.
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [orgStarred, setOrgStarred] = useState<Set<string>>(() => {
    try { const raw = localStorage.getItem('emax_org_favorites'); if (!raw) return new Set(); const arr = JSON.parse(raw); return new Set(Array.isArray(arr) ? arr.map(String) : []); } catch { return new Set(); }
  });
  const [orgFriends, setOrgFriends] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('emax_org_friends');
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch {
      return new Set();
    }
  });
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [onlinePresence, setOnlinePresence] = useState<OnlinePresenceMap>({});
  const [showMemoCompose, setShowMemoCompose] = useState(false);
  const [memoComposeRecipients, setMemoComposeRecipients] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; user: OrgUser; orgGroupId?: string; selectedUsers?: OrgUser[] } | null>(null);
  const [addToGroupUsers, setAddToGroupUsers] = useState<OrgUser[] | null>(null);
  const [profileModalUser, setProfileModalUser] = useState<OrgUser | null>(null);
  const [showCreateOrgGroupModal, setShowCreateOrgGroupModal] = useState(false);
  const [renamingOrgGroup, setRenamingOrgGroup] = useState<OrgGroup | null>(null);
  const [deletingOrgGroup, setDeletingOrgGroup] = useState<OrgGroup | null>(null);
  const [roomContextMenu, setRoomContextMenu] = useState<{ x: number; y: number; room: Room } | null>(null);
  const [showFolderManageModal, setShowFolderManageModal] = useState(false);
  const [avatarEditFile, setAvatarEditFile] = useState<File | null>(null);
  const [statusInput, setStatusInput] = useState('');
  const showToast = useToastStore((s) => s.show);
  const {
    mutedRoomIds,
    notificationsSnoozedUntil,
    notificationSoundEnabled,
    mutedRoomIdsRef,
    notificationsSnoozedUntilRef,
    toggleMuteRoom,
    snoozeNotifications,
    clearSnooze,
    toggleNotificationSound,
  } = useNotificationPrefs(showToast);
  const {
    appVersion,
    canCheckUpdates,
    updateStatus,
    updateVersion,
    updateError,
    requiresManualInstall,
    handleCheckForUpdates,
    handleQuitAndInstall,
    handleOpenUpdateDownload,
    handleOpenReleasesPage,
  } = useUpdateManager({
    hasElectron: !!window.electronAPI,
    electronPlatform: window.electronAPI?.platform,
    activePanel,
    showToast,
  });
  const socketRef = useRef<Socket | null>(null);
  const myIdRef = useRef<string | undefined>(myId);
  const statusSyncedRef = useRef(false);
  const queryClient = useQueryClient();
  myIdRef.current = myId;
  // 모바일 셸(maxWidth) 안에서는 항상 좁은 레이아웃으로 동작
  const isNarrowLayout = true;
  const panelWrapStyle = useCallback((_maxWidth: number) => ({
    className: 'flex-1 flex flex-col min-h-0 w-full',
    style: { maxWidth: '100%' } as React.CSSProperties,
  }), []);

  const notificationStatus = typeof Notification === 'undefined' ? '지원되지 않음' : Notification.permission === 'granted' ? '허용됨' : Notification.permission === 'denied' ? '차단됨' : '미정';
  const requestNotificationPermission = async () => { if (typeof Notification !== 'undefined' && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* ignore */ } } };

  const hasElectron = !!window.electronAPI;

  // --- Queries ---
  const { data: allRooms = [], isError: roomsError } = useQuery<Room[]>({ queryKey: ['rooms', myId], queryFn: roomsApi.list, enabled: !!myId });
  const { data: folders = [] } = useQuery<Folder[]>({ queryKey: ['folders'], queryFn: foldersApi.list, enabled: !!myId });
  useMainSocket({
    token,
    queryClient,
    myIdRef,
    recentTopicRoomRef,
    mutedRoomIdsRef,
    notificationsSnoozedUntilRef,
    setOnlineUserIds,
    setOnlinePresence,
    setSocketConnected,
    setSocket,
    socketRef,
    allRooms,
    socket,
    socketConnected,
  });
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const q = useMemo(() => deferredSearchQuery.trim().toLowerCase(), [deferredSearchQuery]);
  const deferredRoomSearchQuery = useDeferredValue(roomSearchQuery);
  const roomQ = useMemo(() => deferredRoomSearchQuery.trim().toLowerCase(), [deferredRoomSearchQuery]);
  const { topicRooms, chatRooms } = useMemo(() => {
    const filtered = roomQ ? allRooms.filter((r) => r.name?.toLowerCase().includes(roomQ)) : allRooms;
    return {
      topicRooms: filtered.filter((r) => r.isGroup && r.isTopic),
      chatRooms: filtered.filter((r) => !r.isGroup || !r.isTopic),
    };
  }, [allRooms, roomQ]);

  const toggleFolder = useCallback((folderId: string) => setFolderOpen((prev) => ({ ...prev, [folderId]: !prev[folderId] })), []);
  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const roomsByFolder = useMemo(() => {
    const byFolder = new Map<string | null, Room[]>();
    byFolder.set(null, []);
    for (const f of folders) byFolder.set(f.id, []);
    for (const r of topicRooms) {
      const key = r.folderId && folderIds.has(r.folderId) ? r.folderId : null;
      const list = byFolder.get(key)!;
      list.push(r);
    }
    return byFolder;
  }, [topicRooms, folders, folderIds]);

  const topicUnreadCount = useMemo(() => topicRooms.reduce((sum, r) => sum + (r.unreadCount ?? 0), 0), [topicRooms]);
  const chatUnreadCount = useMemo(() => chatRooms.reduce((sum, r) => sum + (r.unreadCount ?? 0), 0), [chatRooms]);
  const totalUnreadCount = topicUnreadCount + chatUnreadCount;

  // 조직도: 기본은 부서 구조 + 인원수만 있는 가벼운 트리를 받고, 실제로 펼쳐진 부서의
  // 사용자 목록만 그때그때 지연 로드한다. 조직 전체를 대상으로 찾아야 하는 경우(검색어가
  // 있거나, "즐겨찾기(친구)" 탭은 부서를 안 펼쳐도 어디 있는 사람이든 바로 보여야 하거나,
  // "온라인만 보기"는 펼쳐본 적 없는 부서에 있는 온라인인 사람도 놓치면 안 되므로)엔
  // 전체 트리를 받아온다(이후로는 캐시돼서 다시 켜도 재요청하지 않음).
  const hasOrgSearch = !!q;
  const needsFullOrgTree = hasOrgSearch || orgFriends.size > 0 || showOnlineOnly;
  const {
    data: orgTreeShallow = [],
    isLoading: orgShallowLoading,
    isError: orgShallowError,
    refetch: refetchOrgShallow,
  } = useQuery<OrgCompany[]>({ queryKey: ['org', 'tree', 'shallow'], queryFn: orgApi.treeShallow, enabled: !!myId });
  const {
    data: orgTreeFull,
    isLoading: orgFullLoading,
    isError: orgFullError,
    refetch: refetchOrgFull,
  } = useQuery<OrgCompany[]>({ queryKey: ['org', 'tree'], queryFn: orgApi.tree, enabled: !!myId && needsFullOrgTree });

  // 검색으로 필터링되기 전 원본 기준으로 계산해야 본부·팀 깊이가 흔들리지 않는다.
  // (구조는 가벼운 트리·전체 트리가 동일하므로 항상 가벼운 트리 기준으로 계산해도 된다)
  const defaultOpenDeptIds = useMemo(() => defaultOpenDepartmentIds(orgTreeShallow ?? []), [orgTreeShallow]);

  // 전체 트리가 필요 없을 때만: 현재 화면에 펼쳐져 보이는 부서들 + "나눠서보기"에서 선택된
  // 부서(접혀 있어도)의 사용자 목록을 병렬로 지연 로드.
  const openDeptIdList = useMemo(() => {
    if (needsFullOrgTree) return [] as string[];
    const ids = new Set(visibleOpenDepartmentIds(orgTreeShallow ?? [], treeOpen, defaultOpenDeptIds));
    if (selectedDeptId) ids.add(selectedDeptId);
    return [...ids];
  }, [needsFullOrgTree, orgTreeShallow, treeOpen, defaultOpenDeptIds, selectedDeptId]);
  const deptUserQueries = useQueries({
    queries: openDeptIdList.map((id) => ({
      queryKey: ['org', 'department-users', id],
      queryFn: () => orgApi.departmentUsers(id),
      enabled: !!myId,
      staleTime: 60_000,
    })),
  });
  const deptUsersMap = useMemo(() => {
    const map: Record<string, OrgUser[]> = {};
    openDeptIdList.forEach((id, i) => {
      const users = deptUserQueries[i]?.data;
      if (users) map[id] = users;
    });
    return map;
  }, [openDeptIdList, deptUserQueries]);

  // 실제로 화면·검색·즐겨찾기 등 하위 로직이 쓰는 조직 트리.
  // 전체가 필요하면 전체 트리를, 아니면 가벼운 트리 위에 지연 로드된 부서 사용자를 덧씌운 것을 쓴다.
  const orgTreeRaw = useMemo<OrgCompany[]>(() => {
    if (needsFullOrgTree) return orgTreeFull ?? [];
    const overlay = (departments: OrgDepartment[]): OrgDepartment[] =>
      (departments ?? []).map((d) => ({
        ...d,
        users: deptUsersMap[d.id] ?? d.users ?? [],
        // 실제로 지연 로드가 끝났는지 여부. "온라인만 보기" 등으로 users가 걸러져 비어 보여도
        // usersLoaded는 그대로 유지돼야 "로딩 중" 표시가 계속 안 뜬다 (filterDepartments가
        // users/children만 덮어쓰고 나머지 필드는 그대로 두므로 필터링 이후에도 값이 보존됨).
        usersLoaded: d.id in deptUsersMap,
        children: overlay(d.children ?? []),
      }));
    return (orgTreeShallow ?? []).map((c) => ({ ...c, departments: overlay(c.departments ?? []) }));
  }, [needsFullOrgTree, orgTreeFull, orgTreeShallow, deptUsersMap]);
  const orgLoading = needsFullOrgTree ? orgFullLoading : orgShallowLoading;
  const orgError = needsFullOrgTree ? orgFullError : orgShallowError;
  const refetchOrg = needsFullOrgTree ? refetchOrgFull : refetchOrgShallow;

  const { data: affiliationData } = useQuery<{ departmentId: string | null; affiliations: UserAffiliation[] }>({
    queryKey: ['users', 'affiliations'],
    queryFn: usersApi.affiliations,
    enabled: !!myId,
  });
  const { data: orgGroupsRaw = [] } = useQuery<OrgGroup[]>({
    queryKey: ['org-groups'],
    queryFn: orgGroupsApi.list,
    enabled: !!myId,
  });
  const orgTree = useMemo(() => {
    const tree = orgTreeRaw ?? [];
    const keepUser = (u: OrgUser) => {
      const onlineMatch = !showOnlineOnly || onlineUserIds.has(String(u.id));
      if (!onlineMatch) return false;
      if (!q) return true;
      if (orgSearchField === 'name') return !!u.name?.toLowerCase().includes(q);
      if (orgSearchField === 'job') return !!u.jobTitle?.toLowerCase().includes(q);
      if (orgSearchField === 'email') return !!u.email?.toLowerCase().includes(q);
      if (orgSearchField === 'extension') return !!u.extension?.toLowerCase().includes(q);
      if (orgSearchField === 'phone') return !!u.phone?.toLowerCase().includes(q);
      if (orgSearchField === 'dept') return true; // 부서 매칭은 keepDept에서
      // all
      return !!(
        u.name?.toLowerCase().includes(q)
        || u.email?.toLowerCase().includes(q)
        || u.phone?.toLowerCase().includes(q)
        || u.extension?.toLowerCase().includes(q)
        || u.jobTitle?.toLowerCase().includes(q)
      );
    };
    const keepDept = (d: { name?: string }) => {
      if (!q) return false;
      if (orgSearchField === 'dept' || orgSearchField === 'all') {
        return !!d.name?.toLowerCase().includes(q);
      }
      return false;
    };
    const filtered = tree.map((company) => ({
      ...company,
      departments: filterDepartments(company.departments ?? [], keepUser, keepDept),
    })).filter((company) => (company.departments?.length ?? 0) > 0);
    return filtered
      .map((c) => ({ ...c, departments: [...c.departments].sort((a, b) => (orgStarred.has(b.id) ? 1 : 0) - (orgStarred.has(a.id) ? 1 : 0)) }))
      .sort((a, b) => (orgStarred.has(b.id) ? 1 : 0) - (orgStarred.has(a.id) ? 1 : 0));
  }, [orgTreeRaw, q, showOnlineOnly, onlineUserIds, orgStarred, orgSearchField]);

  const orgGroups = useMemo(() => {
    return (orgGroupsRaw ?? [])
      .map((g) => ({
        ...g,
        members: (g.members ?? []).filter((u) => {
          const onlineMatch = !showOnlineOnly || onlineUserIds.has(String(u.id));
          if (!onlineMatch) return false;
          if (!q) return true;
          if (orgSearchField === 'name') return !!u.name?.toLowerCase().includes(q);
          if (orgSearchField === 'job') return !!u.jobTitle?.toLowerCase().includes(q);
          if (orgSearchField === 'email') return !!u.email?.toLowerCase().includes(q);
          if (orgSearchField === 'extension') return !!u.extension?.toLowerCase().includes(q);
          if (orgSearchField === 'phone') return !!u.phone?.toLowerCase().includes(q);
          if (orgSearchField === 'dept') return true;
          return !!(
            u.name?.toLowerCase().includes(q)
            || u.email?.toLowerCase().includes(q)
            || u.phone?.toLowerCase().includes(q)
            || u.extension?.toLowerCase().includes(q)
            || u.jobTitle?.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => (!q && !showOnlineOnly) || g.members.length > 0);
  }, [orgGroupsRaw, q, showOnlineOnly, onlineUserIds, orgSearchField]);

  const companyMemberCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const company of orgTreeRaw ?? []) {
      // userCount(서버 메타데이터) 우선 — 부서를 아직 안 펼쳐 사용자 목록이 안 실려 있어도 정확한 값을 준다.
      counts[company.id] = companyUserCount(company);
    }
    return counts;
  }, [orgTreeRaw]);

  const { data: onlineData } = useQuery({ queryKey: ['org', 'online'], queryFn: orgApi.online, enabled: !!token });
  const { data: announcementData } = useQuery({ queryKey: ['announcement'], queryFn: announcementApi.get, enabled: !!token });
  const { data: externalSiteSetting } = useQuery({
    queryKey: ['settings', 'external-site'],
    queryFn: appSettingsApi.getExternalSite,
    enabled: !!token,
  });
  const externalSiteUrl = externalSiteSetting?.url?.trim() || '';
  const { data: events = [] } = useQuery<Event[]>({ queryKey: ['events'], queryFn: eventsApi.list, enabled: !!token });
  const { data: mentions = [] } = useQuery({ queryKey: ['mentions'], queryFn: mentionsApi.list, enabled: !!token && activePanel === 'notifications' });
  const { data: unreadMentionCount } = useQuery({ queryKey: ['mentions', 'unread-count'], queryFn: mentionsApi.unreadCount, enabled: !!token, refetchInterval: 30000 });
  const { data: memoInbox = [] } = useQuery({ queryKey: ['memos', 'inbox'], queryFn: memosApi.inbox, enabled: !!token && activePanel === 'memo' });
  const { data: memoSent = [] } = useQuery({ queryKey: ['memos', 'sent'], queryFn: memosApi.sent, enabled: !!token && activePanel === 'memo' });
  const { data: unreadMemoCount } = useQuery({ queryKey: ['memos', 'unread-count'], queryFn: memosApi.unreadCount, enabled: !!token, refetchInterval: 30000 });
  const { data: publicRooms = [] } = useQuery({ queryKey: ['rooms', 'public'], queryFn: roomsApi.listPublic, enabled: !!token && activePanel === 'rooms' && sectionOpen.topic });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, Event[]>();
    events.forEach((ev) => {
      const startAt = new Date(ev.startAt);
      const endAt = new Date(ev.endAt);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return;

      const rangeStart = new Date(startAt);
      const rangeEnd = new Date(endAt);
      if (rangeStart > rangeEnd) return;

      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setHours(0, 0, 0, 0);

      const cursor = new Date(rangeStart);
      while (cursor <= rangeEnd) {
        const key = toLocalDateKey(cursor.toISOString());
        if (key) {
          const list = map.get(key) || [];
          list.push(ev);
          map.set(key, list);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [events]);

  const announcementItems = useMemo(
    () => (Array.isArray(announcementData?.items) ? announcementData.items : []),
    [announcementData?.items],
  );

  // --- Effects ---
  useEffect(() => { if (!selectedDate) return; setEventForm((prev) => { const n = normalizeTimeRange(selectedDate, prev.startAt, prev.endAt); return { ...prev, startAt: n.startAt, endAt: n.endAt }; }); }, [selectedDate]);
  useEffect(() => {
    if (!onlineData) return;
    const map = presenceFromList(onlineData.userIds, onlineData.presence);
    setOnlinePresence(map);
    setOnlineUserIds(new Set(Object.keys(map).filter((id) => map[id].desktop || map[id].mobile)));
  }, [onlineData]);
  useEffect(() => {
    const unread = getNewestUnreadAnnouncement(announcementItems);
    if (unread?.content?.trim()) {
      setShowAnnouncementModal(true);
    }
  }, [announcementItems]);
  useEffect(() => { if (!contextMenu) return; const close = () => setContextMenu(null); const t = setTimeout(() => document.addEventListener('click', close), 100); return () => { clearTimeout(t); document.removeEventListener('click', close); }; }, [contextMenu]);
  useEffect(() => { if (!roomContextMenu) return; const close = () => setRoomContextMenu(null); const t = setTimeout(() => document.addEventListener('click', close), 100); return () => { clearTimeout(t); document.removeEventListener('click', close); }; }, [roomContextMenu]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (contextMenu) setContextMenu(null);
      if (roomContextMenu) setRoomContextMenu(null);
      if (profileModalUser) setProfileModalUser(null);
      if (showAnnouncementModal) setShowAnnouncementModal(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [contextMenu, roomContextMenu, profileModalUser, showAnnouncementModal]);
  useEffect(() => {
    if (statusSyncedRef.current || !myId) return;
    // 조직도(orgTreeRaw)는 이제 부서를 펼쳐야 사용자가 채워지는 지연 로드 트리라, 내가
    // 속한 부서가 안 펼쳐져 있으면 거기서 "나"를 못 찾을 수 있다. 내 상태 초기화는 조직도
    // 로딩과 무관하게 항상 되어야 하므로 /auth/me로 직접 내 프로필을 가져온다.
    let cancelled = false;
    (async () => {
      try {
        const { user: me } = await authApi.me();
        if (cancelled) return;
        // 재접속/재로그인 시 이전 상태(자리비움 등)를 그대로 이어받지 않고 '온라인'으로 초기화한다.
        // statusMessage가 비어있는(null) 최초 로그인 상태도 '아직 온라인으로 안 바뀐 상태'로 보고
        // 반드시 handleSetStatus를 호출해 DB에 '온라인' 문자열을 기록·브로드캐스트해야
        // 조직도에 온라인 상태 아이콘이 노출된다. (statusMessage가 null이면 아이콘 자체가
        // 표시되지 않으므로 "이미 온라인"으로 간주해 건너뛰면 안 됨)
        setStatusInput('온라인');
        setStatusNote(me.statusNote || '');
        setExtensionInput(me.extension || '');
        setDeskPhoneInput(me.deskPhone || '');
        statusSyncedRef.current = true;
        if (me.statusMessage !== '온라인') void handleSetStatus('온라인');
      } catch (err) {
        console.error('Failed to sync my status:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [myId]);

  // 메모장: 서버(/auth/me)에서 불러온 값으로 채운다. 사용자가 입력을 시작한 뒤로는 덮어쓰지 않는다.
  useEffect(() => {
    if (notepadTouchedRef.current) return;
    setNotepadValue(user?.notepad || '');
  }, [user?.notepad]);

  useEffect(() => () => {
    if (notepadSaveTimerRef.current) clearTimeout(notepadSaveTimerRef.current);
  }, []);

  const handleNotepadChange = (value: string) => {
    notepadTouchedRef.current = true;
    setNotepadValue(value);
    setNotepadSaveStatus('saving');
    if (notepadSaveTimerRef.current) clearTimeout(notepadSaveTimerRef.current);
    notepadSaveTimerRef.current = setTimeout(() => {
      usersApi.updateNotepad(value)
        .then(() => setNotepadSaveStatus('saved'))
        .catch((err) => {
          console.error(err);
          setNotepadSaveStatus('error');
        });
    }, 800);
  };

  const currentDeptLabel = useMemo(() => {
    const active = affiliationData?.affiliations?.find((a) => a.active);
    if (active?.label) return active.label;
    if (!myId) return '';
    for (const company of orgTreeRaw ?? []) {
      for (const dept of flattenDepartments(company.departments ?? [])) {
        if ((dept.users ?? []).some((u) => String(u.id) === String(myId))) {
          return `${company.name} · ${dept.name}`;
        }
      }
    }
    return '';
  }, [affiliationData, orgTreeRaw, myId]);

  // 자리비움 자동 전환 (설정 분 동안 입력 없으면)
  useEffect(() => {
    const minutes = awayMinutes;
    if (!minutes || minutes <= 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const cur = statusInput || '온라인';
        if (cur === '온라인' || cur === '') {
          autoAwayRef.current = true;
          void handleSetStatus('자리 비움');
        }
      }, minutes * 60 * 1000);
    };
    const onActivity = () => {
      if (autoAwayRef.current && statusInput === '자리 비움') {
        autoAwayRef.current = false;
        void handleSetStatus('온라인');
      }
      arm();
    };
    arm();
    const evs = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel'] as const;
    evs.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      if (timer) clearTimeout(timer);
      evs.forEach((e) => window.removeEventListener(e, onActivity));
    };
    // handleSetStatus is stable enough via closure; include statusInput for restore
  }, [awayMinutes, statusInput]);

  useEffect(() => {
    try { localStorage.setItem(AWAY_MINUTES_KEY, String(awayMinutes)); } catch { /* ignore */ }
  }, [awayMinutes]);

  useEffect(() => {
    try { localStorage.setItem(ORG_SEARCH_FIELD_KEY, orgSearchField); } catch { /* ignore */ }
  }, [orgSearchField]);

  useEffect(() => {
    try { localStorage.setItem('emax_org_view_mode', orgViewMode); } catch { /* ignore */ }
  }, [orgViewMode]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getAlwaysOnTop) return;
    void api.getAlwaysOnTop().then((r) => {
      const on = !!r?.alwaysOnTop;
      setAlwaysOnTop(on);
      applyWindowPinClass(on);
    });
    void api.getDownloadPath?.().then((r) => {
      setDownloadPath(r?.path ?? null);
      setAskSaveAs(!!r?.askSaveAs);
    });
  }, []);

  // 앱 아이콘 배지 (맥 도크/윈도우 태스크바) - 실제 안 읽은 개수 표시
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const count = token ? totalUnreadCount : 0;
    const badgeText = count > 99 ? '99+' : String(count);
    if (api.platform === 'darwin' && api.setBadgeCount) {
      api.setBadgeCount(count).catch(() => {});
    } else if (api.platform === 'win32' && api.setOverlayIcon) {
      import('../utils/badgeOverlay').then(({ generateBadgeOverlayIcon }) => {
        const dataUrl = count > 0 ? generateBadgeOverlayIcon(badgeText) : null;
        api.setOverlayIcon!(dataUrl).catch(() => {});
        api.setTrayBadge?.(dataUrl).catch(() => {});
      });
    } else if (api.setBadgeCount) {
      api.setBadgeCount(count).catch(() => {});
    }
  }, [token, totalUnreadCount]);

  // 알림 클릭 시 해당 채팅방으로 이동
  useEffect(() => {
    if (!window.electronAPI?.onNavigateToRoom) return;
    const unsubscribe = window.electronAPI.onNavigateToRoom((roomId: string) => {
      if (openChatRoomWindow(roomId)) return;
      setActivePanel('none');
      navigate(`/room/${roomId}`);
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [navigate]);

  // --- Handlers ---
  const toggleSection = useCallback((key: 'topic' | 'chat') => setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] })), []);
  const toggleTree = (key: string) => setTreeOpen((prev) => {
    // 회사·내 그룹: 기본 펼침 / 부서: 본부·팀 단계까지는 기본 펼침, 그 아래는 기본 접힘
    const defaultOpen = key.startsWith('company-') || key.startsWith('orggroup-')
      || (key.startsWith('dept-') && defaultOpenDeptIds.has(key.slice('dept-'.length)));
    const currentlyOpen = prev[key] === undefined ? defaultOpen : !!prev[key];
    return { ...prev, [key]: !currentlyOpen };
  });
  const toggleOrgStar = (id: string) => {
    setOrgStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('emax_org_favorites', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
  const toggleOrgFriend = useCallback((userId: string) => {
    setOrgFriends((prev) => {
      const next = new Set(prev);
      const id = String(userId);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('emax_org_friends', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const handleToggleFavorite = async (room: Room) => { try { await roomsApi.toggleFavorite(room.id, !room.isFavorite); queryClient.invalidateQueries({ queryKey: ['rooms'] }); } catch (err) { console.error(err); } setRoomContextMenu(null); };
  const handleToggleMuteRoom = (roomId: string) => { toggleMuteRoom(roomId); setRoomContextMenu(null); };
  const handleLeaveRoom = async (roomId: string) => { if (!confirm('채팅방을 나가시겠습니까?')) { setRoomContextMenu(null); return; } try { await roomsApi.leave(roomId); queryClient.invalidateQueries({ queryKey: ['rooms'] }); } catch (err) { console.error(err); } setRoomContextMenu(null); };
  const handleSwitchAffiliation = async (departmentId: string) => {
    try {
      await usersApi.setAffiliation(departmentId);
      queryClient.invalidateQueries({ queryKey: ['users', 'affiliations'] });
      queryClient.invalidateQueries({ queryKey: ['org'] });
      useToastStore.getState().show('표시 소속을 변경했습니다', 'success');
    } catch (err) {
      console.error(err);
      useToastStore.getState().show('소속 전환에 실패했습니다', 'error');
    }
  };
  const handleSetStatus = async (msg: string) => {
    try {
      await usersApi.updateStatus(msg);
      setStatusInput(msg);
      if (msg !== '자리 비움') autoAwayRef.current = false;
      queryClient.invalidateQueries({ queryKey: ['org'] });
    } catch (err) {
      console.error(err);
    }
  };
  const handleOpenExternalSite = () => {
    const url = externalSiteUrl;
    if (!url) {
      showToast(
        user?.isAdmin
          ? '설정에서 링크 주소를 먼저 저장해 주세요'
          : '관리자가 아직 링크를 설정하지 않았습니다',
        'error',
      );
      if (user?.isAdmin) setActivePanel('settings');
      return;
    }
    const openExternal = window.electronAPI?.openExternal;
    if (openExternal) void openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };
  const handleSaveStatusProfile = async () => {
    try {
      await usersApi.updateProfile({
        statusNote: statusNote.trim() || null,
        extension: extensionInput.trim() || null,
        deskPhone: deskPhoneInput.trim() || null,
      });
      queryClient.invalidateQueries({ queryKey: ['org'] });
      useToastStore.getState().show('저장되었습니다', 'success');
    } catch (err) {
      console.error(err);
    }
  };
  const handleToggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    const r = await window.electronAPI?.setAlwaysOnTop?.(next);
    const on = !!(r?.alwaysOnTop ?? next);
    setAlwaysOnTop(on);
    applyWindowPinClass(on);
  };
  const handlePickDownloadPath = async () => {
    const r = await window.electronAPI?.pickDownloadPath?.();
    if (!r?.canceled) setDownloadPath(r?.path ?? null);
  };
  const handleClearDownloadPath = async () => {
    await window.electronAPI?.clearDownloadPath?.();
    setDownloadPath(null);
  };
  const handleToggleAskSaveAs = async () => {
    const next = !askSaveAs;
    const r = await window.electronAPI?.setAskSaveAs?.(next);
    setAskSaveAs(!!(r?.askSaveAs ?? next));
  };
  const handleQuitApp = () => {
    void window.electronAPI?.appQuit?.();
  };
  const handleOrgSearchFieldChange = (field: OrgSearchField) => setOrgSearchField(field);
  const handleOrgViewModeChange = (mode: 'combined' | 'split') => setOrgViewMode(mode);
  const handleSendMailToUsers = (users: OrgUser[]) => {
    const emails = users.map((u) => u.email).filter(Boolean);
    if (emails.length === 0) return;
    const href = `mailto:${emails.join(',')}`;
    if (window.electronAPI?.openExternal) void window.electronAPI.openExternal(href);
    else window.open(href, '_blank');
  };
  const handleSelectAvatarFile = useCallback((file: File) => setAvatarEditFile(file), []);
  const handleDeleteAvatar = useCallback(async () => {
    try {
      await usersApi.deleteAvatar();
      const { user: u } = await authApi.me();
      if (u) useAuthStore.getState().setAuth(u, useAuthStore.getState().token);
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      queryClient.invalidateQueries({ queryKey: ['org'] });
    } catch (err) {
      console.error(err);
      alert('프로필 사진 삭제에 실패했습니다.');
    }
  }, [queryClient]);
  const handleSaveAnnouncement = useCallback(async () => {
    const trimmedContent = announcementEdit.trim();
    if (!trimmedContent) return;
    setAnnouncementSaving(true);
    try {
      if (editingAnnouncementId && editingAnnouncementId !== 'new') {
        await announcementApi.update(editingAnnouncementId, {
          title: announcementTitle.trim(),
          content: trimmedContent,
        });
      } else {
        await announcementApi.create({
          title: announcementTitle.trim(),
          content: trimmedContent,
        });
      }
      setEditingAnnouncementId(null);
      setAnnouncementEdit('');
      setAnnouncementTitle('');
      queryClient.invalidateQueries({ queryKey: ['announcement'] });
    } catch (err) {
      console.error(err);
    } finally {
      setAnnouncementSaving(false);
    }
  }, [announcementEdit, announcementTitle, editingAnnouncementId, queryClient]);
  const handleStartCreateAnnouncement = useCallback(() => {
    setEditingAnnouncementId('new');
    setAnnouncementTitle('');
    setAnnouncementEdit('');
  }, []);
  const handleStartEditAnnouncement = useCallback((item: { id: string; title?: string | null; content: string }) => {
    setEditingAnnouncementId(item.id);
    setAnnouncementTitle(item.title ?? '');
    setAnnouncementEdit(item.content);
  }, []);
  const handleCancelEditAnnouncement = useCallback(() => {
    setEditingAnnouncementId(null);
    setAnnouncementEdit('');
    setAnnouncementTitle('');
  }, []);
  const handleTestNotification = useCallback(() => {
    playNotificationSound(true);
    window.electronAPI?.showNotification('TPA-Korea', '알림 테스트입니다.');
  }, []);
  const handleLogout = useCallback(() => {
    queryClient.removeQueries({ queryKey: ['rooms'] });
    queryClient.removeQueries({ queryKey: ['org'] });
    logout();
  }, [logout, queryClient]);
  const handleOpenRoom = useCallback((room: Room) => {
    if (openChatRoomWindow(room.id)) return;
    setActivePanel('none');
    navigate(`/room/${room.id}`, room.viewMode ? { state: { viewMode: room.viewMode } } : undefined);
  }, [navigate]);
  const handleRoomContextMenu = useCallback((e: React.MouseEvent<HTMLLIElement>, room: Room) => {
    e.preventDefault();
    setRoomContextMenu({ x: e.clientX, y: e.clientY, room });
  }, []);
  const handleJoinPublicRoom = useCallback(async (publicRoomId: string) => {
    try {
      await roomsApi.join(publicRoomId);
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      queryClient.invalidateQueries({ queryKey: ['rooms', 'public'] });
      if (openChatRoomWindow(publicRoomId)) return;
      setActivePanel('none');
      navigate(`/room/${publicRoomId}`);
    } catch (err) {
      console.error(err);
    }
  }, [navigate, queryClient]);
  const handleNavigateHome = useCallback(() => {
    setActivePanel('none');
    navigate('/', { replace: true, state: null });
  }, [navigate]);
  const handleSelectMention = useCallback(async (m: MentionItem) => {
    if (!m.readAt) {
      try {
        await mentionsApi.markRead(m.id);
        queryClient.invalidateQueries({ queryKey: ['mentions'] });
        queryClient.invalidateQueries({ queryKey: ['mentions', 'unread-count'] });
      } catch (err) {
        console.error(err);
      }
    }
    if (m.message?.room?.id) {
      if (openChatRoomWindow(m.message.room.id)) return;
      setActivePanel('none');
      navigate(`/room/${m.message.room.id}`);
    }
  }, [navigate, queryClient]);
  const handleOpenMemoCompose = useCallback((recipientIds: string[] = []) => {
    setMemoComposeRecipients(recipientIds);
    setShowMemoCompose(true);
  }, []);
  const handleMemoSent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['memos'] });
  }, [queryClient]);
  const handleMarkMemoRead = useCallback(async (memo: MemoItem) => {
    if (memo.readAt) return;
    try {
      await memosApi.markRead(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    } catch (err) {
      console.error(err);
    }
  }, [queryClient]);
  const handleDeleteMemo = useCallback(async (memo: MemoItem) => {
    try {
      await memosApi.remove(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    } catch (err) {
      console.error(err);
    }
  }, [queryClient]);
  const handleSendMemoToUser = useCallback((userId: string) => {
    setContextMenu(null);
    setActivePanel('memo');
    handleOpenMemoCompose([userId]);
  }, [handleOpenMemoCompose]);
  const hasStatusIcon = useCallback((status?: string | null) => {
    if (!status) return false;
    return STATUS_OPTIONS.some((o) => o.id === status) || status === '외근' || status === '휴가' || status === '외출';
  }, []);
  const handleToggleOnlineOnly = useCallback(() => {
    setShowOnlineOnly((v) => !v);
  }, []);
  const handleOpenDirectMessage = useCallback(async (userId: string) => {
    try {
      const room = await roomsApi.create(userId);
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      if (openChatRoomWindow(room.id)) return;
      setActivePanel('none');
      navigate(`/room/${room.id}`);
    } catch (err) {
      console.error(err);
    }
  }, [navigate, queryClient]);
  const handleUserContextMenu = useCallback((e: React.MouseEvent, userInfo: OrgUser, opts?: { orgGroupId?: string; selectedUsers?: OrgUser[] }) => {
    e.preventDefault();
    const selectedUsers =
      opts?.selectedUsers && opts.selectedUsers.length > 0
        ? opts.selectedUsers
        : [userInfo];
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      user: userInfo,
      orgGroupId: opts?.orgGroupId,
      selectedUsers,
    });
  }, []);

  const handleCreateOrgGroup = useCallback(async (name: string) => {
    await orgGroupsApi.create(name.trim());
    queryClient.invalidateQueries({ queryKey: ['org-groups'] });
  }, [queryClient]);

  const openCreateOrgGroupModal = useCallback(() => {
    setShowCreateOrgGroupModal(true);
  }, []);

  const handleRenameOrgGroupSubmit = useCallback(async (name: string) => {
    if (!renamingOrgGroup) return;
    await orgGroupsApi.update(renamingOrgGroup.id, name.trim());
    queryClient.invalidateQueries({ queryKey: ['org-groups'] });
  }, [queryClient, renamingOrgGroup]);

  const handleDeleteOrgGroupConfirm = useCallback(async () => {
    if (!deletingOrgGroup) return;
    await orgGroupsApi.delete(deletingOrgGroup.id);
    queryClient.invalidateQueries({ queryKey: ['org-groups'] });
  }, [queryClient, deletingOrgGroup]);

  const handleCreateChatFromOrgGroup = useCallback(async (group: OrgGroup) => {
    const full = (orgGroupsRaw ?? []).find((g) => g.id === group.id) ?? group;
    const memberIds = (full.members ?? [])
      .map((m) => m.id)
      .filter((id) => id && id !== myId);
    if (memberIds.length === 0) {
      alert('그룹에 다른 멤버가 없습니다. 멤버를 추가한 뒤 다시 시도해 주세요.');
      return;
    }
    try {
      if (memberIds.length === 1) {
        const room = await roomsApi.create(memberIds[0]);
        queryClient.invalidateQueries({ queryKey: ['rooms'] });
        if (openChatRoomWindow(room.id)) return;
        setActivePanel('none');
        navigate(`/room/${room.id}`);
        return;
      }
      const room = await roomsApi.createGroup({
        name: full.name,
        memberIds,
      });
      if (myId) {
        queryClient.setQueryData<Room[]>(['rooms', myId], (prev) => {
          const roomToAdd = { ...room, unreadCount: 0, isFavorite: false } as Room;
          if (!prev) return [roomToAdd];
          if (prev.some((r) => r.id === room.id)) return prev;
          return [roomToAdd, ...prev];
        });
      }
      queryClient.setQueryData(['rooms', room.id], room);
      if (openChatRoomWindow(room.id)) return;
      setActivePanel('none');
      navigate(`/room/${room.id}`);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : '그룹 채팅 생성에 실패했습니다.');
    }
  }, [orgGroupsRaw, myId, queryClient, navigate]);

  const handleAddToOrgGroup = useCallback(async (groupId: string, userIds: string[]) => {
    const ids = [...new Set(userIds.map(String))].filter((id) => id && id !== String(myId));
    if (ids.length === 0) {
      setAddToGroupUsers(null);
      return;
    }
    try {
      const results = await Promise.allSettled(ids.map((userId) => orgGroupsApi.addMember(groupId, userId)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      const ok = results.length - failed;
      queryClient.invalidateQueries({ queryKey: ['org-groups'] });
      setAddToGroupUsers(null);
      if (failed > 0 && ok === 0) {
        alert('그룹에 추가하지 못했습니다.');
      } else if (failed > 0) {
        alert(`${ok}명 추가 · ${failed}명 실패`);
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : '그룹에 추가하지 못했습니다.');
    }
  }, [queryClient, myId]);

  const handleRemoveFromOrgGroup = useCallback(async (groupId: string, userId: string) => {
    try {
      await orgGroupsApi.removeMember(groupId, userId);
      queryClient.invalidateQueries({ queryKey: ['org-groups'] });
      setContextMenu(null);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : '그룹에서 제거하지 못했습니다.');
    }
  }, [queryClient]);

  const handleTopicCreated = useCallback((id: string) => {
    recentTopicRoomRef.current = { id, at: Date.now() };
  }, []);
  const handleGroupCreated = useCallback((roomId: string, viewMode?: 'chat' | 'board', opts?: { skipRoomsInvalidate?: boolean }) => {
    if (!opts?.skipRoomsInvalidate) queryClient.invalidateQueries({ queryKey: ['rooms'] });
    if (openChatRoomWindow(roomId)) return;
    setActivePanel('none');
    navigate(`/room/${roomId}`, viewMode != null ? { state: { viewMode } } : undefined);
  }, [navigate, queryClient]);
  const handleConfirmAvatar = useCallback(async (croppedFile: File) => {
    await usersApi.uploadAvatar(croppedFile);
    const { user: u } = await authApi.me();
    if (u) useAuthStore.getState().setAuth(u, useAuthStore.getState().token);
    queryClient.invalidateQueries({ queryKey: ['rooms'] });
    queryClient.invalidateQueries({ queryKey: ['org'] });
  }, [queryClient]);
  const {
    handleEditEvent,
    handleCancelEventEdit,
    handleUpdateEvent,
    handleCreateEvent,
    handleDeleteEvent,
    handleOpenChatInNewWindow,
  } = useMainContentActions({
    queryClient,
    selectedDate,
    setEditingEventId,
    setEventForm,
    editingEventId,
    eventForm,
    navigate,
    openChatWindow,
  });

  const hasNewAnnouncement = useMemo(() => {
    if (activePanel === 'notifications') return false;
    return hasUnreadAnnouncements(announcementItems);
  }, [announcementItems, activePanel]);

  const modalAnnouncement = useMemo(
    () => getNewestUnreadAnnouncement(announcementItems),
    [announcementItems],
  );

  const unreadNotificationCount = useMemo(() => {
    const mentionCount = unreadMentionCount?.count ?? 0;
    return mentionCount + (hasNewAnnouncement ? 1 : 0);
  }, [unreadMentionCount?.count, hasNewAnnouncement]);

  const renderRoomItem = useCallback((r: Room) => (
    <RoomListItem
      key={r.id}
      room={r}
      mutedRoomIds={mutedRoomIds}
      onOpenRoom={handleOpenRoom}
      onContextMenu={handleRoomContextMenu}
    />
  ), [mutedRoomIds, handleOpenRoom, handleRoomContextMenu]);

  return (
    <div className={cn('relative flex flex-col h-full min-h-0 w-full min-w-0', isDark ? 'bg-slate-900' : 'bg-white')}>
      {hasElectron && isMacElectron() && (
        <MacInsetChromeTools
          isDark={isDark}
          showPin
          pinned={alwaysOnTop}
          onTogglePin={() => { void handleToggleAlwaysOnTop(); }}
          showSettings
          onSettings={() => setActivePanel((p) => (p === 'settings' ? 'none' : 'settings'))}
        />
      )}
      {hasElectron && isWinElectron() && (
        <TitleBar
          title="TPA-Korea"
          isDark={isDark}
          showLogo
          showPin
          pinned={alwaysOnTop}
          onTogglePin={() => { void handleToggleAlwaysOnTop(); }}
          showSettings
          onSettings={() => setActivePanel((p) => (p === 'settings' ? 'none' : 'settings'))}
        />
      )}
      {screenLocked && <AppLockOverlay onUnlock={() => setScreenLocked(false)} />}
      <div className="flex flex-1 flex-row min-h-0 min-w-0">
        <LeftSidebar
          isDark={isDark}
          activePanel={activePanel}
          setActivePanel={setActivePanel}
          unreadNotificationCount={unreadNotificationCount}
          unreadMemoCount={unreadMemoCount?.count ?? 0}
          totalUnreadCount={totalUnreadCount}
          onNavigateHome={handleNavigateHome}
          statusOptions={STATUS_OPTIONS}
          currentStatus={statusInput || '온라인'}
          renderStatusIcon={(status, size = 14) => <StatusIcon status={status} size={size} />}
          onSetStatus={(s) => { void handleSetStatus(s); }}
          affiliations={affiliationData?.affiliations ?? []}
          onSwitchAffiliation={(id) => { void handleSwitchAffiliation(id); }}
          currentDeptLabel={currentDeptLabel}
          onLock={() => setScreenLocked(true)}
          onLogout={handleLogout}
          onQuit={hasElectron ? handleQuitApp : undefined}
          externalSiteUrl={externalSiteUrl}
          onOpenExternalSite={handleOpenExternalSite}
        />

        <div className={cn('flex-1 min-h-0 min-w-0 flex flex-col', isDark ? 'bg-slate-900' : 'bg-white')}>
          <div className="flex-1 min-h-0 min-w-0 flex flex-col">
            <RightContentRouter
              isDark={isDark}
              accentTheme={accentTheme}
              isNarrowLayout={isNarrowLayout}
              activePanel={activePanel}
              selectedRoomId={selectedRoomId}
              panelWrapStyle={panelWrapStyle}
              onOpenInNewWindow={handleOpenChatInNewWindow}
              mentions={Array.isArray(mentions) ? mentions : []}
              onSelectMention={handleSelectMention}
              unreadMentionCount={unreadMentionCount?.count ?? 0}
              notificationProps={{
                items: announcementItems,
                isAdmin: user?.isAdmin,
                announcementEdit,
                announcementTitle,
                editingAnnouncementId,
                announcementSaving,
                onAnnouncementEditChange: setAnnouncementEdit,
                onAnnouncementTitleChange: setAnnouncementTitle,
                onStartCreateAnnouncement: handleStartCreateAnnouncement,
                onStartEditAnnouncement: handleStartEditAnnouncement,
                onCancelEditAnnouncement: handleCancelEditAnnouncement,
                onSaveAnnouncement: handleSaveAnnouncement,
              }}
              memoProps={{
                inbox: Array.isArray(memoInbox) ? memoInbox : [],
                sent: Array.isArray(memoSent) ? memoSent : [],
                onOpenCompose: () => handleOpenMemoCompose(),
                onMarkRead: handleMarkMemoRead,
                onDelete: handleDeleteMemo,
              }}
              roomsProps={{
                isDark,
                roomsError,
                folders,
                topicRooms,
                chatRooms,
                topicUnreadCount,
                chatUnreadCount,
                sectionOpen,
                roomsByFolder,
                folderOpen,
                publicRooms,
                allRooms,
                toggleSection,
                toggleFolder,
                setShowFolderManageModal,
                setCreateGroupFor,
                setShowCreateGroupModal,
                renderRoomItem,
                onJoinPublicRoom: handleJoinPublicRoom,
                roomSearchQuery,
                onRoomSearchQueryChange: setRoomSearchQuery,
              }}
              orgProps={{
                searchQuery,
                onSearchQueryChange: setSearchQuery,
                orgSearchField,
                onOrgSearchFieldChange: handleOrgSearchFieldChange,
                orgViewMode,
                onOrgViewModeChange: handleOrgViewModeChange,
                showOnlineOnly,
                onToggleOnlineOnly: handleToggleOnlineOnly,
                orgLoading,
                orgError,
                orgTree,
                orgGroups,
                companyMemberCounts,
                treeOpen,
                selectedDeptId,
                onSelectDept: setSelectedDeptId,
                orgStarred,
                onToggleOrgStar: toggleOrgStar,
                orgFriends,
                onToggleOrgFriend: toggleOrgFriend,
                onlineUserIds,
                onlinePresence,
                myId,
                myEmail,
                socketConnected: !!socket?.connected,
                onRetryOrg: () => { void refetchOrg(); },
                onToggleTree: toggleTree,
                onOpenDirectMessage: handleOpenDirectMessage,
                onUserContextMenu: handleUserContextMenu,
                onCreateOrgGroup: openCreateOrgGroupModal,
                onRenameOrgGroup: (g) => setRenamingOrgGroup(g),
                onDeleteOrgGroup: (g) => setDeletingOrgGroup(g),
                onCreateChatFromOrgGroup: (g) => { void handleCreateChatFromOrgGroup(g); },
                hasStatusIcon,
                renderStatusIcon: (status, size = 11) => <StatusIcon status={status} size={size} />,
              }}
              scheduleProps={{
                calendarMonth,
                selectedDate,
                eventsByDate,
                eventForm,
                editingEventId,
                setCalendarMonth,
                setSelectedDate,
                setEventForm,
                onUpdateEvent: handleUpdateEvent,
                onCreateEvent: handleCreateEvent,
                onCancelEdit: handleCancelEventEdit,
                onEditEvent: handleEditEvent,
                onDeleteEvent: handleDeleteEvent,
              }}
              settingsProps={{
                notificationsSnoozedUntil,
                notificationSoundEnabled,
                snoozeNotifications,
                clearSnooze,
                toggleNotificationSound,
                toggleDark,
                accentTheme,
                onAccentThemeChange: setAccentTheme,
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
                statusNote,
                onStatusNoteChange: setStatusNote,
                extensionInput,
                onExtensionChange: setExtensionInput,
                deskPhoneInput,
                onDeskPhoneChange: setDeskPhoneInput,
                onSaveStatusProfile: () => void handleSaveStatusProfile(),
                awayMinutes,
                onAwayMinutesChange: setAwayMinutes,
                downloadPath,
                askSaveAs,
                onPickDownloadPath: () => void handlePickDownloadPath(),
                onClearDownloadPath: () => void handleClearDownloadPath(),
                onToggleAskSaveAs: () => void handleToggleAskSaveAs(),
                statusOptions: STATUS_OPTIONS,
                renderStatusIcon: (status, size = 18) => <StatusIcon status={status} size={size} />,
                handleSetStatus,
                notificationStatus,
                onSelectAvatarFile: handleSelectAvatarFile,
                onDeleteAvatar: handleDeleteAvatar,
                onTestNotification: handleTestNotification,
                onRequestNotificationPermission: requestNotificationPermission,
                onLogout: handleLogout,
                onQuit: hasElectron ? handleQuitApp : undefined,
                user,
              }}
              notepadProps={{
                value: notepadValue,
                onChange: handleNotepadChange,
                saveStatus: notepadSaveStatus,
              }}
            />
          </div>
        </div>
      </div>

      {/* ===== MODALS ===== */}
      <MainOverlays
        isDark={isDark}
        showAnnouncementModal={showAnnouncementModal}
        announcementTitle={modalAnnouncement?.title ?? undefined}
        announcementContent={modalAnnouncement?.content ?? undefined}
        setShowAnnouncementModal={setShowAnnouncementModal}
        showCreateGroupModal={showCreateGroupModal}
        createGroupFor={createGroupFor}
        setShowCreateGroupModal={setShowCreateGroupModal}
        onTopicCreated={handleTopicCreated}
        onGroupCreated={handleGroupCreated}
        avatarEditFile={avatarEditFile}
        setAvatarEditFile={setAvatarEditFile}
        onConfirmAvatar={handleConfirmAvatar}
        showFolderManageModal={showFolderManageModal}
        setShowFolderManageModal={setShowFolderManageModal}
        topicRooms={topicRooms}
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        setProfileModalUser={setProfileModalUser}
        orgGroups={orgGroupsRaw}
        addToGroupUsers={addToGroupUsers}
        setAddToGroupUsers={setAddToGroupUsers}
        onAddToOrgGroup={handleAddToOrgGroup}
        onRemoveFromOrgGroup={handleRemoveFromOrgGroup}
        showCreateOrgGroupModal={showCreateOrgGroupModal}
        setShowCreateOrgGroupModal={setShowCreateOrgGroupModal}
        onCreateOrgGroup={handleCreateOrgGroup}
        onOpenCreateOrgGroupModal={openCreateOrgGroupModal}
        renamingOrgGroup={renamingOrgGroup}
        setRenamingOrgGroup={setRenamingOrgGroup}
        onRenameOrgGroupSubmit={handleRenameOrgGroupSubmit}
        deletingOrgGroup={deletingOrgGroup}
        setDeletingOrgGroup={setDeletingOrgGroup}
        onDeleteOrgGroupConfirm={handleDeleteOrgGroupConfirm}
        roomContextMenu={roomContextMenu}
        setRoomContextMenu={setRoomContextMenu}
        mutedRoomIds={mutedRoomIds}
        onToggleFavorite={handleToggleFavorite}
        onToggleMuteRoom={handleToggleMuteRoom}
        onLeaveRoom={handleLeaveRoom}
        profileModalUser={profileModalUser}
        onlineUserIds={onlineUserIds}
        onSendMemoToUser={handleSendMemoToUser}
        onSendMemoToUsers={(ids) => {
          setMemoComposeRecipients(ids);
          setShowMemoCompose(true);
          setContextMenu(null);
        }}
        onSendMailToUsers={handleSendMailToUsers}
        orgFriends={orgFriends}
        onToggleOrgFriend={toggleOrgFriend}
      />

      {showMemoCompose && (
        <MemoComposeModal
          initialRecipientIds={memoComposeRecipients}
          onClose={() => setShowMemoCompose(false)}
          onSent={handleMemoSent}
        />
      )}

      {mustChangePassword && (
        <PasswordChangeModal
          isDark={isDark}
          forced
          onClose={() => {}}
          onSuccess={() => setMustChangePassword(false)}
        />
      )}

      <ToastProvider />
    </div>
  );
}
