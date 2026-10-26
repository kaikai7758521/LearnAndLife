# Swift struct / class 详解

>OC 里所有对象**实例本身是 `objc_object`（结构体）**，但**它是一个带 isa 指针的对象结构体**，和 Swift 的 `struct` 不是一回事。
OC 的类实例底层是 `struct objc_object { Class isa; }`；但 OC 的**类是引用类型**，这个结构体只是 runtime 用来承载对象内存布局的底层载体，**语义上依然是引用类型**。

一句话总览：
- Swift `struct`：**值类型（Value Type）**，栈优先、拷贝语义、无引用计数、不支持继承；
- Swift `class`：**引用类型（Reference Type）**，堆分配、引用语义、ARC 引用计数、支持继承；
- Objective‑C：只有**引用类型（`NSObject` 子类）**，没有原生的值类型；OC 的底层 `objc_object` struct 只是 runtime 实现细节，不是值语义。

---

## 一、Swift struct 与 class 核心区别表
| 对比项 | Swift struct（结构体） | Swift class（类） | Objective‑C（NSObject 子类） |
|---|---|---|---|
| 类型语义 | 值类型 | 引用类型 | 引用类型 |
| 内存分配 | 优先栈上；大结构体、捕获进闭包时会逃逸到堆 | 一定分配在堆 | 一定分配在堆 |
| 赋值行为 | 赋值时**拷贝一份独立副本** | 赋值时拷贝指针，指向同一个实例 | 赋值拷贝指针，指向同一个对象 |
| 内存管理 | 无 ARC、无引用计数；栈上自动回收 | ARC 引用计数管理 | ARC 引用计数管理 |
| 继承 | ❌ 不支持继承；可以实现协议 | ✅ 支持单继承 + 协议 | ✅ 单继承 + 协议 |
| 多态 | ❌ 没有多态 | ✅ 支持多态、override | ✅ 支持多态 |
| 析构 | `deinit` ❌ 没有 | `deinit` ✅ 支持 | `-dealloc` ✅ 支持 |
| 可变 | 默认 `let` 不可变；`var` 可变 | `let` 时：**指针不可变，对象内部属性仍然可以改** | `let` 指向对象，内部属性可改 |
| 隐式构造器 | 自动生成成员逐一构造器 | 不会自动生成成员构造器，需要手写 | 手写 init |
| 转发 | 拷贝是深度浅拷贝（成员逐个复制） | 共享同一个实例 | 共享同一个实例 |

> `let s: SomeStruct` → 结构体整个实例不可变，内部属性全都不能改
> `let c: SomeClass` → 只是不能让 c 指向别的对象，但 `c.name = "xxx"` 依然合法！

### 示例直观感受
#### Struct（值类型）
```swift
struct UserStruct {
    var name: String
}
var u1 = UserStruct(name: "A")
var u2 = u1
u2.name = "B"
print(u1.name) // A，互不影响
```

#### Class（引用类型）
```swift
class UserClass {
    var name: String
    init(name: String) { self.name = name }
}
var c1 = UserClass(name: "A")
var c2 = c1
c2.name = "B"
print(c1.name) // B，指向同一个对象
```

OC 等价逻辑：
```Objective-C
@interface OCUser : NSObject
@property (nonatomic, copy) NSString *name;
@end
OCUser *o1 = [[OCUser alloc] init];
o1.name = @"A";
OCUser *o2 = o1;
o2.name = @"B";
NSLog(@"%@", o1.name); // B，和 class 行为一致
```

---

## 二、底层内存细节（回答你提到的：OC 对象是 struct）
```c
// objc4 源码简化
struct objc_object {
    Class isa;
};
struct objc_class : objc_object {
    // ... 方法列表、属性、父类等
};
```
✅ OC 的对象实例底层确实是一个 C struct。
❌ **但是它不具备值语义！**
C struct 本身是值类型，但 Objective‑C  runtime 刻意把 `objc_object` 设计成**引用使用**：
我们永远不会写 `objc_object a = *obj;` 直接拷贝整个对象；我们永远只操作指针 `objc_object *`。
> 所以：**实现用了 struct，语义是引用类型。这是很多人容易踩坑的地方。**

