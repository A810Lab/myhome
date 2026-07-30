export const MASK_PLACEHOLDER = "●●●●●●●●";

/**
 * 민감 문자열 존재 여부에 따른 마스킹 처리
 */
export function maskSecret(secret?: string | null): string {
  return secret ? MASK_PLACEHOLDER : "";
}

/**
 * 마스킹 고정 문자가 아닌 경우에만 신규 값을 반환하는 헬퍼
 */
export function getUpdatedSecret(incomingValue?: string): string | undefined {
  if (incomingValue !== undefined && incomingValue !== MASK_PLACEHOLDER) {
    return incomingValue;
  }
  return undefined;
}
