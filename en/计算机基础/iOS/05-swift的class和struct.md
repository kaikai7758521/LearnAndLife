---
title: "Swift struct / class detailed explanation"
lang: en
translatedFrom: 5f75dde2ca777cd129d42f4997f2abc5f9d9d2abb27c3f9b88e230a0b89bac08
translatedAt: 2026-10-26
---

# Swift struct / class detailed explanation

All object **instances in >OC themselves are `objc_object` (structure)**, but **is an object structure** with an isa pointer, which is not the same thing as Swift's `struct`.
The underlying class instance of OC is `struct objc_object { Class isa; }`; but the **class of OC is the reference type**. This structure is just the underlying carrier used by the runtime to carry the object memory layout. **is still the reference type** semantically.

One sentence overview:
- Swift `struct`: **value type (Value Type)**, stack first, copy semantics, no reference counting, no support for inheritance;
- Swift `class`: **reference type (Reference Type)**, heap allocation, reference semantics, ARC reference counting, support for inheritance;
- Objective-C: There is only **reference type (`NSObject` subclass)**, and no native value type; the underlying `objc_object` struct of OC is just a runtime implementation detail, not value semantics.

---

## 1. Core difference table between Swift struct and class
| Comparison items | Swift struct (structure) | Swift class (class) | Objective‑C (NSObject subclass) |
|---|---|---|---|
| type semantics | value type | reference type | reference type |
| Memory allocation | is on the stack first; large structures will escape to the heap when captured into a closure. | must be allocated on the heap. | must be allocated on the heap. |
| Assignment behavior | **copies an independent copy during assignment** | Copies the pointer during assignment, pointing to the same instance | Assignment copies the pointer, pointing to the same object |
| Memory management | No ARC, no reference counting; automatic recycling on the stack | ARC reference counting management | ARC reference counting management |
| Inherits | ❌ Does not support inheritance; protocol can be implemented | ✅ Supports single inheritance + protocol | ✅ Single inheritance + protocol |
| Polymorphism | ❌ No polymorphism | ✅ Support polymorphism, override | ✅ Support polymorphism |
| Destruction | `deinit` ❌ No | `deinit` ✅ Support | `-dealloc` ✅ Support |
| variable | default `let` immutable; `var` variable | `let`: **pointer is immutable, the internal properties of the object can still be changed** | `let` points to the object, and the internal properties can be changed |
| implicit constructor | automatically generates member-by-member constructors | does not automatically generate member constructors and requires handwriting | handwriting init |
| forwards | The copy is a deep shallow copy (members are copied one by one) | shares the same instance | shares the same instance |

> `let s: SomeStruct` → The entire instance of the structure is immutable, and all internal attributes cannot be changed.
> `let c: SomeClass` → You just can’t let c point to other objects, but `c.name = "xxx"` is still legal!

### Example intuitive feeling
#### Struct (value type)
```swift
struct UserStruct {
    var name: String
}
var u1 = UserStruct(name: "A")
var u2 = u1
u2.name = "B"
print(u1.name) // A，互不影响
```

#### Class (reference type)
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

OC equivalent logic:
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

## 2. Underlying memory details (to answer what you mentioned: OC objects are structs)
```c
// objc4 源码简化
struct objc_object {
    Class isa;
};
struct objc_class : objc_object {
    // ... 方法列表、属性、父类等
};
```
✅ The underlying object instance of OC is indeed a C struct.
❌ **But it does not have value semantics!**
The C struct itself is a value type, but the Objective‑C runtime deliberately designed `objc_object` to refer to **using**:
We never write `objc_object a = *obj;` and directly copy the entire object; we always only operate on the pointer `objc_object *`.
> So: **is implemented using struct, and the semantics are reference types. This is where many people easily fall into trap.**

Swift struct is a value type that is directly exposed to you and encourages you to use it by value semantics; it is completely different from the `objc_object` struct underlying OC.

Extra: The underlying runtime of Swift class is now Swift Metadata and no longer reuses ObjC's objc_object (unless inherited from NSObject).
- `class A: NSObject`: The underlying instance is still objc_object, compatible with OC runtime
- `class A` (pure Swift class, does not inherit NSObject): Swift’s own object header, no longer objc_object

---

## 3. Copy behavior: shallow copy / deep copy
1. **Swift struct**
Assignment = **memberwise copy**
- If the members are all value types: equivalent deep copy
- If the member contains class (reference type): After the structure is copied, the internal class pointer is still shared. At this time, it is **shallow copy**
The ```swift
struct S {
    var c: C // C 是 class
}
```
 structure copies a copy of S, but c in both S points to the same C instance.

2. **Swift class / OC object**
Assignment and parameter passing are always just copying pointers, and **always shallowly copies**; if you want to truly copy the object, you need to manually implement `copy()` / `NSCopying`.

---

## 4. Application scenarios
> ❌ "class must be more powerful than struct, class takes precedence"
> Swift community specification: **takes precedence over struct, and class** is chosen only if shared state/inheritance/deinit is clearly needed. Value types make it easier to reason about code behavior, and there are no pitfalls of shared mutable state under concurrency.
### ✅ When to use struct
**value type**
The official recommendation is to give priority to struct by default:
1. is used to describe the **simple data model**: coordinates, dimensions, user information, configuration items, DTO, Model (network return data)
2. hopes that the data is independent and that modifying the copy does not affect the original data
3. does not require inheritance or polymorphism
4. small data, frequent transfer, pursuit of performance (stack allocation, no reference counting overhead)
5. mainly follows the protocol (Equatable, Hashable, Codable)
> Examples: `CGPoint`, `CGSize`, `String`, `Array`, `Dictionary`, `Int`, `Bool` are all Swift structs!

```swift
struct Article: Codable, Identifiable {
    let id: Int
    var title: String
}
```

### ✅ When to use class
**reference type**
1. requires **to share the same instance**, with multiple modifications and everyone can see the changes (state sharing)
2. requires inheritance, polymorphism, and overriding methods
The life cycle of 3. requires manual management, and `deinit` is required to release resources (close files, release monitoring)
4. interoperates with Objective-C, needs to be passed to OC, and inherits `NSObject`
5. Controller, ViewModel, Manager, singleton, network request manager and other **stateful service objects**

```swift
class AudioPlayer {
    var isPlaying: Bool = false
    func play() {}
    deinit {
        // 释放音频资源
    }
}
```

### ✅ Limitations of Objective‑C (vs. Swift)
OC has no native value types:
- Even if it is just a simple point `CGPoint`, it is a C struct, not an OC object;
Anything - that needs to be placed in the collection `NSArray / NSDictionary` must be packaged into `NSValue`;
- All business models can only inherit NSObject, which has inherent reference semantics and is prone to unexpected shared modifications (side effects);
- does not have automatic memberwise init and has a lot of boilerplate code;
- Equatable and Hashable have to rewrite their own methods.

> This is also one of the original intentions of Swift introducing the struct value type: to separate **pure data** and **stateful objects** at the type level to reduce hidden side effects.

---

## 5. Comparison of parameter passing semantics
Function parameters:
1. Swift struct: The default is to pass by value, and it will be automatically copied when passed in; if you don’t want to copy, you can use `inout` to modify it in place
2. Swift class: passing by reference (pointer passing), internal modifications of the function will affect the external original object
3. OC object: pointer passing, consistent with Swift class

```swift
func modifyStruct(_ s: inout UserStruct) {
    s.name = "xxx"
}
func modifyClass(_ c: UserClass) {
    c.name = "xxx"
}
```

---
