# 主题色集中为语义化 token — 设计文档

日期:2026-06-28
状态:已批准设计,待写实现计划

## 背景与目标

Noa 当前的主题色以硬编码十六进制散布在 ~39 个组件的 Tailwind arbitrary 类里(`bg-[#EAE8E0]`、`text-[#2D2D2D]/70` 等),共约 555 处。暗色模式通过两套并存机制实现:

1. `src/components/ThemeInjector.tsx` — 在 `:root` 写一组 CSS 变量,并注入一大段 `<style>`,用 `!important` + `color-mix` 把 arbitrary 类映射到变量(覆盖核心 class)。
2. `src/index.css` 的 `[data-theme="dark"]` 块 — 逐 class 覆盖长尾(hljs、tag 药丸、滚动条、列表标记、脚注、更多透明度档)。

两套真理来源都绑死在「亮/暗」二元,且覆盖范围不一致(ThemeInjector 比 index.css 少),导致第三套主题无法靠现有机制干净实现。

**目标**:把主题色集中为一套语义化 Tailwind token,使「内置几套主题切换」成立,并让未来「加一套主题 = 加一个变量块,不碰组件」。

**范围(已与用户确认)**:
- 内置主题切换(不做用户导入自定义主题)。
- 采用语义化 Tailwind token(组件改用 `bg-canvas` 等语义类)。
- 启动只重构现有 light + dark 两套,不新增配色。

## Token 体系

在 `src/index.css` 的 `@theme` 里定义语义化颜色 token。命名约束:Tailwind v4 中一个 `--color-x` 同时生成 `bg-x`/`text-x`/`border-x`,所以同名不能既当背景又当文字。按角色命名:

| Token | 亮色 | 暗色 | 生成的类 | 替换原来的 |
|------|------|------|---------|-----------|
| `--color-canvas` | `#EAE8E0` | `#262624` | `bg-canvas` | `bg-[#EAE8E0]` |
| `--color-panel` | `#DCD9CE` | `#1E1E1C` | `bg-panel` | `bg-[#DCD9CE]` |
| `--color-elevated` | `#CFCBBE` | `#2C2C28` | `bg-elevated` | tertiary(少量) |
| `--color-ink` | `#2D2D2D` | `#EEEDEA` | `text-ink` | `text-[#2D2D2D]` |
| `--color-line` | `#2D2D2D` | `#3A3A37` | `border-line` | `border-[#2D2D2D]` |
| `--color-accent` | `#CC7D5E` | `#CC7D5E` | `bg/text/border-accent` | `*-[#CC7D5E]` |
| `--shadow-color` | `#2D2D2D` | `#1A1A18` | arbitrary 中引用 | brutalist 阴影 |

- 透明度变体(`text-ink/70`、`bg-panel/50`、`border-line/20`)由 Tailwind v4 原生 `color-mix` 处理,无需逐档定义。
- 阴影是带偏移的 `box-shadow`,Tailwind 不便用 color token 表达;保留 arbitrary 但引用变量:`shadow-[8px_8px_0px_0px_var(--shadow-color)]`。
- 命名 `canvas/panel/elevated/ink/line/accent` 为约定,可在实现前调整,但确定后须全量一致。

## 组件迁移映射

机械式 find-replace,覆盖约 39 文件 / 555 处:

- `bg-[#EAE8E0]` → `bg-canvas`(含 `/50` 等透明度)
- `bg-[#DCD9CE]` → `bg-panel`(含透明度)
- `bg-[#CFCBBE]` → `bg-elevated`(如有使用)
- `bg-[#CC7D5E]` → `bg-accent`(含透明度)
- `text-[#2D2D2D]` → `text-ink`(含所有 `/NN` 透明度档)
- `text-[#CC7D5E]` → `text-accent`
- `border-[#2D2D2D]` → `border-line`(含透明度)
- `border-[#CC7D5E]` → `border-accent`(含透明度)
- `placeholder-[#2D2D2D]/NN` → `placeholder-ink/NN`
- `selection:bg-[#CC7D5E]` → `selection:bg-accent`
- `accent-[#CC7D5E]`(range 控件) → `accent-accent`
- `prose-a:text-[#CC7D5E]` / `prose-pre:bg-[#DCD9CE]` / `prose-code:text-[#CC7D5E]` 等 → 对应语义类
- brutalist 阴影 `shadow-[...rgba(45,45,45,1)]` → `shadow-[...var(--shadow-color)]`

