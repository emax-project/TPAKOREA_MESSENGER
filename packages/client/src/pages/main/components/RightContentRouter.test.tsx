// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Event } from '../../../api';
import RightContentRouter from './RightContentRouter';

afterEach(() => {
  cleanup();
});

vi.mock('../../ChatWindow', () => ({
  default: ({ onOpenInNewWindow }: { onOpenInNewWindow: () => void }) => (
    <button type="button" onClick={onOpenInNewWindow}>open-chat-window</button>
  ),
}));

vi.mock('./NotificationPanel', () => ({
  default: () => <div data-testid="notification-panel">notification-panel</div>,
}));

vi.mock('./RoomsPanel', () => ({
  default: () => <div data-testid="rooms-panel">rooms-panel</div>,
}));

vi.mock('./SchedulePanel', () => ({
  default: ({ selectedDate }: { selectedDate: string }) => <div data-testid="schedule-panel">{selectedDate}</div>,
}));

vi.mock('./SettingsPanel', () => ({
  default: () => <div data-testid="settings-panel">settings-panel</div>,
}));


vi.mock('./MemoPanel', () => ({
  default: () => <div data-testid="memo-panel">memo-panel</div>,
}));

vi.mock('./OrgPanel', () => ({
  default: () => <div data-testid="org-panel">org-panel</div>,
}));

const makeEvent = (): Event => ({
  id: 'ev-1',
  userId: 'user-1',
  title: 'test',
  startAt: '2026-03-18T09:00:00',
  endAt: '2026-03-18T10:00:00',
  description: 'desc',
});

const baseProps = () => ({
  isDark: false,
  isNarrowLayout: false,
  activePanel: 'none' as 'none' | 'notifications' | 'memo' | 'rooms' | 'schedule' | 'settings',
  selectedRoomId: undefined as string | undefined,
  panelWrapStyle: () => ({ className: '', style: {} }),
  onOpenInNewWindow: vi.fn<(roomId: string) => void>(),
  mentions: [],
  onSelectMention: vi.fn(),
  unreadMentionCount: 0,
  notificationProps: {
    items: [] as import('../../../api').AnnouncementItem[],
    isAdmin: false,
    announcementEdit: '',
    announcementTitle: '',
    editingAnnouncementId: null as string | null,
    announcementSaving: false,
    onAnnouncementEditChange: vi.fn(),
    onAnnouncementTitleChange: vi.fn(),
    onStartCreateAnnouncement: vi.fn(),
    onStartEditAnnouncement: vi.fn(),
    onCancelEditAnnouncement: vi.fn(),
    onSaveAnnouncement: vi.fn(async () => {}),
  },
  memoProps: {
    inbox: [],
    sent: [],
    onOpenCompose: vi.fn(),
    onMarkRead: vi.fn(),
    onDelete: vi.fn(),
  },
  roomsProps: {
    isDark: false,
    roomsError: false,
    folders: [],
    topicRooms: [],
    chatRooms: [],
    topicUnreadCount: 0,
    chatUnreadCount: 0,
    sectionOpen: { topic: true, chat: true },
    roomsByFolder: new Map(),
    folderOpen: {},
    publicRooms: [],
    allRooms: [],
    toggleSection: vi.fn(),
    toggleFolder: vi.fn(),
    setShowFolderManageModal: vi.fn(),
    setCreateGroupFor: vi.fn(),
    setShowCreateGroupModal: vi.fn(),
    renderRoomItem: vi.fn(() => <li />),
    onJoinPublicRoom: vi.fn(),
    roomSearchQuery: '',
    onRoomSearchQueryChange: vi.fn(),
  },
  orgProps: {
    searchQuery: '',
    onSearchQueryChange: vi.fn(),
    orgSearchField: 'all' as const,
    onOrgSearchFieldChange: vi.fn(),
    orgViewMode: 'combined' as const,
    onOrgViewModeChange: vi.fn(),
    showOnlineOnly: false,
    onToggleOnlineOnly: vi.fn(),
    orgLoading: false,
    orgError: false,
    orgTree: [],
    orgGroups: [],
    treeOpen: {},
    selectedDeptId: null,
    onSelectDept: vi.fn(),
    orgStarred: new Set<string>(),
    onToggleOrgStar: vi.fn(),
    orgFriends: new Set<string>(),
    onToggleOrgFriend: vi.fn(),
    onlineUserIds: new Set<string>(),
    onlinePresence: {},
    myId: 'me',
    myEmail: 'me@emax.com',
    socketConnected: true,
    onRetryOrg: vi.fn(),
    onToggleTree: vi.fn(),
    onOpenDirectMessage: vi.fn(),
    onUserContextMenu: vi.fn(),
    onCreateOrgGroup: vi.fn(),
    onRenameOrgGroup: vi.fn(),
    onDeleteOrgGroup: vi.fn(),
    onCreateChatFromOrgGroup: vi.fn(),
    hasStatusIcon: vi.fn(() => false),
    renderStatusIcon: vi.fn(() => null),
  },
  scheduleProps: {
    calendarMonth: new Date('2026-03-01T00:00:00'),
    selectedDate: '2026-03-18',
    eventsByDate: new Map<string, Event[]>(),
    eventForm: { title: '', startAt: '', endAt: '', description: '' },
    editingEventId: null,
    setCalendarMonth: vi.fn(),
    setSelectedDate: vi.fn(),
    setEventForm: vi.fn(),
    onUpdateEvent: vi.fn(),
    onCreateEvent: vi.fn(),
    onCancelEdit: vi.fn(),
    onEditEvent: vi.fn(),
    onDeleteEvent: vi.fn(),
  },
  settingsProps: {
    notificationsSnoozedUntil: 0,
    notificationSoundEnabled: true,
    notificationPopupEnabled: true,
    snoozeNotifications: vi.fn(),
    clearSnooze: vi.fn(),
    toggleNotificationSound: vi.fn(),
    toggleNotificationPopup: vi.fn(),
    toggleDark: vi.fn(),
    accentTheme: 'default' as const,
    onAccentThemeChange: vi.fn(),
    hasElectron: false,
    canCheckUpdates: false,
    appVersion: null,
    updateStatus: 'idle' as const,
    updateVersion: null,
    updateError: null,
    requiresManualInstall: false,
    handleCheckForUpdates: vi.fn(),
    handleQuitAndInstall: vi.fn(),
    handleOpenUpdateDownload: vi.fn(),
    handleOpenReleasesPage: vi.fn(),
    statusInput: '',
    statusOptions: [],
    renderStatusIcon: vi.fn(() => null),
    handleSetStatus: vi.fn(),
    notificationStatus: '지원되지 않음',
    onSelectAvatarFile: vi.fn(),
    onDeleteAvatar: vi.fn(async () => {}),
    onTestNotification: vi.fn(),
    onRequestNotificationPermission: vi.fn(async () => {}),
    onLogout: vi.fn(),
    user: null,
  },
  notepadProps: {
    value: '',
    onChange: vi.fn(),
    saveStatus: 'idle' as const,
  },
});

