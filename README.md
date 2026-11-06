# 会话信箱 · Session mailbox

一个 DeepSeek Harness 插件：让**一个会话里的 AI 直接把消息或工作交给另一个会话**，并读回对方的结果。

不需要 Lead/teammate 层级，不需要共享任务板，也不需要改 agent preset —— 装上之后，每个会话都多出三个工具，任意两个普通会话可以互相对话。

---

## 它解决什么问题

DSH 里每个会话是一个独立的上下文。你想让「实施」把活交给「审查」，通常只能：

- 人手复制粘贴两边的结论；
- 或者用内置 `subagent` —— 但那是父子关系，子会话是为一次性任务开出来的，不是你在侧边栏里长期维护的那个「审查者」；
- 或者用官方实验包 **Agent Teams** —— 但那是 Lead + teammate 的团队结构，要先创建队员、共享任务板。

会话信箱走第三条路：**对等**。你已有的任意两个普通会话，直接互相发消息。

## 安装

需要 DSH 的 Web 或 Desktop profile（依赖 `sessionController` 与 `sessionQuery` 两个 Host 服务）。在 DSH 0.2.2-rc.1 上开发与验证。

从 GitHub 直接装：

```text
plugin_manager  install_bundle  git+https://github.com/yinying8761/dsh-session-mailbox.git
```

本地目录安装（开发时）：

```text
plugin_manager  install_bundle  <本包目录的绝对路径>
```

发布到 npm 之后也可以直接 `install_bundle dsh-session-mailbox`，或从插件市场索引进入「设置 → 插件 / Discover」安装。

安装后**无需配置**：三个工具注册在全局工具层，所有会话自动拥有。

> 改过 `index.js` 之后必须重启 Harness 才会加载新的 JS 模块。

## 三个工具

| 工具 | 作用 | 会不会唤醒对方 |
|---|---|---|
| `session_list` | 列出会话：标题、最近活动、是否在跑、会话 id；可按标题片段过滤 | 否 |
| `session_read` | 读某个会话最近的 user / assistant 消息 | 否 |
| `session_send` | 把消息或任务投递给某个会话 | **是** |

`target` 可以填会话 id、完整标题，或唯一的标题片段。

`mode` 选 `queue`（默认，作为下一回合的输入，适合交办任务）或 `steer`（对方正在跑时插到它最近一步，适合催办/纠偏）。

## 用法示例

下面这些话是**你对会话说的**，不是你要背的命令。AI 会自己调用对应工具。

### 交办任务（A → B）

> 用 `session_send` 把「跑一遍后端测试并修复失败项」交给「二号实施者」。写成完整指令，它看不到我们这个对话。

### 只读进度（不打扰）

> 用 `session_read` 读「需求等文档撰写者」最后 3 条消息，总结它完成了什么。

### 要求回信（B → A）

> 结论用 `session_send` 回给发信人。

### 催一下正在跑的会话

> 用 `session_send` 以 steer 模式告诉「审查者」：先别管风格问题，只报阻塞项。

### 按名字找不准时

名字可以填标题片段（如「审查者」）。片段匹配到多个会话时会报错并列出候选，这时改用会话 id：

> 用 `session_send` 发给 `session-06ed43db-3976-4537-814a-66113d90509d`。

## 实际使用

截图来自真实会话（发布前裁掉了侧边栏里的工作区与会话列表）。

**1. 交办** —— 「需求等文档撰写者」用 `session_send` 把任务交给「审查者」，返回 `Delivered to 审查者 (…) in queue mode.`

![用 session_send 交办任务](docs/usage/01-handoff.png)

**2. 对方收到** —— 「审查者」会话里出现一条带来源与回信引指的用户消息。

![目标会话收到带来源的消息](docs/usage/02-received.png)

**3. 回信** —— 「审查者」用同一条通道把结论发回给发信会话。

![对方用 session_send 回信](docs/usage/03-reply.png)

**4. 收到回复** —— 发信会话收到对方的结论。

![发信会话收到回复](docs/usage/04-reply-received.png)

**5. 继续干活** —— 发信会话据此继续写文档，两个会话各司其职。

![发信会话据此继续](docs/usage/05-continue.png)

## 投递长什么样

目标会话收到的是一条普通用户消息，自带来源前缀：

```text
[Session message from "跨会话插件协作交付" (session-aca436f5-…)]

<你交办的内容>

[Reply to this Session with the session_send tool using target "session-aca436f5-…".]
```

所以被投递方知道是谁发的、也知道怎么回信；回信同样走 `session_send`，形成双向交付。

