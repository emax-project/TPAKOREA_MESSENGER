import { memo, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccentStyles } from '../../../hooks/useAccentStyles';
import { cn } from '../../../utils/cn';
import { appSettingsApi } from '../../../api';
import { useToastStore } from '../../../store';
import BulkUserRegisterSection from './BulkUserRegisterSection';
import OrgManageSection from './OrgManageSection';
import UserManageSection from './UserManageSection';

type Props = {
  isDark: boolean;
  isNarrowLayout?: boolean;
  /** 로그인한 관리자 본인 id. 사용자 관리에서 자기 자신을 못 고르게 하는 데 쓴다. */
  currentUserId?: string;
};

type TabKey = 'register' | 'org' | 'users';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'register', label: '사용자 등록' },
  { key: 'org', label: '부서 · 직급' },
  { key: 'users', label: '사용자 관리' },
];

type LinkSettingProps = {
  isDark: boolean;
  queryKey: string;
  title: string;
  description: string;
  placeholder: string;
  load: () => Promise<{ url: string }>;
  store: (url: string) => Promise<{ url: string }>;
};

function SidebarLinkSettings({ isDark, queryKey, title, description, placeholder, load, store }: LinkSettingProps) {
  const accent = useAccentStyles(isDark);
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  const { data } = useQuery({
    queryKey: ['settings', queryKey],
    queryFn: load,
  });
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof data?.url === 'string') setUrl(data.url);
  }, [data?.url]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await store(url);
      setUrl(saved.url);
      await queryClient.invalidateQueries({ queryKey: ['settings', queryKey] });
      showToast(saved.url ? '링크를 저장했습니다' : '링크를 비웠습니다', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '저장에 실패했습니다', 'error');
    } finally {
      setSaving(false);
    }
  };

  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputStyle = {
    flex: 1,
    minWidth: 0,
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${isDark ? '#475569' : '#e2e8f0'}`,
    background: isDark ? '#1e293b' : '#fff',
    color: isDark ? '#e2e8f0' : '#333',
    fontSize: 13,
    boxSizing: 'border-box' as const,
  };

  return (
    <div className={cn('flex flex-col gap-2 rounded-lg px-3 py-2.5', isDark ? 'bg-slate-800' : 'bg-white')}>
      <div>
        <div className={cn('text-[13px] font-semibold', isDark ? 'text-slate-200' : 'text-slate-800')}>
          {title}
        </div>
        <p className={cn('mt-1 mb-0 text-xs leading-relaxed', muted)}>
          {description}
        </p>
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          placeholder={placeholder}
          style={{ ...inputStyle, ...accent.inputStyle }}
        />
        <button
          type="button"
          style={accent.primaryStyle}
          disabled={saving}
          onClick={() => { void save(); }}
          className={cn(
            'shrink-0 px-3.5 py-2 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-semibold cursor-pointer',
            saving && 'opacity-70 cursor-wait',
          )}
        >
          {saving ? '저장 중' : '저장'}
        </button>
      </div>
    </div>
  );
}

/** 관리자 전용 도구 묶음. 세로로 쌓지 않고 탭으로 나눠 설정 화면이 길어지지 않게 한다. */
function AdminSection({ isDark, isNarrowLayout = false, currentUserId }: Props) {
  const accent = useAccentStyles(isDark);
  const [tab, setTab] = useState<TabKey>('register');

  const sectionBg = isDark ? 'bg-slate-700' : 'bg-slate-50';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={cn('flex flex-col gap-3 rounded-[10px] px-3.5 py-3', sectionBg)}>
      <div>
        <h4 className={cn('m-0 text-sm font-semibold', isDark ? 'text-slate-200' : 'text-slate-800')}>
          관리자
        </h4>
        <p className={cn('mt-1 mb-0 text-xs leading-relaxed', muted)}>
          관리자 계정에만 보이는 기능입니다.
        </p>
      </div>

      <SidebarLinkSettings
        isDark={isDark}
        queryKey="external-site"
        title="사이드바 링크 접속"
        description="왼쪽 사이드바 링크 버튼을 누르면 이 주소로 바로 이동합니다. 모든 사용자에게 동일하게 적용됩니다."
        placeholder="https://portal.example.com"
        load={appSettingsApi.getExternalSite}
        store={appSettingsApi.putExternalSite}
      />
      <SidebarLinkSettings
        isDark={isDark}
        queryKey="mail-site"
        title="사이드바 메일"
        description="왼쪽 사이드바 메일 버튼을 누르면 이 주소로 이동합니다. 비워 두면 그룹웨어가 열립니다. 모든 사용자에게 동일하게 적용됩니다."
        placeholder="https://mail.example.com"
        load={appSettingsApi.getMailSite}
        store={appSettingsApi.putMailSite}
      />

      <div
        role="tablist"
        className={cn(
          'flex gap-1 rounded-lg p-1',
          isDark ? 'bg-slate-800' : 'bg-slate-200/60',
        )}
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            style={tab === key ? accent.secondaryStyle : undefined}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'flex-1 whitespace-nowrap rounded-md border-none px-2 py-2 text-[12.5px] font-semibold cursor-pointer',
              isNarrowLayout && 'min-h-[40px]',
              tab === key
                ? isDark
                  ? 'bg-slate-600 text-slate-100'
                  : 'bg-white text-slate-900 shadow-sm'
                : cn('bg-transparent', muted),
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'register' && (
        <BulkUserRegisterSection isDark={isDark} isNarrowLayout={isNarrowLayout} embedded />
      )}
      {tab === 'org' && <OrgManageSection isDark={isDark} isNarrowLayout={isNarrowLayout} embedded />}
      {tab === 'users' && (
        <UserManageSection
          isDark={isDark}
          isNarrowLayout={isNarrowLayout}
          currentUserId={currentUserId}
          embedded
        />
      )}
    </div>
  );
}

export default memo(AdminSection);
