import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
// 외부 글꼴 사이트(Google Fonts) 접속 없이 앱에 동봉된 글꼴 파일을 쓴다 —
// 인터넷이 차단된 망에서도 글꼴이 깨지지 않고, 실행 시 외부 접속이 발생하지 않는다.
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/600.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/noto-sans-kr/800.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30 * 1000 },
  },
});

// undefined.length 등 TypeError 방지: 전역 에러 핸들러로 로깅 (앱 먹통 방지)
window.addEventListener('error', (e) => {
  if (e.message?.includes("Cannot read properties of undefined") || e.message?.includes("reading 'length'")) {
    console.error('[TPA-Korea] 방어 필요:', e.message, e.filename, e.lineno);
  }
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message ?? String(e.reason);
  if (msg?.includes?.("Cannot read properties of undefined") || msg?.includes?.("reading 'length'")) {
    console.error('[TPA-Korea] Unhandled rejection:', msg);
  }
});

const rootEl = document.getElementById('root')!;
rootEl.style.height = '100%';
rootEl.style.minHeight = '100vh';

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
