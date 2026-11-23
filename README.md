<div align="center">
  <img src="public/brand/olai-mascot.png" alt="Olai 的蓝紫色星球伙伴小o" width="180" />

  <h1>Olai 创作空间</h1>
  <p><strong>从一句灵感，开始对话、绘图、作曲与视频创作。</strong></p>
  <p>让蓝紫色星球伙伴「小o」陪你，把想法变成作品。</p>

  <p>
    <img src="https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white" alt="Go 1.27" />
    <img src="https://img.shields.io/badge/Vue-3-42B883?logo=vue.js&logoColor=white" alt="Vue 3" />
    <img src="https://img.shields.io/badge/webfront-0.1.8-4F5EE0" alt="webfront" />
    <img src="https://img.shields.io/badge/SQLite-PostgreSQL-6366F1" alt="SQLite / PostgreSQL" />
  </p>

  <p>
    <a href="#功能概览">功能概览</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#环境配置">环境配置</a> ·
    <a href="#部署指南">部署指南</a> ·
    <a href="#开发与验证">开发与验证</a>
  </p>
</div>

> **项目状态：持续开发中。** 当前仍有待修复的问题；生成能力取决于上游服务支持，重要作品请及时下载备份。

## 功能概览

Olai 将 AI 对话与媒体创作放在同一个工作台。首页是作品广场，浏览社区已完成的图像、视频与音乐；从左侧导航进入创作台后，点击输入框下方的「+」即可选择图片、音乐或视频，描述、参数和生成结果都在当前对话中完成。

| 创作方式 | 可以做什么 |
| --- | --- |
| 💬 AI 对话 | 在统一界面中交流想法，随时切换创作模式 |
| 🎨 图片创作 | 设置比例、画质与联想等级，查看原始图片的实际尺寸 |
| 🎵 音乐创作 | 整理灵感、编辑歌曲段落、生成封面、校准歌词，导出 TXT / LRC |
| 🎬 视频创作 | 设置时长、比例与画质，播放、下载并保存生成的视频 |
| 🎞️ 短片工坊 | 从一句话创意生成完整多镜头短视频，分阶段创作与编辑（封闭内测，默认关闭） |
| 🗂️ 作品库 | 收藏创作结果，从已有歌曲继续编辑并生成新版本 |
| 🧠 长期记忆 | 保存称呼与偏好，让之后的对话更懂你；可在设置里管理 |
| ☁️ 账号同步 | 登录后同步游客记录，在其他设备读取账号作品 |
| 👤 个人主页 | 设置公开主页与展示项，关注创作者、公开收藏并互发私信 |

首页和 `/gallery` 都是作品广场：游客和登录用户可浏览所有账号已完成的图像、视频与音乐，支持搜索、按类型筛选、预览、播放、下载和滚动加载；点击作品会在当前滚动位置以共享元素动画展开详情：详情作为独立版块占据左侧版面（左为作品，右为作者、操作与评论），右侧继续显示广场作品，滚动位置不会被带回顶部；浏览器后退或关闭按钮即可回到原处。窄屏下详情改为整页展示，关闭时回到原来的滚动位置。左侧导航同时提供「我的库」，登录后只读取当前账号生成的作品。游客自己的创作仍保存在当前浏览器，登录后自动同步。作者可在作品卡片或详情中修改作品名称与描述，名称会用于广场、作品库和搜索展示。新生成的作品默认私密，作者可在生成结果或「我的库」卡片上点击「发布到广场」后才会公开；已有作品保持原有可见性。聊天记录、未完成/失败作品和短片工作流草稿不会公开，公开浏览不能修改或删除他人的作品。

登录用户的收藏保存在账号数据库中，跨设备同步；旧版本只存在浏览器里的本机收藏会在登录后自动导入。作品卡片显示热度（浏览 1 分、下载 2 分、收藏 3 分），可按「最新 / 最热」排序；浏览与下载按访客去重限频，避免刷新刷热度。作品详情展示作者、评论数与创作信息，登录后可收藏、评论（每条最多 500 字，按小时限频）或提交举报（不当内容、侵权、垃圾内容或其他）；后台「举报」页可标记已处理、忽略，或直接隐藏/恢复作品；被隐藏的作品会同时从广场列表、收藏列表、评论接口和公开媒体接口消失。

广场媒体通过只读接口提供，不会放开原私有附件接口。OSS 附件与不超过 32 MiB 的内联媒体可直接预览；未迁移的外部/浏览器临时链接、超过上限的内联文件只展示作品信息，需由作品所属账号登录后同步迁移附件。缺失或过期的原文件可能无法播放。

原 `/home` 入口会重定向到作品广场，媒体路径直接打开对应创作模式。用户界面隐藏模型名称，默认使用指定创作引擎。

### 小o与交互体验

品牌插画和字标位于 [`public/brand`](public/brand)，保留原始品牌形象；小尺寸标识和 favicon 为 SVG。待机小o使用原图底层和独立 SVG 眼睛，随机眨眼、平滑跟随鼠标，离开窗口后回正；减少动态效果时关闭这些动作，触摸设备不追踪视线。

品牌样式集中在 [`web/portal/src/styles/brand.css`](web/portal/src/styles/brand.css)，公共弹窗位于 [`web/portal/src/components`](web/portal/src/components)，支持键盘操作、焦点恢复及减少动态效果偏好。确认删除与会话重命名使用站内弹窗。

创作参数使用右侧边栏，由对话区右上角的侧栏按钮控制展开和收起，并保留参数与本次访问的展开偏好。桌面展开时主内容与输入框一起缩窄，参数独立滚动；窄屏默认收起，展开为右侧抽屉，支持点击遮罩或按 Escape 关闭。进入歌曲段落编辑时自动展开，参数校验提示在结果区域显示。

### 多语言

界面支持简体中文与英文，默认跟随设备语言（`navigator.languages`），也可以在「创作设置 → 语言」中固定某一种；选择保存在 `localStorage` 的 `olai.locale`，切换后自动刷新页面。服务端按 `Accept-Language` 渲染 `<html lang>` 与页面描述，首屏语言与浏览器一致。

文案体系位于 [`web/portal/src/lib/i18n`](web/portal/src/lib/i18n)；管理后台有同一份词典副本 [`web/admin/src/lib/i18n`](web/admin/src/lib/i18n)：以简体中文原文作为 key（gettext 风格），英文词典按模块拆分，缺失译文自动回落到中文，因此新增文案不会出现空白。组件里用 `t('中文原文')` 取译文，支持 `{name}` 占位符；同一句中文在不同模块含义不同时（例如「关闭」既是关闭面板也是开关关闭）用 `tIn('shell' | 'create' | 'gallery' | 'workflow' | 'admin' | 'errors', …)` 指定模块译法。日期与数字使用 `intlLocale()` 格式化。

修改文案时同步更新英文词典文件；缺失译文会自动回落到中文原文，不会出现空白。

## 快速开始

服务端是 Go，前端是 Vue 3，由 webfront 在 Go 进程内编译；**构建和运行都不需要 Node.js**。

### 1. 安装依赖

需要 Go 1.27 或更新版本。

```bash
go mod download
```

### 2. 配置服务

将 [`.env.example`](.env.example) 复制为 `.env`，由部署者填写上游服务地址、密钥和模型别名。所有 `AI_*` 变量仅供服务端使用，浏览器不填写或保存 API Key，也不选择上游模型。

```dotenv
AI_API_BASE_URL=https://example.com/v1
AI_API_KEY=你的上游服务密钥
```

默认配置为 web2api 在线版本。客户端仅获取公开的服务状态和额度，不提供 `/models` 上游目录透传；上游模型名称、连接密钥、系统与功能预设提示词均由服务端管理，不通过前端设置或生成响应公开。用户自己输入的描述、歌词和创作内容正常保留。

### 3. 构建两个前端

`web/` 下共用一份 `package.json` / `package-lock.json` / `wf_modules`，两个前端各自有源码与产物：

- `web/portal`：公开站点与创作工作台；`/`、`/download` 由 Go 做 SSR，工作台路由由 SPA 外壳接管。
- `web/admin`：管理后台 SPA，与门户完全隔离，自带独立登录页；默认入口 `/admin`（登录页 `/admin/login`），固定从 `/admin/assets/` 加载资源，入口路径可在后台改。

```bash
go tool wf install ./web
go tool wf build -modules ../wf_modules ./web/portal
go tool wf build -mode spa -base /admin -modules ../wf_modules ./web/admin
```

> Git Bash 会把 `-base /admin` 误当成 Windows 路径；在该环境下给最后一条命令加 `MSYS_NO_PATHCONV=1`。Linux / macOS 不需要。

### 4. 启动

```bash
go run .
```

