# Bilibili MP3 Local

一个只在本机运行的 Chrome Manifest V3 扩展和 Node.js 转换服务。它用于把当前 Bilibili 视频页面中浏览器已经能够访问的音频媒体转换为 MP3，并通过 Chrome 下载到本地。

项目不需要注册账号、域名或线上服务器，也不包含绕过 DRM、验证码、登录限制、风控或其他访问控制的逻辑。

> 请只处理你拥有版权或已经获得明确授权的内容，并遵守 Bilibili 的服务条款及所在地法律。下载能力不代表对第三方内容拥有使用权。

## 功能

- 从当前 `bilibili.com/video/...` 页面读取视频标题和 BV 号。
- 收集播放器及网络资源中的媒体地址。
- 优先尝试音频相关地址，并自动跳过 `blob:`、HTML、JSON、`ok` 响应和只有视频轨的文件。
- 使用页面相关 Cookie、`Referer` 和浏览器 User-Agent 请求媒体资源，适配需要登录态的可访问资源。
- 使用 FFmpeg 转换为 MP3，支持 `128 kbps`、`192 kbps` 和 `320 kbps`。
- 在 Popup 中显示下载媒体、转换音频、进度百分比、已用时间、文件名和错误原因。
- 转换完成后调用 Chrome Downloads API 保存文件。
- 所有服务和临时文件都运行在本机；任务文件保存在系统临时目录中。

## 批量下载功能

### 使用场景

- 下载B站合集视频的所有集数
- 下载分P视频的所有分P
- 支持断点续传，中断后继续下载
- 自动跳过已下载的视频

### 使用步骤

1. 打开扩展 Popup，点击"📋 批量下载"按钮
2. 在批量管理页面粘贴合集中任意一集的链接
3. 点击"解析合集"，系统会自动识别所有视频
4. 选择起始集数（默认第1集）和音频码率
5. 点击"开始批量下载"
6. 系统会自动逐个下载转换，每集间隔15秒
7. 可以暂停、恢复或停止任务
8. 下载过程中可以关闭管理页面，后台继续执行
9. 重新打开管理页面可以查看进度或继续未完成任务

### 批量下载特性

- **串行下载**: 一次只处理一个视频，避免带宽占用和触发限流
- **自动重试**: 单个视频失败后自动重试3次，超时后跳过
- **进度保存**: 每完成一个视频立即保存进度到 `batch-store.json`
- **断点续传**: 浏览器关闭或意外中断后，重新打开自动提示继续
- **智能去重**: 检查已下载历史，自动跳过已完成的视频
- **实时监控**: 显示当前进度、已完成数、失败数等统计信息

### 批量下载限制

- 每个视频间隔15秒，避免被B站检测为异常行为
- 长时间批量下载建议保持浏览器和本地服务运行
- 批量任务运行时可以正常使用单个下载功能，互不干扰

## 工作方式

```text
Bilibili 页面
    │
    ├─ content.js 读取标题、BV 号、播放器地址和资源记录
    │
    └─ popup.js ─ background.js ─ HTTP ─> 127.0.0.1:3000
                                      │
                                      ├─ 使用 Cookie 下载候选媒体
                                      ├─ ffprobe 检查是否包含音频流
                                      ├─ ffmpeg 转换 MP3
                                      └─ 返回任务状态和下载文件
```

Bilibili 经常使用 DASH：视频轨和音频轨分开，播放器还可能只暴露 `blob:` 地址。`blob:` 是浏览器页面内部的临时地址，本地 Node 服务无法直接读取。服务会尝试页面中记录的 HTTP(S) 候选地址；如果候选地址全部是视频轨或已过期，就需要提供一个当前浏览器确实可以访问的音频地址。

## 环境要求

### 必需软件

- Chrome 或 Chromium
- Node.js 20 或更高版本
- FFmpeg（必须同时提供 `ffmpeg` 和 `ffprobe` 命令）

检查环境：

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

Node 20+ 用于原生 `fetch` 和 Web Streams 支持。FFmpeg 转换和 FFprobe 音频流检测都由本地服务调用。

### macOS

如果已安装 Homebrew：

```bash
brew install ffmpeg
```

Apple Silicon 默认安装到 `/opt/homebrew/bin`，Intel Mac 通常安装到 `/usr/local/bin`。如果终端找不到命令，请把 FFmpeg 的 `bin` 目录加入 shell 的 `PATH`，然后重新打开终端。

### Windows

