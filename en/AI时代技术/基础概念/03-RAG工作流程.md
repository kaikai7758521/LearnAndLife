---
title: "RAG workflow"
lang: en
translatedFrom: 2b8da885a2d4d980a7c3da1feffebc6a8b35ddaf3edd1f65f1a6816d03bf6b35
translatedAt: 2026-10-24
---

# RAG workflow

## Front
> - Naive RAG: Basic Search Tool
> - Advanced RAG: optimized retrieval skill
> - Modular RAG: Composite Skill with internal planning and multi-data source routing, which can be called directly to the Agent
- **Naive RAG (Naive RAG)**: The simplest prototype, only "blocking → vectorization → vector recall → spell prompt", the link is short and easy to use, but the recall quality is unstable.
- **Advanced RAG (enhanced RAG / advanced RAG)**: Add various optimization modules (rearrangement, query rewriting, multi-retrieval fusion, filtering) to the simple RAG. **does not change the main link structure**, but inserts enhancement links into the original pipeline.
- **Modular RAG (modular RAG)**: Split the RAG into a large number of pluggable and routable independent modules, add a scheduler/planner, **dynamically selects the retrieval strategy, retrieval source, and post-processing logic**, and is highly integrated with Agent thinking.

---

# 1. RAG complete workflow (separation line stage + online inference stage)
RAG is divided into two major stages as a whole: **index construction stage (offline, only run once/incremental update)** and **question and answer reasoning stage (online, run once every time the user asks)**

## Stage 1: Offline indexing pipeline (document storage)
```
原始文档 → 文档加载 & 清洗 → 文档切分(Chunking) → 向量化(Embedding) → 写入向量库 + 元数据存储
```
1. **document loading & cleaning**
    Read PDF/Markdown/Word/web pages, etc., extract plain text; remove watermarks, headers and footers, garbled characters, repeated advertisements, and irrelevant comments.
2. **Chunk Chunking (slicing)**
    Cutting long text into small segments is a very critical step in RAG.
    - plain RAG: fixed length cutting (for example, 1000 tokens, overlapping 50 tokens)
    - advanced RAG: semantic chunking, segmentation by title/chapter boundaries, semantic boundary segmentation based on LLM
The purpose of     > is to control the length of a single block, adapt to the input upper limit of the Embedding model, and ensure that the semantics within a block are as complete as possible.
3. **Embedding vectorized**
    Using the Embedding model, text blocks are converted into dense vectors (vectors), and text vectors with similar semantics are closer.
4. **warehoused**
    Vectors are stored in vector databases (Chroma, Milvus, Qdrant, etc.); metadata such as original text chunks, document names, page numbers, and time are also saved.
Many engineering implementations of     > will retain the original text at the same time, and the vector will only be used for similarity retrieval.

In the offline phase of > , **does not call the generative formula LLM**, but only uses the Embedding model.

## Phase 2: Online Q&A pipeline (user questions, core link)
```
用户Query → 查询预处理 → 检索（召回）→ 筛选/重排 → 上下文组装 → LLM生成 → 后校验/溯源输出
```
 is broken down step by step:
1. **Query query preprocessing**
    Process the user's original questions: clean up invalid characters, rewrite, and expand sub-questions.
    - Naive: Search directly with the original sentence
    - Advanced: Query Rewrite (query rewriting), Query Expansion (multiple subqueries generated from multiple perspectives), Hyde (hypothetical document)
2. **Retrieval (Retrieval)**
    Vectorize the processed query and perform similarity Top-K recall in the vector library; it can also be integrated with BM25 keyword retrieval (sparse retrieval).
    Output: a batch of candidate document fragments (candidate set).
3. **Rerank (Advanced RAG iconic module)**
    Among the recalled Top-K, there are still many fragments that are semantically similar but unrelated.
    Rerank models (such as BGE-Reranker, Cohere Rerank) receive [query + candidate chunk] pairwise scoring, reorder, filter low-scoring fragments, and compress the context sent to LLM.
    > simple RAG generally does not rearrange, and directly feeds the vector recall results to LLM.
4. **context prompt assembly**
    Concatenate user questions + filtered reference fragments + constraint instructions (requiring citations, prohibiting fabrication) into Prompt.
5. **LLM generates answer**
    LLM reads the prompt and generates an answer based on the given reference material.
6. **post-check & output**
    Optional: fact checking, hallucination detection, citation annotation, filtering sensitive content, return answer + source link/page number.

---

# 2. Naive RAG / Advanced RAG / Modular RAG detailed comparison
## 1. Naive RAG Simplerag
### Link structure
Offline: fixed block → embedding → vector storage
Online: Direct vectorization of original query → Vector recall TopK → Directly spliced into prompt → LLM output
**No rewriting, no rearrangement, no routing, no multi-retrieval source fusion**

### Features
✅ Advantages
- is the simplest implementation, quick to get started, and has a small amount of code. It is suitable for demos, small knowledge bases, and internal simple document Q&A.
- has low latency, few components, and low operation and maintenance costs.

❌ Disadvantages
- has poor effect on ambiguous queries, complex problems, and cross-document problems.
- vector similarity ≠ factual correlation, easy to recall "semantically similar but unrelated" content
- fixed chunking strategy is easy to cut off semantics and cause context breakage
- has no filtering mechanism, and the noise is directly fed into the LLM, causing hallucinations to occur frequently.

### Typical scenarios
Course demo, small knowledge base (within dozens of documents), and prototypes for verifying ideas.

