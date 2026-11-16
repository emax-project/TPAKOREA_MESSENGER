import { clearSessionDate, getActiveToken, removeStoredToken } from './utils/authSession';
import { evaluateFilePolicy } from './utils/filePolicy';

// 빈 문자열이면 같은 origin 사용(배포 시 같은 서버에서 API·웹 서빙), 없으면 로컬 개발용
/** 거래처 사외 기본 API (UTM 1442: 121.143.3.163:3030 → 192.168.123.210:3001) */
const DEFAULT_BASE =
  import.meta.env.VITE_API_URL === '' ? '' : (import.meta.env.VITE_API_URL || 'http://121.143.3.163:3030');

const API_URL_KEY = 'emax_api_url';

/**
 * 로그인 시 저장된 서버 주소(localStorage)는 빌드 기본값보다 우선한다. 그런데 이 앱은 userData 폴더가
 * 다른 브랜드(CSIN-Tech 등) 빌드와 "client"로 겹칠 수 있어, 남의 서버 주소가 저장돼 있으면
 * 빌드 기본값(HTTPS)을 무시하고 엉뚱한 주소로 붙어 "서버에 연결할 수 없습니다"가 난다.
 * 서버 주소를 사용자가 직접 바꾸는 UI가 없으므로, 빌드 기본값과 다른 저장값은 stale로 보고 삭제한다.
 */
function readSavedBaseUrl(): string | null {
  let saved: string | null = null;
  try { saved = localStorage.getItem(API_URL_KEY); } catch { return null; }
  if (!saved) return null;
  const buildBase = import.meta.env.VITE_API_URL;
  if (buildBase && saved.replace(/\/$/, '') !== buildBase.replace(/\/$/, '')) {
    try { localStorage.removeItem(API_URL_KEY); } catch { /* ignore */ }
    return null;
  }
  return saved;
}

/** 런타임에 설정한 서버 주소가 있으면 사용, 없으면 빌드 시 기본값 */
export function getBaseUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BASE;
  const envBase =
    import.meta.env.VITE_API_URL === ''
      ? ''
      : (import.meta.env.VITE_API_URL || DEFAULT_BASE);
  // dev: .env의 API 주소 우선 (localStorage 원격 주소 → 신규 API 404 방지)
  const saved = import.meta.env.DEV ? null : readSavedBaseUrl();
  const base = saved || envBase;
  // Vite dev(5173)에서 로컬 서버(3001) 사용 시: 프록시 경유로 CORS 회피
  const origin = window.location?.origin || '';
  if (origin.includes('5173') && (base === 'http://localhost:3001' || base === 'http://127.0.0.1:3001')) {
    return '';
  }
  return base;
}

/** 서버 주소를 저장 (로그인 실패 시 사용자가 직접 입력) */
export function setBaseUrl(url: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(API_URL_KEY, url.replace(/\/$/, ''));
}

function getToken(): string | null {
  return getActiveToken();
}

function headers(): HeadersInit {
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) (h as Record<string, string>)['Authorization'] = `Bearer ${t}`;
  return h;
}

function authHeaders(): HeadersInit {
  const h: HeadersInit = {};
  const t = getToken();
  if (t) (h as Record<string, string>)['Authorization'] = `Bearer ${t}`;
  return h;
}

function mapUploadError(status: number, serverMessage?: string) {
  if (serverMessage) return serverMessage;
  if (status === 0) return '네트워크 오류가 발생했습니다';
  if (status === 401) return '로그인이 필요합니다';
  if (status === 403) return '권한이 없습니다';
  if (status === 404) return '업로드 경로를 찾을 수 없습니다. 서버를 최신 버전으로 업데이트했는지 확인해 주세요.';
  if (status === 413) return '파일이 너무 큽니다';
  if (status === 415) return '지원하지 않는 파일 형식입니다';
  if (status >= 500) return '서버 오류가 발생했습니다';
  return '업로드 실패';
}

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

/** Electron에서는 location.href 대신 이벤트로 처리 (file://C:/login 방지) */
export function navigateToLogin(): void {
  if (typeof window === 'undefined') return;
  if (isElectron) {
    window.dispatchEvent(new CustomEvent('emax-force-logout'));
  } else {
    window.location.href = '/login';
  }
}

function handleForcedLogout(path: string, status: number, serverMessage?: string) {
  if (status !== 401) return;
  if (path.startsWith('/auth/login') || path.startsWith('/auth/register') || path.startsWith('/auth/logout')) return;
  // /auth/me 401: 로그인 직후 서버 타이밍 이슈로 즉시 리다이렉트 방지
  if (path.startsWith('/auth/me')) return;
  const msg = serverMessage || '다른 기기에서 로그인되어 로그아웃되었습니다.';
  try {
    localStorage.setItem('forcedLogoutMessage', msg);
    removeStoredToken();
    clearSessionDate();
    if (typeof window !== 'undefined') {
      const isLoginPage = window.location.pathname === '/login' || window.location.pathname === '/register';
      if (!isLoginPage) navigateToLogin();
    }
  } catch {
    // ignore
  }
}

