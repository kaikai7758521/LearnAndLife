# MVVM 架构
> 前置约定：MVVM = Model - View - ViewModel。
> SwiftUI 天然就是 MVVM 范式，依靠 `@Observable` / `@StateObject` 这类响应式能力，是理解 MVVM 最好的载体。
> 重要前提：**SwiftUI 的 View 本质是声明式的视图描述结构体，不是 UI 控件对象**，这点和 UIKit / WPF 的 View 有本质区别，后面例子会体现。

## 一、MVVM 各分层精确职责（细节）
### 1. Model
Model 代表**领域数据和纯粹业务规则**，是整个架构里最底层、最稳定的一层。
✅ 职责边界：
- 存储原始数据实体（结构体、数据模型）
- 封装数据校验、数据转换、持久化、网络请求逻辑
- **完全不感知 View、ViewModel 的存在**，不持有任何 UI 相关引用
- 只关心“数据是什么、数据怎么来、数据怎么校验”，不关心数据给谁展示、怎么展示
- Model 是可跨层、跨模块复用的纯数据和业务实体

❌ Model 不做：
UI 格式化、页面状态控制、按钮点击响应、弹窗开关。

> 举例：User 模型，只有 id、name、email；登录接口请求函数，密码校验规则。

### 2. View
在 SwiftUI 里 View 是**声明式视图描述**。
✅ 职责边界：
- 唯一工作：描述页面长什么样、布局、颜色、控件排列
- 从 ViewModel 读取状态进行渲染；把用户交互事件转发给 ViewModel
- View 只依赖 ViewModel，**禁止直接访问 Model**
- View 尽量薄，不要写业务逻辑、数据计算、网络请求
- View 是被动的：ViewModel 数据一变，View 自动刷新

❌ View 不做：
业务判断、接口调用、复杂数据格式化、状态计算。

> 核心：View 是“UI 的声明”，不是控制器。

### 3. ViewModel（核心层，视图模型）
ViewModel 是 Model 和 View 之间的适配与中介，是 MVVM 的灵魂。
✅ 职责边界：
1. 持有 Model，从 Model 获取原始数据；
2. 把原始 Model 数据**加工成适合 View 展示的 UI 状态**（格式化日期、拼接文本、计算标记、开关状态、加载态、错误提示）；
3. 对外暴露**可被 View 监听的响应式状态**；
4. 对外暴露 View 可以调用的动作（函数：登录、刷新、提交）；
5. ViewModel **不持有 View，不知道 View 的存在**，没有对任何 UI 控件的引用；
6. 所有和页面相关的业务逻辑、交互逻辑都写在这里；
7. 可以脱离 View 单独做单元测试。

> 关键点区分：
> Model：业务原始数据
> ViewModel：面向这个页面的**UI状态 + 交互行为**

> 双向绑定理解（SwiftUI 视角）
> SwiftUI 没有传统意义上 WPF 的双向绑定语法糖，但是 `@Binding` + 响应式数据流构成了 MVVM 的绑定关系：
> View 读取 VM 的状态渲染；View 的输入修改通过绑定回写到 VM；VM 变化自动驱动 View 刷新。
> 本质依然是：**ViewModel 作为唯一可信数据源**。

---

## 二、SwiftUI 完整 MVVM 示例（Swift 5.9+，@Observable 新版）
需求：做一个简单用户信息页面，可以加载用户信息、修改用户名、保存。
分层严格分开：Model / ViewModel / View

```swift
import SwiftUI

// MARK: - Model
/// 领域模型：纯数据，和UI无关
struct User: Identifiable {
    let id: UUID
    var name: String
    var email: String
}

/// Model 服务：负责网络/数据获取（属于Model层能力）
class UserRepository {
    // 模拟网络请求
    func fetchUser() async throws -> User {
        try await Task.sleep(nanoseconds: 1_000_000_000)
        return User(id: UUID(), name: "小明", email: "xiaoming@example.com")
    }
    
    // 模拟保存
    func saveUser(_ user: User) async throws {
        try await Task.sleep(nanoseconds: 800_000_000)
    }
}

// MARK: - ViewModel
/// 视图模型：面向当前页面的UI状态与行为
@Observable
class UserViewModel {
    // 依赖 Model 服务
    private let repo = UserRepository()
    
    // UI状态：给View监听
    var user: User?
    var isLoading: Bool = false
    var errorMsg: String?
    
    // 供View调用的动作
    func loadUser() async {
        isLoading = true
        errorMsg = nil
        do {
            user = try await repo.fetchUser()
        } catch {
            errorMsg = "加载失败：\(error.localizedDescription)"
        }
        isLoading = false
    }
    
    func save() async {
        guard let user else { return }
        isLoading = true
        errorMsg = nil
        do {
            try await repo.saveUser(user)
            errorMsg = "保存成功"
        } catch {
            errorMsg = "保存失败：\(error.localizedDescription)"
        }
        isLoading = false
    }
}

// MARK: - View
/// 视图层：只负责声明UI，转发交互
struct UserView: View {
    @StateObject private var vm = UserViewModel()
    
    var body: some View {
        Form {
            if vm.isLoading {
                ProgressView("加载中...")
            } else if let err = vm.errorMsg {
                Text(err)
                    .foregroundColor(.red)
            } else if let user = vm.user {
                TextField("用户名", text: $vm.user.name)
                Text(user.email)
                    .foregroundColor(.secondary)
                
                Button("保存") {
                    Task { await vm.save() }
                }
            }
        }
        .onAppear {
            Task { await vm.loadUser() }
        }
    }
}

#Preview {
    UserView()
}
```

