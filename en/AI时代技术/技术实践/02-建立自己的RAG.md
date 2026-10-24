---
title: "Self-built RAG system"
lang: en
translatedFrom: 24acd896728fb81529d88feb50802ba82f024769eef0a88de54ab1012174f2ee
translatedAt: 2026-10-24
---

# Self-built RAG system
The overall idea of > : **first builds the index offline, and then does Q&A online; Demo gives priority to the smallest available, and then gradually adds the optimization component**

## Pre-cognition
The essence of self-built RAG is to build two pipelines: **offline index pipeline (one-time/incremental update of documents)**, **online question and answer pipeline (executed when users ask questions)**
RAG Demo’s simplest component list (necessary for running the minimum version):
1. document loader: read PDF/md/txt
2. text splitter (Chunker)
3. Embedding model (turn text into vector)
4. vector database (save vector + original text)
5. LLM (to generate answers, you can use the OpenAI/Tongyi Qianwen/LLama local model)
6. calls the glue code (mainly Python, LangChain/LlamaIndex simplifies development, and can also be written natively)

> Important reminder: Demo is usually **Naive RAG**; wait for Naive to run through, then add Query rewrite, BM25, and Rerank to upgrade to Advanced RAG.

---

# Offline stage: building knowledge base index
## Step 1: Prepare original document & document loading
✅ Goal: Extract unstructured files into clean text
✅ Principle: PDF, Word, and Markdown themselves are rich formats, which contain pictures, tables, headers and footers; the loader is responsible for parsing and extracting the plain text stream for subsequent segmentation.
✅ Demo common tools
- Markdown/txt: direct Python reading
- PDF: PyPDF2 (simple), pdfplumber (better, retain table text), Unstructured
✅ Notes & Details
1. ❌ Do not use the scanned PDF directly! Scanned PDFs are images, and text cannot be extracted directly. OCR (pytesseract/PaddleOCR) is required. In the demo stage, try to use only the electronic PDF **that can copy text,**, to reduce the difficulty;
2. filters noise: headers, footers, page numbers, advertisements, repeated titles, blank lines; the noise will turn into chunks, and a large amount of junk will be recalled in subsequent searches;
3. retains metadata: record the document name, page number, and chapter, and do citation tracing later;
The 4. table is a big pitfall: the simple loader often splits the table into scrambled text. Demo can avoid complex tables first.

## Step 2: Text Segmentation Chunking (the most likely part of RAG to overturn)
✅ Goal: Cut extremely long text into small chunks, adapt to the input limit of the Embedding model, and try to ensure the semantic integrity of a single block.
✅ Principle: The Embedding model has a maximum token limit; direct vectorization of the full text will exceed the limit; after segmentation, each block is an independent retrieval unit. Recall chunks during retrieval, not the entire document.
✅ Most commonly used in Demo: **fixed size sliding window splitting** (RecursiveCharacterTextSplitter)
Parameters: `chunk_size` block size, `chunk_overlap` overlap length
✅ Notes & Details
1. chunk_size is not that bigger is better, nor is smaller that is better:
    - is too small: the semantics are broken, the single piece of information is incomplete, and the retrieved fragments lack context.
    - is too large: there are multiple irrelevant topics mixed in, the vector semantics are mixed, and the recall accuracy is reduced.
    - Demo experience value: about 500~1000 tokens in English; 300~600 words recommended in Chinese
2. overlap (overlap) is very critical: avoid a sentence or a knowledge point being cut in the middle of two pieces, and the context is broken; generally set to 10%~20% of chunk_size;
3. fixed segmentation shortcomings: it will cut off the title from the text and paragraphs; this is also the inherent shortcoming of Naive RAG; Advanced RAG will be replaced by semantic segmentation and segmentation by title;
4. gives priority to recursive cutting according to newlines, periods, and semicolons, rather than rough cutting by characters (advantage of recursive splitter).

