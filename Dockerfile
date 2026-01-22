FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY apps/worker/package.json apps/worker/package-lock.json ./apps/worker/
RUN cd apps/worker && npm ci

COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN cd apps/web && npm ci

COPY apps/worker ./apps/worker
COPY apps/web ./apps/web
COPY level ./level
COPY scripts ./scripts

RUN cd apps/worker && npm run build
RUN cd apps/web && npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["bash", "-lc", "chmod +x ./scripts/start-all.sh && ./scripts/start-all.sh"]
