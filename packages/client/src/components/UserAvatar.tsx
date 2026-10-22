import { useState, useEffect, useRef } from 'react';
import { usersApi } from '../api';
import { useAuthStore } from '../store';

type Props = {
  userId: string;
  name: string;
  avatarUrlPath?: string | null;
  style?: React.CSSProperties;
  imgStyle?: React.CSSProperties;
  initialStyle?: React.CSSProperties;
};

/** 사용자 아바타: avatarUrlPath가 있으면 인증 fetch로 이미지, 없으면 이니셜 (카카오톡 스타일 둥근 사각형) */
export default function UserAvatar({ userId, name, avatarUrlPath, style, imgStyle, initialStyle }: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!avatarUrlPath) return;
    let cancelled = false;
    const doFetch = () => {
      if (window.electronAPI?.fetchUserAvatar && token) {
        return window.electronAPI.fetchUserAvatar(userId);
      }
      return usersApi.fetchUserAvatarBlob(userId).then((blob) => URL.createObjectURL(blob));
    };
    doFetch()
      .then((url) => {
        if (cancelled || !url) return;
        if (url.startsWith('data:')) {
          setImgSrc(url);
        } else {
          blobUrlRef.current = url;
          setImgSrc(url);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (import.meta.env.DEV) console.warn('[UserAvatar] fetch 실패 userId=', userId, err);
        setError(true);
      });
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [userId, avatarUrlPath, token]);

  if (avatarUrlPath && imgSrc && !error) {
    return <img src={imgSrc} alt="" style={{ ...style, ...imgStyle, display: 'block' }} />;
  }
  const displayText = (name?.trim().slice(0, 2) || '?').toUpperCase();
  return <span style={{ ...style, ...initialStyle }}>{displayText}</span>;
}