## Step 3: Embedding Vectorization
✅ Goal: text chunk → dense vector, text vectors with similar semantics are closer
✅ Principle: The Embedding model is a pre-trained text representation model that inputs text and outputs a fixed-dimensional floating point vector; the closer the distance in the vector space = the more similar the semantics; subsequent vector databases rely on distance for similarity retrieval.
✅ Demo selection
- online API: bge, text-embedding, general meaning embedding (simple, no graphics card required)
- local: BGE series (bge-small-zh, Chinese-friendly, recommended for Demo)
✅ Notes & Details
1. **query and document must use the same Embedding model!** Fatal pitfall: The document is encoded with model A, and the user query is encoded with model B. The vector space does not match at all, and the recall completely fails;
2. Embedding also has an input upper limit, and the chunk cannot exceed the maximum context of the embedding model;
Do not use the English embedding model for 3. Chinese, as the representation effect is extremely poor;
4. vector dimensions are fixed, for example, BGE-small-zh has 512 dimensions, and the dimensions cannot be changed randomly when stored in the vector library;
5. cost: Online embedding is charged by token, local model is free but consumes video memory.

## Step 4: Write to vector database and create index
✅ Goal: Store [vector + original chunk text + metadata] and support fast similarity retrieval
✅ Principle: The bottom layer of the vector database is an approximate nearest neighbor search ANN (HNSW and other indexes); violent traversal is too slow, and the ANN sacrifices a little accuracy in exchange for millisecond retrieval of millions of vectors;
✅ Demo recommends lightweight vector library (no need to deploy services separately, embedded)
- Chroma (the simplest, preferred demo)
- FAISS (Meta, fast, purely local, no persistence required)
- Qdrant also has embedded mode
> production generally uses Milvus and Qdrant servers; for demo, do not use heavy services.
✅ Notes & Details
1. persistence: Chroma can be saved to the local disk, and the index will not be lost when the program is restarted; FAISS is only in memory by default, and needs to be manually saved/loaded;
2. index type: Demo can just default to HNSW without adjusting the index parameters;
3. Do not store duplicate chunks: simply remove duplicate chunks before warehousing to avoid repeated recalls;
4. metadata is stored together: file name, page number, and the source can be output later in the answer.

> ✅ Here, the offline phase of **ends**. The document has been turned into a vector index, and there is no need to repeat it in the future (new documents need to be incrementally stored in the database)

---

# Online question and answer stage (the link for users to ask questions will be run again every time they ask questions)
## Step 5: User Query Preprocessing
✅ Goal: Process the user’s original question into a query suitable for retrieval
✅ Principle: User questions are colloquial, short, and ambiguous; simple RAG is directly retrieved; advanced RAG is rewritten, expanded, and HyDEed here.
✅ Naive Demo method: use the original query directly
✅ Notes & Details
1. cleans up redundant symbols, expressions, and irrelevant chatter;
2. multi-round dialogue scenario: historical dialogue summaries must be merged into the query, otherwise the retrieval will lack context when the user asks (Demo can be done in a single round first to simplify);
3. Pitfalls: The questions are very short (such as "Process?") with ambiguous semantics, and vector recall can easily go off track. This is a classic shortcoming of Naive RAG.

## Step 6: Retrieval Retrieval
✅ Goal: Use query vector to find the Top-K most similar chunks in the vector library
✅ Principle: The query is converted into a vector through the same embedding model, the distance is calculated in the vector library, and the K closest fragments are returned.
✅ Demo parameters: Top-K, generally 3~6
✅ Notes & Details
1. Top-K is not that bigger is better: the more recalls, the more noise is stuffed into the LLM context, the token becomes more expensive, and the model is more likely to be interfered with by irrelevant content;
2. similarity ≠ correlation! The vectors are only semantically similar and do not mean that the content can answer the question (this is why Rerank is added later);
3. Naive RAG only has dense vector retrieval here; Advanced adds BM25 keyword retrieval and multi-path recall here.

## Step 7: (optional, generally omitted in Demo) Rerank
> Naive Demo can be skipped, this step belongs to the Advanced RAG optimization item
✅ Principle: The recalled candidate chunks are handed over to the Rerank cross encoder, and `query + chunk` is input for pairwise scoring, reordering, and filtering of low-scoring irrelevant fragments; the Rerank model has a much stronger ability to distinguish correlations than embedding.
✅ Note: Rearrangement will increase delay and additional calling costs; add them after the demo is run through.

