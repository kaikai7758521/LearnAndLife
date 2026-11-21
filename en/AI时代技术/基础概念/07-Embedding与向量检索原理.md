---
title: "Embedding and vector retrieval principle"
lang: en
translatedFrom: 9d1d4d3cea24a3903e0fac91b2a80c005fdf210c18932ab1d3d43e5bc4078c83
translatedAt: 2026-11-21
---

# Embedding and vector retrieval principle
> In one sentence: **Embedding compresses the text into a fixed-dimensional dense vector, turning "semantic similarity" into "spatial proximity"; vector retrieval uses approximate nearest neighbor index to quickly find the ones closest to the query in massive vectors.**
> positioning: It is the recall module of RAG, responsible for "accurate finding"; the quality of generation still depends on LLM and context assembly.

## 1. What exactly does Embedding do?
### 1. From text to vector
```
文本 → Tokenizer 分词 → Transformer 编码 → 池化（CLS / 均值）→ L2 归一化 → 向量 [0.013, -0.204, ...]
```
 - The output is a floating point array of fixed dimensions **and**, common dimensions are 384 / 512 / 768 / 1024 / 1536 / 3072;
The - vector itself has no readable meaning. Each dimension is not a "topic" or "emotion", but a combination of implicit features trained by the model;
- **has similar semantics ≠ Literally similar**: "The computer is broken" and "The laptop cannot be turned on" will be encoded in similar positions, even if there is no common keyword.

### 2. Twin-tower structure and comparative learning
Embedding model is usually **twin towers (bi-encoder)**:
- query tower, document tower shared or symmetrical encoder, **independently encodes**;
- Benefits: The document vector can be **pre-computed** offline, and only the query is encoded online, and only one vector comparison is required, with low complexity;
- Cost: query and doc cannot see each other** in the encoding stage, and the fine-grained matching capability is weaker than that of the cross encoder.

The training goal is contrastive learning (represented by InfoNCE):
1. In a batch, `(query, 正样本)` is paired, and the other documents are negative samples (in-batch negatives);
2. brings the similarity of positive samples closer and pushes the similarity of negative samples farther away, and the temperature coefficient τ controls the sharpness of the distribution;
The key to 3. is that **is difficult to mine negative samples**: random negative samples are too easy, and the model cannot learn the ability to distinguish "semantically similar but irrelevant", which is the source of RAG recall noise.

> This is why **Embedding is responsible for "rough recall", and Rerank is responsible for "fine sorting"**: The twin towers pursue pre-computation speed, and the cross encoder pursues the accuracy of query-doc word-by-word interaction. The two have different divisions of labor.

### 3. Symmetric search vs asymmetric search
| type | query and doc relationship | example | note |
|---|---|---|---|
| Symmetrical | Similar length and shape | "How to reset password" please find "How to reset password" | Ordinary sentence vector model can be used |
| Asymmetric | Short query Find long document | "Refund Policy" Find 3000-word terms | Need a model with **command prefix** |

Many models use command prefixes during training, such as the E5 series requirements:
If the prefix is missed during ```
query: 退款政策
passage: 用户在签收后 7 天内可申请无理由退款……
```
**inference, the effect will be significantly reduced**, and no error will be reported, which is a typical silent failure.

## 2. Similarity measurement
| Metric | Formula Intuition | Characteristics |
|---|---|---|
| **Cosine similarity** | The angle between two vectors | only looks at the direction, not the length, the most commonly used |
| **inner product (dot)** | direction + length | When the vector has been normalized, it is completely equivalent to the cosine **** |
| **Euclidean distance** | Straight line distance | After normalization, it corresponds to cosine monotonic and can be converted to each other |

Project points:
Whether 1. **is normalized before storage, it must be consistent** when querying. If one side is normalized and the other side is not normalized, the scores will drift as a whole, and the Top-K will be directly confused;
2. can directly use the inner product after normalization, saving one division. Vector libraries usually do this by default;
3. Different models have different optimal metrics. Please refer to the description on the model card. Do not default to cosine universal;
4. similarity score **is not comparable across models.**, 0.82 is considered high in model A, but may only be medium in model B. The threshold must be recalibrated according to the model.