export const api = {
  async post(path: string, body: object, requestHeaders = headers()) {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const serverMsg = (data as { error?: string })?.error;
      handleForcedLogout(path, res.status, serverMsg);
      const fallback = res.status === 500 ? '서버 오류가 발생했습니다' : res.statusText;
      throw new Error(serverMsg || fallback);
    }
    return data;
  },
  async get(path: string) {
    const res = await fetch(`${getBaseUrl()}${path}`, { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      handleForcedLogout(path, res.status, (data as { error?: string }).error);
      throw new Error((data as { error?: string }).error || res.statusText);
    }
    return data;
  },
  async put(path: string, body: object) {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      handleForcedLogout(path, res.status, (data as { error?: string }).error);
      throw new Error((data as { error?: string }).error || res.statusText);
    }
    return data;
  },
  async delete(path: string) {
    const res = await fetch(`${getBaseUrl()}${path}`, { method: 'DELETE', headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      handleForcedLogout(path, res.status, (data as { error?: string }).error);
      throw new Error((data as { error?: string }).error || res.statusText);
    }
    return data;
  },
  upload(
    path: string,
    formData: FormData,
    onProgress?: (percent: number) => void
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${getBaseUrl()}${path}`);
      const t = getToken();
      if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`);
      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }
      xhr.addEventListener('load', () => {
        try {
          const data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else {
            const serverMsg = (data as { error?: string })?.error;
            reject(new Error(serverMsg || mapUploadError(xhr.status)));
          }
        } catch {
          const serverMsg = (() => { try { const d = JSON.parse(xhr.responseText || '{}'); return (d as { error?: string })?.error; } catch { return undefined; } })();
          reject(new Error(serverMsg || mapUploadError(xhr.status)));
        }
      });
      xhr.addEventListener('error', () => reject(new Error(mapUploadError(0))));
      xhr.addEventListener('abort', () => reject(new Error('업로드가 취소되었습니다')));
      xhr.send(formData);
    });
  },
};

export type LoginSuccess = { user: User; token: string; mustChangePassword?: boolean };
/** 2차 인증이 필요하면 세션 토큰 대신 5분짜리 중간 토큰(mfaToken)이 온다 */
export type LoginResponse =
  | (LoginSuccess & { mfaRequired?: undefined; mfaSetupRequired?: undefined; mfaToken?: undefined })
  | { mfaRequired: true; mfaSetupRequired?: undefined; mfaToken: string }
  | { mfaSetupRequired: true; mfaRequired?: undefined; mfaToken: string };
export type MfaStatus = { enabled: boolean; required: boolean; recoveryCodesLeft: number };

export type User = { id: string; email: string; name: string; phone?: string | null; extension?: string | null; deskPhone?: string | null; jobTitle?: string | null; createdAt?: string; isAdmin?: boolean; statusMessage?: string | null; statusNote?: string | null; notepad?: string | null; avatarUrl?: string; mustChangePassword?: boolean };

export type UserAffiliation = {
  departmentId: string;
  departmentName: string;
  companyId: string;
  companyName: string;
  label: string;
  active: boolean;
};

export type PasswordPolicy = {
  ldapEnabled: boolean;
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  hint: string;
};

export type OrgUser = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  extension?: string | null;
  deskPhone?: string | null;
  jobTitle?: string | null;
  avatarUrl?: string;
  statusMessage?: string | null;
  statusNote?: string | null;
  /** 소속팀(부서) 이름. 프로필 상세 표기용 */
  deptName?: string | null;
  /** 소속 회사 이름 */
  companyName?: string | null;
  /** 소속 회사 주소 */
  companyAddress?: string | null;
  /** 같은 부서 안에서의 조회 순번. 작을수록 먼저 나온다(관리자 화면에서만 의미 있음). */
  sortOrder?: number;
  /** false면 겸직(세컨더리 소속)으로 이 부서에 걸린 사람 — 이 부서 안에서 순번을 갖지 않는다. */
  primary?: boolean;
};
export type OrgDepartment = {
  id: string;
  name: string;
  users: OrgUser[];
  /** 상위 부서 id. null이면 회사 바로 아래 */
  parentId?: string | null;
  /** 하위 부서. 회사 전체를 훑을 땐 utils/orgTree의 헬퍼를 쓸 것 */
  children: OrgDepartment[];
  /**
   * 이 부서 직속 인원수. orgApi.treeShallow()로 받은 트리에서만 내려오며,
   * 그때는 users가 비어 있어도(아직 지연 로드 전) 이 값으로 인원수를 표시할 수 있다.
   * orgApi.tree()(전체 로드)로 받은 트리에는 없고, users.length를 그대로 쓰면 된다.
   */
  userCount?: number;
  /**
   * userCount와 짝을 이루는 필드(Main.tsx가 채움): 이 부서의 지연 로드가 실제로 끝났는지.
   * "users.length === 0"만으로는 로딩 중인지 필터(예: 온라인만 보기)로 걸러진 건지 구분이
   * 안 돼서 별도로 둠 — 필터링돼도 이 값은 보존되게 되어 있음.
   */
  usersLoaded?: boolean;
};
export type OrgCompany = { id: string; name: string; departments: OrgDepartment[] };

export type ReactionGroup = { emoji: string; count: number; userIds: string[] };

export type PollOption = {
  id: string;
  text: string;
  voteCount: number;
  voterIds: string[];
};

export type Poll = {
  id: string;
  question: string;
  isMultiple: boolean;
  options: PollOption[];
  messageId?: string;
};

