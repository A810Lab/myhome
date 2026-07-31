# 1단계: 빌드 스테이지
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# workspaces 의존성 설치를 위해 package.json 파일들 복사
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/collector/package*.json ./packages/collector/
COPY packages/dashboard/package*.json ./packages/dashboard/

# 의존성 설치 (CI)
RUN npm ci

# 소스코드 전체 복사
COPY . .

# 전체 프로젝트 빌드
RUN npm run build

# 프로덕션 실행에 불필요한 devDependencies 제거
RUN npm prune --omit=dev

# 2단계: 실행 스테이지 (용량 최소화)
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4174

# 빌드 결과물 및 필수 파일 복사
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/packages ./packages
COPY --from=builder /usr/src/app/scripts ./scripts

# 데이터 저장 디렉토리 생성
RUN mkdir -p /app/data

EXPOSE 4174

# npm workspace를 사용하여 대시보드 서버 기동
CMD ["npm", "run", "start:server", "--workspace=packages/dashboard"]
