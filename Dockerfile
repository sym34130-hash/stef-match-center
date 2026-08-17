FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production
ENV PORT=4174
ENV STEF_DATA_DIR=/data/agencies
ENV STEF_UPLOAD_LIMIT_MB=20

EXPOSE 4174

CMD ["pnpm", "start"]