迁移后须人工复查无遗漏的 canonical 十六进制残留(非 JS 设色面)。

## 主题注册表

新增 `src/lib/themes.ts`:

```ts
export type TokenName =
  | 'canvas' | 'panel' | 'elevated' | 'ink' | 'line' | 'accent' | 'shadow-color';

export interface ThemeDefinition {
  id: string;                       // 'light' | 'dark'
  label: string;                    // 下拉显示名
  base: 'light' | 'dark';           // 驱动长尾 CSS + system 映射 + JS 设色
  tokens: Record<TokenName, string>;
}

export const THEMES: Record<string, ThemeDefinition>;
```

以后加主题 = 往 `THEMES` 加一个对象,不碰组件。这是本次重构的核心收益。

## ThemeInjector 瘦身

删除注入的 `<style>` 逐 class 映射块(当前文件 45-91 行)。新逻辑:

1. 解析当前主题:`'system'` → 按 `prefers-color-scheme` 取 light/dark;否则按 id 查 `THEMES`,查不到回退(回退到 `'light'` 或 system 解析结果)。
2. 在 `:root` 上 `style.setProperty` 写该主题的 `--color-*` 变量(直接覆盖 `@theme` 的默认值)。
3. 设 `document.documentElement` 的 `data-theme-base="light|dark"`(给长尾 CSS 用)。
4. 字体 family / 指针光标逻辑原样保留。

`@theme` 中以 light 值作为构建期默认,确保所有 `bg-canvas` 等工具类被生成;运行期由 ThemeInjector 覆盖为当前主题。

## index.css 长尾处理

确实按亮/暗分家的部分(hljs 代码高亮、tag 药丸 HSL、滚动条透明度、列表标记 `::marker`、脚注分隔线、骨架屏 pulse)保留,但选择器从 `[data-theme="dark"]` 改为 `[data-theme-base="dark"]`,使未来任何暗系主题自动继承。

删除:逐 class 的 token 覆盖块(bg/text/border/shadow/placeholder/selection/prose),已由语义 token 取代。

## JS 设色面(范围外)

`src/components/GraphView.tsx`、`src/components/editor/useCodeMirror.ts`、`src/components/editor/MermaidBlock.tsx` 用 `isDark` 布尔 + 各自硬编码色(GraphView 含独立节点配色板)。保持现状,仅 `isDark` 改由「解析后主题 base === 'dark'」驱动。`src/hooks/useIsDark.ts` 保留给这些消费者。这次不把它们改为读 CSS 变量;未来若做完全自定义主题再单独处理。

## 类型与持久化

- `src/types.ts`:`appearance.theme` 由 `'light' | 'dark' | 'system'` 改为 `string`(主题 id 或 `'system'`)。
- `src/hooks/useSettings.ts`:读取时按 `THEMES` 校验,非法值回退。
- 已存的 `'light' / 'dark' / 'system'` 均仍合法,无需数据迁移。
- `AppearanceSettings.tsx`:Base Theme 下拉从 `THEMES` 注册表生成选项 + `System`。

## 测试与验证

- **单元**(vitest):`themes.ts` 注册表形状;主题解析逻辑(`system` → 亮/暗、未知 id → 回退)。
- **手动**:Settings 切亮↔暗,逐面板肉眼核对(编辑器、预览、侧栏、图谱、设置、代码块、标签药丸)。
- `npm run lint`(tsc --noEmit)。
- `npm run check:structure`(`themes.ts` 在 lib 层;ThemeInjector/AppearanceSettings 引用合规;确认无 App.tsx 边界违规)。
- `npm run test:smoke` 的 `e2e.spec.ts`(含 theme 用例)须通过。

## 已知副作用

暗色文字当前底色不统一:低透明度档用 `#EEEDEA`、高透明度档用 `#D7D2C5`(两套近白)。归一为单 token 后,暗色文字统一到一个底色(建议 `#EEEDEA`,因其为目前实际生效值)。视觉位移极小,但需在暗色下肉眼确认可接受。

## 非目标

- 不做用户导入/自定义主题(拾色器、导入导出)。
- 不新增配色方案。
- 不改 JS 设色面(图谱/编辑器/Mermaid)的取色方式。
- 不做无关重构。
