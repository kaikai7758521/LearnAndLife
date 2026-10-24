# 建立自己的Agent 
---

# 用 OpenCode + DeepSeek API 搭建小说写作Agent
> 说明：你**不需要写任何Python、LangGraph代码**。OpenCode自带Agent调度、工具调用、文件读写、子Agent能力；所有推理全部调用DeepSeek官方API，不本地部署大模型；你只需要准备好DeepSeek的API Key，跟着交互式命令一步步配置即可。
> OpenCode内置工具：`read（读取文件）`、`write（写入文件）`，正好用来做小说设定读取、章节保存；支持创建子Agent，我们分成【主写作Agent】+【审查Critic子Agent】，实现之前方案里的规划、写稿、自查、保存闭环。


## 前置理解（原理）
整套小说Agent的工作逻辑和之前版本保持一致，只是**调度引擎交给OpenCode**：
1. OpenCode负责循环调度、工具调用、权限控制、会话记忆；
2. 所有思考、大纲、写正文、一致性审查，全部走DeepSeek API；
3. 小说资料（世界观、人物卡、章节）全部放在本地文件夹里，由OpenCode的内置read/write工具读写；
4. 两个Agent分工：
   - 主小说Agent：负责读取设定、做章节规划、写章节正文、保存草稿；
   - Critic审查子Agent：专门读取章节、人设、世界观，检查OOC、剧情矛盾、战力崩坏，只输出问题清单，不直接改文。

> 重要边界：
> ✅ Agent可以自动读取所有设定、章节；自动写新章节、更新角色动态状态；
> ❌ Agent**不能自动修改基础世界观、角色基础人设**，这类修改必须由你手动改文件。

## 前置准备（一次性）
### 1. 准备 DeepSeek API Key
1. 打开 DeepSeek开放平台，进入API密钥页面，新建API Key，复制保存（sk开头）；
2. 提前充值余额，Agent是多轮调用，会消耗token；
3. 推荐模型选择：
   - 写正文：`deepseek-v4-flash`，文笔灵活、性价比高
   - 大纲规划、审查校验、摘要生成：`deepseek-v4-pro`，逻辑严谨，适合自检

### 2. 安装 OpenCode（支持Windows / Mac / Linux）
OpenCode有桌面版、终端TUI两种，推荐**桌面版**，对新手更友好；
官方地址：opencode.ai，直接下载安装包，一路下一步安装。
> 安装完成后，打开OpenCode（桌面程序，或者终端输入命令 `opencode` 启动交互式界面）

### 3. 在电脑上新建一个小说项目文件夹
随便找一个位置新建文件夹，命名比如 `我的小说项目`，目录结构（手动新建，全部是文本文件，不用代码）：
```
我的小说项目/
├── setting.md        # 全局世界观、力量体系、世界规则、时间线（静态，尽量不改）
├── characters.md     # 角色卡：基础人设 + 动态状态（伤势、关系、已知秘密）
├── chapter_index.md  # 章节目录：章节号、标题、本章摘要、新增伏笔
└── chapters/         # 存放每一章正文
    ├── ch01.md
    ├── ch02.md
```
先用记事本简单写好初始内容：
- setting.md：题材、世界观、核心规则；
- characters.md：主角、配角的基础性格、出身、能力上限；
> 这两份是基准设定，后面Agent每次写作都会读取它，作为权威标准。

## 步骤1：OpenCode连接DeepSeek（核心绑定）
打开OpenCode，在底部输入框输入命令：
```
/connect
```
1. 弹出供应商搜索框，输入 `deepseek`，选中DeepSeek；
2. 粘贴你的DeepSeek API Key，回车提交；
3. 选择默认模型，这里优先选 `deepseek-v4-flash`（主写作默认模型）；
4. 提示连接成功，代表OpenCode所有模型请求都会转发到DeepSeek官方API，没有本地模型。
> 验证：输入 `/models`，可以切换v4-pro / v4-flash两个模型，后续我们给审查子Agent单独指定v4-pro

## 步骤2：交互式创建【主小说写作Agent】
在OpenCode输入框执行创建Agent命令，向导会一步步问，只用打字回答：
```
opencode agent create
```
向导依次提问，按下面方案填写：
1. 保存位置：`项目内（Project）`（只给这本小说使用，推荐这个）；
2. Agent名称：`novel-writer`；
3. Agent描述（直接复制粘贴）：
> 你是长篇小说写作Agent，调用DeepSeek大模型。你写作前，优先读取项目里的setting.md、characters.md、chapter_index.md，读取相关章节摘要。写作流程：先生成本章节拍清单，交给作者确认，节拍确认后再写章节正文；写完正文后调用critic子Agent做一致性审查；审查完毕，使用write工具保存章节、更新chapter_index里的摘要和伏笔记录。你禁止私自修改setting.md和角色基础人设；如果发现设定冲突，列出冲突等待作者确认。
4. 选择开放给这个Agent的工具（**只勾选下面两个**，其余全部取消，控制权限）：
   - read：读取本地md文件
   - write：写入/修改本地md文件
   > ⚠️ 不要给shell等高危工具，避免误操作
5. 模型：选择 `deepseek-v4-flash`
6. 向导自动生成Agent配置文件，完成创建。

## 步骤3：交互式创建【Critic审查子Agent】
再次执行创建命令，做审查专用子Agent：
```
opencode agent create
```
参数填写：
1. 保存位置：同一个项目；
2. Agent名称：`critic`；
3. Agent描述（直接复制）：
> 你是小说一致性审查子Agent，使用deepseek-v4-pro。拿到章节文本后，对照setting.md世界观、characters.md角色卡、chapter_index历史伏笔，逐条检查：角色OOC、战力违规、时间线矛盾、伏笔冲突、秘密提前泄露；只输出结构化问题清单，**不修改正文**。如果没有问题，直接返回【无明显冲突】。
4. 工具权限：只勾选 read（只读！不能写文件，防止它乱改稿子）
5. 模型：指定 `deepseek-v4-pro`（逻辑更强，适合校验）

