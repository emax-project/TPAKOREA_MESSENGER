import { useEffect, useState } from 'react';
import { type Message, filesApi } from '../api';
import { useThemeStore, useToastStore } from '../store';
import UICloseButton from './ui/UICloseButton';
import { cn } from '../utils/cn';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function isImageMime(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith('image/');
}

function ImageLightbox({ src, alt, onDownload, onClose }: {
  src: string;
  alt: string;
  onDownload: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[99999] bg-black/85 flex flex-col items-center justify-center" onClick={onClose}>
      <div className="relative flex flex-col items-center max-w-[95vw] max-h-[95vh]" onClick={(e) => e.stopPropagation()}>
        <UICloseButton
          size="lg"
          tone="inverse"
          className="absolute top-[-40px] right-[-4px] opacity-80 z-[1]"
          onClick={onClose}
        />
        <img src={src} alt={alt} className="max-w-[90vw] max-h-[calc(90vh-60px)] object-contain rounded select-none" />
        <div className="flex items-center justify-center gap-5 mt-4 px-5 py-2.5 bg-white/10 rounded-[10px]">
          <span className="text-white/70 text-[13px] max-w-[300px] truncate">{alt}</span>
          <button type="button" onClick={onDownload} className="flex items-center gap-1.5 px-4 py-2 bg-white/15 border border-white/25 rounded-lg text-white text-[13px] font-semibold cursor-pointer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>다운로드</span>
          </button>
        </div>
      </div>
    </div>
  );
}

type Props = {
  message: Message;
};

export default function FileMessage({ message }: Props) {
  const { fileName, fileSize, fileMimeType, fileUrl, fileExpiresAt, id } = message;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const isDark = useThemeStore((s) => s.isDark);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (fileUrl && isImageMime(fileMimeType)) {
      filesApi.fetchBlob(id).then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      }).catch(() => {
        if (active) setPreviewError(true);
      });
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, fileMimeType, fileUrl]);

  const showToast = useToastStore((state) => state.show);

  if (!fileUrl) {
    return (
      <span className={cn('text-[13px] italic', isDark ? 'text-slate-500' : 'text-slate-500')}>
        파일이 만료되었습니다
      </span>
    );
  }

  const expiresAt = fileExpiresAt ? new Date(fileExpiresAt) : null;
  const isExpiringSoon =
    expiresAt && expiresAt.getTime() - Date.now() < 24 * 60 * 60 * 1000;

  const handleDownload = async () => {
    try {
      await filesApi.download(id, fileName);
    } catch (err) {
      showToast(err instanceof Error ? `다운로드 실패 · ${err.message}` : '다운로드에 실패했습니다.', 'error');
    }
  };

  const fileLinkClass = cn(
    'flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] border-none cursor-pointer w-full min-w-[220px] text-left text-inherit',
    isDark ? 'bg-white/[0.06]' : 'bg-black/[0.04]',
  );

  return (
    <div className="mt-1">
      {isImageMime(fileMimeType) ? (
        <>
          {previewUrl && !previewError ? (
            <img
              src={previewUrl}
              alt={fileName || 'image'}
              className="max-w-[420px] max-h-[320px] rounded-lg cursor-pointer block w-full object-contain"
              loading="lazy"
              onClick={() => setLightboxOpen(true)}
            />
          ) : previewError ? (
            <span className={fileLinkClass}>미리보기를 불러올 수 없습니다</span>
          ) : (
            <span className={fileLinkClass}>미리보기 로딩 중...</span>
          )}
          {lightboxOpen && (
            <ImageLightbox
              src={previewUrl || ''}
              alt={fileName || 'image'}
              onDownload={handleDownload}
              onClose={() => setLightboxOpen(false)}
            />
          )}
        </>
      ) : (
        <button type="button" onClick={handleDownload} className={cn(fileLinkClass, isDark ? 'text-slate-400' : 'text-slate-600')}>
          <div className="shrink-0 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
            <span className={cn('text-[13px] font-medium truncate min-w-0 flex-1', isDark ? 'text-slate-200' : 'text-slate-800')}>
              {fileName || 'file'}
            </span>
            {fileSize != null && (
              <span className={cn('text-[11px] shrink-0', isDark ? 'text-slate-500' : 'text-slate-500')}>
                {formatFileSize(fileSize)}
              </span>
            )}
          </div>
          <div className={cn('shrink-0 flex items-center justify-center', isDark ? 'text-slate-500' : 'text-slate-400')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
        </button>
      )}
      {isExpiringSoon && (
        <span className="text-[11px] text-[#e65100] mt-1 block">곧 만료됩니다</span>
      )}
    </div>
  );
}