describe('RightContentRouter', () => {
  it('renders chat window and forwards open-in-new-window action', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    props.selectedRoomId = 'room-1';

    render(<RightContentRouter {...props} />);
    await user.click(screen.getByRole('button', { name: 'open-chat-window' }));

    expect(props.onOpenInNewWindow).toHaveBeenCalledWith('room-1');
  });

  it('renders org panel when no active panel and no selected room', async () => {
    render(<RightContentRouter {...baseProps()} />);
    await waitFor(() => {
      expect(screen.getByTestId('org-panel')).toBeInTheDocument();
    });
  });

  it('routes schedule panel when active panel is schedule', async () => {
    const props = baseProps();
    props.activePanel = 'schedule';
    props.scheduleProps.eventsByDate = new Map([['2026-03-18', [makeEvent()]]]);

    render(<RightContentRouter {...props} />);
    await waitFor(() => {
      expect(screen.getByTestId('schedule-panel')).toHaveTextContent('2026-03-18');
    });
  });

  it('routes rooms panel when active panel is rooms', async () => {
    const props = baseProps();
    props.activePanel = 'rooms';

    render(<RightContentRouter {...props} />);
    await waitFor(() => {
      expect(screen.getByTestId('rooms-panel')).toBeInTheDocument();
    });
  });

  it('routes notification panel when active panel is notifications', async () => {
    const props = baseProps();
    props.activePanel = 'notifications';

    render(<RightContentRouter {...props} />);
    await waitFor(() => {
      expect(screen.getByTestId('notification-panel')).toBeInTheDocument();
    });
  });

  it('routes settings panel when active panel is settings', async () => {
    const props = baseProps();
    props.activePanel = 'settings';

    render(<RightContentRouter {...props} />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
    });
  });
});
