/**
 * lib/i18n.ts
 *
 * 경량 i18n 유틸리티 — Context, 타입, Hook 정의.
 * Provider 컴포넌트는 LocaleProvider.tsx에서 별도로 export합니다.
 */

import { createContext, useContext } from "react";
import { copy } from "../locales/ko";

// ── 타입 정의 ────────────────────────────────────────────────────
export type Locale = keyof typeof copy;
export type Translations = typeof copy[Locale];

export interface LocaleContextValue {
  /** 현재 locale 코드 (예: 'ko', 'en') */
  locale: Locale;
  /** 현재 locale의 번역 문자열 객체 */
  t: Translations;
  /** locale 변경 함수. localStorage에 저장합니다. */
  setLocale: (locale: Locale) => void;
  /** 지원하는 locale 목록 */
  supportedLocales: Locale[];
}

// ── 지원 locale 목록 ──────────────────────────────────────────────
export const SUPPORTED_LOCALES: Locale[] = Object.keys(copy) as Locale[];

// ── 초기 locale 감지 ─────────────────────────────────────────────
export function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem("lang");
    if (saved && (saved in copy)) return saved as Locale;
  } catch {
    // SSR/test 환경에서 localStorage 접근 불가 시 무시
  }
  return "ko";
}

// ── Context (기본값은 ko) ─────────────────────────────────────────
export const LocaleContext = createContext<LocaleContextValue>({
  locale: "ko",
  t: copy.ko,
  setLocale: () => {},
  supportedLocales: SUPPORTED_LOCALES,
});

// ── Hook ─────────────────────────────────────────────────────────
/**
 * 현재 locale의 번역 문자열 `t`와 locale 변경 함수 `setLocale`을 반환합니다.
 *
 * @example
 * function MyComponent() {
 *   const { t, locale, setLocale } = useLocale();
 *   return <button onClick={() => setLocale('en')}>{t.searchButton}</button>;
 * }
 */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}
