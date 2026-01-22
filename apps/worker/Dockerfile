FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app/apps/worker

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY apps/worker/package.json apps/worker/package-lock.json ./
RUN npm ci

COPY apps/worker/tsconfig.json ./tsconfig.json
COPY apps/worker/src ./src
COPY apps/worker/.env.example ./.env.example
COPY level /app/level

RUN npm run build

ENV NODE_ENV=production

EXPOSE 4000

CMD ["bash", "-lc", "npm run db:migrate:dist && npm run start"]
