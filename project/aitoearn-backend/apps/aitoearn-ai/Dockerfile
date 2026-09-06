FROM node:24-alpine AS deps

# Keep the image installer aligned with package.json's packageManager.
# An unpinned pnpm can upgrade its lockfile/engine protocol between builds.
RUN npm install -g pnpm@10.33.0

WORKDIR /app

COPY deps/ ./

RUN test "pnpm@$(pnpm --version)" = "$(node -p 'require("./package.json").packageManager')"

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod

FROM node:24-alpine AS production

ARG APP_NAME

RUN apk add --no-cache curl ffmpeg

WORKDIR /app

COPY assets/ ./
COPY --from=deps /app/ ./

COPY apps/ ./apps/
COPY libs/ ./libs/

ENV NODE_ENV=production
ENV APP_NAME=$APP_NAME

CMD ["sh", "-c", "echo 'nameserver 8.8.8.8' >> /etc/resolv.conf && echo 'nameserver 1.1.1.1' >> /etc/resolv.conf && node apps/${APP_NAME}/src/main.js -c config.js"]
