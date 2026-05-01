# InsightHost RAG System (LangChain + Gemini + Pinecone)

This project implements a **Retrieval Augmented Generation (RAG) pipeline** using **LangChain (JavaScript), Google Gemini embeddings, and Pinecone vector database**.

The system ingests documents (including **PDFs with OCR support**), generates vector embeddings, stores them in Pinecone, and retrieves relevant information to answer user questions using a **Gemini LLM-powered REST API**.

---

# Key Features

* Document ingestion into Pinecone
* PDF text extraction
* OCR support for image-based PDFs
* Text chunking using LangChain
* Gemini embeddings for vector generation
* Semantic vector search using Pinecone
* **MMR retrieval for better context diversity**
* **Hybrid retrieval (semantic + keyword ranking)**
* REST API for question answering
* Context-grounded answers using system prompts
* Source citations for retrieved content
* Duplicate-safe ingestion
* Support for multiple documents
* Fast vector store initialization

---

# Project Structure

```
insighthost_1
│
├── ingestGoogle.js        # Document ingestion pipeline
├── server.js              # REST API for RAG queries
├── system_prompt.md       # System prompt for grounded responses
│
├── package.json
├── .env                   # API keys (not committed)
│
└── documents
    ├── Accion Labs Innovation Summit 2026 Synopsis.pdf
    └── other_documents.pdf
```

---

# Technologies Used

* LangChain (JavaScript)
* Google Gemini API
* Pinecone Vector Database
* Node.js
* Express.js
* PDF.js (PDF parsing)
* Tesseract.js (OCR for scanned PDFs)
* Sharp (image preprocessing for OCR)

---

# Setup

## 1 Install Dependencies

```
npm install
```

For OCR support:

```
npm install pdfjs-dist tesseract.js sharp
```

---

# Environment Variables

Create a `.env` file in the root directory.

```
GOOGLE_API_KEY=your_google_ai_key
PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX_NAME=your_index_name
```

---

# Document Ingestion

Run the ingestion script:

```
node ingestGoogle.js
```

The ingestion pipeline performs:

1. Reads files from the `documents/` folder
2. Extracts text from PDFs
3. Runs OCR for image-based pages
4. Splits text into chunks
5. Generates Gemini embeddings
6. Uploads vectors to Pinecone

Example output:

```
📂 Found 1 files
📄 Reading Accion Labs Innovation Summit 2026 Synopsis.pdf
📑 PDF has 37 pages
🚀 Uploading 125 chunks in batches...
```

---

# Start the RAG API

Run the REST API server:

```
node server.js
```

Server will start at:

```
http://localhost:3000
```

---

# Query the System

Send a POST request:

```
POST http://localhost:3000/extractRAG
```

Request body:

```
{
  "question": "What are the four risks discussed in the summit?"
}
```

Example response:

```
{
  "answer": "The summit discusses four key risks related to enterprise AI adoption including governance challenges, scaling limitations, security risks, and workforce readiness. [Source 1]",
  "sources": [
    "Accion Labs Innovation Summit 2026 Synopsis.pdf"
  ]
}
```

---

# System Architecture

```
Documents (PDF / TXT)
        ↓
Text Extraction + OCR
        ↓
Chunking (LangChain)
        ↓
Gemini Embeddings
        ↓
Pinecone Vector Database
        ↓
MMR Retrieval
        ↓
Hybrid Reranking
        ↓
Gemini LLM
        ↓
Answer + Citations
```

---

# Chunking Strategy

Documents are split using:

```
chunkSize: 800
chunkOverlap: 150
```

Benefits:

* Preserves contextual continuity
* Improves retrieval accuracy
* Reduces semantic fragmentation

---

# Duplicate Handling

The ingestion pipeline generates deterministic vector IDs:

```
filename-chunkNumber-lastModified
```

This ensures:

* Re-ingesting the same document **updates vectors**
* Duplicate vectors are **not created**
* Updated documents **replace older versions**

---

# Retrieval Improvements

The system uses multiple retrieval optimizations:

### MMR Retrieval

Ensures diverse and relevant chunks are selected.

### Hybrid Reranking

Combines semantic similarity and keyword matching.

### Context Grounding

System prompts ensure answers use only retrieved document content.

---

# Future Improvements

Potential enhancements:

* Query rewriting for better retrieval
* Streaming responses
* Web interface for querying
* Multi-document filtering
* Hybrid vector + BM25 search
* Response caching for faster queries

---

# Author

**Vijay Kumar**

AI / ML Engineer
LangChain • RAG • Vector Databases • LLM Systems
