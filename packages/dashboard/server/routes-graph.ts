/**
 * routes-graph.ts — Graph API re-exports
 *
 * 기존 routes-graph.ts 파일을 routes/graph 폴더 하위로 5분할하여 이관한 뒤,
 * 서버와의 하위 호환성을 유지하기 위한 re-export barrel 모듈입니다.
 */

export { createGraphRouter } from "./routes/graph/index.js";