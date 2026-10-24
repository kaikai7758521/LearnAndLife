---
title: "Build your own Agent"
lang: en
translatedFrom: d83d441aae4181d2b934d2eefd6065dd4c31f8cb2984d8ba4d9f04128b7ed384
translatedAt: 2026-10-24
---

# Build your own Agent

**uses OpenCode + DeepSeek API to build novel writing agent**
> Note: You **do not need to write any Python or LangGraph code**. OpenCode comes with Agent scheduling, tool calling, file reading and writing, and sub-Agent capabilities; all inferences call DeepSeek's official API and do not deploy large models locally; you only need to prepare the DeepSeek API Key and follow the interactive commands to configure it step by step.
> OpenCode has built-in tools: `read（读取文件）` and `write（写入文件）`, which are suitable for reading novel settings and saving chapters; it supports the creation of sub-Agents. We divide it into [main writing agent] + [critic sub-agent] to realize the closed loop of planning, writing, self-examination, and saving in the previous plan.


## Pre-understanding (principle)
The working logic of the entire novel Agent remains the same as the previous version, except that the **scheduling engine is handed over to OpenCode**:
1. OpenCode is responsible for cycle scheduling, tool calling, permission control, and session memory;
2. uses DeepSeek API for all thinking, outline, text writing, and consistency review;
3. novel materials (world view, character cards, chapters) are all placed in local folders and read and written by OpenCode's built-in read/write tool;
Division of work between 4. two Agents:
   - main novel agent: responsible for reading settings, making chapter planning, writing chapter text, and saving drafts;
   - Critic review sub-agent: specializes in reading chapters, characters, world view, checking OOC, plot conflicts, and combat power collapse. It only outputs a list of issues and does not directly modify the text.

> important boundaries:
> ✅ Agent can automatically read all settings and chapters; automatically write new chapters and update character dynamic status;
> ❌ Agent**cannot automatically modify the basic world view and basic character settings**. Such modifications must be made manually by you.

## Pre-preparation (one-time use)
### 1. Prepare DeepSeek API Key
1. Open the DeepSeek open platform, enter the API key page, create a new API Key, copy and save (starting with sk);
2. recharges the balance in advance. The Agent is called in multiple rounds and will consume tokens;
3. recommended model selection:
   - Write the text: `deepseek-v4-flash`, flexible writing style and high cost performance
   - Outline planning, review and verification, abstract generation: `deepseek-v4-pro`, rigorous logic, suitable for self-inspection

### 2. Install OpenCode (supports Windows/Mac/Linux)
OpenCode has two types: desktop version and terminal TUI. We recommend **desktop version**, which is more friendly to novices;
Official address: opencode.ai, download the installation package directly and install it in the next step.
After the installation of > is completed, open OpenCode (desktop program, or enter the command `opencode` in the terminal to start the interactive interface)

### 3. Create a new novel project folder on your computer
Find a new folder in any location, name it such as `我的小说项目`, directory structure (manually create, all text files, no code required):
```
我的小说项目/
├── setting.md        # 全局世界观、力量体系、世界规则、时间线（静态，尽量不改）
├── characters.md     # 角色卡：基础人设 + 动态状态（伤势、关系、已知秘密）
├── chapter_index.md  # 章节目录：章节号、标题、本章摘要、新增伏笔
└── chapters/         # 存放每一章正文
    ├── ch01.md
    ├── ch02.md
```
 First use notepad to simply write the initial content:
- setting.md: theme, world view, core rules;
- characters.md: The basic character, origin, and ability limit of the protagonist and supporting characters;
The two copies of > are the baseline settings. The Agent will read them every time it writes as the authoritative standard.

## Step 1: OpenCode connects DeepSeek (core binding)
Open OpenCode and enter the command in the bottom input box:
```
/connect
```
1. The supplier search box pops up, enter `deepseek`, and select DeepSeek;
2. Paste your DeepSeek API Key and press Enter to submit;
3. selects the default model, here `deepseek-v4-flash` is preferred (the default model for main writing);
4. prompts that the connection is successful, which means that all OpenCode model requests will be forwarded to the DeepSeek official API, and there are no local models.
> verification: Enter `/models` to switch between the two models v4-pro / v4-flash. Later, we will separately specify v4-pro for the review sub-agent.

