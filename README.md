# Noa

*Notes on Anything*

Noa 是一个本地优先的私人笔记空间。没有账号，没有服务器，没有订阅费。你的文字只存在于你的设备上。

## 理念

大多数笔记工具要么太重——你花更多时间整理系统而不是真正思考；要么太轻——用完即弃，留不下什么。

Noa 想做第三种：**足够简单，随时能写；足够结构，值得长期用**。

- **本地优先** — 数据存在浏览器 IndexedDB，不经过任何服务器
- **Markdown 原生** — 写作不被格式打断，支持 Mermaid 图表和 KaTeX 公式，随时在编辑/预览/分栏间切换
- **连接你的想法** — Wiki 链接、知识图谱、反向链接，让笔记之间形成网络而不是孤岛
- **极简界面** — 克制、干净的编辑空间，让注意力回到文字本身

## 用法

### 开始写

打开 Noa，左侧选择文件夹，点 `+` 新建笔记。标题直接在顶部输入，正文支持完整 Markdown 语法。

`⌘ N` 随时新建，`⌘ F` 搜索，`⌘ S` 手动保存（也自动保存）。

外观默认跟随系统，可在设置 → Appearance 中固定为浅色或深色。

### 图片附件

直接把图片粘贴或拖进编辑器即可插入，支持 jpeg / png / gif / webp，单张最大 10MB。图片以 blob 存在本地 IndexedDB，笔记中用 `![[文件名]]` 引用。

### 每日笔记

`⌘ ⇧ K` 打开今天的日记。每天一条，自动以日期命名，按模板初始化。你可以在设置里自定义日期格式和模板内容。

### 任务

在任意笔记里写 `- [ ] 待办事项`，右侧面板的 Tasks 标签会自动聚合所有笔记里的任务。勾选即完成，实时同步回笔记内容。

### 链接与图谱

在笔记里写 `[[另一篇笔记的标题]]` 即可创建链接。右侧 Backlinks 标签显示哪些笔记引用了当前这篇。Graph 标签展示全局知识图谱，节点大小反映连接数量。

### 标签

在正文里写 `#标签名`，侧边栏底部的标签浏览器会自动收录，点击筛选。

### 从 Obsidian 迁移

设置 → Workspace → Import Vault Folder，选择一个 vault 文件夹即可一次性导入全部 Markdown 笔记，frontmatter 中的标签和链接会被保留。这是一次性迁移；如果想让文件留在磁盘上并保持镜像，请使用下方的文件夹同步。

### 文件夹同步

设置 → Workspace → Vault Folder，选择本地文件夹后，Noa 会镜像该目录中已有的 Markdown 文件。你在 Noa 中对这些文件做的改动会写回磁盘；Noa 会在窗口重新获得焦点时检查外部改动，并在窗口可见时每 60 秒检查一次；也可点击 Retry Sync 立即刷新。它不使用实时文件监听。在 Noa 中新建的笔记不会自动写入同步目录。这不是强一致的双向同步引擎，发生冲突时请优先备份并手动确认。

### 备份

设置 → Data 提供两条备份路径：

- **手动导出**：Data 页支持三种格式——完整 JSON 快照（含元数据和设置，用于备份）、Vault ZIP（Markdown + 附件，可迁移到其他工具）、静态 HTML（仅供阅读，不是备份）。该区域会显示备份健康度（7 天内为 healthy，14 天内为 warning，更久为 risk）。
- **自动备份**：选择本地文件夹后立即创建一次快照；之后每次启动时，若距离上次备份已满 24 小时，会自动备份。连续打开应用不会按天重复备份，可在设置中点击 Run backup now 手动执行。

## 快捷键

| 快捷键 | 操作 |
|--------|------|
| `⌘ N` | 新建笔记 |
| `⌘ F` | 搜索 |
| `⌘ K` | 命令面板 |
| `⌘ ⇧ K` | 今日日记 |
| `⌘ ⇧ F` | 专注模式 |
| `⌘ S` | 保存 |
| `Escape` | 清空搜索 / 退出专注模式 |

## 本地运行

```bash
npm install
npm run dev    # http://localhost:3000
```

## 开发

```bash
npm run lint                 # TypeScript + ESLint
npm run test:unit            # Vitest
npm run test:smoke           # Playwright
npm run build                # Vite build → dist/
npm run build:budget         # build + bundle size check
npm run check:structure      # dependency-cruiser
npm run desktop:dev          # Electron + Vite
npm run desktop:pack:mac     # unsigned dmg+zip, arm64
```

## 桌面版（macOS）

目前面向个人和朋友内测，仅支持 Apple Silicon Mac。从 [Releases](https://github.com/rickkwang/Noa/releases) 下载 `.dmg`。当前安装包未经开发者签名和公证，首次打开可能被 macOS 拦截；只从上述官方发布页获取安装包。应用启动后会自动检查更新，重要笔记请保留独立备份。

## 技术栈

- React + Vite
- CodeMirror 6
- IndexedDB（localForage）
- Electron（macOS arm64）
- react-force-graph-2d

## 商业模式

Noa 是免费、开源、本地优先的个人笔记工具：无账号、无服务器、不收集用户数据。未来若探索可持续方式，会以一次性购买或离线增值功能为主，不会把云同步或隐私作为付费点。

## License

[AGPL-3.0](LICENSE) © rickkwang