## Step 8: Prompt assembly (package the question + retrieval fragment and feed it to LLM)
✅ Goal: Construct constraint Prompt and tell LLM**that it can only answer based on the given reference materials and cannot make up**
✅ Principle: LLM itself does not know external documents. We insert the evidence fragments into the context window and add instruction constraints to achieve grounding.
✅ Demo reference Prompt template
```
你是文档问答助手，请严格根据下面提供的参考材料回答用户问题。
如果参考材料里面没有对应信息，请直接说“知识库中没有找到相关内容”，不要编造、不要自己发挥。
参考材料：
{retrieved_chunks}

用户问题：{user_query}
```
✅ Notes & Details
1. context window upper limit! The total tokens of all chunk+prompt+questions cannot exceed the LLM maximum window; If you recall too much, it will be truncated, and truncation will lose evidence;
The 2. constraint word must be written, otherwise LLM will ignore the material and use its own parameter knowledge to make up random things (illusion);
Add a separator (---) between 3. chunk to facilitate LLM to distinguish different fragments;
4. Don’t fill in dozens of pieces of material at once, as LLM can easily ignore some of them.

## Step 9: LLM generates the answer and returns the result + source
✅ Goal: LLM reads the prompt and outputs the answer; with reference to the source
✅ Principle: Standard autoregressive generation; LLM only does reading comprehension, summarization, and integration here, and no longer relies on training knowledge.
✅ Notes & Details
1. will still hallucinate even if restraints are added! RAG cannot completely eliminate hallucinations;
2. brings metadata (document name, page number) when output for easy verification;
3. can add post-checking: let LLm self-check whether the answer conflicts with the reference material (advanced gameplay, not used in Demo).

---

Recommended # Simplest Demo technology stack (can be written right out of the box)
Python + LangChain + Chroma + BGE Embedding + any LLM
```
# 极简依赖
langchain
langchain-chroma
sentence-transformers  # 本地BGE embedding
pdfplumber
openai / dashscope
```
> Don’t want to deploy local models: directly use LLM online API, Demo development is the fastest.

# Demo development sequence suggestions (pitfall avoidance route)
1. first writes the document loading + text segmentation, prints out the chunk, and checks the segmentation effect with the naked eye (many people jump directly to vector storage, but later find that the chunk segmentation is a mess)
2. tests Embedding alone: input two pieces of text, print the vector, and test whether the similarity is as expected
3. independently tests vector library retrieval: manually write several queries to see if the recalled chunks are correct; **retrieval link is adjusted separately, and then connected to LLM**
    > is super important: 80% of RAG’s problems are caused by recalls, not generated by LLM; many people have changed LLM and the effect is still poor, the root cause is the recall garbage
4. connects to LLM, writes prompt template, and completes the question and answer closed loop
5. Plus evaluation: Take test questions with known answers and see if the recall and answers are correct
6. iterative upgrade: add Rerank, BM25 hybrid search, upgrade Advanced RAG

# High Frequency Pit Cheat Sheet (useful for interviews and practical operations)
1. Embedding model is inconsistent: document uses A, query uses B → recall is completely messed up
2. Chunk is cut too large/too small and has no overlap → the information is broken and the recall is invalid
3. noise is not cleaned (header and footer watermark) → a large number of invalid chunks are stored in the database
4. Prompt has no strong constraints → LLM can play freely without material, causing serious hallucinations
5. Top-K is set too large → noise is injected into the context
6. confuses "semantic similarity" and "factual correlation": vector recall is only similar, not necessarily able to answer the question
7. directly uploads complex and long PDFs with a large number of table images, making it more difficult for yourself in the Demo stage.
8. forgot the metadata, the answer cannot be traced, and I don’t know which document caused the problem.

# Expanded upgrade route (from Naive → Advanced → Modular)
- Naive Demo (current): fixed segmentation, pure vector recall, no rewriting or reranking
- upgrade to Advanced: Add Query Rewrite/HyDE, BM25+ vector hybrid recall, Rerank, parent document retrieval
- upgrade Modular: Add Router Planner to determine whether to search and select different search sources (vector library/database/network search). At this time, it becomes a composite Skill that can be called by the Agent.
