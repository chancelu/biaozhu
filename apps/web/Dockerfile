FROM node:20-slim

WORKDIR /app/apps/web

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web/next.config.ts ./next.config.ts
COPY apps/web/tsconfig.json ./tsconfig.json
COPY apps/web/eslint.config.mjs ./eslint.config.mjs
COPY apps/web/next-env.d.ts ./next-env.d.ts
COPY apps/web/postcss.config.mjs ./postcss.config.mjs
COPY apps/web/public ./public
COPY apps/web/app ./app
COPY apps/web/lib ./lib

RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "run", "start", "--", "--port", "3000"]
