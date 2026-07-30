import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { applySavedDisplayPreferences } from "./lib/displayPreferences";
import { LocaleProvider } from "./LocaleProvider";

// 초기 화면 표시(폰트, 크기, 주조색) 환경 설정 적용
applySavedDisplayPreferences();

// 초기 테마 설정 적용 (다크 모드 여부 감지)
const savedTheme = localStorage.getItem('theme') || 'system';
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = savedTheme === 'dark' || (savedTheme === 'system' && prefersDark);
document.documentElement.classList.toggle('dark', isDark);
if (isDark) {
  document.documentElement.classList.remove('light');
} else {
  document.documentElement.classList.add('light');
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </React.StrictMode>
);

