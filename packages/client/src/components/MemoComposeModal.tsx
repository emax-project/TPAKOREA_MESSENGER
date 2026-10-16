import { memo, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { orgApi, memosApi, type OrgUser } from '../api';
import { useAuthStore, useThemeStore, useToastStore } from '../store';
import UIButton from './ui/UIButton';
import UIModal from './ui/UIModal';
import ModalFooter from './ui/ModalFooter';
import { cn } from '../utils/cn';
import { companyUsers } from '../utils/orgTree';

type MemoComposeModalProps = {
  onClose: () => void;
  onSent?: () => void;
  initialRecipientIds?: string[];
};

function MemoComposeModal({ onClose, onSent, initialRecipientIds = [] }: MemoComposeModalProps) {
  const myId = useAuthStore((s) => s.user?.id);
  const isDark = useThemeStore((s) => s.isDark);
  const showToast = useToastStore((s) => s.show);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialRecipientIds));
  const [searchQuery, setSearchQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { data: orgTree = [], isLoading: orgLoading } = useQuery({
    queryKey: ['org', 'tree'],
    queryFn: orgApi.tree,
  });

  const allUsers = useMemo(() => {
    const users: OrgUser[] = [];
    (Array.isArray(orgTree) ? orgTree : []).forEach((c) =>
      companyUsers(c).forEach((u) => {
        if (String(u.id) !== String(myId)) users.push(u);
      }),
    );
    return users;
  }, [orgTree, myId]);

  const usersById = useMemo(() => {
    const map = new Map<string, OrgUser>();
    allUsers.forEach((u) => map.set(u.id, u));
    return map;
  }, [allUsers]);

  const selectedUsers = useMemo(
    () => [...selected].map((id) => usersById.get(id)).filter(Boolean) as OrgUser[],
    [selected, usersById],
  );

  const searchLower = searchQuery.trim().toLowerCase();
  const suggestions = useMemo(() => {
    return allUsers
      .filter((u) => !selected.has(u.id))
      .filter((u) => {
        if (!searchLower) return true;
        return (
          u.name.toLowerCase().includes(searchLower) ||
          (u.email != null && u.email.toLowerCase().includes(searchLower))
        );
      })
      .slice(0, 8);
  }, [allUsers, selected, searchLower]);

  const addUser = (userId: string) => {
    setSelected((prev) => new Set(prev).add(userId));
    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  const removeUser = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  };

  const handleSend = async () => {
    const trimmedBody = body.trim();
    if (selected.size === 0) {
      showToast('받는 사람을 선택해 주세요.', 'error');
      return;
    }
    if (!trimmedBody) {
      showToast('내용을 입력해 주세요.', 'error');
      return;
    }
    // 제목 입력란을 없앤 대신, 쪽지함 목록에 쓸 제목을 본문 첫 줄에서 자동으로 뽑는다.
    const autoSubject = trimmedBody.split('\n')[0].slice(0, 60) || '(제목 없음)';
    setLoading(true);
    try {
      await memosApi.send({
        recipientIds: [...selected],
        subject: autoSubject,
        body: trimmedBody,
      });
      showToast('쪽지를 보냈습니다.', 'success');
      onSent?.();
      onClose();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : '';
      const hint = /not found|404|경로/i.test(msg)
        ? ' (로컬 API 서버 localhost:3001 실행 여부 확인)'
        : '';
      showToast(msg ? `쪽지 전송 실패: ${msg}${hint}` : '쪽지 전송에 실패했습니다. API 서버가 실행 중인지 확인해 주세요.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <UIModal onClose={onClose} title="쪽지 쓰기" width={520} overlayPosition="absolute">
      <div className="flex flex-col gap-3">
        <div>
          <div className={cn('mb-1.5 text-xs font-semibold', isDark ? 'text-slate-300' : 'text-slate-600')}>
            받는 사람
          </div>
          <div
            className={cn(
              'relative rounded-xl border px-2.5 py-2 transition-[border-color,box-shadow]',
              pickerOpen
                ? 'border-brand-dark ring-1 ring-brand-dark/30'
                : isDark
                  ? 'border-slate-600'
                  : 'border-slate-200',
              isDark ? 'bg-slate-950' : 'bg-slate-50',
            )}
            onClick={() => searchInputRef.current?.focus()}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedUsers.map((u) => (
                <span
                  key={u.id}
                  className={cn(
                    'inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-[13px] font-medium',
                    isDark ? 'bg-slate-700 text-slate-100' : 'bg-white text-slate-800 border border-slate-200',
                  )}
                >
                  <span className="truncate">{u.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeUser(u.id);
                    }}
                    className={cn(
                      'shrink-0 border-none bg-transparent p-0 text-sm leading-none cursor-pointer rounded',
                      isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-400 hover:text-slate-700',
                    )}
                    aria-label={`${u.name} 제거`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setPickerOpen(true)}
                onBlur={() => {
                  // allow click on suggestion before closing
                  window.setTimeout(() => setPickerOpen(false), 120);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !searchQuery && selectedUsers.length > 0) {
                    removeUser(selectedUsers[selectedUsers.length - 1].id);
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (suggestions[0]) addUser(suggestions[0].id);
                  }
                  if (e.key === 'Escape') {
                    setPickerOpen(false);
                    searchInputRef.current?.blur();
                  }
                }}
                placeholder={selectedUsers.length === 0 ? '이름 또는 이메일로 추가' : ''}
                aria-label="받는 사람 검색"
                className={cn(
                  'min-w-[140px] flex-1 border-none bg-transparent py-1 text-sm outline-none',
                  isDark ? 'text-slate-200 placeholder:text-slate-500' : 'text-slate-800 placeholder:text-slate-400',
                )}
              />
            </div>

            {pickerOpen && (
              <div
                className={cn(
                  'absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[200px] overflow-auto rounded-lg border py-1 shadow-lg',
                  isDark ? 'border-slate-600 bg-slate-800' : 'border-slate-200 bg-white',
                )}
              >
                {orgLoading ? (
                  <div className={cn('px-3 py-3 text-sm', isDark ? 'text-slate-400' : 'text-slate-500')}>
                    로딩 중...
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className={cn('px-3 py-3 text-sm', isDark ? 'text-slate-400' : 'text-slate-500')}>
                    {searchLower ? '검색 결과가 없습니다' : '추가할 사람이 없습니다'}
                  </div>
                ) : (
                  suggestions.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addUser(u.id)}
                      className={cn(
                        'flex w-full items-center gap-2 border-none bg-transparent px-3 py-2 text-left cursor-pointer',
                        isDark ? 'hover:bg-slate-700' : 'hover:bg-slate-50',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                          isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600',
                        )}
                      >
                        {(u.name?.trim().slice(0, 1) || '?').toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-sm font-medium', isDark ? 'text-slate-100' : 'text-slate-800')}>
                          {u.name}
                        </span>
                        {u.email && (
                          <span className={cn('block truncate text-xs', isDark ? 'text-slate-500' : 'text-slate-400')}>
                            {u.email}
                          </span>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {selectedUsers.length > 0 && (
            <div className={cn('mt-1.5 text-[11px]', isDark ? 'text-slate-500' : 'text-slate-400')}>
              {selectedUsers.length}명 선택됨
            </div>
          )}
        </div>

        <div>
          <div className={cn('mb-1.5 text-xs font-semibold', isDark ? 'text-slate-300' : 'text-slate-600')}>내용</div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="내용을 입력하세요"
            rows={8}
            className={cn(
              'w-full rounded-xl border px-3 py-2 text-sm outline-none resize-y min-h-[160px] font-inherit',
              isDark ? 'border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500' : 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400',
            )}
          />
        </div>
      </div>

      <ModalFooter>
        <UIButton variant="secondary" onClick={onClose} disabled={loading}>취소</UIButton>
        <UIButton onClick={() => void handleSend()} disabled={loading}>{loading ? '전송 중...' : '보내기'}</UIButton>
      </ModalFooter>
    </UIModal>
  );
}

export default memo(MemoComposeModal);