打开 [http://localhost:4321](http://localhost:4321)，开始对话或选择创作模式。产物已通过 `//go:embed` 打进二进制，部署时只需要 `go build` 出的可执行文件、`.env` 与可写的 `data/` 目录。

## 创作说明

### 音乐与歌曲编辑

音乐支持 Composer 段落编辑和灵感整理，两种模式共享歌曲结构。灵感模式每次读取当前描述与风格；Composer 使用最新编辑的歌词和编曲，修改下方灵感后会重新整理歌曲。

完成的作品和作品库中均可点击「编辑后生成」载入歌曲，修改后保存为新作品，保留原版本。游客的歌词、编曲结构和音频关联保存在当前浏览器，登录后保存在账号数据库中，支持 TXT 和 LRC 导出。纯音乐不会生成歌词文件。

### 可选封面与旧作品补图

音乐参数中可勾选「生成封面」，默认关闭。勾选后，在音频完成时调用 Nanobanana 2.1，根据歌曲名称、风格、主题与歌词生成 1:1 封面，与歌曲关联保存，并显示在作品卡片、唱片和迷你播放器中。

支持单独下载封面，下载作品时也会包含封面；封面失败不影响音频，可单独重试。编辑旧作品会恢复原封面选项，新版本生成对应的新封面。

没有封面的已完成音乐作品提供「生成封面」按钮，创作结果与作品库都可直接补图。旧版本没有保存歌曲段落的作品，也会根据原描述生成封面。补图只更新原作品的封面，保留音频、歌词和时间轴。

### 歌词导出与校准

初始 LRC 按实际音频时长估算，不能保证与演唱对齐。在作品卡片或播放器点击「校准歌词」，会把实际音频（转换为单声道 WAV）和逐句歌词提交给默认 3.8 文本引擎，通过 `input_audio` 获取开始与结束时间，保留前奏和间奏留白。

服务需要支持音频输入和理解；只校验结果的完整性与时间范围，实际同步效果需试听检查。成功后同步更新播放器、下载文件及本地保存；失败保留已有时间轴并显示原因。

自动校准后仍有偏差时，可在播放器歌词面板点击「手动校对」逐句校正：左侧显示音频波形和各句起点标记，点击或拖动波形可定位，播放时选中一行点「打点」（或按 `T`）把该句起点设为当前播放位置，并自动跳到下一句；也可用 ±0.1s / ±1s 微调单句、整体平移全部时间轴，`←` / `→`（或 `[` / `]`、`-` / `=`）微调 0.1 秒（按住 Shift 为 1 秒）。点击歌词行的时间可直接输入 `01:23.45` 或秒数；开启「联动后续」（`L`）后，微调或修改时间会同步平移该句之后的所有句子，适合修正从某一句开始的整体漂移。双击歌词行可修改文字，支持 `Ctrl+Z` / `Ctrl+Shift+Z`（或 `Ctrl+Y`）撤销重做，播放倍速可降到 0.5x。保存会保留原 LRC 的 `[ti:]`、`[ar:]`、`[al:]` 等头部信息和自定义标签（校对后的时间戳已是最终时间，不再保留 `[offset:]`），写入 `manual` 时间轴，与音频校准一样视为已校对，并随作品保存、同步和导出。

### 图片尺寸与画质

图片默认 **Auto 比例 / 1K 画质 / Medium 联想**，支持主流比例、自定义正数比例及 1K / 2K / 4K。默认聊天兼容模式将画质写入提示词，无法保证精确控制；原生分辨率控制见[上游接口与模型](#上游接口与模型)。

图片作品显示原始文件的实际宽高，并保存到作品记录；旧作品在预览载入后也会显示实际尺寸。若返回图片的长边未达到目标分辨率（1K：1024、2K：2048、4K：至少 3840，兼容 3840 和 4096），卡片和生成完成提示会说明未达标。图片读取失败不影响保存或下载，不会将图片拉伸成 4K。

### 视频创作与短片工坊

**单镜头视频创作**：默认使用 **Omni 1.1 Flash**，参数提供 16:9 / 9:16、3–10 秒滑块（步长 1 秒）与 720p / 1080p / 4K，默认 **4 秒 / 720p**。

**短片工坊（视频工作流）**：从一句话创意生成完整的多镜头短视频，分阶段进行创作与编辑。该功能处于**封闭内测**，默认不对外发布：只有显式配置 `AI_SHORT_FILM=true` 的部署才会显示入口，否则侧边栏不出现「短片工坊」，直接访问 `/workflow` 会回到 AI 对话。

创作工作台支持拖拽编排：在左侧元素库创建人物、场景和道具，拖入镜头即可复用设定；拖动镜头顶部的手柄调整顺序，右侧编辑时长、画面、运镜和对白，底部时间线展示镜头节奏。也可以点选镜头后添加元素，使用前移 / 后移按钮或手柄上的左右方向键排序。元素设定会进入脚本、分镜和对应镜头的生成提示词；修改已关联的设定后，相关镜头需要重新生成。项目自动保存，支持游客本地保存和登录后的账号保存。

1. **编剧**：AI 将创意扩展为完整脚本，并生成风格圣经（角色外观、服装、美术风格、色调）确保视觉一致性
2. **分镜**：根据脚本生成结构化的镜头列表（景别、机位、运动、对白、音效）
   - **完整编辑功能**：编辑每个字段（时长、景别、运动、场景描述、对白、音效）
   - **增删重排**：添加/删除/复制镜头，拖拽或上下移动重新排序
   - 编辑后自动重新编号，修改镜头后需重新生成其关键帧和视频
3. **关键帧**：为每个镜头生成静态参考图（16:9, 1K），遵循风格圣经保持统一视觉
   - 支持单独重新生成失败的关键帧
   - 计入图片额度，失败自动退款
4. **镜头视频**：基于关键帧或纯文本为每个镜头生成视频
   - **图生视频**：通过 `AI_VIDEO_IMAGE_INPUT=true` 启用（需 web2api v0.3.1+），使用关键帧作为首帧参考
   - **Omni 异步模式**：通过 `AI_VIDEO_OMNI_ASYNC=true` 启用（需 web2api v0.3.1+），Omni 走 `/v1/videos` 异步任务
   - **连续长镜头模式**：Omni 异步时可选，使用 `extend_from` 将镜头序列连接为一个 10-30 秒的连续视频，保持视觉连贯性（默认最多 30 秒，可配置 `AI_VIDEO_EXTEND_MAX_SECONDS`）
   - **并发控制**：默认最多 2 个并发生成，减少上游压力
   - **429 处理**：显示 `Retry-After` 和每日额度提醒，Omni 每日约 3-5 次
   - 支持失败重试，不丢失已完成镜头
5. **配乐**（可选）：生成与脚本情绪匹配的背景音乐（~180 秒），自动裁剪和淡出到片长
6. **成片**：使用 ffmpeg.wasm 在浏览器中合成完整 MP4
   - **视频拼接**：按顺序合成所有镜头，统一分辨率和帧率（720p/1080p, 30fps）
   - **音频混合**：背景音乐降音（ducking）混入原视频音轨，自动淡出
   - **字幕**：可选烧录对白字幕，或导出 SRT 文件单独使用
   - **进度显示**：实时显示合成进度
   - **预览下载**：在线预览成片，下载为 MP4，保存到作品库

工作流项目自动保存，支持断点续传。目标时长可配置（默认 30 秒），每个镜头 3-30 秒。

**Omni 模式**（默认 `gemini-omni-1.1-flash`）：
- 通过 /v1/chat/completions 接口，约 43 秒返回
- 顶层 `resolution` 参数（720p/1080p/4k）控制画质
- 时长、比例写入提示词作为创作偏好
- 支持 3–10 秒时长
- 返回 Markdown 格式的 Base64 视频：`![media](data:video/mp4;base64,...)`

**Veo 模式**（配置 `veo-*` 模型）：
- 分辨率直接映射：720p (1280×720), 1080p (1920×1080), 4K (3840×2160)，竖屏比例自动调换
- 4K 视频需要 8 秒时长，选择 4K 会自动使用 8 秒
- 使用独立 /v1/videos 异步任务接口
- 支持 4–8 秒时长

视频按 MIME 保存原始文件，可播放、下载并收入作品库。两种路由共用视频生成额度。具体协议见[上游接口与模型](#上游接口与模型)。

## 账号与生成额度

### 注册与登录

点击侧边栏或顶部的「登录 / 注册」会进入独立的登录页 `/login`，可使用邮箱和 **8–128 位密码**注册。注册后会向该邮箱发送验证链接，验证通过后才能登录。已登录用户点击「我的账号」进入账号中心 `/account`，可查看积分、每日额度、邀请码与价目，同步本地数据或退出登录；点击资料卡上的「编辑资料」可以修改昵称、选择预设头像，或上传 PNG / JPG / WebP 图片作为头像（上传会把图片居中裁剪为 256×256，并保存到私有媒体存储，需启用 OSS）；修改后工作台与账号中心会同步显示。账号中心在服务端校验登录态，未登录访问会带 `next=/account` 转到登录页。

密码使用 scrypt 加盐散列，登录凭证通过 HttpOnly / SameSite Cookie 保存，数据库仅保存凭证散列，有效期 30 天。HTTPS 部署只信任带 `__Host-` 前缀的会话 Cookie，防止子域投放裸 Cookie；从旧版本或纯 HTTP 部署升级的用户可能需要重新登录一次。登录页提供密码重置：输入邮箱后会收到重置链接，30 分钟内有效。验证邮件和重置邮件由 `MAIL_*` 配置通过 SMTP 发送（`.env` 或管理后台「系统设置 → 出站邮件」），发件地址为 `MAIL_FROM`（默认 `noreply@olai.cc`）。已有账号在升级后视为已验证，不受影响。GitHub / Google 登录仍使用各平台已验证的邮箱，无需再走邮件验证。退出登录会撤销当前登录凭证并回到工作台。

#### 个人主页、关注与私信

登录用户在账号中心「编辑资料与隐私」中设置公开主页地址（3–20 位小写字母、数字或连字符）、简介、个人网址和展示开关；可分别控制作品、收藏、简介、加入时间、关注数据和私信权限。作品作者名会链接到 `/u/<handle>`，主页只展示已完成的公开作品，收藏只有在作者主动公开时才可见。关注与拉黑互斥，拉黑会同时解除双方关注并阻止私信；私信要求双方都未拉黑且收信人开启私信。

新作品默认私密，作品库和生成结果卡片上提供「发布到广场」按钮；已发布的作品可随时撤回。私密作品不会出现在广场、个人主页、公开收藏、评论和公开媒体接口中，仍保留在作者自己的库中。发布状态只通过专门的接口修改，普通的作品保存不会意外公开或撤回作品。作者也可以修改自己作品的名称（最多 80 字）和描述（最多 16000 字），保存后会同步到广场、作品库和搜索。收藏可以创建分类并移动作品；删除分类不会删除作品，只会把其中的收藏移回未分类。

#### 使用 GitHub 登录

配置 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET` 后，登录页会显示「使用 GitHub 登录」；未配置时入口自动隐藏。GitHub 账号使用**已验证的主邮箱**创建或关联本站账号：邮箱已存在时直接登录原账号，不创建重复账号；新邮箱会创建账号，若同时带了邀请码也会记录邀请关系。授权失败会回到 `/login?github_error=…` 并显示具体原因。

第三方账号没有可用密码（数据库保存不可用于登录的 `oauth:` 标记），因此只能用对应的第三方方式登录，不会覆盖或绕过已有密码。授权回调地址固定为 `{SITE_ORIGIN}/api/auth/github/callback`，反向代理部署时必须配置 `SITE_ORIGIN`，并与 GitHub OAuth App 后台填写的地址完全一致。

在 GitHub → Settings → Developer settings → OAuth Apps 新建应用并填写回调地址即可；本地开发的回调地址为 `http://localhost:4321/api/auth/github/callback`。授权使用一次性 state Cookie 校验来源，回调后立即删除。

若服务器所在网络无法直连 `github.com`（表现为终端日志 `GitHub login failed: fetch failed`，而浏览器能打开 GitHub），通常是因为浏览器走了系统代理而 Go 服务端不走。此时在 `.env` 设置 `GITHUB_PROXY` 指向该代理（例如 `GITHUB_PROXY=http://127.0.0.1:7890`）即可，GitHub 的令牌和用户信息请求都会经过它；未设置时也会读取 `HTTPS_PROXY` / `https_proxy`。没有代理时可用 `GITHUB_RESOLVE_IP` 指定一个可访问的 github.com 地址作为备选。两者都只影响服务端请求，不修改系统 hosts，也不会关闭证书校验；网络恢复后建议留空。

#### 使用 Google 登录

配置 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET` 后，登录页会显示「使用 Google 登录」；未配置时入口自动隐藏。Google 账号使用稳定的 `sub` 作为身份主键，只有 `email_verified=true` 的邮箱才会用于创建或关联本站账号：邮箱已存在时登录原账号，新邮箱会创建账号，注册时携带的邀请码也会记录邀请关系。授权失败会回到 `/login?google_error=…` 并显示具体原因。

在 Google Cloud Console 创建 **Web application** 类型的 OAuth 客户端：Authorized redirect URI 填 `{SITE_ORIGIN}/api/auth/google/callback`（本地开发为 `http://localhost:4321/api/auth/google/callback`），scope 只需 `openid email profile`。开发期 OAuth 同意屏可保持 Testing 并添加测试账号；正式上线前发布为 In production，并将 `SITE_ORIGIN` 配置为与 Google 后台完全一致的公开域名。登录使用一次性 state Cookie 与 PKCE（S256）校验来源，回调后立即删除。

若服务器无法直连 `oauth2.googleapis.com` / `openidconnect.googleapis.com`，可设置 `GOOGLE_PROXY`（留空读取 `HTTPS_PROXY` / `https_proxy`）；该代理只影响服务端换取令牌和读取用户信息，不改变浏览器到 `accounts.google.com` 的连接。**Google 登录页在中国大陆普通网络不可访问**，因此它只能作为海外用户的可选登录方式，不能替代邮箱密码或 GitHub 登录。

### 管理后台

后台与门户使用**两套完全独立的登录体系**：后台账号保存在 `admin_accounts`，后台会话使用自己的 HttpOnly Cookie（默认 12 小时有效，HTTPS 下同样只信任 `__Host-` Cookie），门户登录不会获得后台权限，后台登录也不会登录门户。门户不显示任何后台入口或入口提示，后台页面也不链接回门户。后台默认入口是 `/admin`，登录页是入口下的 `/login`（默认 `/admin/login`）；入口可在“系统设置”中改成自定义路径（例如 `/console-x7k2`），修改后原入口立即失效，`/admin/assets/` 保持固定。

全新部署在 `/setup` 创建第一个**后台管理员账号**，完成后直接跳转到后台登录页；该账号不会自动创建或登录门户账号。存量部署首次启动时，会把 `ADMIN_EMAILS`（逗号分隔，大小写不敏感）中已在门户注册且使用密码登录的邮箱一次性迁移为独立后台账号，初始密码沿用原门户密码，请登录后台后立即修改；只有第三方登录（GitHub / Google）、没有门户密码的邮箱无法自动迁移，需要用下面的命令设置后台密码。门户之后修改密码不会影响后台账号，反之亦然。

忘记后台密码或需要新增管理员时，在服务器上运行（留空 `-password` 会生成随机密码并打印一次）：

```bash
go run ./cmd/admin-passwd -email admin@example.com
```

后台页面本身不含业务数据，能否使用由 `/api/admin/session` 与每个 `/api/admin/*` 接口在服务端重新校验后台会话决定；未登录时后台显示自己的登录页，不会跳回门户。后台还提供“修改密码”，修改后会注销该账号在其他设备上的后台会话。

后台包含：概览（账号、流通/消耗积分、近 14 天消耗、最新账号、待处理举报）、用户搜索与详情、积分加减（写入积分流水和审计日志，扣减不会产生负余额）、账号停用与恢复（停用会立即注销该账号所有会话并阻止再次登录）、邀请排行榜与明细、生成消耗与作品记录、作品管理（以官方账号发布作品，编辑任意作品的名称/描述/可见性，隐藏或删除作品）、作品举报处理（标记已处理/忽略、隐藏/恢复作品）、媒体对象浏览与删除（同时删除对象存储中的文件）、系统设置和操作日志。

**“系统设置”是运行期配置的主入口**：AI 网关与模型、每日额度与限流、积分单价与邀请奖励、GitHub / Google 登录、私有 OSS、站点地址等全部保存在主数据库的 `app_settings` 中（默认部署即 SQLite，PostgreSQL 部署时随主数据库保存）。首次启动会把 `.env` 里已填写的同名项一次性导入数据库（`SETTINGS_SEEDED` 标记），之后以数据库为准；保存后本进程立即生效，多实例部署最多 10 秒同步。AI 服务中的对话、图片、视频、音乐默认模型直接从“模型与定价”里已启用的同类模型中选择，也可选“内置默认”回到内置模型；尚未同步模型目录时仍可手动填写。密钥类配置只显示“是否已配置”，不会回传到浏览器或写入日志；留空保存表示保持原值，“恢复默认”会回到 `.env` 或内置默认值。只有 `HOST`、`PORT`、`DATABASE_URL`、`SETUP_TOKEN` 等启动参数仍只从 `.env` 读取。当前版本未使用 Redis，会话与限流保存在主数据库；SQLite / PostgreSQL 由启动前的 `DATABASE_URL` 选择。

**“模型与定价”支持按模型逐一计价。** 列表可以按类型筛选并搜索别名或上游模型 ID。点击“同步网关”会从 `${AI_API_BASE_URL}/models`（OpenAI 兼容格式）拉取模型列表，并**严格以网关返回的列表为准**：新模型自动按名称猜测为对话、图像、视频或音乐并加入后台，网关中已不存在的模型（包括手动添加的）会被删除；仍然存在的模型只更新上游 `display_name`，保留已配置的别名、类型、启用状态和价格。也可以手动填写上游模型 ID 添加，但在下次同步时若网关未返回该模型就会被移除。每个模型可以单独设置显示别名、启用状态、支持的档位和积分价格：图像可选 1K/2K/4K，视频可选 360p/720p/1080p/4K，音乐按每分钟、对话按每条消息计价。只有勾选的档位会出现在用户端的画质/分辨率选择里，价格输入框也只显示这些档位。保存后用户端立即出现这些模型供选择，并按所选模型的价格扣积分。

浏览器只会拿到模型的不透明公开 ID、别名、支持的档位和积分价格；上游模型 ID 仅保存在服务端，不会出现在 `/api/models` 响应、页面源码或日志中。停用的模型不再出现在选择列表，但仍保留价格配置。未选择模型（或模型目录为空）时继续使用 `.env` / 系统设置中的默认模型与全局档位价。

### 版本与更新

服务端版本在构建时写入二进制：`go build` 不传参数时显示 `dev`，正式构建建议传入语义化版本：

```bash
go tool wf build -modules ../wf_modules ./web/portal
go tool wf build -mode spa -base /admin -modules ../wf_modules ./web/admin
go build -trimpath -ldflags="-s -w -X olai/internal/version.Version=1.5.0" -o olai .
```

Docker 构建支持 `VERSION`、`COMMIT`、`BUILT_AT` 三个 build arg；例如 `docker build --build-arg VERSION=1.5.0 -t olai:1.5.0 .`。网络无法直接访问 Go 官方模块代理时，可追加 `--build-arg GOPROXY=https://goproxy.cn,direct`。正式镜像由 Release 工作流在推送 `v*.*.*` tag 时自动构建，后台页头会显示当前服务端版本，下载页页脚也会显示。该版本号是构建产物的一部分，不能在后台修改。

#### 整站更新

后台「系统设置 → 版本与更新」顶部提供**整站更新**面板，显示当前服务端版本、最新 Git tag、最近部署记录，并可从后台触发整站升级。它不会让容器直接操作 Docker；点击「更新整站」只是通过 GitHub API 触发仓库里的 `Deploy production` 工作流（默认 `deploy.yml`），实际部署仍由 Actions 完成：检出 tag、备份 SQLite 数据卷、拉取 GHCR 镜像、替换 Compose 服务、健康检查，失败自动回滚。服务端与两个前端随镜像一起更新。

启用前需要填写：

| 配置 | 说明 |
| --- | --- |
| `SITE_UPDATE_ENABLED` | 开启后台整站更新入口 |
| `SITE_UPDATE_REPO` | GitHub 仓库，格式 `owner/repo`，默认 `plunjoin/olai` |
| `SITE_UPDATE_WORKFLOW` | 部署工作流文件名，默认 `deploy.yml` |
| `SITE_UPDATE_REF` | 触发工作流的分支，默认 `master`，该分支必须包含部署工作流 |
| `SITE_UPDATE_TOKEN` | 细粒度 GitHub PAT，需要 `Actions: Read and write` 与 `Contents: Read`；仅保存在服务端 |

这些配置也可写入 `.env`，首次启动时导入数据库。部署工作流使用仓库 `Settings → Environments → production` 的审批策略；若配置了 Required reviewers，后台会显示「等待审批」，需要在 GitHub Actions 中批准后才会继续。更新前应先确认对应 tag 的 `Release image` 工作流已经成功，否则部署工作流会在镜像校验阶段失败。后台不能绕过 GitHub 审批、SSH 密钥或服务器上的 Docker 权限。

首次升级到包含该面板的版本（`v1.5.0`）仍需要在 GitHub Actions 手动运行一次 `Deploy production`；部署完成并进入新后台后，后续版本才可以在「系统设置 → 版本与更新」中直接触发整站更新。

#### 客户端更新

后台「系统设置 → 版本与更新」控制 iOS / Android 的发布信息：是否启用更新检查、是否强制旧版本更新、更新说明、最新版本、最低支持版本和下载地址。最低版本不能高于最新版本；版本格式为 `1.2.3`（也接受 `v1.2.3` 或 `1.2`）。保存后立即生效，多实例最多 10 秒同步。

原生客户端启动、回到前台时调用以下接口（无需登录）：

```http
GET /api/app/update?platform=ios&version=1.2.3
```

```json
{
  "enabled": true,
  "platform": "ios",
  "currentVersion": "1.2.3",
  "latestVersion": "1.5.0",
  "minimumVersion": "1.3.0",
  "updateAvailable": true,
  "required": true,
  "downloadUrl": "https://apps.apple.com/app/id0000000000",
  "notes": "修复播放问题，优化生成速度。",
  "checkedAt": 1763800000000
}
```

- `updateAvailable` 表示当前版本低于最新版本。
- `required` 为 `true` 时客户端应显示不可跳过的更新页；低于最低支持版本时始终为 `true`，后台开启「强制旧版本更新」后所有低于最新版本的客户端都会强制更新。
- `platform` 只接受 `ios` 或 `android`；缺少 `version` 时仍返回发布信息，但不会判定需要更新。
- `GET /api/version` 返回服务端构建信息和两个平台的公开发布信息，下载页使用它展示商店链接、版本号和更新说明。

### 本地保存与账号同步

默认继续使用浏览器 IndexedDB（不支持时使用 localStorage）。登录或注册成功后，自动将当前浏览器尚未关联账号的游客会话、作品、音频/视频、歌曲结构、封面和歌词在后台同步并关联到当前账号。

先载入账号记录并开放工作台，同步不会阻塞新建对话和其他操作。已登录的页面刷新时也会补同步未完成的游客记录。

每条记录上传成功后才标记本地归属，原始本地副本保留作为备份；已关联的记录不再显示为游客记录，也不会同步给之后登录的其他账号。

重复导入不会产生重复记录或覆盖云端已有修改；单条同步失败会继续处理后续记录，未完成的内容保留在本地；工作台和账号中心均可重试同步并查看错误。

启用 OSS 后，图片、音频、视频、歌曲封面、TXT / LRC、关键帧及浏览器合成成片先上传私有 OSS，数据库保存记录、附件归属、对象 key、MIME、字节数和 SHA-256；记录正文只引用本站 `/api/media/{uuid}`。单个附件默认上限 256 MiB，浏览器上传超时 180 秒；记录 JSON 上限仍为 64 MB，不再包含新上传媒体的 Base64。未启用 OSS 时兼容原来的本地 / 数据库内联保存。

账号中心始终提供「同步本地数据」按钮。登录自动同步会导入尚未关联的本地缓存，并将账号数据库里旧的 Base64 / 远程媒体迁移到 OSS。只有附件上传和记录保存都成功才标记本地归属；失败保留原数据，可重试。旧数据库迁移逐条处理，版本冲突不覆盖并发编辑。关闭短片内测时不尝试迁移短片记录。已经关联其他账号的本地记录不会导入当前账号。

退出后可继续创建新的游客记录。浏览器只保存允许的创作偏好，不保存连接密钥、上游模型或预设提示词；旧版浏览器密钥与设置会自动清理。记录读写和游客导入会递归移除旧版私有配置字段，保留用户描述、歌词、正文和媒体。账号记录接口逐次验证登录身份和记录归属；账号过期或云端保存失败时会提示错误，请下载重要内容备份。

新建异步视频任务使用不透明任务编号；旧版仍在等待中的任务可能需要重新生成，已保存的成品不受影响。

### 长期记忆

登录用户可在「创作设置 → 长期记忆」中保存称呼、语言与语气偏好、长期目标等短句。每条记忆 1–280 个字符，每个账号最多 50 条，保存在账号数据库中，可随时编辑、单条删除或清空；删除账号时会一并删除。

- 「在对话中使用记忆」默认开启。开启时，普通对话会在服务端系统提示词末尾附上已保存的记忆，让回答更贴合用户；关闭后记忆仍会保留，但不再加入对话。
- 「自动记住对话中的偏好」默认关闭。开启后，每轮成功回答会额外调用一次默认对话模型，从最近的对话中提取最多 3 条值得长期保留的信息，并标记为「自动记录」。提取失败不会影响对话中的回答。
- 记忆只作用于当前账号的普通对话，不会注入歌曲整理、歌词校准、短片脚本或每日灵感等其他 AI 请求。记忆由服务端读取并拼入系统提示词，浏览器请求不能直接修改系统提示词。

### 每日生成额度

| 身份 | 默认额度 | 计算方式 |
| --- | --- | --- |
| 游客 | 每种类型每天 1 次 | 按 IP |
| 登录用户 | 每种类型每天 15 次 | 按账号 |
| 游客对话 | 每天 100 条 | 按 IP |
| 登录用户对话 | 每天 100 条 | 按账号 |

图片、音乐、视频分别计算每日生成额度，按**北京时间零点**重置。

普通对话计入**对话额度**（默认每天 100 条，游客按 IP、登录用户按账号分别配置）；歌曲文本整理与歌词校准走对话接口，同样计入对话额度；视频轮询/下载不计次数。**歌曲封面计入图片额度。**

对话还按 IP 限流：每分钟最多 30 条（`CHAT_RATE_LIMIT`）、同时最多 20 个进行中的对话请求（`CHAT_CONCURRENT_LIMIT`，含流式未结束的请求），超限返回 429 并附带 `Retry-After`；两项均可配置，0 表示不限制。上游请求失败会退还当日对话次数，但限速计数不退还。

额度由服务端数据库原子预占；已经提交的生成请求计一次，失败、停止和重试也会使用次数。同一类型的原生聊天生成与专用媒体接口共用额度，所有请求统一使用服务端连接配置，不接受客户端自带 API Key。

次数必须为非负整数，`0` 禁用对应身份的媒体生成；修改后重启服务。登录 / 注册接口另有每 IP 每 15 分钟 20 次的保护。

### 积分与邀请

登录账号在每日额度之内，按所选档位消耗积分；游客不参与积分，继续使用每日额度。每日额度仍是硬上限，积分用于邀请奖励和后续运营。

| 档位 | 默认积分 |
| --- | --- |
| 图片 1K / 2K / 4K | 1 / 2 / 4 |
| 视频 360p / 720p / 1080p / 4K（每秒） | 1 / 2 / 4 / 8 |
| 音乐（每分钟，不足一分钟按一分钟计） | 2 |
| 对话（每条，默认关闭） | 0 |

新账号注册获得 `POINT_SIGNUP_BONUS`（默认 100）积分。所有单价都由服务端计算并通过账号接口下发公开档位，浏览器拿不到上游模型 ID。

每个账号在账号中心里有一个 8 位邀请码。好友使用邀请码注册并**完成首次成功生成**后，邀请人获得 `POINT_INVITE_REWARD`（默认 30）积分，好友获得 `POINT_INVITE_BONUS`（默认 20）积分；同一邀请人每天最多发放 `POINT_INVITE_DAILY_LIMIT`（默认 5）次。奖励延迟到首次生成，是为了避免注册机批量刷分；邮箱注册需要先完成邮件验证；也可使用 GitHub / Google 登录。

扣费使用数据库条件更新原子完成，余额不足返回 402 且不扣减；上游失败、请求停止会退还当日次数和积分。积分流水只追加不修改，`(reason, refId)` 唯一索引保证同一笔扣费 / 退款 / 奖励只入账一次。余额和最近流水可在账号中心与 `GET /api/points` 查看。

## 环境配置

完整示例见 [`.env.example`](.env.example)。Go 启动时依次加载 `.env.production` 和 `.env`，部署平台已经提供的环境变量优先；修改 `.env` 后需重启进程。数据库连接在运行时读取。

| 环境变量 | 默认值 / 行为 | 用途 |
| --- | --- | --- |
| `AI_API_BASE_URL` | `https://example.com/v1` | 上游 OpenAI 兼容接口地址；默认配置为 web2api 在线版本 |
| `AI_API_KEY` | 可选 | 仅供服务端使用的上游 API Key，不接受浏览器覆盖 |
| `AI_SYSTEM_PROMPT` | 留空使用服务端默认值 | 可选的服务端对话系统提示词；不下发到浏览器 |
| `AI_CHAT_MODEL` | `gemini-3.5-flash` | 对话引擎在网关中的实际别名 |
| `AI_IMAGE_MODEL` | `gemini-3.1-flash-image` | 图片引擎在网关中的实际别名 |
| `AI_IMAGE_API_MODE` | `auto` | 图片接口模式；web2api 通过 chat 接口返回 Markdown 图片 |
| `AI_VIDEO_MODEL` | `gemini-omni-1.1-flash` | 视频引擎；omni 使用 /v1/chat/completions，veo 使用 /v1/videos |
| `AI_VIDEO_IMAGE_INPUT` | `false` | 视频工作流是否启用图生视频（需 web2api v0.3.1+），false 时回退到文本生成 |
| `AI_VIDEO_OMNI_ASYNC` | `false` | Omni 是否走异步任务接口（需 web2api v0.3.1+），false 时走同步聊天接口 |
| `AI_VIDEO_EXTEND_MAX_SECONDS` | `30` | 连续长镜头模式最大时长（20-40 秒，需 Omni 异步模式） |
| `AI_SHORT_FILM` | `false` | 短片工坊（视频工作流）封闭内测开关；关闭时隐藏侧边栏入口、`/workflow` 与 `#workflow` 回落到 AI 对话，`/api/records/workflows` 返回 404 |
| `AI_MUSIC_MODEL` | `lyria-3.5` | 音乐引擎在网关中的实际别名；通过 chat 接口返回音频 |
| `AI_AUDIO_API_MODE` | `auto` | 服务端音频接口模式；不接受浏览器覆盖 |
| `GUEST_DAILY_GENERATION_LIMIT` | `1` | 每个游客 IP、每种生成类型的每日次数 |
| `USER_DAILY_GENERATION_LIMIT` | `15` | 每个登录账号、每种生成类型的每日次数 |
| `GUEST_DAILY_CHAT_LIMIT` | `100` | 每个游客 IP 每天可发送的对话条数，0 停用对话 |
| `USER_DAILY_CHAT_LIMIT` | `100` | 每个登录账号每天可发送的对话条数，0 停用对话 |
| `CHAT_RATE_LIMIT` | `30` | 同一 IP 每分钟对话请求上限，0 不限速 |
| `CHAT_CONCURRENT_LIMIT` | `20` | 同一 IP 同时进行的对话请求上限，0 不限 |
| `POINT_SIGNUP_BONUS` | `100` | 新账号注册获得的积分 |
| `POINT_IMAGE_1K` / `POINT_IMAGE_2K` / `POINT_IMAGE_4K` | `1` / `2` / `4` | 图片各档位积分单价 |
| `POINT_VIDEO_360P` / `POINT_VIDEO_720P` / `POINT_VIDEO_1080P` / `POINT_VIDEO_4K` | `1` / `2` / `4` / `8` | 视频各画质每秒积分 |
| `POINT_MUSIC_PER_MINUTE` | `2` | 音乐每分钟积分，不足一分钟按一分钟计 |
| `POINT_CHAT` | `0` | 每条对话积分，0 表示对话不计积分 |
| `POINT_INVITE_REWARD` / `POINT_INVITE_BONUS` | `30` / `20` | 邀请人与被邀请人获得的奖励积分 |
| `POINT_INVITE_DAILY_LIMIT` | `5` | 每个邀请人每天最多发放奖励次数，0 暂停发放 |
| `DATABASE_URL` | 默认 `data/olai.db` | SQLite 文件路径 / `file:` URL，或 `postgres://` 连接串；须在启动前确定 |
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `PORT` | `4321` | 服务监听端口 |
| `SETUP_TOKEN` | 留空 | 可选：首次初始化 `/setup` 需要携带的安装令牌；留空则只依赖同源校验与限流 |
| `SITE_ORIGIN` | 本地访问无需设置 | 反向代理部署时的公开站点 origin；首次初始化时可一并填写，GitHub / Google 登录回调也依赖它 |
| `ADMIN_EMAILS` | 留空 | 旧版管理员邮箱白名单；仅用于升级时一次性迁移独立后台账号，不再参与登录鉴权。全新部署请在 `/setup` 创建后台账号 |
| `ADMIN_PATH` | `/admin` | 后台入口路径；可在后台改为自定义路径，修改后原入口立即失效 |
| `MAIL_HOST` | `mail.bllii.com` | 出站 SMTP 主机；也可在管理后台覆盖 |
| `MAIL_PORT` | `465` | SMTP 端口，默认 465 隐式 TLS；也可在管理后台覆盖 |
| `MAIL_SECURE` | `true` | `false` 时改用 STARTTLS（例如 587）；也可在管理后台覆盖 |
| `MAIL_USER` | `admin@bllii.com` | SMTP 登录用户名；也可在管理后台覆盖 |
| `MAIL_PASS` | 留空 | SMTP 密码，不要提交到 Git；也可在管理后台配置，界面不会回传明文 |
| `MAIL_FROM` | `noreply@olai.cc` | 发件人地址；也可在管理后台覆盖 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 留空 | GitHub OAuth App 凭证；两项都配置后显示 GitHub 登录入口 |
| `GITHUB_PROXY` | 留空 | 无法直连 github.com 时使用的代理；留空时读取 `HTTPS_PROXY` / `https_proxy` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 留空 | Google OAuth Web 客户端凭证；两项都配置后显示 Google 登录入口 |
| `GOOGLE_PROXY` | 留空 | 服务端访问 Google 令牌 / 用户信息接口时的代理；留空时读取 `HTTPS_PROXY` / `https_proxy` |
| `GITHUB_RESOLVE_IP` | 留空 | 无代理时可访问的 github.com IP，作为直连备选 |
| `TRUST_PROXY` | `false` | 是否信任代理提供的客户端 IP 与 `X-Forwarded-Proto` 协议头 |

除 `HOST`、`PORT`、`DATABASE_URL`、`SETUP_TOKEN` 外，上表配置在首次启动时会一次性写入主数据库（默认 SQLite）；之后修改 `.env` 不会覆盖数据库中的值，请在后台“系统设置”中调整，或使用“恢复默认”重新回落到 `.env` / 内置默认值。

若网关使用不同的模型 ID，由部署者通过上述服务端变量配置实际别名。所有 `AI_*` 变量仅在服务端读取，不能通过前端设置、浏览器存储或请求中的模型/系统提示词字段覆盖。歌曲整理、歌词校准、封面与短片工作流的预设提示词也只在服务端组装；客户端只提交创作意图、内容和允许的参数。

## 部署指南

### 首次部署初始化

全新部署（数据库中没有账号，且未写入 `SETUP_COMPLETED`）第一次访问任何页面都会跳转到 `/setup`，其他页面与 API 分别返回 302 / `428 setup_required`。在向导中需要：

1. 创建第一个后台管理员账号（邮箱 + 密码，可选昵称；与门户账号相互独立）；
2. 可选填写公开站点 origin；
3. 如设置了 `SETUP_TOKEN`，填写安装令牌。公开部署请务必设置该变量，否则第一个访问者就能完成初始化并成为管理员。

页面会显示当前数据库类型，并明确列出运行环境：配置与账号保存在当前主数据库（默认 SQLite），数据库类型需在启动前通过 `DATABASE_URL` 选择，当前版本不使用 Redis（会话与限流在主数据库）。初始化完成后不会登录门户，而是跳转到后台登录页（默认 `/admin/login`），使用刚创建的账号登录后台。

已有账号或已迁移数据的部署会在启动时自动写入 `SETUP_COMPLETED`，不会出现初始化向导。

若忘记自定义后台入口：它保存在 `app_settings` 表的 `ADMIN_PATH` 行。停止服务后删除该行并重启，入口会回落到 `.env` 或默认 `/admin`。SQLite 示例：

```bash
sqlite3 data/olai.db "DELETE FROM app_settings WHERE key='ADMIN_PATH';"
```

PostgreSQL 部署请对同一张表执行等价 SQL。

### 本地持久化数据库

```bash
go build -o olai .
./olai
```

数据库环境变量可全部留空。服务在首次连接时自动创建 `data/olai.db` 及所需表，持久保存账号、会话、额度，以及 `app_settings` 中的基础配置与站点配置。构建不连接数据库，数据库地址仅在运行时读取；SQLite / PostgreSQL 只能在启动前通过 `DATABASE_URL` 选择，运行中不能在后台切换。

需要指定文件时，设置 `DATABASE_URL=data/olai.db`，普通路径和 `file:./data/olai.db` 均可。也可以使用 PostgreSQL：

```dotenv
DATABASE_URL=postgres://user:password@localhost:5432/olai?sslmode=disable
```

两种数据库共用同一套 Go 查询层与初始化逻辑，自动建表只添加缺少的表和索引，不删除账号或作品。

部署时保留 `data` 目录并提供写入权限，容器部署将其挂载到持久化卷。服务默认监听 4321 端口，可通过 `HOST`、`PORT` 配置。

### 从旧 Astro 版本迁移数据

旧 Astro 版本使用 PascalCase 表（`User`、`StudioRecord`、`MediaObject` 等），新版本使用 snake_case 表（`users`、`studio_records`、`media_objects` 等）。启动新服务只会建表，不会自动复制旧数据；需要执行一次回填。

**务必先完成回填，再启动新版服务。** 新版首次启动会把 `.env` 写入 `app_settings` 并写入 `SETTINGS_SEEDED` 标记；若此时新表还没有旧数据，之后回填时旧 `AppSetting` 会被 `ON CONFLICT DO NOTHING` 跳过。同样，在新版服务上完成 `/setup` 会创建新的管理员账号，导致旧账号回填时出现邮箱冲突。已经有旧数据要迁移时，请按“停止旧版 → 备份 → 回填 → 启动新版”的顺序操作。

```bash
go run ./cmd/migrate-legacy
```

默认是试运行：全部写入和校验都在一个事务内完成，最后回滚，不改变数据库。输出会逐表列出旧表行数、将新增行数、缺失行数和列值不一致数，并检查外键、完整性、作品 JSON、模型价格、积分余额与作品 key。确认无误后正式执行：

```bash
go run ./cmd/migrate-legacy -apply
```

回填前请停止旧 Astro 与新 Go 两个进程，并做包含 WAL 的一致性备份，例如：

```bash
sqlite3 "file:data/olai.db?mode=ro" ".backup 'data/olai.db.pre-backfill.bak'"
```

备份文件包含密码哈希、AI 密钥和邮件密码等敏感数据，请限制访问权限，并在验收后按保留策略删除。

回填是幂等的：已存在的行按主键跳过，重复执行时加 `-force`。旧 PascalCase 表不会被修改，可保留用于回滚或验收比对。该命令只支持 SQLite；若 `DATABASE_URL` 指向 PostgreSQL 会拒绝执行（旧 Astro 数据本身在 SQLite 中）。

迁移会保留账号密码哈希、会话、积分、作品记录、媒体元数据、模型目录和运行期设置。邮箱验证状态按原值迁移：旧版中未验证的账号迁移后仍需完成验证才能用密码登录（与旧版行为一致），GitHub 登录不受影响。注意：旧 `AppSetting` 中的 AI 密钥、邮件密码等会覆盖新 `.env` 中的同名配置；旧游客媒体的所有者哈希算法与新版本不同，迁移后原游客设备无法再认领这 6 条元数据（账号媒体不受影响）。媒体文件本体在 OSS，不在数据库中。

### 私有 OSS 与媒体中转

先在阿里云 OSS 控制台确认 `magicfang-linux-dev` 的实际地域，设置桶 ACL 为 **私有**，关闭公共访问。使用只允许 `opt/olai/*` 前缀读写 / 删除的 RAM 子账号；凭证仅放服务器环境变量，泄露后立即轮换。

```dotenv
OSS_ENABLED=true
OSS_BUCKET=magicfang-linux-dev
OSS_REGION=实际桶地域，例如 oss-cn-hangzhou
OSS_PREFIX=opt/olai
OSS_ACCESS_KEY_ID=轮换后的RAM访问密钥ID
OSS_ACCESS_KEY_SECRET=轮换后的RAM访问密钥Secret
```

`/opt/olai` 在这里是 OSS 对象前缀 `opt/olai/`，不是 Linux 挂载目录。对象 key 为 `opt/olai/{userid}/{UTC时间}/{uuid}-{附件id}.{格式}`：登录用账号 ID，游客用服务端 IP + 随机 HttpOnly 设备 Cookie 的组合哈希，不在对象路径暴露原始 IP。游客附件在同设备、同 IP 登录后通过数据库归属认领；已有对象 key 不重写。

生成接口在 OSS 上传成功并写入 `MediaObject` 后才返回本站媒体链接，绝不返回桶域名、对象 key 或签名直链。预览与下载由 Go 服务流式中转，按账号 / 游客设备校验所有权，支持音视频 Range / HEAD，并使用同源来源校验、CORP、私有不缓存、nosniff 和流量限制防盗链。TXT / LRC / JSON / SRT 强制下载，禁止 SVG / HTML。此机制阻止未授权读取与站外嵌入，不能阻止已获授权的用户保存或再次传播内容。

游客标识包含 IP；清理 Cookie 或更换网络后，原游客私有链接无法直接访问，建议及时登录同步。已登录账号不绑定当前 IP，但仍按 IP 共享流量上限。

旧远程媒体只能从 `OSS_IMPORT_HOSTS` 指定的精确 HTTPS 主机导入（逗号分隔，自动包含 `AI_API_BASE_URL` 主机）。不允许 HTTP、通配符、任意端口或内网地址；所有 DNS 结果及重定向均检查，连接绑定已检查的公共 IP。不应把本站预览地址或用户可控制的任意上传主机加入白名单。

`OSS_MAX_FILE_BYTES` 默认 268435456。上传 / 导入使用 `OSS_MEDIA_RATE_LIMIT`（默认每分钟 60 次）和 `OSS_MEDIA_DAILY_BYTES`（默认每天 1 GiB）。浏览 / 下载使用独立的 `OSS_MEDIA_READ_RATE_LIMIT`（默认每分钟 60 次）和 `OSS_MEDIA_READ_DAILY_BYTES`（默认每天 1 GiB），广场与个人库共享浏览额度，不挤占上传额度；两类均同时约束身份与 IP，流量在 UTC 零点切换。**缓存命中和 ETag 304 都不扣次数、不扣流量**：浏览器保存媒体并使用 ETag 校验复用，服务端同时提供 15 分钟的内存 LRU 缓存（最多 256 MiB，单文件/片段集合最多 64 MiB），支持重复播放、下载和 Range 请求复用，也保留已送出的取消预览片段。服务端缓存按进程独立，重启后清空；每次请求仍先校验账号归属或作品公开状态，缓存不绕过权限。仅缓存未命中按实际送出的数据计费，视频取消不会预扣未发送的整段文件，HEAD 不扣流量。响应的 `X-Olai-Media-Cache` 为 `MISS`、`HIT` 或 `REVALIDATED`。限速和每日流量超限会分别提示，并附带对应的 `Retry-After`。合理调整大作品和多镜头视频的流量预算。显式开启但缺少配置时安全失败，不回退公开媒体直链。数据表自动增量初始化；生产部署同时备份数据库和 OSS，单独备份某一边不能恢复附件归属。

删除作品记录不会立即物理删除所有历史 OSS 对象（避免并发引用或迁移误删）；上传失败产生的本次对象会尽力清理。可按运维保留策略处理孤儿对象，不要直接按账号目录批量删除仍被引用的文件。

### PostgreSQL

在 `.env` 或部署平台设置连接串：

```dotenv
DATABASE_URL=postgres://user:password@db.example.com:5432/olai?sslmode=require
```

使用相同的构建和启动命令。服务启动时自动创建缺少的表和索引。SQLite 与 PostgreSQL 的查询由 `internal/store` 统一处理。

### 开发与生产数据库

| 运行方式 | 数据库 | 持久化行为 |
| --- | --- | --- |
| `go run .` | `data/olai.db` | 重启保留记录 |
| `go build` + `./olai` | `data/olai.db` | 重启、重新构建保留记录 |
| PostgreSQL 部署 | 配置的 PostgreSQL | 由远程数据库持久保存 |

配置了数据库地址时，开发和生产均使用该地址。请从项目根目录启动服务，相对数据库路径以启动目录为准。部署只需要 Go 可执行文件；前端已嵌入，不需要额外的静态目录或 Node 进程。

### Docker 部署

仓库提供 [`Dockerfile`](Dockerfile)：构建阶段用 Go 工具链安装前端依赖并编译两个前端，运行阶段只包含静态链接的 Go 二进制，不使用 Node：

```bash
docker build -t olai .
docker run -d --name olai -p 4321:4321 --env-file .env -v olai-data:/app/data olai
```

`.env` 中配置公开站点的 `SITE_ORIGIN` 和上游服务。数据库默认使用持久化卷内的 `/app/data/olai.db`。镜像不包含本地 `.env`、数据库或 Windows 的 `node_modules`。

使用自己的容器构建流程时，运行镜像只需要 `olai` 二进制、`.env` 和可写的 `data/` 目录。前端产物在 `go build` 时嵌入，SQLite 驱动是纯 Go 实现，不需要任何 Node 依赖或共享库。

### Docker Compose 单机部署

仓库提供 [`docker-compose.yml`](docker-compose.yml)，固定使用 `olai` 容器名和 `olai-data` 数据卷；镜像内置 `/api/status` 健康检查。首次启动：

```bash
cp .env.example .env
chmod 600 .env
# 编辑 .env 中的站点、数据库与上游配置
docker compose up -d
docker compose ps
curl http://127.0.0.1:4321/api/status
```

容器内端口固定为 `4321`；宿主机端口和监听地址由 `.env` 中的 `OLAI_PORT`、`OLAI_BIND` 控制，默认分别是 `4321` 和 `0.0.0.0`。只允许本机反向代理访问时可设置 `OLAI_BIND=127.0.0.1`。

GHCR 包为私有时，先执行 `docker login ghcr.io -u <GitHub 用户名>`；也可以在本地执行 `docker build -t olai:local .`，再用 `OLAI_IMAGE=olai:local docker compose up -d` 启动。

此前按旧 README 使用 `docker run --name olai` 部署时，容器名会与 Compose 冲突。确认备份后，首次迁移执行一次：

```bash
docker stop olai
mkdir -p backups
docker run --rm --entrypoint tar \
  -v olai-data:/data:ro \
  -v "$PWD/backups:/backup" \
  <旧镜像> -C /data -czf /backup/pre-compose.tar.gz .
docker rm olai
docker compose up -d
```

数据卷名应保持 `olai-data`；删除旧容器不会删除该卷。若使用 PostgreSQL，数据库不在该卷中，迁移前应单独执行 `pg_dump`。

### CI/CD 与生产发布

仓库包含三条 GitHub Actions 工作流：

| 工作流 | 触发方式 | 作用 |
| --- | --- | --- |
| `CI` | Pull Request、推送 `master` | 构建两个前端，执行 `go test`、`go vet`、`go build`，构建镜像并做 HTTP 冒烟检查 |
| `Release image` | 推送 `v*.*.*` tag | 再次测试后构建并推送 GHCR 镜像，同时生成版本 tag、`sha-*` tag 和稳定版的 `latest` |
| `Deploy production` | 手动触发并审批 | SSH 到服务器，检出指定 tag，调用部署脚本替换容器 |

镜像名格式为 `ghcr.io/plunjoin/olai:<版本>`。例如 `v1.5.0` 会生成：

```text
ghcr.io/plunjoin/olai:1.5.0
ghcr.io/plunjoin/olai:sha-<提交短哈希>
ghcr.io/plunjoin/olai:latest
```

预发布 tag（如 `v1.5.0-rc.1`）不会覆盖 `latest`。

#### 服务器首次准备

1. 安装 Git、Docker Engine、Compose v2，并把部署用户加入 `docker` 组（或使用有 Docker 权限的专用账号）。
2. 将仓库克隆到固定目录，例如 `/opt/olai`，复制 `.env.example` 为 `.env` 并配置；`.env` 不进入镜像，也不会被 `git checkout` 删除。
3. 如果 GHCR 包是私有的，先以具有 `read:packages` 权限的账号登录：`docker login ghcr.io -u <GitHub 用户名>`。
4. 在 GitHub 仓库 `Settings → Environments` 新建 `production`，配置 Required reviewers，避免未经审批直接发布。
5. 在环境或仓库 Secrets 中配置：

| Secret | 必填 | 说明 |
| --- | --- | --- |
| `DEPLOY_HOST` | 是 | 服务器地址 |
| `DEPLOY_USER` | 是 | SSH 用户，需能运行 Docker |
| `DEPLOY_SSH_KEY` | 是 | 专用 SSH 私钥 |
| `DEPLOY_PORT` | 否 | SSH 端口，默认 `22` |
| `DEPLOY_PATH` | 是 | 仓库绝对路径，例如 `/opt/olai` |
| `GHCR_USERNAME` | 否 | 私有 GHCR 包的用户名 |
| `GHCR_READ_TOKEN` | 否 | 仅有 `read:packages` 权限的 PAT |

如果服务器已经执行过 `docker login ghcr.io`，两个 GHCR Secret 可以留空。建议为部署单独生成无交互 SSH key，并限制其只能执行服务器账户允许的操作。

#### 发布与回滚

发布新版本：

```bash
git tag -a v1.5.0 -m "v1.5.0"
git push origin v1.5.0
```

等待 `Release image` 成功后，在 Actions 中手动运行 `Deploy production` 并输入 `v1.5.0`；也可以在后台「系统设置 → 版本与更新」的整站更新面板选择该 tag 并点击「更新整站」。两种方式都会在配置了 `production` 环境保护时等待审批。部署脚本会读取当前容器镜像、停止容器做 SQLite 数据卷备份、拉取新镜像、替换 Compose 服务，并最多等待 180 秒健康检查。

部署状态保存在：

- `.deploy/current-image`：当前成功运行的镜像。
- `.deploy/previous-image`：本次部署前的镜像。
- `backups/olai-data-*.tar.gz`：部署前的一致性数据卷备份。

新镜像启动失败或健康检查超时时，脚本会自动切回上一镜像；已经执行过的数据库迁移不会自动回退，因此使用数据库备份前应先确认版本兼容性。手动重发旧镜像仍使用同一条路径：

```bash
bash scripts/deploy-docker.sh ghcr.io/plunjoin/olai:1.3.0
```

SQLite 数据恢复会覆盖当前数据，必须在停机并再次备份后人工执行：

```bash
docker compose stop olai
docker run --rm \
  --entrypoint sh \
  -v olai-data:/data \
  -v "$PWD/backups:/backup" \
  ghcr.io/plunjoin/olai:1.5.0 \
  -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/<备份文件>.tar.gz -C /data'
docker compose up -d
```

PostgreSQL 部署必须在发布前自行做 `pg_dump`，不能依赖 `olai-data` 卷备份。生产环境还应把数据卷和数据库备份复制到另一台机器或对象存储。

后台「系统设置 → 版本与更新」同时包含整站更新和 iOS / Android 客户端更新。整站更新不会在容器内直接替换进程或操作 Docker：它通过 GitHub Actions 触发 `Deploy production`，由 Actions 和服务器上的部署脚本完成 tag → GHCR 镜像 → Compose 替换；生产环境仍运行编译好的静态二进制镜像，容器内没有 Go 工具链。

### 反向代理与来源校验

本地访问无需设置 `SITE_ORIGIN`，服务按请求的实际 Host（含端口）与协议校验 Origin，支持 `localhost:4321`、`127.0.0.1:4321` 和局域网地址，拒绝不同来源。

通过反向代理部署时，设置 `SITE_ORIGIN` 为公开站点的完整 origin，不含路径和末尾斜杠（例如 `https://olai.example.com`）。应用自行校验所有变更请求的 `Origin`（`internal/server` 的 `sameOrigin` 与各接口处理器），因此无需在构建时写入域名。

使用 `-tags dev` 的开发构建会忽略数据库 / 环境变量里的 `SITE_ORIGIN`，一律按请求 Host 校验来源并生成媒体链接；因此在任意端口启动开发服务器都不必改设置，生产二进制仍使用配置的公开地址。

仅当可信代理覆盖 `X-Forwarded-For` / `X-Forwarded-Proto`、且外部不能直接连接应用时，启用 `TRUST_PROXY=true`。默认拒绝带有未受信任转发 IP 标头的游客生成及登录请求，避免伪造 IP 改变额度；启用后 `X-Forwarded-Proto: https` 也会让服务按 HTTPS 处理会话 Cookie（未配置 `SITE_ORIGIN` 时尤其重要）。

代理需保留原始 `Host` 并传递 `X-Forwarded-Proto`（`https` 时尤为重要），否则未配置 `SITE_ORIGIN` 时应用无法还原浏览器看到的来源并会拒绝请求：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

## 上游接口与模型

以下为部署者的服务端接入说明，不代表浏览器可读取这些配置。接入依据：[web2api 文档](https://example.com/v1/docs)，适配版本 v0.3.0。默认服务地址为 `https://example.com/v1`，服务端使用 Bearer API Key；公开 API 只提供服务状态、首页灵感卡片和创作结果，不透传 `/models`、密钥、模型元数据或预设提示词。首页灵感卡片由默认对话模型每天生成一次（按北京时间），生成失败的日期回退到内置文案池。

**当前配置说明：**
- **对话**：`gemini-3.5-flash` 或 `gemini-flash-latest` 通过 /v1/chat/completions
- **图片**：`gemini-3.1-flash-image` 通过 /v1/chat/completions，响应中包含 Markdown 格式的 Base64 图片，支持 `image_size: 1K/2K/4K` 和 `max_tokens >= 2048`
- **视频**：`gemini-omni-1.1-flash`（默认）通过 /v1/chat/completions，顶层 `resolution: 720p|1080p|4k` 参数，响应中包含 Markdown 格式的 Base64 视频；`veo-*` 模型通过 /v1/videos 异步任务接口
- **音乐**：`lyria-3.5`（约 180 秒）、`lyria-3-pro-preview`（约 180 秒）、`lyria-3-clip-preview`（约 30 秒）通过 /v1/chat/completions，响应中包含 Markdown 格式的 MP3 音频 `![media](data:audio/mpeg;base64,...)`

<details>
<summary><strong>图片生成：chat/completions 接口</strong></summary>

图片使用 `POST /v1/chat/completions` 非流式 JSON，发送 `model`、`messages`、`stream: false`，以及顶层参数 `image_size`（"1K"/"2K"/"4K"）和 `max_tokens`（≥2048，4K 建议 8192）。

响应的 `choices[].message.content` 包含 Markdown 格式的 Base64 图片，例如 `![image](data:image/png;base64,...)`。比例和联想等级写入提示词，属于创作偏好。

web2api v0.3.0 的 /v1/images/generations 接口当前返回 502，不可用。

</details>


<details>
<summary><strong>视频生成：Omni 聊天接口与 Veo 任务接口</strong></summary>

**Omni 模式**（默认 `gemini-omni-1.1-flash`）：
- 通过 `POST /v1/chat/completions` 转发
- 发送 `model`、`messages`、`stream: false`、顶层 `resolution`（`"720p"` | `"1080p"` | `"4k"`）
- 在提示词中要求生成视频，写入时长、比例、画质
- 响应约 43 秒，返回 Markdown 格式的 Base64 视频：`![media](data:video/mp4;base64,...)`
- 聊天响应只有文字时提示未收到视频文件
- 支持 3–10 秒时长

**Veo 模式**（配置 `veo-*` 模型）：
- 使用 `POST /v1/videos`、`GET /v1/videos/{id}` 和携带鉴权的 `GET /v1/videos/{id}/content`
- 发送 `model`、`prompt`、`size`、`seconds`（4-8 秒）
- `size` 根据画质和比例计算：
  - 720p: 1280×720 (16:9) 或 720×1280 (9:16)
  - 1080p: 1920×1080 (16:9) 或 1080×1920 (9:16)
  - 4K: 3840×2160 (16:9) 或 2160×3840 (9:16)
- 4K 视频自动使用 8 秒时长
- 下载返回 409 时继续等待，失败任务停止查询

Omni 与 Veo 两种路由共用视频生成额度。上游视频服务返回 HTML 错误页时，本站转为 JSON 错误。

</details>

<details>
<summary><strong>音乐生成：chat/completions 接口</strong></summary>

音乐使用 `POST /v1/chat/completions` 非流式 JSON，发送 `model`、`messages`、`stream: false`。

支持的模型：
- `lyria-3.5`（约 180 秒）
- `lyria-3-pro-preview`（约 180 秒）
- `lyria-3-clip-preview`（约 30 秒）

响应的 `choices[].message.content` 包含 Markdown 格式的 MP3 音频，例如 `![media](data:audio/mpeg;base64,...)`。解码后为标准 MP3 文件。

歌曲结构、歌词和风格写入提示词。歌曲整理通过系统提示要求 JSON，再校验完整段落结构。

</details>

## 开发与验证

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `go run .` | 启动开发服务（读取 `.env`，SQLite 默认 `data/olai.db`） |
| `go build ./...` | 编译服务端并检查前端嵌入 |
| `go test ./...` | 运行 Go 单元测试 |
| `go tool wf install ./web` | 安装 / 更新两个前端共用的依赖 |
| `go tool wf build -modules ../wf_modules ./web/portal` | 构建 portal（SSR + SPA 外壳） |
| `go tool wf build -mode spa -base /admin -modules ../wf_modules ./web/admin` | 构建 admin SPA |

修改 `web/portal/src` 或 `web/admin/src` 后重新构建对应前端；只改 Go 代码时 `go run .` 即可。`web/portal/dist` 与 `web/admin/dist` 必须存在（仓库保留 `.gitkeep`），否则 `//go:embed` 会在编译期失败。Git Bash 下构建 admin 时加 `MSYS_NO_PATHCONV=1`，避免 `-base /admin` 被改写成 Windows 路径。

### 浏览器检查

启动服务后访问 `http://localhost:4321`：

- `/`、`/gallery`、`/download` 由 portal 的 goja SSR 输出，带 `__WF_DATA__`，客户端执行 hydration。
- `/chat`、`/image`、`/video`、`/music`、`/library`、`/workflow`、`/login`、`/account` 使用 portal 的 SPA 外壳，避免在服务端访问浏览器存储。
- 后台有独立登录页：默认 `/admin/login`（自定义入口时为 `{入口}/login`）。后台账号与门户账号、会话互不相通；门户任何位置都不显示后台入口，后台也不链接回门户。
- 全新数据库首次访问会跳转到 `/setup` 创建第一个后台管理员账号，完成后进入后台登录页；已有数据的数据库不会出现该向导。

### 项目结构

```text
.
├── main.go                  # 启动、嵌入 public、装配两个前端运行时
├── cmd/
│   ├── admin-passwd/        # 创建/重置独立后台管理员账号
│   └── migrate-legacy/      # 旧 Astro 数据迁移工具
├── internal/                # Go 服务：路由、认证、配额、媒体、管理接口
│   └── version/             # 构建版本注入与客户端版本比较
├── web/
│   ├── embed.go             # 嵌入 portal/dist 与 admin/dist
│   ├── package.json         # 两个前端共用的依赖与 lockfile
│   ├── wf_modules/          # webfront 依赖 store（不进版本库）
│   ├── portal/              # 公开站点 + 创作工作台（Vue SSR / SPA 混合）
│   │   ├── src/entry-server.vue.ts
│   │   ├── src/entry-client.ts
│   │   └── dist/
│   └── admin/               # 管理后台（Vue SPA，资源固定在 /admin/assets）
│       ├── src/main.ts
│       └── dist/
├── public/                  # 品牌图、favicon 等原样静态资源
├── migrations/              # SQLite / PostgreSQL 初始化 SQL
├── .github/workflows/       # CI、GHCR 发布与生产部署
├── scripts/
│   └── deploy-docker.sh     # Compose 部署、备份与自动回滚
├── docker-compose.yml       # 单机持久化部署
├── Dockerfile               # 纯 Go 多阶段构建
└── .env.example             # 环境配置示例
```

## 常见问题

### 登录接口返回 HTML，而不是 JSON

`GET /api/auth/me` 应返回 `application/json`。未登录时返回 `{"user":null,"generationLimit":1}`。返回 HTML 通常表示请求没有匹配到 `/api/*` 路由：检查反向代理是否把接口转发给 Go 服务，以及前端路由是否先拦截了该路径。Go 服务内部注册 `/api/` 兜底，未知接口会返回 JSON 404。

### 服务初始化失败

先运行 `go build ./...`，确认服务端和两个前端的 `dist` 都能嵌入；若报 `pattern all:web/portal/dist: no matching files found`，说明前端尚未构建或 `.gitkeep` 丢失。启动日志会记录数据库初始化、端口占用或上游 / OSS / 邮件配置错误。SQLite 需要 `data/` 可写；PostgreSQL 检查 `DATABASE_URL`、网络与账号权限。修改 `.env` 后必须重启进程。

### 开发服务器重启后，账号记录消失

默认数据库是 `data/olai.db`，正常重启会保留账号与作品；删除 `data/` 会删除数据库。部署时保留该目录或改用 PostgreSQL。生产环境先运行前端构建，再 `go build -o olai .`，启动 `./olai`。

### 选择 4K 后，实际输出没有达到 4K

默认聊天兼容协议将画质作为提示词偏好，无法保证精确输出。图片可在上游启用官方后端后使用 `interactions` 模式；视频输出仍取决于上游模型支持。

## 后续计划

在继续修复现有问题的同时，计划探索以下创作能力：

- 视频工作流（短片工坊）—— 封闭内测，默认不发布，配置 `AI_SHORT_FILM=true` 后开放
- 客户端视频合成（ffmpeg.wasm 或 WebCodecs）
- 流水线生成
- 链式生成

> AI生成