几个关键行为：

- **目标在自己的工作目录里执行**。会话的工作目录来自它自己的 `header.cwd`，不是发信人的。
- **冷会话会被唤醒**。目标没开着也能收：`sessionController.resolveAgent()` 会 resume 它，再通过它自己的 Agent 入箱。
- **列表是 profile 级的**。跨工作区可见；工具本身也不区分工作区。
- **投递即唤醒**。只想看进度用 `session_read`，别用 `session_send`。

## 和其他做法的区别

| 做法 | 形态 | 适合 |
|---|---|---|
| 本插件 | 任意两个**普通会话**对等收发 | 你长期维护的多个职责会话互相交接 |
| 内置 `subagent` + `send_message` | 父子会话，一次性子任务 | 把一块工作外包给临时子代理 |
| `@` 引用会话 | 单向、只读地把另一个会话拉进上下文 | 只想要背景资料 |
| 官方实验包 Agent Teams | Lead + 命名 teammate + 共享任务板 | 需要团队花名册、任务认领与依赖 |
| `schedule` | 定时把消息投给某个会话 | 周期性提醒/报告 |

和 Agent Teams 的关键差别：**不创建任何新会话**，直接用你已有的会话；没有 Lead 权威，没有任务板，没有共享 cwd 假设。

## 实现要点

- 目标解析：`ctx.sessionController.list` + `ctx.sessionQuery.readTitleSnapshots`（只读，不激活冷会话）。
- 投递：`ctx.sessionController.resolveAgent(sessionId)` → `agent.followup()` / `agent.steer()`。
- 投递内容是**完整的 user message**：`{ id, role: 'user', source: { kind: 'user' }, content }`。Agent 的 inbox 会把对象原样写成持久的 `user/message` 事件，而 session 的 replay 校验要求 `id` 非空、`role` 匹配、`source.kind` 是字符串、`content` 是数组。少了 `id`/`role` 的写法**当场看不出问题**，但会让该会话在冷读/重启后无法 replay（详见修复记录）。
- 读取：`ctx.sessionQuery.readSurface(sessionId)`，只取 `user/message` 与 `assistant/message`。
- 工具定义是普通对象（不 import `@deepseek-ai/dsh-tools`），因此本 bundle 零依赖、无构建步骤。

## 限制

- 只能投递给**普通会话**；subagent 子会话会被 `session/agent-busy` 拒绝（那种场景用内置 `send_message`）。
- 不能投给调用方自己（避免自激循环）。
- 空会话（还没有第一轮）不在列表里，也无法按 id 投递。
- 普通会话超过列表上限时，需用标题片段过滤后投递。
- 不做去重：模型重试同一个 `session_send` 会真的投两遍。
- 投递正文截断到 4000 字符；读回每条消息截断到 1500 字符。
- 目标侧看到的是 `source: { kind: 'user' }`，在 UI 里就是一条用户消息（靠前缀区分来源）。
- 权限跟随 profile：若 profile 是 `danger-full-access`，跨工作区投递等于允许一个会话让另一个会话全权执行。插件本身不做工作区隔离或白名单。

## 修复记录

**1.0.1**：首版投递只传了 `{ content, source }`，缺 `id` 与 `role`，写出的 `user/message` 通不过 `assertMessageEventShape`（`lacks an identified message`）。后果不是模型读不到消息（会话内照常工作），而是该会话日志在冷读/重启后 replay 时被判为损坏（`SessionPersistenceCorruptionError`），`session_read`、`@` 引用、fork 全部失败。现已补全消息身份；已损坏的日志用 `.scratch/repair-session.cjs` 就地修复（只重编码受影响的那一帧，并保留备份）。

## English

A DeepSeek Harness plugin for **peer messaging between ordinary sessions**. It registers three tools — `session_list`, `session_read`, `session_send` — on the global tool layer, so every session in the profile can discover another session by title or id, read its recent messages, and deliver a message or task to it. Delivery resolves or cold-resumes the target and wakes it through its own Agent handle; the target keeps its own working directory.

Unlike the built-in `subagent` tools (parent/child, one-shot) or the experimental Agent Teams bundle (lead + teammates + shared task board), this plugin creates no sessions and imposes no hierarchy: any two existing sessions can hand work to each other.

Requires a Web or Desktop profile (Host `sessionController` + `sessionQuery`). Tested on DSH 0.2.2-rc.1. Delivering to a subagent session is rejected; self-delivery is refused; messages are truncated (4000 chars out, 1500 chars per read-back message).

## License

[MIT](LICENSE) © 2026 yinying8761