安装 FFmpeg 后，把包含 `ffmpeg.exe` 和 `ffprobe.exe` 的 `bin` 目录加入系统 PATH。重新打开 PowerShell，再运行：

```powershell
ffmpeg -version
ffprobe -version
```

## 项目目录

```text
bilibili-mp3-local/
├── extension/
│   ├── manifest.json    # Chrome 扩展配置和权限
│   ├── content.js       # 读取 Bilibili 页面信息和媒体候选地址，解析合集
│   ├── background.js    # 获取 Cookie、调用本地 API、批量任务调度
│   ├── popup.html       # 弹窗结构
│   ├── popup.css        # 弹窗样式和进度条
│   ├── popup.js         # 表单、轮询、下载和状态展示
│   ├── batch.html       # 批量下载管理页面
│   ├── batch.css        # 批量页面样式
│   └── batch.js         # 批量任务UI逻辑
├── local-server/
│   ├── package.json     # 本地服务启动脚本
│   ├── server.js        # HTTP API、媒体下载和 FFmpeg 任务
│   └── batch-store.json # 批量任务进度存储（运行时生成）
├── .gitignore
└── README.md
```

## 启动本地服务

打开一个终端窗口：

```bash
cd /Users/pat/Work/FuDoor/bilibili-mp3-local/local-server
npm start
```

成功后会看到：

```text
Bilibili MP3 local server: http://127.0.0.1:3000
```

服务只监听 `127.0.0.1`，不是局域网或公网服务。这个终端窗口需要保持运行，关闭窗口或按 `Ctrl-C` 后扩展将无法提交任务。

如 3000 端口已经被占用，可以临时使用其他端口启动：

```bash
PORT=3001 npm start
```

同时需要修改 `extension/background.js` 中的 `API_BASE`，以及 `extension/popup.js` 中轮询和下载地址的端口，然后在 Chrome 扩展页重新加载扩展。

## 在 Chrome 中加载扩展

1. 打开 `chrome://extensions`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `extension` 目录：

   ```text
   /Users/pat/Work/FuDoor/bilibili-mp3-local/extension
   ```

5. 打开一个 Bilibili 视频页面并等待播放器加载。
6. 点击 Chrome 工具栏中的扩展图标。

修改扩展文件后，回到 `chrome://extensions`，点击该扩展卡片上的“重新加载”。修改 `content.js` 后还要刷新 Bilibili 页面，让新的 Content Script 生效。修改 `local-server/server.js` 后需要停止并重新运行 `npm start`。

## 使用步骤

1. 确认本地服务终端仍显示正在监听 `127.0.0.1:3000`。
2. 在 Bilibili 打开目标视频，等待视频至少开始播放一次。
3. 打开扩展 Popup，确认标题已读取。
4. 选择输出码率：`128 kbps` 适合语音，`192 kbps` 是默认选项，`320 kbps` 文件较大但不会提升原始音频质量。
5. 确认“媒体地址”输入框有 HTTP(S) 地址。`blob:` 地址不能直接用于本地服务。
6. 点击“转换并下载”。
7. 等待进度显示“已完成”，Chrome 随后会打开保存位置选择或开始下载。

转换期间不要停止本地服务。任务状态由 Popup 每秒查询一次。

## 本地 API

服务端没有单独的 npm 依赖，使用 Node.js 内置 HTTP 服务。

### 创建任务

```http
POST http://127.0.0.1:3000/api/convert
Content-Type: application/json
```

请求字段：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `mediaUrl` | 是 | 首选媒体地址 |
| `mediaCandidates` | 否 | 其他候选 HTTP(S) 地址数组 |
| `title` | 否 | 输出文件名来源 |
| `pageUrl` | 否 | Bilibili 页面地址，用于 `Referer` |
| `cookieHeader` | 否 | 当前页面 Cookie，由扩展自动生成 |
| `bitrate` | 否 | `128k`、`192k` 或 `320k` |

返回示例：

```json
{
  "jobId": "任务 ID",
  "status": "processing"
}
```

### 查询任务

```http
GET http://127.0.0.1:3000/api/jobs/:jobId
```

状态包括：`queued`（已创建）、`processing`（下载或转换中）、`completed`（MP3 已生成）和 `failed`（失败，`error` 包含诊断信息）。处理中的 `progress` 是估算百分比。

### 下载文件

```http
GET http://127.0.0.1:3000/api/jobs/:jobId/file
```

只有 `completed` 任务可以读取该接口。输出文件名会根据视频标题清理路径分隔符、系统保留字符和控制字符，最长 100 个字符。

## 常见问题