export type Room = {
  id: string;
  name: string;
  isGroup: boolean;
  /** true=아젠다, false=그룹채팅(채팅 섹션) */
  isTopic?: boolean;
  /** 'chat' = 챗뷰(메시지 기반), 'board' = 보드뷰(게시글 기반) */
  viewMode?: 'chat' | 'board';
  /** 폴더 ID (사용자별로 RoomMember.folderId) */
  folderId?: string | null;
  /** 아젠다 생성자 ID (방 설정 권한) */
  createdBy?: string | null;
  members: User[];
  lastMessage: { id: string; content: string; createdAt: string; senderName: string } | null;
  updatedAt: string;
  unreadCount?: number;
  lastReadAt?: string | null;
  avatarUrl?: string;
  initials?: string | null;  // 프로필 이니셜 (최대 2글자)
  isFavorite?: boolean;
};

export type Message = {
  id: string;
  /** 보낸 사람이 만든 전송 고유 키(재전송 중복 방지용). 키를 안 보내는 구버전이 보낸 메시지는 null */
  clientMessageId?: string | null;
  roomId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender: User;
  readCount?: number;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  fileMimeType?: string | null;
  fileExpiresAt?: string | null;
  eventTitle?: string | null;
  eventStartAt?: string | null;
  eventEndAt?: string | null;
  eventDescription?: string | null;
  replyToId?: string | null;
  replyTo?: { id: string; content: string; sender: { id: string; name: string } } | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  reactions?: ReactionGroup[];
  poll?: Poll | null;
  contextFilePath?: string | null;
  contextLine?: number | null;
  contextBranch?: string | null;
};

export type PinnedMessageItem = {
  id: string;
  pinnedAt: string;
  message: {
    id: string;
    content: string;
    sender: { id: string; name: string };
    createdAt: string;
  };
};

export type Event = {
  id: string;
  userId: string;
  title: string;
  startAt: string;
  endAt: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type MentionItem = {
  id: string;
  messageId: string;
  readAt: string | null;
  message: {
    id: string;
    content: string;
    createdAt: string;
    sender: { id: string; name: string };
    room: { id: string; name: string };
  };
};

export type ReaderInfo = {
  userId: string;
  userName: string;
  readAt: string;
};

export type FileInfo = {
  id: string;
  fileName: string | null;
  fileSize: number | null;
  fileMimeType: string | null;
  fileExpiresAt: string | null;
  createdAt: string;
  sender: { id: string; name: string };
};

export type PublicRoom = {
  id: string;
  name: string;
  memberCount: number;
  isMember: boolean;
  lastMessage: { content: string; createdAt: string; senderName: string } | null;
  updatedAt: string;
};

export type ThreadData = {
  parent: Message;
  replies: Message[];
};

export const authApi = {
  /**
   * 본인 비밀번호 변경. 현재 비밀번호가 맞아야 한다.
   * 성공하면 지금 창의 세션은 유지되고 다른 기기의 세션만 끊긴다.
   */
  changePassword: (currentPassword: string, newPassword: string) =>
    api.put('/auth/password', { currentPassword, newPassword }) as Promise<{ ok: boolean }>,
  passwordPolicy: () => api.get('/auth/password-policy') as Promise<PasswordPolicy>,
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }) as Promise<LoginResponse>,
  /** 현재 세션을 유지한 채 비밀번호만 확인 (화면 잠금 해제용 — /auth/login 재호출은 세션을 지운다) */
  verifyPassword: (password: string) =>
    api.post('/auth/verify-password', { password }) as Promise<{ ok: boolean }>,
  /** 2차 인증 2단계 — 로그인 응답과 같은 형태를 돌려준다 */
  mfaVerify: (mfaToken: string, code: string) =>
    api.post('/auth/mfa/verify', { mfaToken, code }) as Promise<LoginSuccess>,
  mfaStatus: () => api.get('/auth/mfa/status') as Promise<MfaStatus>,
  /** mfaToken이 있으면 로그인 도중(강제 등록), 없으면 로그인한 세션으로 호출 */
  mfaSetupStart: (mfaToken?: string) =>
    api.post('/auth/mfa/setup/start', mfaToken ? { mfaToken } : {}) as Promise<{ secret: string; otpauthUrl: string }>,
  mfaSetupConfirm: (code: string, mfaToken?: string) =>
    api.post('/auth/mfa/setup/confirm', mfaToken ? { code, mfaToken } : { code }) as Promise<
      { ok?: boolean; recoveryCodes: string[] } & Partial<LoginSuccess>
    >,
  mfaDisable: (password: string, code: string) =>
    api.post('/auth/mfa/disable', { password, code }) as Promise<{ ok: boolean }>,
  mfaRegenerateRecoveryCodes: (password: string, code: string) =>
    api.post('/auth/mfa/recovery-codes', { password, code }) as Promise<{ recoveryCodes: string[] }>,
  register: (email: string, password: string, name: string) =>
    api.post('/auth/register', { email, password, name }) as Promise<{ user: User; token: string }>,
  me: () => api.get('/auth/me') as Promise<{ user: User }>,
  logout: (token: string) => api.post('/auth/logout', {}, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }) as Promise<{ ok: boolean }>,
};

export type BulkRegisterUserInput = {
  email: string;
  name: string;
  password?: string;
  phone?: string;
  jobTitle?: string;
  departmentName?: string;
  companyName?: string;
};

export type BulkRegisterResult = {
  created: number;
  failed: number;
  users: Array<{
    id: string;
    email: string;
    name: string;
    phone?: string | null;
    jobTitle?: string | null;
    departmentId?: string | null;
    createdAt: string;
  }>;
  errors: Array<{ row: number; email: string | null; reason: string }>;
};

