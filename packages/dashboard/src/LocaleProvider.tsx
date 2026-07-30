/**
 * LocaleProvider.tsx
 *
 * 전역 언어(locale) Context Provider 컴포넌트.
 * main.tsx에서 <App />을 감싸면 하위 컴포넌트 어디서나 useLocale()로
 * 번역 문자열을 사용할 수 있습니다.
 *
 * 사용:
 *   <LocaleProvider>
 *     <App />
 *   </LocaleProvider>
 */

import { useState, useCallback, type ReactNode } from "react";
import { copy } from "./locales/ko";
import {
  LocaleContext,
  SUPPORTED_LOCALES,
  detectInitialLocale,
  type Locale,
  type LocaleContextValue,
} from "./lib/i18n";

interface LocaleProviderProps {
  children: ReactNode;
  /** 초기 locale을 강제 지정할 때 사용 (테스트 환경용) */
  initialLocale?: Locale;
}

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(
    initialLocale ?? detectInitialLocale
  );

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem("lang", newLocale);
    } catch {
      // 무시
    }
  }, []);

  const value: LocaleContextValue = {
    locale,
    t: copy[locale],
    setLocale,
    supportedLocales: SUPPORTED_LOCALES,
  };

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}
