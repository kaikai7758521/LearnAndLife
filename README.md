# 📚 我的笔记

按 **学习方向 / 内容 / 细节** 整理的 Markdown 学习笔记。下面是全部笔记的目录，点击标题即可跳转到对应页面或章节；标题栏右上角的 `EN` / `中文` 可切换英文版本。

<!-- NOTES:START -->
<!-- 本区域由 scripts/update-readme.py 自动生成，请勿手动修改 -->

## 日常生活 / 运动

- [篮球](https://kaikai7758521.github.io/LearnAndLife/#/日常生活/运动/01-篮球.md)
- [羽毛球](https://kaikai7758521.github.io/LearnAndLife/#/日常生活/运动/02-羽毛球.md)

## 电子工程 / 常见基本电路

- [包含芯片的最小系统电路](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md)
  - [一、最小系统通用概念](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@一最小系统通用概念)
  - [二、STM32 最小系统（以 STM32F103C8T6 为例）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@二stm32-最小系统以-stm32f103c8t6-为例)
    - [1. 电源电路](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@1-电源电路)
    - [2. 复位电路（NRST 引脚，低电平复位）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@2-复位电路nrst-引脚低电平复位)
    - [3. 时钟电路（外部高速晶振 HSE）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@3-时钟电路外部高速晶振-hse)
    - [4. BOOT 启动选择电路](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@4-boot-启动选择电路)
    - [5. 下载调试电路](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@5-下载调试电路)
  - [三、ESP32 最小系统（ESP32‑WROOM‑32 模组）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@三esp32-最小系统esp32‑wroom‑32-模组)
    - [1. 电源电路](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@1-电源电路-2)
    - [2. CHIPEN（EN）使能引脚](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@2-chipenen使能引脚)
    - [3. BOOT 下载引脚（GPIO0）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@3-boot-下载引脚gpio0)
    - [4. 时钟](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@4-时钟)
    - [5. 下载电路](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@5-下载电路)
    - [6. Flash](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@6-flash)
  - [四、STM32最小系统 VS ESP32最小系统对比](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@四stm32最小系统-vs-esp32最小系统对比)
  - [五、常见踩坑总结](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@五常见踩坑总结)
  - [六、总结](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md@六总结)
- [芯片电路的简单介绍](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md)
  - [一、总述](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@一总述)
  - [二、第一层：裸片（Die）整体分区结构](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@二第一层裸片die整体分区结构)
  - [三、第二层：功能模块电路（Module）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@三第二层功能模块电路module)
    - [数字芯片（MCU/CPU/FPGA）常见模块](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@数字芯片mcucpufpga常见模块)
    - [模拟 / 混合信号芯片（ADC、电源芯片）常见模块](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@模拟-混合信号芯片adc电源芯片常见模块)
  - [四、第三层：标准单元电路（Standard Cell）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@四第三层标准单元电路standard-cell)
  - [五、第四层：底层器件电路 —— 晶体管（最基础开关）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@五第四层底层器件电路-晶体管最基础开关)
    - [CMOS 反相器（最基础 CMOS 电路）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@cmos-反相器最基础-cmos-电路)
  - [六、互连层：金属连线结构（多层布线）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@六互连层金属连线结构多层布线)
  - [七、时钟树电路（同步数字芯片关键结构）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@七时钟树电路同步数字芯片关键结构)
  - [八、从 Die 到封装：外部电路接口](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@八从-die-到封装外部电路接口)
  - [九、补充：两类芯片电路架构对比](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@九补充两类芯片电路架构对比)
  - [十、一句话总结层级关系](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md@十一句话总结层级关系)

## 电子工程 / 电路案例

- [桨板电动推进器电路设计笔记](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md)
  - [一、功能需求梳理](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@一功能需求梳理)
  - [二、整体电路](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@二整体电路)
  - [三、分模块电路详解](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@三分模块电路详解)
    - [3.1 无线遥控模块](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@31-无线遥控模块)
    - [3.2 推进电机驱动单元（ESC电调）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@32-推进电机驱动单元esc电调)
    - [3.3 转向舵机单元](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@33-转向舵机单元)
    - [3.4 电源与BEC降压单元（重点，分电池方案）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@34-电源与bec降压单元重点分电池方案)
      - [方案A：3S锂电（11.1V，充满12.6V）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@方案a3s锂电111v充满126v)
      - [方案B：4S锂电（14.8V，充满16.8V）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@方案b4s锂电148v充满168v)
      - [方案C：12V铅酸 / 12V磷酸铁锂（4串铁锂充满14.6V）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@方案c12v铅酸-12v磷酸铁锂4串铁锂充满146v)
    - [3.5 保护电路清单（必加）](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@35-保护电路清单必加)
  - [四、完整接线总表](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@四完整接线总表)
  - [五、电路调试步骤](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@五电路调试步骤)
  - [六、安全与实操注意事项](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@六安全与实操注意事项)
    - [电气安全](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@电气安全)
    - [机械与防水](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@机械与防水)
    - [使用规范](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@使用规范)
    - [电路避坑清单](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@电路避坑清单)
  - [七、可选升级拓展电路](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md@七可选升级拓展电路)

## 计算机基础 / JavaScript

- [变量与类型](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/01-变量与类型.md)
  - [三种声明方式](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/01-变量与类型.md@三种声明方式)
    - [暂时性死区（TDZ）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/01-变量与类型.md@暂时性死区tdz)
  - [原始类型与引用类型](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/01-变量与类型.md@原始类型与引用类型)
    - [值传递的差异](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/01-变量与类型.md@值传递的差异)
  - [类型转换的坑](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/01-变量与类型.md@类型转换的坑)
  - [相关笔记](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/01-变量与类型.md@相关笔记)
- [异步与事件循环](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/02-异步与事件循环.md)
  - [一张图看懂执行顺序](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/02-异步与事件循环.md@一张图看懂执行顺序)
  - [经典面试题](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/02-异步与事件循环.md@经典面试题)
  - [async / await 的本质](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/02-异步与事件循环.md@async-await-的本质)
  - [定时器并不精确](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/02-异步与事件循环.md@定时器并不精确)
  - [相关笔记](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/02-异步与事件循环.md@相关笔记)

## 计算机基础 / 数据结构

- [数组与链表](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/01-数组与链表.md)
  - [复杂度对比](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/01-数组与链表.md@复杂度对比)
  - [数组的典型写法](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/01-数组与链表.md@数组的典型写法)
  - [链表的典型写法](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/01-数组与链表.md@链表的典型写法)
  - [什么时候用哪个](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/01-数组与链表.md@什么时候用哪个)
  - [相关笔记](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/01-数组与链表.md@相关笔记)
- [数据结构 - 树](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md)
  - [一、树的基本概念](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@一树的基本概念)
    - [1. 基础术语](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@1-基础术语)
  - [二、二叉树（重点）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@二二叉树重点)
    - [1. 二叉树的5种基本形态](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@1-二叉树的5种基本形态)
    - [2. 两种特殊二叉树](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@2-两种特殊二叉树)
      - [（1）满二叉树](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@1满二叉树)
      - [（2）完全二叉树](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@2完全二叉树)
    - [3. 二叉树重要性质（常考）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@3-二叉树重要性质常考)
  - [三、二叉树的存储](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@三二叉树的存储)
    - [1. 顺序存储（数组）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@1-顺序存储数组)
    - [2. 链式存储（二叉链表，最常用）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@2-链式存储二叉链表最常用)
  - [四、二叉树遍历（必考）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@四二叉树遍历必考)
  - [五、二叉搜索树 BST（Binary Search Tree）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@五二叉搜索树-bstbinary-search-tree)
  - [六、平衡二叉树 AVL](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@六平衡二叉树-avl)
  - [七、堆（Heap）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@七堆heap)
  - [八、哈夫曼树（Huffman树 / 最优二叉树）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@八哈夫曼树huffman树-最优二叉树)
  - [九、常见对比总结](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md@九常见对比总结)

<!-- NOTES:END -->

---

> 新建笔记时，只需在仓库中新建目录和 `.md` 文件并提交；GitHub Action 会自动刷新索引与中英目录，Pages 重新部署后左侧目录、搜索和首页统计会自动更新，全程无需命令行。
>
> 本页目录由脚本自动生成（仓库根目录运行 `python3 scripts/update-readme.py`，会同时刷新 `manifest.json` 与 `manifest.en.json`），请勿手动修改标记区内容；站点搭建与写作说明见仓库根目录的 `USAGE.md`。