## Step 2: Interactively create [Main Novel Writing Agent]
Execute the Create Agent command in the OpenCode input box. The wizard will ask you step by step. Just type the answer:
The ```
opencode agent create
```
 wizard asks questions one by one and fill them in according to the following plan:
1. save location: `项目内（Project）` (only used for this novel, recommended);
2. Agent name: `novel-writer`;
3. Agent description (copy and paste directly):
> You are a novel writing agent, calling the DeepSeek large model. Before you write, give priority to reading the setting.md, characters.md, chapter_index.md in the project, and reading the relevant chapter summaries. Writing process: The teacher makes a list of chapters and gives them to the author for confirmation. After the rhythm is confirmed, he writes the chapter text; after writing the text, he calls the critic sub-Agent for consistency review; after the review is completed, he uses the write tool to save the chapter and update the summary and foreshadowing records in chapter_index. You are prohibited from modifying setting.md and basic character settings without permission; if a setting conflict is found, list the conflict and wait for confirmation from the author.
4. selects the tools open to this Agent (**only checks the following two**, and cancels the rest to control permissions):
   - read: Read local md file
   - write: write/modify local md file
   > ⚠️ Do not give shell and other high-risk tools to avoid misoperation
5. model: Select `deepseek-v4-flash`
The 6. wizard automatically generates the Agent configuration file and completes the creation.

## Step 3: Interactively create [Critic review sub-Agent]
Execute the create command again to create a dedicated sub-agent for review:
Fill in the ```
opencode agent create
```
 parameters:
1. save location: the same project;
2. Agent name: `critic`;
3. Agent description (direct copy):
> You are the novel consistency review sub-agent, using deepseek-v4-pro. After getting the chapter text, compare it with the setting.md world view, characters.md character card, chapter_index historical foreshadowing, and check one by one: character OOC, combat power violations, timeline conflicts, foreshadowing conflicts, and secrets leaked in advance; only a structured question list is output, **does not modify the main text**. If there is no problem, return directly to [No obvious conflict].
4. tool permissions: only check read (read only! Files cannot be written to prevent it from changing the manuscript randomly)
5. model: specify `deepseek-v4-pro` (stronger logic, suitable for verification)

> Now two Agents have been created: `novel-writer` (main writer) and `critic` (quality inspector); the main writer will automatically call the critic sub-Agent, and you can also manually `@critic` call it to review the manuscript.

## Step 4: Initialize the novel and generate the outline of the book
1. switches to `novel-writer` Agent in OpenCode (Tab key switches Agent);
2. sends command (copy):
> reads setting.md and characters.md, based on the existing settings, generates the overall outline and volume outline of the book, and outputs them to me for review in the session; after the outline is confirmed, we start writing the first chapter.
3. At this time, OpenCode will automatically call the read tool to read the setting file you wrote, and send it to the DeepSeek API to generate the outline;
4. After reading the outline, reply directly in the dialog box: Agree with the outline/revision comments;
After the 5. outline is finalized, you can ask the Agent to append the outline to chapter_index.md.

## Step 5: Standard Writing Process
> sends text commands, **does not write code,**, OpenCode automatically runs the ReAct loop, calls tools, and calls sub-Agents
Example of 1. sending writing instructions:
> writes Chapter 3. The POV is that of the heroine. The core conflict of this chapter: an ambush in a secret realm; please send me a list of this chapter for confirmation.
2. automatic process (automatically executed internally by OpenCode):
   ① Call read to read setting.md, appearance character card, and historical chapter summary;
   ② Call DeepSeek API to generate the beat list of this chapter (opening, conflict, turning point, foreshadowing);
3. review tempo:
   - Satisfied: Reply [beat confirmed, start writing text]
   - is not satisfied: directly submit modification suggestions, and the agent will regenerate the beat.