### Popup 显示 `Failed to fetch`

通常表示扩展无法连接本地服务：

1. 确认 `npm start` 仍在运行。
2. 确认终端显示端口是 `3000`。
3. 在浏览器打开 `http://127.0.0.1:3000/api/jobs/test`，如果返回 JSON 的“任务不存在”说明服务已连通。
4. 在 `chrome://extensions` 重新加载扩展。

### 返回 `ok`、HTML 或 JSON

这表示媒体 URL 返回的是接口响应或错误页面，不是媒体文件。刷新 Bilibili 页面并等待播放，让扩展重新收集资源；不要使用以 `api`、`playurl` 或普通接口路径结尾的地址。

### “文件不包含音频流”

当前地址是视频轨（常见于 DASH 的 `.m4s` 视频文件）。服务会跳过该地址并尝试其他候选地址。需要使用对应的音频轨地址，通常是音频 `.m4s` 或 `.m4a`。

### `Invalid data found when processing input`

下载内容不是完整媒体、媒体 URL 已过期，或响应需要新的 Cookie。刷新视频页、重新打开 Popup，再提交一次。手动填写媒体地址时，必须使用当前仍有效的 HTTP(S) 音频地址。

### `Output file does not contain any stream`

FFmpeg 没有找到音频轨。请检查输入是否为视频文件；当前版本只转换包含音频流的媒体，不会把无声视频伪装成 MP3。

### 服务启动后提示找不到 FFmpeg

运行：

```bash
ffmpeg -version
ffprobe -version
```

如果命令不可用，安装 FFmpeg 或修正 PATH，然后重启本地服务。服务启动时会检查 FFmpeg，但真正转换时还需要 `ffprobe`。

### 批量下载任务中断了怎么办？

重新打开批量管理页面，系统会检测到未完成任务并提示"是否继续"。点击"继续"即可从中断位置恢复下载。进度数据保存在 `local-server/batch-store.json`。

### 批量下载可以在后台运行吗？

可以。启动批量任务后，可以关闭批量管理页面，任务会在 background.js 中继续运行。重新打开管理页面可以查看实时进度。但不要关闭浏览器或停止本地服务。

### 批量下载速度慢吗？

批量下载采用串行模式（一次一个视频），每个视频间隔15秒。这是为了避免触发B站的限流机制。一个50集的合集大约需要30-40分钟（取决于每集时长）。

### 批量下载会和单个下载冲突吗？

不会。批量下载使用独立的任务队列，不影响单个下载功能。可以在批量任务运行时使用 Popup 单独下载其他视频。

## 调试

### 查看扩展日志

1. 打开 `chrome://extensions`。
2. 找到扩展，点击“Service worker”或“检查视图”。
3. 查看 `background.js` 的网络请求和异常。
4. 在 Bilibili 页面按 `F12`，查看 `content.js` 是否加载以及资源记录。

### 查看服务端日志

服务端日志显示在运行 `npm start` 的终端。失败任务会把候选地址的主机名、HTTP 状态、响应类型、文件大小和 FFprobe 结果写入任务错误信息，不会把完整 Cookie 写入日志。

### 手动检查 FFmpeg 是否能读取文件

```bash
ffprobe -v error -select_streams a:0 \
  -show_entries stream=index -of csv=p=0 ./sample.m4s
```

有输出表示检测到了音频流。转换示例：

```bash
ffmpeg -i ./sample.m4s -vn -codec:a libmp3lame -b:a 192k ./sample.mp3
```

## 隐私和安全说明

- 扩展的 Cookie 权限只用于获取当前 Bilibili 页面和媒体域名的 Cookie。
- Cookie 仅随当前任务发送到本机 `127.0.0.1:3000`，服务端不会把它保存到数据库或日志。
- 本地服务默认只监听回环地址，其他设备无法直接连接。
- 输入媒体和输出 MP3 使用系统临时目录；成功或失败后输入临时文件会清理。输出文件会保留到进程结束或系统清理临时目录。
- 不要把 `cookieHeader`、媒体 URL 或带鉴权参数的链接分享给其他人。

## 开发约定

这是一个本地 MVP，当前没有构建步骤：扩展目录中的文件可以直接加载。提交修改前建议运行：

```bash
node --check local-server/server.js
node --check extension/content.js
node --check extension/background.js
node --check extension/popup.js
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json')); console.log('manifest ok')"
```

扩展权限和媒体访问能力应尽量保持最小范围。涉及第三方内容时，优先使用用户明确选择的单个任务，不要做后台批量抓取或自动扫描。