## 3. Mainstream models and selection dimensions
### 1. Common series
- **BGE / bge-m3**: Chinese ecology is mature, multi-language and multi-granularity;
- **E5 / multilingual-e5**: The instruction prefix specification is clear and the retrieval task performance is stable;
- **GTE**: Chinese and long text support is better;
- **text-embedding-3 series**: API call is convenient and supports dimension truncation;
- **Jina / Cohere Embed**: Commonly used in long context and multi-language scenarios.

### 2. What to look for when choosing a model
1. **Language and domain**: Chinese scenes give priority to Chinese or multi-language models. If the English model is used directly in Chinese, it will significantly drop points;
2. **Maximum input length**: 512 / 8192 Token The difference is huge. If it exceeds the upper limit, it will be truncated and no error will be reported;
3. **Dimension and cost**: The higher the dimension, the more expensive the storage and retrieval are. 1 million 1536-dimensional float32 ≈ 5.7 GB, not counting index overhead;
4. **MTEB / C-MTEB list**: For reference only, **’s own business query must be used in the end to collect** evaluation;
Does 5. **support Matryoshka (MRL)**: Optimize according to nested dimensions during training, 1024 dimensions can be truncated to 256 dimensions and still retain most of the effects, which can be used to exchange for storage costs;
6. **Deployment form**: API operation and maintenance is free but billed by token and there is network delay; the local model is free but consumes video memory and needs to be expanded and reduced by yourself.

### 3. Hidden costs of model upgrades
Replace Embedding model = **. The entire vector library must be fully reconstructed**:
- The old library is the vector space of model A, and the new query is encoded with model B. The two spaces are not comparable, and the recall is equal to random;
During - , double writing/double indexing is required, or shutdown and reconstruction are required;
- Therefore, the "migration cost of future model changes" should be taken into account when selecting a model, and the original text should be retained in the metadata to facilitate re-runs.

## 4. Vector retrieval: from brute force scanning to ANN
### 1. Why must we use approximate algorithm?
For one million 768-dimensional vectors, a violent comparison requires 768 million floating-point operations, which increases linearly with the amount of data. **ANN (Approximate Nearest Neighbor)** trades a small amount of recall for an order of magnitude speed increase.

### 2. Three types of mainstream indexes
| Index | Principle | Advantages | Disadvantages | Key parameters |
|---|---|---|---|---|
| **HNSW** | Multi-layer navigable small world graph, the upper layer is sparse for coarse jumps, and the bottom layer is dense for fine search | High recall, low latency, industrial default | Large memory usage, slow construction, troublesome deletion | `M` (number of neighbors per layer), `efConstruction` (mapping depth), `efSearch` (query depth) |
| **IVF** | is first clustered into `nlist` clusters, and only the nearest `nprobe` clusters are scanned when querying. | is memory-friendly and suitable for very large scales. | requires training and boundary samples are prone to leakage. | `nlist`, `nprobe` |
| **PQ** | Cut the vector into `m` segments, and use the codebook to quantize each segment into 1 byte | Compression 10~30 times | The accuracy loss is obvious, often combined with IVF to form IVF-PQ | `m`, `nbits` |

Parameter adjustment intuition:
- `efSearch` Turn up → recall rise and delay rise, which are the most commonly used effect/performance knobs;
- `M` Increase the size → the graph is more connected and the recall is better, but the memory and build time increase;
- `nprobe` Turn up → scan more clusters, recall up, slow down;
- **does not have a set of parameters that are universal for**. Real data must be used to measure Recall@K and P99 delays.

### 3. Traps of metadata filtering
Business retrieval often has filter conditions (tenant, time, document type). Two approaches:
- **Post-filter (post-filter)**: First ANN takes Top-K, and then filters according to conditions. Under harsh conditions, only 1 or even 0 items may be left after sifting;
- **Pre-filter (pre-filter)**: Screen the subset first and then search. If the subset is too small, it will destroy the HNSW graph connectivity and degenerate into violent scanning.

The mature solution is **partition index / filtered graph search** (collection by tenant, or using an engine that supports filtered HNSW), rather than forcing it at the application layer.