Swift struct 是直接暴露给你、鼓励你按值语义使用的值类型；它和 OC 底层那个 `objc_object` struct 完全不是同一个概念。

额外：Swift class 底层 runtime 现在是 Swift Metadata，不再复用 ObjC 的 objc_object（除非继承自 NSObject）。
- `class A: NSObject`：实例底层还是 objc_object，兼容 OC runtime
- `class A`（纯 Swift class，不继承 NSObject）：Swift 自己的对象头，不再是 objc_object

---

## 三、拷贝行为：浅拷贝 / 深拷贝
1. **Swift struct**
赋值 = **逐成员拷贝（memberwise copy）**
- 如果成员都是值类型：等价深拷贝
- 如果成员里面包含 class（引用类型）：结构体拷贝后，内部 class 指针依然共享，此时是**浅拷贝**
```swift
struct S {
    var c: C // C 是 class
}
```
结构体拷贝一份 S，但是两个 S 里面的 c 指向同一个 C 实例。

2. **Swift class / OC 对象**
赋值、传参永远只是复制指针，**永远浅拷贝**；想要真正拷贝对象，需要手动实现 `copy()` / `NSCopying`。

---

## 四、应用场景
> ❌ “class 一定比 struct 强大，优先 class”
> Swift 社区规范：**优先 struct，只有明确需要共享状态/继承/deinit 才选 class**。值类型更容易推理代码行为，没有并发下共享可变状态的坑。
### ✅ 什么时候用 struct
**值类型**
官方推荐默认优先选 struct：
1. 用来描述**简单数据模型**：坐标、尺寸、用户信息、配置项、DTO、Model（网络返回数据）
2. 希望数据是独立的，修改副本不影响原始数据
3. 不需要继承、不需要多态
4. 数据小、频繁传递，追求性能（栈分配，无引用计数开销）
5. 遵循协议为主（Equatable、Hashable、Codable）
> 例子：`CGPoint`、`CGSize`、`String`、`Array`、`Dictionary`、`Int`、`Bool` 全部都是 Swift struct！

```swift
struct Article: Codable, Identifiable {
    let id: Int
    var title: String
}
```

### ✅ 什么时候用 class
**引用类型**
1. 需要**共享同一个实例**，多处修改、所有人都看到变更（状态共享）
2. 需要继承、多态、重写方法
3. 生命周期需要手动管理、需要 `deinit` 做资源释放（关闭文件、释放监听）
4. 和 Objective‑C 互操作，需要传给 OC，继承 `NSObject`
5. 控制器、ViewModel、Manager、单例、网络请求管理器这类**有状态的服务对象**

```swift
class AudioPlayer {
    var isPlaying: Bool = false
    func play() {}
    deinit {
        // 释放音频资源
    }
}
```

### ✅ Objective‑C 的局限（对比 Swift）
OC 没有原生值类型：
- 哪怕只是一个简单的点 `CGPoint`，它是 C struct，不是 OC 对象；
- 凡是需要放到集合 `NSArray / NSDictionary` 里，都必须包装成 `NSValue`；
- 所有业务模型只能继承 NSObject，天生引用语义，很容易出现意外的共享修改（副作用）；
- 没有自动 memberwise init，样板代码多；
- Equatable、Hashable 都要自己重写方法。

> 这也是 Swift 引入 struct 值类型的一大初衷：把**纯数据**和**有状态对象**在类型层面分开，减少隐性副作用。

---

## 五、传参语义对比
函数传参：
1. Swift struct：默认是值传递，传入时自动拷贝；如果不想拷贝，可以用 `inout` 实现原地修改
2. Swift class：引用传递（传指针），函数内部修改会影响外部原对象
3. OC 对象：指针传递，和 Swift class 一致

```swift
func modifyStruct(_ s: inout UserStruct) {
    s.name = "xxx"
}
func modifyClass(_ c: UserClass) {
    c.name = "xxx"
}
```

---


