import { memo } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { Room } from '../../../api';
import { useThemeStore } from '../../../store';
import { cn } from '../../../utils/cn';
import { formatRoomListTimestamp } from '../utils/date';

type RoomListItemProps = {
  room: Room;
  mutedRoomIds: Set<string>;
  onOpenRoom: (room: Room) => void;
  onContextMenu: (e: MouseEvent<HTMLLIElement>, room: Room) => void;
};

function RoomListItem({
  room,
  mutedRoomIds,
  onOpenRoom,
  onContextMenu,
}: RoomListItemProps) {
  const isDark = useThemeStore((s) => s.isDark);

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.key === 'Enter') onOpenRoom(room);
  };

  return (
    <li
      key={room.id}
      role="button"
      tabIndex={0}
      onClick={() => onOpenRoom(room)}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => onContextMenu(e, room)}
      className={cn(
        'px-3.5 py-2 border-b cursor-pointer flex items-center gap-2',
        isDark ? 'border-b-[#334155]' : 'border-b-slate-200',
      )}
    >
      {room.isFavorite && (
        <span
          className={cn('w-5 h-5 shrink-0 flex items-center justify-center', isDark ? 'text-[#fbbf24]' : 'text-[#f59e0b]')}
          aria-label="즐겨찾기"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className={cn('font-semibold text-xs mb-px flex items-center gap-1.5', isDark ? 'text-slate-200' : 'text-slate-900')}>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">{room.name}</span>
          {room.isGroup && room.isTopic && room.viewMode && (
            <span
              className={cn(
                'text-[10px] shrink-0 py-px px-[5px] rounded',
                isDark ? 'text-slate-400 bg-white/[0.08]' : 'text-slate-500 bg-slate-100',
              )}
              title={room.viewMode === 'board' ? '보드뷰: 게시글 기반' : '챗뷰: 메시지 기반'}
            >
              {room.viewMode === 'board' ? '보드뷰' : '챗뷰'}
            </span>
          )}
        </div>
        <div className={cn('text-[11px] overflow-hidden text-ellipsis whitespace-nowrap', isDark ? 'text-slate-400' : 'text-slate-500')}>
          {room.lastMessage ? room.lastMessage.content : ''}
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-[3px]">
        {room.lastMessage && (
          <span className={cn('text-[10px]', isDark ? 'text-slate-400' : 'text-slate-500')}>
            {formatRoomListTimestamp(room.lastMessage.createdAt)}
          </span>
        )}
        {mutedRoomIds.has(room.id) && <span className="text-[10px] text-[#94a3b8]" title="알림 꺼짐">음소거</span>}
        {(room.unreadCount ?? 0) > 0 && (
          <span className="min-w-[18px] h-[18px] px-[5px] rounded-[9px] bg-brand text-white text-[10px] font-bold flex items-center justify-center">
            {room.unreadCount! > 99 ? '99+' : room.unreadCount}
          </span>
        )}
      </div>
    </li>
  );
}

export default memo(RoomListItem);
