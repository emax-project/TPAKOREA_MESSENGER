import { useEffect, useState } from 'react';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'latest';

type AppInfo = { version: string; isPackaged: boolean; platform: string };

type UseUpdateManagerParams = {
  hasElectron: boolean;
  electronPlatform?: string;
  activePanel: 'none' | 'notifications' | 'memo' | 'rooms' | 'schedule' | 'ai' | 'settings' | 'notepad';
  showToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
};

export function useUpdateManager({ hasElectron, electronPlatform, activePanel, showToast }: UseUpdateManagerParams) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const requiresManualInstall = electronPlatform === 'darwin';
  const canCheckUpdates = hasElectron && (appInfo?.isPackaged ?? false);
  const appVersion = appInfo?.version ?? null;

  useEffect(() => {
    if (!hasElectron || activePanel !== 'settings') return;
    window.electronAPI?.getAppInfo?.()
      .then((info) => setAppInfo(info))
      .catch(() => {
        window.electronAPI?.getAppVersion?.()
          .then((version) => setAppInfo({ version, isPackaged: false, platform: electronPlatform ?? '' }))
          .catch(() => {});
      });
  }, [hasElectron, activePanel, electronPlatform]);

  // 업데이트 다운로드 완료 시 "지금 재시작" 버튼 표시
  useEffect(() => {
    if (!hasElectron || !window.electronAPI?.onUpdateDownloaded) return;
    const unsub = window.electronAPI.onUpdateDownloaded(() => setUpdateStatus('ready'));
    return unsub;
  }, [hasElectron]);

  const handleCheckForUpdates = async () => {
    if (!canCheckUpdates || !window.electronAPI?.checkForUpdates) return;
    setUpdateStatus('checking');
    setUpdateError(null);
    try {
      const r = await window.electronAPI.checkForUpdates();
      if (!r.success) {
        setUpdateStatus('error');
        setUpdateError(r.error || '업데이트 확인에 실패했습니다.');
        return;
      }
      if (r.hasUpdate && r.version) {
        setUpdateVersion(r.version);
        if (r.currentVersion) {
          setAppInfo((prev) => (prev ? { ...prev, version: r.currentVersion! } : prev));
        }
        setUpdateStatus(r.downloaded || requiresManualInstall ? 'ready' : 'available');
      } else {
        setUpdateStatus('latest');
        if (r.currentVersion) {
          setAppInfo((prev) => (prev ? { ...prev, version: r.currentVersion! } : prev));
        }
      }
    } catch (err) {
      setUpdateStatus('error');
      setUpdateError((err as Error)?.message || '업데이트 확인에 실패했습니다.');
    }
  };

  const handleOpenUpdateDownload = async () => {
    if (!hasElectron || !window.electronAPI?.openUpdateDownload) return;
    await window.electronAPI.openUpdateDownload(updateVersion);
    showToast?.('브라우저에서 설치 파일 다운로드를 시작합니다.', 'info');
  };

  const handleOpenReleasesPage = () => {
    // TPA-Korea 빌드는 TPAKOREA_MESSENGER 저장소에 릴리즈된다 (공개 MESSAGE 저장소가
    // 아님 — 거기엔 이 설치파일이 없어 페이지가 비어 보임).
    window.electronAPI?.openExternal?.('https://github.com/emax-project/TPAKOREA_MESSENGER/releases/latest');
  };

  const handleQuitAndInstall = async () => {
    if (!hasElectron || !window.electronAPI?.quitAndInstall) return;
    if (requiresManualInstall) {
      await handleOpenUpdateDownload();
      showToast?.('DMG를 다운로드한 뒤 Applications 폴더에 TPA-Korea를 다시 설치해 주세요.', 'info');
      return;
    }
    const result = await window.electronAPI.quitAndInstall();
    if (result?.requiresManualInstall || result?.success === false) {
      showToast?.(result?.error || '자동 설치에 실패했습니다. 설치 파일을 직접 받아 주세요.', 'error');
    }
  };

  return {
    appVersion,
    appInfo,
    canCheckUpdates,
    updateStatus,
    updateVersion,
    updateError,
    requiresManualInstall,
    handleCheckForUpdates,
    handleQuitAndInstall,
    handleOpenUpdateDownload,
    handleOpenReleasesPage,
  };
}
