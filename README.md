# MakerWorld 爬取 + 自动标注工具

这个仓库包含两个服务：

- `apps/web`：Next.js 前端（两页：爬取 / 标注），部署到 Vercel
- `apps/worker`：爬虫 + 标注 Worker（Express + Playwright），部署到 Render/Fly.io

## 本地运行

### 1) 启动 Worker

```bash
cd apps/worker
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

默认端口：`http://localhost:4000`

### 2) 启动 Web

```bash
cd apps/web
cp .env.example .env.local
npm install
npm run dev
```

默认端口：`http://localhost:3000`

## 线上部署（方案 A：省心）

### Web（Vercel）

1. 导入 `apps/web` 为 Vercel 项目
2. 设置环境变量：
   - `NEXT_PUBLIC_WORKER_URL`：Worker 公开访问地址（例如 Render 的 URL）
3. 部署

### Worker（Render）

1. 导入 `apps/worker` 为 Render Web Service
2. Build Command：
   - `npm install && npm run build`
3. Start Command：
   - `npm run db:migrate && node dist/index.js`
4. 环境变量（最小集合）：
   - `PORT`：Render 会注入（或手动设置）
   - `DB_DIALECT=sqlite`（一次性工具可用；若需要持久化建议用 Postgres）
   - `SQLITE_PATH=./data.db`
   - `OPENAI_API_KEY`（启用“自动标注”时必需）
   - `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`（Render 通常不需要；如需自带 Chromium 再设置）

## Cloudflare 拦截说明（重要）

MakerWorld 可能对无交互的爬虫触发 Cloudflare 人机验证。

当前实现的策略：

- 任务失败时会返回 `CLOUDFLARE_BLOCKED`
- 你可以在“爬取”页面把浏览器里已通过验证的 Cookie 粘贴到 `Cookie Header`（通常包含 `cf_clearance`），再重新开始爬取

## 数据导出

在“标注”页点击“导出CSV”，会下载包含以下列的文件：

- ID / 文件链接 / 作者名 / 下载量 / 标题 / 模型图 / 等级 / 图片摘要 / 理由

## 线上部署（方案 B：自建服务器，无账号/无鉴权）

适合“只自己用、换电脑也能访问”的场景：用一台 VPS/家用 NAS 跑 Docker Compose。

### 1) 配置环境变量（服务器上）

在仓库根目录新建一个 `.env`（仅给 docker-compose 读取，不要提交）：

```bash
ARK_API_KEY=你的方舟Key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-1-8-251228

# Web 访问 Worker 的地址（先用公网 IP；有域名后改成 https://worker.xxx.com）
NEXT_PUBLIC_WORKER_URL=http://你的服务器公网IP:4000
```

### 2) 启动

在仓库根目录执行：

```bash
docker compose up -d --build
```

默认访问：
- Web：http://你的服务器公网IP:3000
- Worker：http://你的服务器公网IP:4000

### 3) 安全建议（可选）

你要求“不加账号和鉴权”，但建议至少在防火墙或反向代理层做 IP 白名单，只允许你自己的公网 IP 访问，避免 Key 所在的 Worker 被扫描器打到。

## 线上部署（方案 C：最省事，一条链接直接用）

用 Render 的 Blueprint 一次性部署成“单个网站链接”（Web 与 Worker 在同一个服务里，外部只访问 Web，一个域名即可用）。

### 步骤

1. 把代码推到 GitHub
2. 打开 Render，选择 **New → Blueprint**
3. 选择你的仓库，Render 会识别 [render.yaml](file:///Users/ikutamari/Documents/GitHub/biaozhu/render.yaml)
4. 只需要填一个环境变量：
   - `ARK_API_KEY`
5. 点击 Deploy，等完成后会给你一个形如 `https://xxx.onrender.com` 的链接

之后你在任何电脑直接打开这个链接即可使用，不需要登录系统账号（但链接是公开的，建议用 Render 的访问控制/防火墙或 IP 白名单只放行你自己）。