### 4. Other compression methods
- **float16 / int8 Quantitative**: save 2~4 times of memory, usually only a very small amount of recall is lost;
- **Binary embedding (binary embedding)**: Using Hamming distance, the memory is reduced by 32 times, suitable for two-stage coarse screening + fine sorting;
- **Disk Index (DiskANN)**: The choice when the memory cannot be stored, use SSD to replace the memory.

## 5. How to evaluate search quality
Don’t just look at “I feel like the search is okay”, there should be offline indicators:
1. **Recall@K**: Whether the document with the standard answer appears in the first K items is the most intuitive;
2. **MRR**: The reciprocal mean of the ranking of the first correct result, measuring the quality of the sorting head;
3. **nDCG@K**: Consider multiple related results and hierarchical correlation, suitable for multiple answer scenarios;
4. **End-to-end indicators**: The final answer correct rate/reference hit rate is what the business really cares about.

Method:
- extracts 100~300 queries from real logs and manually annotates the correct documents to form the **gold evaluation set**;
- changes models, changes chunks, and adjusts `efSearch` all run in the same set to avoid adjusting parameters based on feeling;
- simultaneously records the delay of **and the cost of**. An increase in recall rate is often accompanied by an increase in delay, which requires a trade-off.

## 6. Engineering pit list
1. **query and doc must have the same model, the same version, and the same normalization method**. Any inconsistency will cause silent degradation;
2. **Extra long text is truncated without error**: The chunk must be smaller than the maximum input of the model, and the length of the instruction prefix must be reserved;
3. **short query with thin semantics**: "Process?" This type of query vector has extremely low information content and needs to be rewritten or combined with context;
4. **The relationship between negation and quantity is a weakness**: "Food without preservatives" can easily recall the content of "containing preservatives", and the vector is not sensitive to negation;
5. **Domain drift**: The general model performs poorly in medical, legal, and process terms, so models that have been fine-tuned in the field are preferred;
6. **is added to the database repeatedly**: Importing the same document multiple times will occupy Top-K, so duplicates must be removed before being added to the database;
7. **dimensions mixed with**: When vectors of different dimensions are mixed into a collection, most engines will report an error directly, and a few will truncate silently;
8. **Deletion and update**: HNSW deletions are mostly marked deletions. Long-term additions without deletions will lead to index expansion and require regular reconstruction;
9. **similar ≠ related**: The vector only guarantees semantic closeness, but does not guarantee that it can answer the question. This is the fundamental reason why Rerank must be added.

## 7. Common misunderstandings
1. ❌ The higher the dimension, the better: high-dimensional improvement is limited, storage and retrieval costs increase linearly, and MRL truncation is often more cost-effective;
2. ❌ The vector library is a database: it is an index + metadata storage. Transactions, related queries, and strong consistency are not its strengths;
3. ❌ Cosine similarity is always optimal: it is equivalent to the inner product after normalization, and the behavior is different when not normalized, depending on the model training method;
4. ❌ Changing to a stronger Embedding model will definitely increase the value: without rebuilding the index, changing the chunk, or re-labeling the threshold, it is likely to decrease instead;
5. ❌ The recall score can be thresholded across models: the score distribution changes with the model, and the threshold must be recalibrated;
6. ❌ ANN is approximately negligible: if `efSearch` is too low, correct results will be missed steadily and no warning will be given;
7. ❌ Embedding can understand logic: it is good at semantic similarity, but not good at negation, comparison, causality, and numerical reasoning. These rely on Rerank or LLM.

## 8. Division of labor with other aspects of RAG
| Link | Responsibility | Failure performance |
|---|---|---|
| Chunking | Determines the minimum semantic unit for retrieval | Shreds semantics and recalls fragments to answer questions |
| **Embedding + vector search** | Roughly recall candidates from a large number of documents | The correct document did not enter the candidate set at all |
| Rerank | Perform query-doc fine scoring on the candidates | There are correct answers in the candidates but they are ranked behind |
| Context assembly | controls the fragments and order sent to LLM | Noise squeezes the window and the model is disturbed |
| LLM generation | Answer based on evidence | Still fabricating evidence, it is a generation side problem |

> has poor RAG troubleshooting effect. First locate whether **has not recalled** (Embedding/index problem) or **has recalled** (Rerank/Prompt problem). Do not change to a larger model as soon as you start.