### 示例重点解读
1. `@Observable` 让 ViewModel 具备响应式能力，属性变化自动通知依赖它的 View 刷新；
2. View `UserView` 只持有 ViewModel，不直接碰 `UserRepository`；
3. 所有异步、加载逻辑、错误处理都在 ViewModel；
4. View 里面只有布局、控件、绑定；
5. 单元测试的时候，可以直接实例化 `UserViewModel`，调用 `loadUser()`，不需要启动 SwiftUI 视图。

> 小提示：如果你用旧版 SwiftUI（iOS16及以下），把 `@Observable` 替换成 `ObservableObject` + `@Published`。

---

## 三、MVVM 的演化路径（从 MVC → MVP → MVVM）
理清演化链条，就能理解 MVVM 解决了前面架构的痛点：
### 1. MVC（Model-View-Controller）最早版本
经典后端 MVC 移植到客户端。
- Controller 作为中间人；View 可以感知 Model
**痛点（UIKit 典型问题）**：
Controller 不断膨胀，变成“大泥球”，俗称 Massive View Controller。业务逻辑、UI逻辑、数据逻辑全部堆在 Controller，极难测试。

### 2. MVP（Model-View-Presenter）为了解决 MVC 臃肿诞生
目标：隔离 View 和 Model
- Presenter 中间层；View 持有 Presenter；Presenter 持有 View 的协议（ViewProtocol）
- 数据流单向：View 事件交给 Presenter → Presenter 操作 Model → Presenter 回调 View 更新UI
**痛点**：
Presenter 需要手动调用 View 的协议方法刷新界面，大量样板回调代码；页面交互多的时候，更新回调满天飞。

### 3. MVVM 诞生（微软 WPF 平台最先提出）
微软在 WPF 框架中引入 MVVM，核心创新：**用框架内置的响应式绑定机制，消除手动刷新回调**。
- 去掉 Presenter 里对 View 的协议引用；ViewModel 不再持有 View；
- 框架提供绑定系统：ViewModel 状态变更自动驱动 View；
- 交互输入自动回流到 ViewModel；
- 不再需要手动写 `view.updateData()`；
- 这就是 MVVM 和 MVP 最本质分水岭：**Presenter 知道 View；ViewModel 不知道 View**。

后续：前端 Vue、Android DataBinding / Compose、SwiftUI、Flutter GetX 都吸收这套思想，MVVM 成为声明式UI框架标配架构。

演化一句话总结：
> MVC：Controller 太胖；
> MVP：Presenter 要手动回调 View；
> MVVM：利用响应式绑定自动同步状态，ViewModel 完全解耦于 View。

---

## 四、MVVM 的核心特点
1. **关注点彻底分离**
Model：领域数据；ViewModel：UI状态与交互逻辑；View：UI声明。各司其职，边界清晰。

2. **ViewModel 无 UI 依赖（核心优势）**
ViewModel 不 import UIKit / SwiftUI（理想设计），没有任何 UI 对象引用，纯逻辑层，天然支持单元测试。

3. **响应式驱动，状态单一可信源**
页面状态收敛在 ViewModel 中，View 是状态的投射。避免状态散落在 View 的各种 `@State` 里造成状态不同步。

4. **视图可组合、ViewModel 可复用**
同一个 ViewModel，可以供给多个不同的 View；同一个 View，替换 ViewModel 就可以切换业务。例如：详情页、弹窗预览页，可以共用一套 ViewModel。

5. **数据流清晰**
标准单向思想（SwiftUI 主流写法）：
用户操作 → View 触发 VM 方法 → VM 修改自身状态 → 响应式系统自动刷新 View
> 注意：很多人混淆双向绑定，SwiftUI 推荐以单向数据流为主，Binding 只是语法糖，不要滥用双向绑定。

6. **缺点（客观特点）**
- 简单页面会增加样板代码，需要额外创建 ViewModel；
- 响应式系统有一定开销；
- 如果设计失控，ViewModel 也会膨胀成 Massive ViewModel；
- 对开发者有要求：需要分清哪些属于 Model，哪些属于 UI 状态（很多人把UI字段塞进Model）。

---

## 五、MVVM 的应用场景
### ✅ 非常适合 MVVM
1. **声明式 UI 框架项目**：SwiftUI、Jetpack Compose、Vue、React（React 很多是变种MVVM）、Flutter（GetX），框架原生支持响应式，成本最低。
2. **表单类页面**：大量输入框、联动选择、校验、提交、加载、错误状态。绑定可以极大减少同步代码。
3. **富交互页面**：列表筛选、搜索实时联想、多 Tab、弹窗、加载/空态/错误多状态切换。
4. **需要单元测试的业务模块**：核心业务逻辑要写自动化测试，ViewModel 脱离UI可测是巨大优势。
5. **多人长期迭代的中大型客户端项目**：分层规范便于团队协作、代码Review、模块拆分。
6. **同一份业务数据多形态展示**：比如商品数据，商品卡片、详情页、分享预览，复用同一个ViewModel。

### ⚠️ 不太适合 MVVM
1. 极简单静态展示页面，几乎无交互，只为展示一段文字图片；搭建 VM 属于过度设计。
2. 强动画、底层视图渲染重度代码（Metal、自定义渲染管线），核心逻辑本身就是View渲染逻辑，强行拆分收益很低。
3. 超小型Demo、一次性脚本页面，追求最快开发速度。

---