export const usersApi = {
  /**
   * 비밀번호 초기화 (관리자 전용).
   * 기존 비밀번호를 몰라도 바꿀 수 있고, 대상 사용자의 세션은 모두 끊긴다.
   */
  resetPassword: (id: string, password: string) =>
    api.post(`/users/${id}/reset-password`, { password }) as Promise<{
      ok: boolean;
      name: string;
      email: string;
    }>,
  /** 2차 인증 초기화 (관리자 전용) — 인증 앱을 잃어버린 사용자용. 대상 사용자의 세션은 모두 끊긴다. */
  resetMfa: (id: string) =>
    api.post(`/users/${id}/reset-mfa`, {}) as Promise<{ ok: boolean; name: string; email: string; wasEnabled: boolean }>,
  /** 삭제 시 함께 사라지는 데이터 (관리자 전용) */
  deleteImpact: (id: string) => api.get(`/users/${id}/impact`) as Promise<UserDeleteImpact>,
  /**
   * 사용자 삭제 (관리자 전용). 되돌릴 수 없고 보낸 메시지도 함께 지워진다.
   * confirmMessages에는 화면에서 확인한 메시지 수를 그대로 넘긴다(불일치 시 서버가 중단).
   */
  remove: (id: string, confirmMessages: number) =>
    api.delete(`/users/${id}?confirmMessages=${confirmMessages}`) as Promise<{
      deleted: boolean;
      name: string;
      messageCount: number;
    }>,
  list: () => api.get('/users') as Promise<User[]>,
  search: (query: string) => api.get(`/users?search=${encodeURIComponent(query)}`) as Promise<User[]>,
  bulkRegister: (data: { defaultPassword?: string; users: BulkRegisterUserInput[] }) =>
    api.post('/users/bulk', data) as Promise<BulkRegisterResult>,
  /** 직급은 여기서 바꿀 수 없다. 조직 마스터 값이라 관리자만 setJobTitle로 지정한다. */
  updateProfile: (data: { phone?: string | null; extension?: string | null; deskPhone?: string | null; statusMessage?: string | null; statusNote?: string | null }) =>
    api.put('/users/me', data) as Promise<{ ok: boolean }>,
  /** 특정 사용자의 직급 지정 (관리자 전용). 빈 값이면 직급 없음. */
  setJobTitle: (id: string, jobTitle: string | null) =>
    api.put(`/users/${id}/job-title`, { jobTitle }) as Promise<{
      ok: boolean;
      name: string;
      jobTitle: string | null;
    }>,
  updateStatus: (statusMessage: string) =>
    api.put('/users/status', { statusMessage }) as Promise<{ ok: boolean }>,
  /** 개인 메모장 저장 (본인만 조회, 자동저장) */
  updateNotepad: (notepad: string) =>
    api.put('/users/me/notepad', { notepad }) as Promise<{ ok: boolean }>,
  affiliations: () =>
    api.get('/users/me/affiliations') as Promise<{ departmentId: string | null; affiliations: UserAffiliation[] }>,
  setAffiliation: (departmentId: string) =>
    api.put('/users/me/affiliation', { departmentId }) as Promise<{ ok: boolean; departmentId: string; label: string }>,
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.upload('/users/me/avatar', formData) as Promise<{ avatarUrl: string }>;
  },
  deleteAvatar: () => api.delete('/users/me/avatar') as Promise<{ ok: boolean }>,
  fetchUserAvatarBlob(userId: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const base = getBaseUrl();
      const url = base ? `${base.replace(/\/$/, '')}/users/${userId}/avatar` : `/users/${userId}/avatar`;
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      const t = getToken();
      if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`);
      xhr.responseType = 'blob';
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as Blob);
        else reject(new Error('Avatar not found'));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send();
    });
  },
};

export type CompanyItem = {
  id: string;
  name: string;
  /** 저장된 정렬값 */
  sortOrder: number;
  /** 화면에 보이는 조회 순번 (1부터) */
  order: number;
  /** 직속 부서 수 */
  departmentCount: number;
  /** 소속 전체 인원 */
  userCount: number;
};

export type DepartmentItem = {
  id: string;
  name: string;
  parentId: string | null;
  companyId: string;
  companyName: string;
  /** 이 부서에 직접 속한 인원 */
  userCount: number;
  /** 저장된 정렬값 */
  sortOrder: number;
  /** 화면에 보이는 조회 순번 (같은 상위 부서 안에서 1부터) */
  order: number;
  /** 하위 부서까지 합친 인원 */
  totalUserCount: number;
  /** 트리 깊이 (0 = 최상위) */
  depth: number;
  /** '본부 > 팀 > 파트' 전체 경로 */
  path: string;
};

export type JobTitleItem = {
  name: string;
  userCount: number;
  /** 직급 목록에 등록된 값인지. false면 예전에 자유 입력으로 들어간 값 */
  inMaster: boolean;
  sortOrder: number;
  /** 화면에 보이는 조회 순번. 목록에 없는 값은 null */
  order: number | null;
};

export type UserDeleteImpact = {
  id: string;
  name: string;
  email: string;
  /** 함께 삭제될 메시지 수 (Message.sender가 Cascade) */
  messageCount: number;
  memoCount: number;
  roomCount: number;
  createdRoomCount: number;
};

export const orgApi = {
  tree: () => api.get('/org/tree') as Promise<OrgCompany[]>,
  /** 부서 구조 + 인원수만 가벼운 트리로. 사용자 목록은 departmentUsers()로 부서별 지연 로드. */
  treeShallow: () => api.get('/org/tree?shallow=1') as Promise<OrgCompany[]>,
  /** 부서를 펼칠 때 그 부서(하위 부서 제외) 소속 사용자 목록을 가져온다. */
  departmentUsers: (departmentId: string) =>
    api.get(`/org/departments/${departmentId}/users`) as Promise<OrgUser[]>,
  /** 같은 부서(직속) 안에서 임직원 순번을 한 칸 이동한다. 겸직으로만 걸린 사람은 대상이 아니다. */
  reorderUser: (id: string, direction: 'up' | 'down') =>
    api.put(`/org/users/${id}/order`, { direction }) as Promise<{ moved: boolean }>,
  online: () => api.get('/org/online') as Promise<{
    userIds: string[];
    presence?: Record<string, { desktop: boolean; mobile: boolean }>;
  }>,

  companies: () => api.get('/org/companies') as Promise<CompanyItem[]>,
  /** 회사 목록 순번을 한 칸 이동한다. */
  reorderCompany: (id: string, direction: 'up' | 'down') =>
    api.put(`/org/companies/${id}/order`, { direction }) as Promise<{ moved: boolean }>,

  departments: () => api.get('/org/departments') as Promise<DepartmentItem[]>,
  createDepartment: (name: string, parentId?: string | null, companyName?: string) =>
    api.post('/org/departments', { name, parentId, companyName }) as Promise<DepartmentItem>,
  renameDepartment: (id: string, name: string) =>
    api.put(`/org/departments/${id}`, { name }) as Promise<{ id: string; name: string }>,
  /** parentId를 null로 주면 최상위로 올린다. 자기 자신·자기 하위로는 옮길 수 없다. */
  /** 같은 상위 부서 안에서 순번을 한 칸 이동한다. */
  reorderDepartment: (id: string, direction: 'up' | 'down') =>
    api.put(`/org/departments/${id}/order`, { direction }) as Promise<{ moved: boolean }>,
  moveDepartment: (id: string, parentId: string | null) =>
    api.put(`/org/departments/${id}`, { parentId }) as Promise<{
      id: string;
      name: string;
      parentId: string | null;
    }>,
  /** moveToId를 주면 소속 인원을 그 부서로 옮긴 뒤 삭제한다. */
  deleteDepartment: (id: string, moveToId?: string) =>
    api.delete(
      `/org/departments/${id}${moveToId ? `?moveToId=${encodeURIComponent(moveToId)}` : ''}`,
    ) as Promise<{
      deleted: boolean;
      movedUsers: number;
      movedTo?: string;
      /** 한 단계 위로 올라간 하위 부서 수 */
      promotedChildren: number;
    }>,

  jobTitles: () => api.get('/org/job-titles') as Promise<JobTitleItem[]>,
  /** 아무도 쓰지 않아도 목록에 남는 직급을 추가한다. */
  createJobTitle: (name: string) =>
    api.post('/org/job-titles', { name }) as Promise<JobTitleItem>,
  /** 사용 중인 직급은 지울 수 없다(409). 사용자까지 정리하려면 renameJobTitle에 빈 값을 준다. */
  /** 직급 순번을 한 칸 이동한다. 목록에 등록된 직급만 순서를 가진다. */
  reorderJobTitle: (name: string, direction: 'up' | 'down') =>
    api.put('/org/job-titles/order', { name, direction }) as Promise<{ moved: boolean }>,
  deleteJobTitle: (name: string) =>
    api.delete(`/org/job-titles/${encodeURIComponent(name)}`) as Promise<{ deleted: boolean }>,
  /** to를 비우면 해당 직급을 지운다(사용자 직급이 없음 상태가 됨). */
  renameJobTitle: (from: string, to: string) =>
    api.put('/org/job-titles', { from, to }) as Promise<{
      updated: number;
      from: string;
      to: string | null;
    }>,
};

export type AnnouncementItem = {
  id: string;
  title?: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type FileTransferPolicy = {
  enabled: boolean;
  /** 파일 내려받기 허용 여부(업로드와 별개) */
  downloadEnabled: boolean;
  maxSizeMB: number;
  blockedExtensions: string[];
  allowedExtensions: string[];
};
export type SecurityPolicy = {
  /** 입력이 없으면 화면을 잠그는 시간(분). 0이면 사용 안 함 */
  screenLockMinutes: number;
  twoFactor: 'optional' | 'required';
  /** 동시에 열 수 있는 대화창 수. 0이면 제한 없음 */
  maxChatWindows: number;
  fileTransfer: FileTransferPolicy;
  alwaysBlockedExtensions: string[];
};
export type SecurityPolicyPatch = {
  screenLockMinutes?: number;
  twoFactor?: 'optional' | 'required';
  maxChatWindows?: number;
  fileTransfer?: Partial<FileTransferPolicy>;
};
export type FileAuditEntry = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  roomId: string | null;
  fileName: string;
  fileSize: number;
  allowed: boolean;
  reason: string | null;
  createdAt: string;
};

export const appSettingsApi = {
  getExternalSite: () => api.get('/settings/external-site') as Promise<{ url: string }>,
  putExternalSite: (url: string) =>
    api.put('/settings/external-site', { url }) as Promise<{ url: string }>,
  getMailSite: () => api.get('/settings/mail-site') as Promise<{ url: string }>,
  putMailSite: (url: string) =>
    api.put('/settings/mail-site', { url }) as Promise<{ url: string }>,
  getGroupwareUrl: () => api.get('/settings/groupware-url') as Promise<{ url: string }>,
  putGroupwareUrl: (url: string) =>
    api.put('/settings/groupware-url', { url }) as Promise<{ url: string }>,
  getSecurity: () => api.get('/settings/security') as Promise<SecurityPolicy>,
  putSecurity: (patch: SecurityPolicyPatch) => api.put('/settings/security', patch) as Promise<SecurityPolicy>,
  fileAudit: (opts: { blockedOnly?: boolean; limit?: number } = {}) =>
    api.get(
      `/settings/file-audit?limit=${opts.limit ?? 50}${opts.blockedOnly ? '&blockedOnly=1' : ''}`,
    ) as Promise<FileAuditEntry[]>,
};

let securityPolicyCache: { at: number; policy: SecurityPolicy } | null = null;
const SECURITY_POLICY_TTL_MS = 60_000;

/** 보안 정책을 1분간 캐시해서 돌려준다. 실패하면 null(호출 측은 서버 검증에 맡긴다). */
export async function getCachedSecurityPolicy(force = false): Promise<SecurityPolicy | null> {
  if (!force && securityPolicyCache && Date.now() - securityPolicyCache.at < SECURITY_POLICY_TTL_MS) {
    return securityPolicyCache.policy;
  }
  try {
    const policy = await appSettingsApi.getSecurity();
    securityPolicyCache = { at: Date.now(), policy };
    return policy;
  } catch {
    return securityPolicyCache?.policy ?? null;
  }
}

export function clearSecurityPolicyCache(): void {
  securityPolicyCache = null;
}

export const announcementApi = {
  get: () => api.get('/announcement') as Promise<{
    items: AnnouncementItem[];
    content: string | null;
    updatedAt?: string | null;
  }>,
  create: (data: { title?: string; content: string }) =>
    api.post('/announcement', data) as Promise<AnnouncementItem>,
  update: (id: string, data: { title?: string; content: string }) =>
    api.put(`/announcement/${id}`, data) as Promise<AnnouncementItem>,
  put: (content: string) => api.put('/announcement', { content }) as Promise<{ ok: boolean }>,
};

export const eventsApi = {
  list: () => api.get('/events') as Promise<Event[]>,
  create: (data: { title: string; startAt: string; endAt: string; description?: string }) =>
    api.post('/events', data) as Promise<Event>,
  update: (id: string, data: { title?: string; startAt?: string; endAt?: string; description?: string }) =>
    api.put(`/events/${id}`, data) as Promise<Event>,
  delete: (id: string) => api.delete(`/events/${id}`) as Promise<{ ok: boolean }>,
};

export const roomsApi = {
  list: () => api.get('/rooms') as Promise<Room[]>,
  create: (otherUserId: string) => api.post('/rooms', { otherUserId }) as Promise<Room & { members: { user: User }[] }>,
  createTopic: (data: { name: string; description?: string; isPublic?: boolean; viewMode?: string; memberIds: string[]; folderId?: string; initials?: string }) =>
    api.post('/rooms/topic', data) as Promise<Room>,
  createGroup: (data: { name: string; memberIds: string[] }) =>
    api.post('/rooms/group', data) as Promise<Room>,
  get: (id: string) => api.get(`/rooms/${id}`) as Promise<Room>,
  updateViewMode: (roomId: string, viewMode: 'chat' | 'board') =>
    api.put(`/rooms/${roomId}`, { viewMode }) as Promise<{ viewMode: string }>,
  markRead: (roomId: string) => api.post(`/rooms/${roomId}/read`, {}) as Promise<{ ok: boolean }>,
  messages: (roomId: string, cursor?: string) =>
    api.get(`/rooms/${roomId}/messages${cursor ? `?cursor=${cursor}` : ''}`) as Promise<{
      messages: Message[];
      nextCursor: string | null;
      hasMore: boolean;
    }>,
  addMembers: (roomId: string, userIds: string[], isPublic?: boolean) =>
    api.post(`/rooms/${roomId}/members`, { userIds, isPublic }) as Promise<Room>,
  searchMessages: (roomId: string, query: string) =>
    api.get(`/rooms/${roomId}/messages/search?q=${encodeURIComponent(query)}`) as Promise<{ messages: Message[] }>,
  editMessage: (roomId: string, messageId: string, content: string) =>
    api.put(`/rooms/${roomId}/messages/${messageId}`, { content }) as Promise<Message>,
  deleteMessage: (roomId: string, messageId: string) =>
    api.delete(`/rooms/${roomId}/messages/${messageId}`) as Promise<{ ok: boolean }>,
  leave: (roomId: string) =>
    api.post(`/rooms/${roomId}/leave`, {}) as Promise<{ ok: boolean }>,
  toggleFavorite: (roomId: string, isFavorite: boolean) =>
    api.put(`/rooms/${roomId}/favorite`, { isFavorite }) as Promise<{ ok: boolean; isFavorite: boolean }>,
  forwardMessage: (targetRoomId: string, messageId: string) =>
    api.post(`/rooms/${targetRoomId}/forward`, { messageId }) as Promise<Message>,
  toggleReaction: (roomId: string, messageId: string, emoji: string) =>
    api.post(`/rooms/${roomId}/messages/${messageId}/reactions`, { emoji }) as Promise<{ reactions: ReactionGroup[] }>,
  pinMessage: (roomId: string, messageId: string) =>
    api.post(`/rooms/${roomId}/pin`, { messageId }) as Promise<{ ok: boolean }>,
  unpinMessage: (roomId: string, messageId: string) =>
    api.delete(`/rooms/${roomId}/pin/${messageId}`) as Promise<{ ok: boolean }>,
  getPins: (roomId: string) =>
    api.get(`/rooms/${roomId}/pins`) as Promise<{ pins: PinnedMessageItem[] }>,
  files: (roomId: string, cursor?: string) =>
    api.get(`/rooms/${roomId}/files${cursor ? `?cursor=${cursor}` : ''}`) as Promise<{ files: FileInfo[]; nextCursor: string | null; hasMore: boolean }>,
  messageReaders: (roomId: string, messageId: string) =>
    api.get(`/rooms/${roomId}/messages/${messageId}/readers`) as Promise<{ readers: ReaderInfo[] }>,
  thread: (roomId: string, messageId: string) =>
    api.get(`/rooms/${roomId}/messages/${messageId}/thread`) as Promise<ThreadData>,
  listPublic: () =>
    api.get('/rooms/public') as Promise<PublicRoom[]>,
  join: (roomId: string) =>
    api.post(`/rooms/${roomId}/join`, {}) as Promise<Room>,
};

export const filesApi = {
  async upload(roomId: string, file: File, onProgress?: (percent: number) => void, content?: string) {
    // 정책에 막힐 파일을 (수 GB여도) 끝까지 올리고 나서야 알게 되지 않도록 먼저 검사한다.
    // 최종 강제는 서버가 하므로, 정책을 못 읽어오면 검사를 건너뛰고 서버에 맡긴다.
    const policy = await getCachedSecurityPolicy();
    const verdict = policy ? evaluateFilePolicy(file, policy) : null;
    if (verdict) throw new Error(verdict);
    const formData = new FormData();
    formData.append('roomId', roomId);
    formData.append('file', file);
    if (content) formData.append('content', content);
    return api.upload('/files/upload', formData, onProgress) as Promise<Message>;
  },
  async fetchBlob(messageId: string): Promise<Blob> {
    const res = await fetch(`${getBaseUrl()}/files/download/${messageId}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || res.statusText);
    }
    return res.blob();
  },
  async download(messageId: string, filename?: string | null) {
    // Electron: 메인 프로세스가 직접 받아 디스크에 스트리밍 저장 — 렌더러가 큰 파일을
    // 통째로 메모리(blob)에 올리지 않는다.
    if (window.electronAPI?.downloadFile) {
      const result = await window.electronAPI.downloadFile(messageId, filename ?? undefined);
      if (result?.ok || result?.error === 'CANCELED') return;
      throw new Error('다운로드에 실패했습니다.');
    }
    // 웹(비 Electron) 폴백 — 브라우저 다운로드는 blob 경유가 불가피
    const res = await fetch(`${getBaseUrl()}/files/download/${messageId}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || res.statusText);
    }
    const blob = await res.blob();
    let downloadName = filename || 'download';
    const disp = res.headers.get('Content-Disposition');
    if (disp) {
      const utf8Match = disp.match(/filename\*=UTF-8''([^;\s]+)/i);
      if (utf8Match) {
        try {
          downloadName = decodeURIComponent(utf8Match[1]);
        } catch {
          // keep filename from param
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const pollsApi = {
  create: (data: { roomId: string; question: string; options: string[]; isMultiple?: boolean }) =>
    api.post('/polls', data) as Promise<{ message: Message; poll: Poll }>,
  vote: (pollId: string, optionId: string) =>
    api.post(`/polls/${pollId}/vote`, { optionId }) as Promise<Poll>,
  get: (pollId: string) =>
    api.get(`/polls/${pollId}`) as Promise<Poll>,
};

export type Project = {
  id: string;
  roomId: string;
  name: string;
  description?: string | null;
  createdBy: string;
  createdAt: string;
  boards: Board[];
  /** projectsApi.list()로 받은 프로젝트는 항상 비어 있다 — projectsApi.tasks(id)로 따로 가져올 것. */
  tasks: TaskItem[];
  /** projectsApi.list()에서만 내려온다: 태스크를 아직 안 가져온 상태에서도 정확한 개수를 보여줄 수 있음. */
  taskCount?: number;
};

export type Board = {
  id: string;
  projectId: string;
  name: string;
  position: number;
};

export type TaskItem = {
  id: string;
  projectId: string;
  boardId: string;
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  priority: 'low' | 'medium' | 'high';
  startDate?: string | null;
  dueDate?: string | null;
  position: number;
  createdBy: string;
  messageId?: string | null;
  createdAt: string;
  _count?: { comments: number };
};

export type TaskComment = {
  id: string;
  taskId: string;
  userId: string;
  userName?: string;
  content: string;
  createdAt: string;
};

export const projectsApi = {
  list: (roomId: string) =>
    api.get(`/projects/room/${roomId}`) as Promise<Project[]>,
  /** 프로젝트 하나(선택된 탭)의 태스크 전체. 칸반/간트를 열 때(=프로젝트 선택 시) 따로 불러온다. */
  tasks: (projectId: string) =>
    api.get(`/projects/${projectId}/tasks`) as Promise<TaskItem[]>,
  create: (data: { roomId: string; name: string; description?: string }) =>
    api.post('/projects', data) as Promise<Project>,
  update: (id: string, data: { name?: string; description?: string }) =>
    api.put(`/projects/${id}`, data) as Promise<Project>,
  delete: (id: string) =>
    api.delete(`/projects/${id}`) as Promise<{ ok: boolean }>,
  addBoard: (id: string, name: string) =>
    api.post(`/projects/${id}/boards`, { name }) as Promise<Board>,
  updateBoard: (id: string, boardId: string, name: string) =>
    api.put(`/projects/${id}/boards/${boardId}`, { name }) as Promise<Board>,
  deleteBoard: (id: string, boardId: string) =>
    api.delete(`/projects/${id}/boards/${boardId}`) as Promise<{ ok: boolean }>,
  createTask: (id: string, data: { boardId: string; title: string; description?: string; assigneeId?: string; priority?: string; startDate?: string; dueDate?: string; messageId?: string }) =>
    api.post(`/projects/${id}/tasks`, data) as Promise<TaskItem>,
  updateTask: (id: string, taskId: string, data: { title?: string; description?: string; assigneeId?: string | null; priority?: string; startDate?: string | null; dueDate?: string | null }) =>
    api.put(`/projects/${id}/tasks/${taskId}`, data) as Promise<TaskItem>,
  deleteTask: (id: string, taskId: string) =>
    api.delete(`/projects/${id}/tasks/${taskId}`) as Promise<{ ok: boolean }>,
  moveTask: (id: string, taskId: string, boardId: string, position: number) =>
    api.post(`/projects/${id}/tasks/${taskId}/move`, { boardId, position }) as Promise<TaskItem>,
  getComments: (id: string, taskId: string) =>
    api.get(`/projects/${id}/tasks/${taskId}/comments`) as Promise<TaskComment[]>,
  addComment: (id: string, taskId: string, content: string) =>
    api.post(`/projects/${id}/tasks/${taskId}/comments`, { content }) as Promise<TaskComment>,
};

export const mentionsApi = {
  list: () => api.get('/mentions') as Promise<MentionItem[]>,
  markRead: (id: string) => api.post(`/mentions/${id}/read`, {}) as Promise<{ ok: boolean }>,
  unreadCount: () => api.get('/mentions/unread-count') as Promise<{ count: number }>,
};

export type MemoUser = { id: string; name: string; email?: string | null };
export type MemoRecipient = { id: string; userId: string; readAt?: string | null; user: MemoUser };
export type MemoItem = {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  sender: MemoUser;
  recipients: MemoRecipient[];
  readAt?: string | null;
  recipientId?: string | null;
};

export const memosApi = {
  inbox: () => api.get('/memos/inbox') as Promise<MemoItem[]>,
  sent: () => api.get('/memos/sent') as Promise<MemoItem[]>,
  get: (id: string) => api.get(`/memos/${id}`) as Promise<MemoItem>,
  send: (data: { recipientIds: string[]; subject: string; body: string }) =>
    api.post('/memos', data) as Promise<MemoItem>,
  markRead: (id: string) => api.post(`/memos/${id}/read`, {}) as Promise<{ ok: boolean }>,
  remove: (id: string) => api.delete(`/memos/${id}`) as Promise<{ ok: boolean }>,
  unreadCount: () => api.get('/memos/unread-count') as Promise<{ count: number }>,
};

export type LinkPreviewData = { url: string; title: string | null; description: string | null; imageUrl: string | null };

export const linkPreviewApi = {
  get: (url: string) =>
    api.get(`/link-preview?url=${encodeURIComponent(url)}`) as Promise<LinkPreviewData>,
  /** 썸네일 이미지를 서버 경유로 가져와서 외부 차단 시에도 표시 */
  async fetchImageBlob(imageUrl: string, pageUrl?: string): Promise<Blob> {
    let url = `${getBaseUrl()}/link-preview/image?imageUrl=${encodeURIComponent(imageUrl)}`;
    if (pageUrl) url += `&referer=${encodeURIComponent(pageUrl)}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error('이미지를 불러올 수 없습니다.');
    return res.blob();
  },
};

