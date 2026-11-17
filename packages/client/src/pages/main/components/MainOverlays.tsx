import type { Dispatch, SetStateAction } from 'react';
import type { OrgGroup, OrgUser, Room } from '../../../api';
import CreateGroupModal from '../../../components/CreateGroupModal';
import CreateOrgContactGroupModal from '../../../components/CreateOrgContactGroupModal';
import DeleteOrgContactGroupModal from '../../../components/DeleteOrgContactGroupModal';
import FolderManageModal from '../../../components/FolderManageModal';
import AvatarEditModal from '../../../components/AvatarEditModal';
import UICloseButton from '../../../components/ui/UICloseButton';
import UserAvatar from '../../../components/UserAvatar';
import { cn } from '../../../utils/cn';
import { formatJobTitle } from '../../../utils/orgTree';

type CtxUserMenu = { x: number; y: number; user: OrgUser; orgGroupId?: string; selectedUsers?: OrgUser[] } | null;
type CtxRoomMenu = { x: number; y: number; room: Room } | null;

type MainOverlaysProps = {
  isDark: boolean;
  showAnnouncementModal: boolean;
  announcementTitle?: string | null;
  announcementContent?: string | null;
  setShowAnnouncementModal: Dispatch<SetStateAction<boolean>>;
  showCreateGroupModal: boolean;
  createGroupFor: 'topic' | 'chat';
  setShowCreateGroupModal: Dispatch<SetStateAction<boolean>>;
  onTopicCreated: (id: string) => void;
  onGroupCreated: (roomId: string, viewMode?: 'chat' | 'board', options?: { skipRoomsInvalidate?: boolean }) => void;
  avatarEditFile: File | null;
  setAvatarEditFile: Dispatch<SetStateAction<File | null>>;
  onConfirmAvatar: (croppedFile: File) => Promise<void>;
  showFolderManageModal: boolean;
  setShowFolderManageModal: Dispatch<SetStateAction<boolean>>;
  topicRooms: Room[];
  contextMenu: CtxUserMenu;
  setContextMenu: Dispatch<SetStateAction<CtxUserMenu>>;
  setProfileModalUser: Dispatch<SetStateAction<OrgUser | null>>;
  orgGroups: OrgGroup[];
  addToGroupUsers: OrgUser[] | null;
  setAddToGroupUsers: Dispatch<SetStateAction<OrgUser[] | null>>;
  onAddToOrgGroup: (groupId: string, userIds: string[]) => void | Promise<void>;
  onRemoveFromOrgGroup: (groupId: string, userId: string) => void | Promise<void>;
  showCreateOrgGroupModal: boolean;
  setShowCreateOrgGroupModal: Dispatch<SetStateAction<boolean>>;
  onCreateOrgGroup: (name: string) => Promise<void>;
  onOpenCreateOrgGroupModal: () => void;
  renamingOrgGroup: OrgGroup | null;
  setRenamingOrgGroup: Dispatch<SetStateAction<OrgGroup | null>>;
  onRenameOrgGroupSubmit: (name: string) => Promise<void>;
  deletingOrgGroup: OrgGroup | null;
  setDeletingOrgGroup: Dispatch<SetStateAction<OrgGroup | null>>;
  onDeleteOrgGroupConfirm: () => Promise<void>;
  roomContextMenu: CtxRoomMenu;
  setRoomContextMenu: Dispatch<SetStateAction<CtxRoomMenu>>;
  mutedRoomIds: Set<string>;
  onToggleFavorite: (room: Room) => void | Promise<void>;
  onToggleMuteRoom: (roomId: string) => void;
  onOpenRoomInNewWindow: (roomId: string) => void;
  onLeaveRoom: (roomId: string) => void | Promise<void>;
  profileModalUser: OrgUser | null;
  onlineUserIds: Set<string>;
  onSendMemoToUser: (userId: string) => void;
  onSendMemoToUsers?: (userIds: string[]) => void;
  onSendMailToUsers?: (users: OrgUser[]) => void;
  orgFriends: Set<string>;
  onToggleOrgFriend: (userId: string) => void;
};

