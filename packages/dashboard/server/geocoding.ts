/**
 * geocoding.ts — 카카오 REST API 기반 Geocoding + re-exports
 * 
 * 기존 geocoding.ts 파일을 4개로 분리한 후, 하위 호환성을 유지하기 위한
 * re-export barrel 모듈입니다.
 */

export * from "./geocoding-utils.js";
export * from "./geocoding-kakao.js";
export * from "./geocoding-station.js";
export * from "./geocoding-infra.js";