4. beat confirmation, Agent generates the first draft of the chapter;
5. Agent automatically @critic sub-Agent, initiates consistency review (using v4-pro);
6. Critic returns to the problem list. If there are OOC or contradictions, the main writer will automatically modify the manuscript (up to 2 rounds of automatic modifications to prevent infinite loops from consuming balances);
After 7. is finalized, the Agent calls the write tool:
   - Create new chapters/ch03.md and save the text;
   - updates chapter_index.md, writing the chapter summary, new foreshadowing, and character status changes;
   - updates the dynamic status of the characters in characters.md (injury, change of favorability, acquisition of new information)
8. manuscript is output to you, waiting for your next instruction: write a chapter / Modify the content of this chapter

## Step 6: Modify the feedback process (when you are not satisfied with the manuscript)
Send modification instructions directly, example:
> The dialogue of the heroine in Chapter 3 does not fit the character, please modify it; after the modification is completed, submit it to critic again for review.
Agent will automatically read the original text and settings of ch03.md, call DeepSeek to modify it, go through the review process again, and finally overwrite the draft and update the summary.

## Step 7: Operation skills for switching Agents
- Tab key: quickly switch novel-writer/critic;
- manually review a chapter individually and send it directly:
`@critic 读取 chapters/ch03.md，做一次完整剧情一致性检查`

Important precautions for ## 
### 1. API and fees related
1. All requests use the DeepSeek API Key, and OpenCode itself does not charge inference fees; you only bear the token consumption of DeepSeek;
Each chapter of 2. will call the API multiple times: planning → writing → review → modification, which consumes more tokens than ordinary continuation;
When the 3. network is unstable, the API call will time out. Just resend the command. OpenCode comes with a simple retry;
4. **API Key Do not share, do not take screenshots and send them to others**. OpenCode saves the key locally and will not upload it to a third-party server.

### 2. Permission security
The tool permissions of the two Agents of 1. are strictly configured as above: writers can only read+write, and examiners can only read; **do not open shells and execute command tools** casually;
2. setting.md, character basic settings, Agent can only read: any need to modify these two files, **can only be opened and modified manually in Notepad, and the Agent will not automatically overwrite**;
If 3. Agent finds a setting conflict, it will only list the conflict, and will not privately rewrite the setting to smooth out the conflict, waiting for your decision.

### 3. Memory and long-form consistency
OpenCode itself has an upper limit on the session window, so we do not rely on conversation history memory; **all relies on external md files to store settings and summaries**. The file is read every time when writing to solve long-form amnesia and OOC problems.
> Even if DeepSeek v4 supports millions of contexts, the file summary solution will still be used first, which is more stable and saves money.

### 4. How to deal with tool calling errors
Occasionally, the tool call format returned by DeepSeek is not standardized, and OpenCode will prompt that the call failed. Solution:
- directly sends a sentence: `请重新整理输出，规范调用read/write工具`, and the model will regenerate legal calling instructions.

### 5. Terminate the loop to prevent infinite API calls
If you find that the Agent has been repeatedly calling tools and consuming balances in a non-stop cycle, directly enter `/stop` to terminate the current session.

## Verification route
1. installs OpenCode, `/connect` binds DeepSeek Key, and confirms that the connection is successful;
2. Create a new novel folder and manually write the minimalist setting.md and characters.md;
3. creates novel-writer and critic agents;
4. test simple instructions: `读取setting.md，把世界观内容复述一遍`, verify that the read tool is normal;
5. test writing the first chapter, complete: beat confirmation → writing → critic review → save;
6. finished writing the first chapter, tested the modification feedback process, and verified that the modification and re-examination were normal;
7. Write 2 to 3 chapters in a row and observe whether the characters and foreshadowing are consistent.

## Optional advanced gameplay
1. adds [Foreshadowing Tracking Sub-Agent]: Create a new sub-Agent to record and retrieve all foreshadowings in the book, and regularly check foreshadowing recovery;
2. Writing style lock: You put the sample essay you are satisfied with in style.md, and let the Agent read style.md to align the writing style before each writing;
3. Multi-line branch story: Create a new branch folder, let the Agent read and write chapter files of different branches, and manage parallel plots.