## 2. Advanced RAG Advanced RAG
> is often called Advanced RAG in the industry, and the **pipeline sequence remains unchanged. The enhancement plug-in** is added to the original node. The overall pipeline is still a linear pipeline without dynamic branch routing.
### Common enhancement components (optional combination)
- Query side: Query Rewrite, Query Expansion, HyDE (Hypothetical Document Embedding, first generate a hypothetical answer and then retrieve it), multiple rounds of query memory
- retrieval side: sparse + dense hybrid retrieval (BM25 + vector), multi-path recall
- post-retrieval side: Rerank rearrangement, deduplication, low-quality chunk filtering, summary compression (Context Compression)
- Chunk side: semantic chunking, hierarchical summary index (Parent-Document Retrieval parent document retrieval)

### Link
Query → Query enhancement → Multi-way recall → Rerank filtering → Compression context → Assembly Prompt → LLM generation

### Features
✅ Advantages
- has very obvious benefits in most enterprise document scenarios, and is the most mainstream solution for industrial implementation.
- is controllable, and modules can be added gradually: first add weight, then add Hyde, then add BM25, the iteration cost is low
- does not require the introduction of complex planning/Agent scheduling, and the cost is controllable

❌ Disadvantages
- **or fixed assembly line**: No matter what the problem is, the same set of search logic is used, one size fits all
    For example, simple questions, complex reasoning questions, and questions that require database query are all forced to use document vector retrieval.
- When the types of questions are very different and need to span different data sources (document library/database/API), the bottleneck is obvious

### Typical scenarios
Enterprise knowledge base customer service, product manual Q&A, legal document retrieval Q&A, most RAG production projects stop at this level.

## 3. Modular RAG Modular RAG
The core idea of > : **splits RAG into a bunch of independent capability modules, adds a Router/Planner scheduler, and uses the large model to determine which modules should be used and in what order to execute**. In essence, RAG moves closer to the Agent.
> Modular RAG = RAG capability set + intelligent route planner
### Pluggable module example
- retrieval module: vector retrieval module, BM25 retrieval module, SQL database query module, web page search module
- Query module: rewrite module, split module, summary module
- post-processing module: rearrangement module, verification module, comparison module
- refuse to answer module: judge that the question is not within the scope of the knowledge base and refuse to answer directly

### Execution process
User Query → Planner/Router (LLM determines the question type)
1. Judgment: Should this question be searched?
2. Judgment: Which search source to use? Vector library / database / Internet search?
3. Judgment: Do you need to split it into multiple sub-questions first and search in parallel?
4. calls the corresponding module to get the result → merge the evidence → generate the answer

> example:
> user asked: "Comparison of the company's revenue in 2025 and 2026, and also list the revenue caliber document description"
> Router planning: ① Call the SQL module to check the revenue data table; ② Call the vector RAG module to check the caliber document; ③ Combine the two pieces of evidence to generate an answer.

### Features
✅ Advantages
- is extremely flexible and automatically matches the most appropriate search method for different types of questions.
- naturally supports heterogeneous data sources: document vector library, structured database, search engine, API
- can avoid the waste and errors caused by "brainless vectorized retrieval of all problems"
- is seamlessly connected to the Agent system: Modular RAG itself can be directly connected to the Agent as a complex Skill

❌ Disadvantages
The complexity of the - system has increased significantly, requiring maintenance of Router prompt words, module routing logic, and failure fallback strategies.
- Router itself will make mistakes: the planning is wrong, the wrong search module is selected, which directly leads to the failure of the answer
- Token consumption and delay are higher, making debugging and evaluation more difficult.

### Typical scenarios
Complex enterprise Q&A (also involving documents + reports + business databases), multi-source knowledge base, and intelligent customer service middle platform.

---

# 3. Comparison table of the three
| Dimensions | Naive RAG | Advanced RAG | Modular RAG |
|---|---|---|---|
| Core architecture | Single linear fixed link | Single linear link + enhanced plug-in | Module pool + Router planning and scheduling, dynamic branching |
| Query processing | Direct retrieval of the original query | Supports rewriting, expansion, and HyDE | The planner decides whether to rewrite and split sub-questions |
| Search method | Dense vector search only | Hybrid search (BM25+vector) multiple recall | Optional search source: vector/BM25/SQL/network search |
| Rerank | Generally not available | Standard for high-frequency use | Optional, the route determines whether to enable |
| Applicable questions | Simple, single document, clear semantics | Most general document questions and answers | Heterogeneous data sources, cross-type complex questions |
| Relationship with Agent | Independent simple search tool | Enhanced version of search Skill | Composite Skill with built-in planning capabilities, blurred boundaries and agents |
| Implementation difficulty | low | medium | high |
| Illusion control | Weak | Strong | Strong, but routing errors introduce new risks |

---

# IV. Supplement
1. Advanced RAG ≠ Modular RAG
Advanced RAG is just **adding buff** to the pipeline, and the process sequence remains unchanged; Modular RAG is **changing the scheduling logic and dynamically selecting the path**.
2. Modular RAG is very close to a lightweight agent
Distinguishing boundaries: Modular RAG's goal is still **retrieval + question and answer**, with a single task goal; the general agent can execute any Tool and span multiple types of tasks (reading and writing files, sending emails, encoding, and retrieval).
3. is not the more advanced the better
For many internal knowledge bases, an Advanced RAG (vector + BM25 + Rerank) is stable enough; blindly using Modular will only increase operation and maintenance costs.
