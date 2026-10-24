---
title: "RAG technology and its principles"
lang: en
translatedFrom: fa1c851598c9c41c3be92609c94aba651e39a35f03ccda6d0a97e166f09e3495
translatedAt: 2026-10-24
---

# RAG technology and its principles
The key point of the sentence before > : **RAG is not an independent large model, it is a set of "retrieval + LLM" application architecture; LLM is the brain responsible for generation, and RAG plugs into this brain a knowledge base** that can be updated at any time.
> can be linked with the previous Agent note: RAG is often encapsulated into a Skill of Agent.

## 1. Basic definitions and principles
### Ordinary LLM (native large language model)
**defines**: a generative model that has undergone massive text pre-training and weight solidification. All knowledge is encoded in the model parameters (weights). This part of knowledge is also called **parameterized knowledge (Parametric Memory)**.
**Workflow**
The user asks a question → the model reads the conversation history in the context window → relies on the parameter knowledge learned during the training phase and autoregressively outputs the answer.
- It doesn't know about "external documents"; it only knows about the text distribution it saw during training.
- knowledge is frozen at the **training deadline**. It has no natural knowledge of new things that happen after the deadline and your private documents.
- 's answer is generated probabilistically, with priority given to ensuring fluency, but not necessarily correct facts. This is the source of the illusion.

### RAG (Retrieval-Augmented Generation, retrieval enhanced generation)
**defines**: before LLM is generated, add an independent search link, pull relevant fragments from the external knowledge base, stuff the fragments and user questions into Prompt, and let LLM**write the answer** based on the retrieved evidence; knowledge source = parameter knowledge + external non-parametric knowledge base (Non-parametric Memory).
**two major stages**
1. **Offline indexing stage (preparing knowledge base)**
Document parsing → Text chunking (Chunk) → Embedding vectorization → Store in vector library (can also be used with BM25 keyword search) to establish a searchable index.
2. **Online question and answer stage (during reasoning)**
User questions → Question vectorization → Search Top-K related fragments in the vector library → Assemble [user questions + search fragments] into an enhanced Prompt and feed it to LLM → LLM outputs answers based on the given reference materials, and supports annotation of citation sources.

> popular analogy:
> - Pure LLM: Closed book exam, all based on what you have trained to remember in your mind. It is easy to make up if you can’t remember.
> - RAG: Open book exam. When you get the question, you first read the designated reference book, and then write the answer according to the content in the book.

## 2. Comparison of core dimensions
| Comparison dimension | Ordinary LLM (no RAG) |RAG System (retrieval enhanced LLM) |
|---|---|---|
| knowledge storage location | All in model weight (within parameters) | weight + external vector knowledge base (separated) |
|Knowledge timeliness is fixed. It is stuck on the training deadline and new information cannot be perceived. | Add, modify, and delete documents at any time. Knowledge can be updated in real time without retraining the model. |
| Private data support
The risk of hallucinations | is high, and it is easy to make up facts in unknown areas. | is significantly reduced, but **cannot be completely eliminated.** (the wrong material is retrieved, and the model will still hallucinate despite the material) |
|It is difficult to trace the answer to |. The source of the material cannot be given. | can output quotation fragments, document links, page numbers, and can be verified and audited. |
| The cost of modifying knowledge | is extremely high. Changing facts usually requires fine-tuning/retraining. The cost is expensive and the cycle is long. | is very low. You can directly update the knowledge base document without changing the model weights |
| The upper limit of context | is limited by the model’s native context window | Theoretically the knowledge base can be infinite; however, **’s single retrieval fragment sent to LLM is still limited by the window**|
| is good at tasks |General creation, logical reasoning, translation, brainstorming, open dialogue |Enterprise Q&A, document Q&A, knowledge base customer service, regulations/manual query, factual Q&A|
| Additional components | only requires LLM services |Embedding model, vector database, retriever, chunking/cleaning link, reorderer (advanced RAG) |
| delay & cost | is simple, single-round LLM call | is higher, with more vector retrieval and Embedding calls, the token consumption is greater |