export type Folder = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
};

export const foldersApi = {
  list: () => api.get('/folders') as Promise<Folder[]>,
  create: (name: string) => api.post('/folders', { name }) as Promise<Folder>,
  update: (id: string, name: string) => api.put(`/folders/${id}`, { name }) as Promise<Folder>,
  delete: (id: string) => api.delete(`/folders/${id}`) as Promise<{ ok: boolean }>,
  assign: (roomId: string, folderId: string | null) =>
    api.put('/folders/assign', { roomId, folderId }) as Promise<{ ok: boolean }>,
};

export type OrgGroup = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  members: OrgUser[];
};

export const orgGroupsApi = {
  list: () => api.get('/org-groups') as Promise<OrgGroup[]>,
  create: (name: string) => api.post('/org-groups', { name }) as Promise<OrgGroup>,
  update: (id: string, name: string) => api.put(`/org-groups/${id}`, { name }) as Promise<OrgGroup>,
  delete: (id: string) => api.delete(`/org-groups/${id}`) as Promise<{ ok: boolean }>,
  addMember: (groupId: string, userId: string) =>
    api.post(`/org-groups/${groupId}/members`, { userId }) as Promise<OrgGroup>,
  removeMember: (groupId: string, userId: string) =>
    api.delete(`/org-groups/${groupId}/members/${userId}`) as Promise<OrgGroup>,
};

export function getSocketUrl(): string {
  const base = getBaseUrl();
  if (base === '') return typeof window !== 'undefined' ? window.location.origin : '';
  return base;
}