export default function MainOverlays({
  isDark,
  showAnnouncementModal,
  announcementTitle,
  announcementContent,
  setShowAnnouncementModal,
  showCreateGroupModal,
  createGroupFor,
  setShowCreateGroupModal,
  onTopicCreated,
  onGroupCreated,
  avatarEditFile,
  setAvatarEditFile,
  onConfirmAvatar,
  showFolderManageModal,
  setShowFolderManageModal,
  topicRooms,
  contextMenu,
  setContextMenu,
  setProfileModalUser,
  orgGroups,
  addToGroupUsers,
  setAddToGroupUsers,
  onAddToOrgGroup,
  onRemoveFromOrgGroup,
  showCreateOrgGroupModal,
  setShowCreateOrgGroupModal,
  onCreateOrgGroup,
  onOpenCreateOrgGroupModal,
  renamingOrgGroup,
  setRenamingOrgGroup,
  onRenameOrgGroupSubmit,
  deletingOrgGroup,
  setDeletingOrgGroup,
  onDeleteOrgGroupConfirm,
  roomContextMenu,
  setRoomContextMenu,
  mutedRoomIds,
  onToggleFavorite,
  onToggleMuteRoom,
  onOpenRoomInNewWindow,
  onLeaveRoom,
  profileModalUser,
  onlineUserIds,
  onSendMemoToUser,
  onSendMemoToUsers,
  onSendMailToUsers,
  orgFriends,
  onToggleOrgFriend,
}: MainOverlaysProps) {
  const overlayCls = 'fixed inset-0 z-[10002] bg-black/40 flex items-center justify-center';
  const modalCls = cn(
    'rounded-xl shadow-lg min-w-[320px] max-w-[90%] max-h-[80vh] overflow-auto p-5',
    isDark ? 'bg-slate-800' : 'bg-white',
  );
  const ctxMenuCls = cn(
    'fixed z-[10000] min-w-[140px] max-w-[220px] p-1 rounded-lg shadow-lg border whitespace-nowrap',
    isDark ? 'bg-slate-700 border-slate-600' : 'bg-white border-slate-200',
  );
  const ctxMenuItemCls = cn(
    'block w-full py-2 px-3 border-none bg-transparent rounded-md text-[13px] text-left cursor-pointer',
    isDark ? 'text-slate-200' : 'text-slate-900',
  );

  return (
    <>
      {showAnnouncementModal && announcementContent?.trim() && (
        <div className={overlayCls} onClick={() => setShowAnnouncementModal(false)}>
          <div className={modalCls} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600, color: isDark ? '#e2e8f0' : '#0f172a' }}>
              {announcementTitle?.trim() || '공지'}
            </h3>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.5, color: isDark ? '#94a3b8' : '#64748b', marginBottom: 16 }}>{announcementContent}</div>
            <button
              type="button"
              className="w-full py-2 px-4 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-bold cursor-pointer"
              onClick={() => setShowAnnouncementModal(false)}
            >
              확인
            </button>
          </div>
        </div>
      )}

      {showCreateGroupModal && (
        <CreateGroupModal
          mode={createGroupFor}
          onClose={() => setShowCreateGroupModal(false)}
          onTopicCreated={onTopicCreated}
          onCreated={onGroupCreated}
        />
      )}

      {showCreateOrgGroupModal && (
        <CreateOrgContactGroupModal
          mode="create"
          onClose={() => setShowCreateOrgGroupModal(false)}
          onSubmit={onCreateOrgGroup}
        />
      )}

      {renamingOrgGroup && (
        <CreateOrgContactGroupModal
          mode="rename"
          initialName={renamingOrgGroup.name}
          onClose={() => setRenamingOrgGroup(null)}
          onSubmit={onRenameOrgGroupSubmit}
        />
      )}

      {deletingOrgGroup && (
        <DeleteOrgContactGroupModal
          groupName={deletingOrgGroup.name}
          onClose={() => setDeletingOrgGroup(null)}
          onConfirm={onDeleteOrgGroupConfirm}
        />
      )}

      {avatarEditFile && (
        <AvatarEditModal
          file={avatarEditFile}
          onClose={() => setAvatarEditFile(null)}
          onConfirm={onConfirmAvatar}
        />
      )}

      {showFolderManageModal && <FolderManageModal topicRooms={topicRooms} onClose={() => setShowFolderManageModal(false)} />}

      {contextMenu && (() => {
        const targets = contextMenu.selectedUsers?.length
          ? contextMenu.selectedUsers
          : [contextMenu.user];
        const multiCount = targets.length;
        const isFriend = orgFriends.has(String(contextMenu.user.id));
        const estH = contextMenu.orgGroupId ? 170 : 140;
        const top = contextMenu.y + estH > window.innerHeight - 8 ? contextMenu.y - estH : contextMenu.y;
        const left = Math.min(Math.max(contextMenu.x, 8), window.innerWidth - 180);
        return (
          <div className={ctxMenuCls} style={{ left, top }} onClick={(e) => e.stopPropagation()}>
            {multiCount === 1 && (
              <>
                <button type="button" className={ctxMenuItemCls} onClick={() => { setProfileModalUser(contextMenu.user); setContextMenu(null); }}>프로필 보기</button>
                <button type="button" className={ctxMenuItemCls} onClick={() => onSendMemoToUser(contextMenu.user.id)}>쪽지 보내기</button>
                <button
                  type="button"
                  className={ctxMenuItemCls}
                  onClick={() => {
                    onToggleOrgFriend(contextMenu.user.id);
                    setContextMenu(null);
                  }}
                >
                  {isFriend ? '즐겨찾기 해제' : '즐겨찾기(친구) 추가'}
                </button>
              </>
            )}
            {multiCount > 1 && (
              <>
                <button
                  type="button"
                  className={ctxMenuItemCls}
                  onClick={() => {
                    onSendMemoToUsers?.(targets.map((u) => u.id));
                    setContextMenu(null);
                  }}
                >
                  쪽지 보내기 ({multiCount}명)
                </button>
                <button
                  type="button"
                  className={ctxMenuItemCls}
                  onClick={() => {
                    onSendMailToUsers?.(targets);
                    setContextMenu(null);
                  }}
                >
                  메일 보내기 ({multiCount}명)
                </button>
              </>
            )}
            {multiCount === 1 && onSendMailToUsers && (
              <button
                type="button"
                className={ctxMenuItemCls}
                onClick={() => {
                  onSendMailToUsers([contextMenu.user]);
                  setContextMenu(null);
                }}
              >
                메일 보내기
              </button>
            )}
            <button
              type="button"
              className={ctxMenuItemCls}
              onClick={() => {
                setAddToGroupUsers(targets);
                setContextMenu(null);
              }}
            >
              {multiCount > 1 ? `내 그룹에 추가 (${multiCount}명)` : '내 그룹에 추가'}
            </button>
            {contextMenu.orgGroupId && multiCount === 1 && (
              <button
                type="button"
                className={cn(ctxMenuItemCls, 'text-[#c62828]')}
                onClick={() => void onRemoveFromOrgGroup(contextMenu.orgGroupId!, contextMenu.user.id)}
              >
                그룹에서 제거
              </button>
            )}
            {contextMenu.orgGroupId && multiCount > 1 && (
              <button
                type="button"
                className={cn(ctxMenuItemCls, 'text-[#c62828]')}
                onClick={() => {
                  void (async () => {
                    for (const u of targets) {
                      await onRemoveFromOrgGroup(contextMenu.orgGroupId!, u.id);
                    }
                  })();
                }}
              >
                그룹에서 제거 ({multiCount}명)
              </button>
            )}
          </div>
        );
      })()}

      {addToGroupUsers && addToGroupUsers.length > 0 && (() => {
        const targets = addToGroupUsers;
        const title =
          targets.length === 1
            ? `${targets[0].name} → 그룹 선택`
            : `${targets.length}명 → 그룹 선택`;
        return (
          <div className={overlayCls} onClick={() => setAddToGroupUsers(null)}>
            <div className={modalCls} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: isDark ? '#e2e8f0' : '#0f172a' }}>
                  {title}
                </h3>
                <UICloseButton onClick={() => setAddToGroupUsers(null)} />
              </div>
              {targets.length > 1 && (
                <p style={{ margin: '0 0 10px', fontSize: 12, color: isDark ? '#94a3b8' : '#64748b' }}>
                  {targets.map((u) => u.name).join(', ')}
                </p>
              )}
              {orgGroups.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 13, color: isDark ? '#94a3b8' : '#64748b' }}>
                    아직 그룹이 없습니다. 먼저 그룹을 만들어 주세요.
                  </p>
                  <button
                    type="button"
                    className="w-full py-2 px-4 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-bold cursor-pointer"
                    onClick={() => {
                      setAddToGroupUsers(null);
                      onOpenCreateOrgGroupModal();
                    }}
                  >
                    + 그룹 만들기
                  </button>
                </div>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {orgGroups.map((g) => {
                    const alreadyCount = targets.filter((u) => g.members.some((m) => m.id === u.id)).length;
                    const allAlready = alreadyCount === targets.length;
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          disabled={allAlready}
                          className={cn(
                            'w-full text-left py-2.5 px-3 rounded-lg border-none cursor-pointer text-[13px] mb-1',
                            allAlready
                              ? (isDark ? 'bg-slate-700/50 text-slate-500' : 'bg-slate-100 text-slate-400')
                              : (isDark ? 'bg-slate-700 text-slate-100 hover:bg-slate-600' : 'bg-slate-50 text-slate-800 hover:bg-slate-100'),
                          )}
                          onClick={() => void onAddToOrgGroup(g.id, targets.map((u) => u.id))}
                        >
                          {g.name}
                          <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>
                            {allAlready
                              ? '이미 포함됨'
                              : alreadyCount > 0
                                ? `${targets.length - alreadyCount}명 추가 · ${alreadyCount}명 포함됨`
                                : `${g.members.length}명`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        );
      })()}

      {roomContextMenu && (() => {
        const estH = 216;
        const top = roomContextMenu.y + estH > window.innerHeight - 8 ? roomContextMenu.y - estH : roomContextMenu.y;
        const left = Math.min(Math.max(roomContextMenu.x, 8), window.innerWidth - 210);
        return (
          <div className={ctxMenuCls} style={{ left, top }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={ctxMenuItemCls} onClick={() => onOpenRoomInNewWindow(roomContextMenu.room.id)}>새 창으로 열기</button>
            <button type="button" className={ctxMenuItemCls} onClick={() => void onToggleFavorite(roomContextMenu.room)}>{roomContextMenu.room.isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}</button>
            <button type="button" className={ctxMenuItemCls} onClick={() => onToggleMuteRoom(roomContextMenu.room.id)}>{mutedRoomIds.has(roomContextMenu.room.id) ? '알림 켜기' : '알림 끄기'}</button>
            {roomContextMenu.room.isGroup && roomContextMenu.room.isTopic && (
              <button type="button" className={ctxMenuItemCls} onClick={() => { setShowFolderManageModal(true); setRoomContextMenu(null); }}>폴더로 이동</button>
            )}
            <button type="button" className={cn(ctxMenuItemCls, 'text-[#c62828]')} onClick={() => void onLeaveRoom(roomContextMenu.room.id)}>나가기</button>
          </div>
        );
      })()}

      {profileModalUser && (() => {
        const isOnline = onlineUserIds.has(String(profileModalUser.id));
        const metaRow = {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 0',
          fontSize: 13,
          color: isDark ? '#cbd5e1' : '#475569',
        } as const;
        const iconStyle = { flexShrink: 0, color: isDark ? '#7c8ba1' : '#94a3b8' } as const;

        return (
          <div className={overlayCls} onClick={() => setProfileModalUser(null)}>
            <div
              onClick={(e) => e.stopPropagation()}
              className={cn('relative overflow-hidden rounded-2xl shadow-xl', isDark ? 'bg-slate-800' : 'bg-white')}
              style={{ width: 360, maxWidth: '90%' }}
            >
              <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>
                <UICloseButton onClick={() => setProfileModalUser(null)} />
              </div>

              {/* 머리: 얼굴과 이름이 먼저 오도록 */}
              <div
                style={{
                  padding: '26px 20px 20px',
                  display: 'flex',
                  flexDirection: 'column' as const,
                  alignItems: 'center',
                  gap: 10,
                  background: isDark
                    ? 'linear-gradient(160deg, #3a4759 0%, #2f3a4b 100%)'
                    : 'linear-gradient(160deg, #f6f8ff 0%, #eaf0fd 100%)',
                  borderBottom: `1px solid ${isDark ? '#3f4d63' : '#e3e9fb'}`,
                }}
              >
                <div style={{ position: 'relative', width: 68, height: 68 }}>
                  <div
                    style={{
                      width: 68,
                      height: 68,
                      borderRadius: 20,
                      overflow: 'hidden',
                      background: isDark ? '#4a5769' : '#dfe6f5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: isDark
                        ? '0 5px 14px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.06)'
                        : '0 5px 14px rgba(37,64,128,0.10), inset 0 0 0 1px rgba(255,255,255,0.7)',
                    }}
                  >
                    {profileModalUser.avatarUrl ? (
                      <UserAvatar
                        userId={profileModalUser.id}
                        name={profileModalUser.name || ''}
                        avatarUrlPath={profileModalUser.avatarUrl}
                        imgStyle={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 20 }}
                        initialStyle={{ fontSize: 26, fontWeight: 700, color: isDark ? '#e2e8f0' : 'rgba(60,30,30,0.85)' }}
                      />
                    ) : (
                      <span style={{ fontSize: 26, fontWeight: 700, color: isDark ? '#e2e8f0' : 'rgba(60,30,30,0.85)' }}>
                        {profileModalUser.name?.trim()[0]?.toUpperCase() || '?'}
                      </span>
                    )}
                  </div>
                  {/* 접속 상태는 아바타에 점으로. 별도 항목 한 줄을 아낀다 */}
                  <span
                    title={isOnline ? '온라인' : '오프라인'}
                    style={{
                      position: 'absolute',
                      right: -1,
                      bottom: -1,
                      width: 17,
                      height: 17,
                      borderRadius: 999,
                      background: isOnline ? '#22c55e' : isDark ? '#64748b' : '#cbd5e1',
                      boxShadow: `0 0 0 3px ${isDark ? '#354254' : '#f0f4fd'}`,
                    }}
                  />
                </div>

                <div style={{ textAlign: 'center' as const, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, justifyContent: 'center' }}>
                    <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', color: isDark ? '#f1f5f9' : '#172033' }}>
                      {profileModalUser.name}
                    </span>
                    {formatJobTitle(profileModalUser.jobTitle) && (
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
                        {formatJobTitle(profileModalUser.jobTitle)}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: isOnline ? '#16a34a' : isDark ? '#7c8ba1' : '#94a3b8' }}>
                    {isOnline ? '온라인' : '오프라인'}
                  </span>
                  {profileModalUser.statusMessage && (
                    <span style={{ marginTop: 2, fontSize: 12.5, lineHeight: 1.5, color: isDark ? '#9fb0c6' : '#64748b' }}>
                      “{profileModalUser.statusMessage}”
                    </span>
                  )}
                </div>
              </div>

              {/* 연락 정보: 소속팀 · 휴대전화 · 자리 전화번호 · 이메일 · 회사 주소 · 내선번호 */}
              <div style={{ padding: '6px 20px 16px' }}>
                {(() => {
                  const dash = '—';
                  const text = (v?: string | null) => {
                    const t = v?.trim();
                    return t || dash;
                  };
                  const team = [profileModalUser.companyName, profileModalUser.deptName]
                    .map((v) => v?.trim())
                    .filter((v): v is string => !!v)
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .join(' · ');
                  const labelColor = isDark ? '#94a3b8' : '#64748b';
                  const valueColor = isDark ? '#e2e8f0' : '#172033';
                  const rows: { key: string; label: string; value: string; icon: JSX.Element }[] = [
                    {
                      key: 'team',
                      label: '소속팀',
                      value: text(team),
                      icon: (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={iconStyle} aria-hidden>
                          <path d="M3 21h18" />
                          <path d="M5 21V7l7-4 7 4v14" />
                          <path d="M9 9h.01M9 13h.01M15 9h.01M15 13h.01" />
                        </svg>
                      ),
                    },
                    {
                      key: 'phone',
                      label: '휴대전화',
                      value: text(profileModalUser.phone),
                      icon: (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={iconStyle} aria-hidden>
                          <rect x="7" y="2" width="10" height="20" rx="2" />
                          <line x1="12" y1="18" x2="12" y2="18.01" />
                        </svg>
                      ),
                    },
                    {
                      key: 'deskPhone',
                      label: '자리 전화번호',
                      value: text(profileModalUser.deskPhone),
                      icon: (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={iconStyle} aria-hidden>
                          <path d="M6 3h3l2 5-2.5 1.5a12 12 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.2 2 2 0 0 1 6 3Z" />
                        </svg>
                      ),
                    },
                    {
                      key: 'email',
                      label: '이메일 주소',
                      value: text(profileModalUser.email),
                      icon: (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={iconStyle} aria-hidden>
                          <rect x="3" y="5" width="18" height="14" rx="2" />
                          <path d="m3 7 9 6 9-6" />
                        </svg>
                      ),
                    },
                    {
                      key: 'address',
                      label: '회사 주소',
                      value: text(profileModalUser.companyAddress),
                      icon: (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={iconStyle} aria-hidden>
                          <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z" />
                          <circle cx="12" cy="10" r="2.5" />
                        </svg>
                      ),
                    },
                    {
                      key: 'extension',
                      label: '내선번호',
                      value: text(profileModalUser.extension),
                      icon: (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={iconStyle} aria-hidden>
                          <rect x="4" y="2" width="16" height="20" rx="2" />
                          <line x1="8" y1="6" x2="16" y2="6" />
                          <line x1="8" y1="18" x2="8.01" y2="18" />
                        </svg>
                      ),
                    },
                  ];
                  return rows.map((row, i) => (
                    <div key={row.key}>
                      {i > 0 && <div style={{ height: 1, background: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.06)' }} />}
                      <div style={metaRow}>
                        {row.icon}
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: labelColor }}>{row.label}</span>
                          <span style={{ overflowWrap: 'anywhere' as const, fontWeight: 600, color: valueColor }}>{row.value}</span>
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