## 3. Their respective advantages and shortcomings
### ✅ Ordinary LLM
Advantages:
1. is simple to deploy, has short links and low latency;
2. emphasizes generalization, creativity, abstract reasoning, and multiple rounds of free dialogue;
3. does not rely on external documents and is suitable for open-ended and creative tasks.

Shortcomings:
1. knowledge is outdated;
2. lack of private content and knowledge in niche fields;
3. Factual questions have serious hallucinations and the answers are not traceable;
The cost of updating 4. is huge, and there is a risk of forgetting fine-tuning.

### ✅ RAG
Advantages:
1. knowledge is decoupled, documents can be updated at any time, and maintenance is low-cost;
2. can access private, confidential, and internal business data;
3. fact-based answers are more controllable, support reference tracing, and facilitate auditing;
4. does not require frequent fine-tuning of large models and is suitable for enterprise implementation.

Shortcomings:
1. relies on retrieval quality: recall is inaccurate, irrelevant junk fragments are recalled, and answers are directly wrong (a typical failure of RAG is called "retrieval pollution");
2. increases system complexity: vector library, blocking strategy, rearrangement, and deduplication need to be maintained;
3. cannot improve the underlying reasoning capabilities of the model itself, and complex mathematics and long-chain logic still rely on LLM itself;
4. window bottleneck: the reference materials that can be fed into the model at one time are limited, and extremely long documents require complex routing.

## 4. Misunderstandings
1. ❌ Myth: RAG is a new model
✅ Correct answer: RAG is an architectural paradigm, and LLM is still used at the bottom layer; you can connect the same LLM to RAG, or use it directly naked.
2. ❌ Myth: RAG can completely eliminate hallucinations
✅ Correct answer: RAG is **grounded (grounded)** method, which greatly reduces factual hallucinations; however, if wrong documents are retrieved, the model is forcibly used, and Prompt constraints are weak, hallucinations will still occur.
3. ❌ Myth: With RAG, there is no need for fine-tuning
✅ Correct answer: The two are complementary. RAG is suitable for dynamic facts and external data; fine-tuning is suitable for letting the model learn fixed formats, fixed styles, and domain language.
4. ❌ Misunderstanding: RAG=vector search
✅ Correct answer: Vector retrieval is only one module of RAG; the complete RAG includes a complete link of data cleaning, chunking, embedding, recall, rearrangement, prompt assembly, and generation and verification.

## 5. Linkage with the Agent system
RAG is often encapsulated into a **Skill** for Agent to use:
Agent receives user requirements → determines the need to check the knowledge base → calls RAG Skill (performs search + obtains reference materials) → then continues planning based on the materials, calls other Tools, and outputs results.
> distinction:
> - Naked LLM: Simple dialogue generation
> -RAG: document retrieval enhanced question answering system
> - Agent: an autonomous agent with cycle planning and Tool/Skill scheduling. RAG is an optional capability unit.

## 6. Simple selection reference
- Writing, brainstorming, translation, free chat, general reasoning → directly use ordinary LLM
- Check company policies, product manuals, historical work orders, papers, private documents, factual questions and answers that require citing sources → RAG priority

## 7. The difference between Naive RAG / Advanced RAG / Modular RAG
- **Naive RAG (Naive RAG)**: The simplest prototype, only "blocking→vectorization→vector recall→prompt", the link is short and easy to use, but the recall quality is unstable.
- **Advanced RAG (enhanced RAG / advanced RAG)**: Add various optimization modules (rearrangement, query rewriting, multi-retrieval fusion, filtering) to the simple RAG. **does not change the main link structure**, but inserts enhancement links in the original pipeline.
- **Modular RAG (modular RAG)**: Split the RAG into a large number of pluggable and routable independent modules, add a scheduler/planner, **dynamically selects the retrieval strategy, retrieval source, and post-processing logic**, and is highly integrated with Agent thinking.