> 现在两个Agent都创建好了：`novel-writer`（主写手）、`critic`（质检员）；主写手会自动调用critic子Agent，你也可以手动 `@critic` 调用它审查稿子

## 步骤4：初始化小说、生成全书大纲
1. 在OpenCode里切换到 `novel-writer` Agent（Tab键切换Agent）；
2. 发送指令（复制）：
> 读取 setting.md 和 characters.md，基于现有设定，生成全书总大纲、分卷大纲，输出在会话里给我审核；大纲确认之后，我们再开始写第一章。
3. 此时OpenCode会自动调用read工具读取你写好的设定文件，发给DeepSeek API生成大纲；
4. 你看完大纲，直接在对话框回复：同意大纲 / 修改意见；
5. 大纲定稿后，你可以让Agent把大纲追加写入 chapter_index.md。

## 步骤5：标准写作流程
> 发文字指令，**不写代码**，OpenCode自动跑ReAct循环、调用工具、调用子Agent
1. 发送写作指令示例：
> 写第3章，POV为女主，本章核心冲突：在秘境遭遇伏击；先生成本章节拍清单给我确认。
2. 自动流程（OpenCode内部自动执行）：
   ① 调用read读取 setting.md、出场角色卡、历史章节摘要；
   ② 调用DeepSeek API，生成本章节拍清单（开场、冲突、转折点、伏笔）；
3. 审核节拍：
   - 满意：回复【节拍确认，开始写正文】
   - 不满意：直接提修改意见，Agent重新生成节拍
4. 节拍确认，Agent生成章节初稿；
5. Agent自动 @critic 子Agent，发起一致性审查（走v4-pro）；
6. Critic返回问题清单，如果有OOC、矛盾，主写手自动修改文稿（最多自动修改2轮，防止无限循环消耗余额）；
7. 定稿后，Agent调用write工具：
   - 新建 chapters/ch03.md 保存正文；
   - 更新 chapter_index.md，写入本章摘要、新增伏笔、角色状态变化；
   - 更新 characters.md 里角色的动态状态（受伤、好感变化、获得新情报）
8. 稿件输出给你，等待你的下一条指令：写下一章 / 修改本章内容

## 步骤6：修改反馈流程（稿子不满意的时候）
直接发修改指令，示例：
> 第3章里女主这段对话不符合人设，请修改；修改完成后重新交给critic审查。
Agent会自动读取ch03.md原文、设定，调用DeepSeek修改，再次走审查流程，最后覆盖草稿、更新摘要。

## 步骤7：切换Agent的操作技巧
- Tab键：快速切换novel-writer / critic；
- 手动单独审查某一章，直接发：
`@critic 读取 chapters/ch03.md，做一次完整剧情一致性检查`

## 重点注意事项
### 1. API和费用相关
1. 所有请求都走DeepSeek API Key，OpenCode本身不收推理费用；你只承担DeepSeek的token消耗；
2. 每一章会多次调用API：规划 → 写稿 → 审查 → 修改，比普通续写消耗更多token；
3. 网络不稳定时，API调用会超时，直接重新发一遍指令即可，OpenCode自带简单重试；
4. **API Key不要分享、不要截图发给别人**，OpenCode本地保存密钥，不会上传第三方服务器。

### 2. 权限安全
1. 两个Agent的工具权限严格按上面配置：写手只能read+write，审查员只能read；**不要随便开启shell、执行命令类工具**；
2. setting.md、角色基础人设，Agent只能读：任何修改这两份文件的需求，**只能手动记事本打开改，不让Agent自动覆盖**；
3. Agent如果发现设定冲突，它只会列出冲突，不会私自改写设定抹平矛盾，等你裁决。

### 3. 记忆和长篇一致性
OpenCode本身会话窗口有上限，所以我们不依赖对话历史记忆；**全部依靠外部md文件存储设定、摘要**，每次写作都read读取文件，解决长篇失忆、OOC问题。
> 就算DeepSeek v4支持百万上下文，依然优先用文件摘要方案，更稳定、省钱。

### 4. 工具调用出错怎么处理
偶尔DeepSeek返回的工具调用格式不规范，OpenCode会提示调用失败，解决方案：
- 直接发送一句：`请重新整理输出，规范调用read/write工具`，模型会重新生成合法调用指令。

### 5. 终止循环，防止无限调用API
如果发现Agent一直在反复调用工具、不停循环消耗余额，直接输入 `/stop` 终止当前会话。

## 验证路线
1. 安装OpenCode，`/connect` 绑定DeepSeek Key，确认连接成功；
2. 新建小说文件夹，手动写好极简setting.md、characters.md；
3. 创建novel-writer、critic两个Agent；
4. 测试简单指令：`读取setting.md，把世界观内容复述一遍`，验证read工具正常；
5. 测试写第一章，走完：节拍确认 → 写稿 → critic审查 → 保存；
6. 写完第一章，测试修改反馈流程，验证修改、重审查正常；
7. 连续写2~3章，观察是否保持人设、伏笔连贯。

## 可选进阶玩法
1. 增加【伏笔追踪子Agent】：再新建一个子Agent，专门记录、检索全书所有伏笔，定期检查伏笔回收；
2. 文风锁定：你把写满意的范文放在style.md，每次写作前让Agent读取style.md对齐文笔；
3. 多线分支故事：新建分支文件夹，让Agent读写不同分支的章节文件，管理平行剧情。
