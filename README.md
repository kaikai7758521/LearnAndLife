# 📚 笔记

按 **学习方向 / 内容 / 细节** 整理的 Markdown 笔记。下面是全部笔记的目录，点击标题即可跳转到对应页面；标题栏右上角的 `EN` / `中文` 可切换英文版本。

<!-- NOTES:START -->
<!-- 本区域由 scripts/update-readme.py 自动生成，请勿手动修改 -->

## AI时代技术 / 基础概念

- [AI常见概念盘点](https://kaikai7758521.github.io/LearnAndLife/#/AI时代技术/基础概念/01-AI常见概念盘点.md)
- [RAG技术及其原理](https://kaikai7758521.github.io/LearnAndLife/#/AI时代技术/基础概念/02-RAG技术及其原理.md)
- [RAG 工作流程](https://kaikai7758521.github.io/LearnAndLife/#/AI时代技术/基础概念/03-RAG工作流程.md)
- [Token 是怎么消耗的](https://kaikai7758521.github.io/LearnAndLife/#/AI时代技术/基础概念/04-Token是怎么被消耗的.md)

## AI时代技术 / 技术实践

- [建立自己的Agent](https://kaikai7758521.github.io/LearnAndLife/#/AI时代技术/技术实践/01-建立自己的Agent.md)
- [建立自己的RAG](https://kaikai7758521.github.io/LearnAndLife/#/AI时代技术/技术实践/02-建立自己的RAG.md)

## 日常生活 / 运动

- [篮球](https://kaikai7758521.github.io/LearnAndLife/#/日常生活/运动/01-篮球.md)
- [羽毛球](https://kaikai7758521.github.io/LearnAndLife/#/日常生活/运动/02-羽毛球.md)

## 电子工程 / 常见基本电路

- [包含芯片的最小系统电路](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/01-最小系统.md)
- [芯片电路的简单介绍](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/常见基本电路/02-芯片电路.md)

## 电子工程 / 电路案例

- [桨板电动推进器电路设计笔记](https://kaikai7758521.github.io/LearnAndLife/#/电子工程/电路案例/01-桨板推进器.md)

## 计算机基础 / JavaScript

- [变量与类型](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/01-变量与类型.md)
- [异步与事件循环](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/JavaScript/02-异步与事件循环.md)

## 计算机基础 / iOS

- [iOS 内存管理底层笔记](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md)

## 计算机基础 / iOS

- [iOS 内存管理底层笔记](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md)
  - [一、基础概念：为什么需要内存管理](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@一基础概念为什么需要内存管理)
  - [二、对象的内存布局 & isa 与 NONPOINTERISA](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@二对象的内存布局-isa-与-nonpointerisa)
  - [三、SideTable：引用计数、弱引用表的真正容器](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@三sidetable引用计数弱引用表的真正容器)
    - [什么时候走 SideTable 的 RefcountMap？](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@什么时候走-sidetable-的-refcountmap)
    - [weaktablet 弱引用表](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@weaktablet-弱引用表)
  - [四、TaggedPointer：特殊的“伪对象”](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@四taggedpointer特殊的伪对象)
  - [五、AutoreleasePool 自动释放池](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@五autoreleasepool-自动释放池)
    - [1. 作用](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@1-作用)
    - [2. 底层结构：不是数组，是双向链表](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@2-底层结构不是数组是双向链表)
    - [3. 什么时候 drain（释放）？](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@3-什么时候-drain释放)
    - [4. 经典场景：循环内大量创建临时对象](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@4-经典场景循环内大量创建临时对象)
    - [5. 重要规则](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@5-重要规则)
  - [六、ARC 修饰符底层区别（strong / weak / unsafeunretained / autoreleasing）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@六arc-修饰符底层区别strong-weak-unsafeunretained-autoreleasing)
    - [循环引用（Retain Cycle）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@循环引用retain-cycle)
  - [七、对象销毁流程：dealloc 底层调用链路](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@七对象销毁流程dealloc-底层调用链路)
  - [八、内存布局：iOS 进程内存分区](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@八内存布局ios-进程内存分区)
  - [九、常见坑 & 面试高频问答梳理](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@九常见坑-面试高频问答梳理)
  - [十、总结](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/iOS/01-内存管理.md@十总结)

## 计算机基础 / 数据结构

- [数组与链表](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/01-数组与链表.md)
- [数据结构 - 树](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/数据结构/02-树.md)

## 计算机基础 / 算法 / 基本算法

- [单例](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/基本算法/01-单例.md)

## 计算机基础 / 算法 / 数组算法

- [数组中重复的数字](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/数组算法/01-数组中的重复数字.md)

## 计算机基础 / 算法 / 基本算法

- [单例](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/基本算法/01-单例.md)
  - [iOS的单例](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/基本算法/01-单例.md@ios的单例)
  - [Java的单例](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/基本算法/01-单例.md@java的单例)
    - [初始化则加载（线程安全）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/基本算法/01-单例.md@初始化则加载线程安全)
    - [懒加载（需要时加载，有多线程风险，加锁进行双重判断）](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/基本算法/01-单例.md@懒加载需要时加载有多线程风险加锁进行双重判断)

## 计算机基础 / 算法 / 数组算法

- [数组中重复的数字](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/数组算法/01-数组中的重复数字.md)
  - [题目一](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/数组算法/01-数组中的重复数字.md@题目一)
  - [解法](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/数组算法/01-数组中的重复数字.md@解法)
  - [题目二](https://kaikai7758521.github.io/LearnAndLife/#/计算机基础/算法/数组算法/01-数组中的重复数字.md@题目二)

<!-- NOTES:END -->

---

> 新建笔记时，只需在仓库中新建目录和 `.md` 文件并提交；GitHub Action 会自动刷新索引与中英目录，Pages 重新部署后左侧目录、搜索和首页统计会自动更新，全程无需命令行。
>
> 本页目录由脚本自动生成（仓库根目录运行 `python3 scripts/update-readme.py`，会同时刷新 `manifest.json` 与 `manifest.en.json`），请勿手动修改标记区内容；站点搭建与写作说明见仓库根目录的 `USAGE.md`。
