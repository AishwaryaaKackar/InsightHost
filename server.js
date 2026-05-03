import fs from "fs";
import express from "express";
import dotenv from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { PineconeStore } from "@langchain/pinecone";
import cors from "cors";
 
dotenv.config();
 
// Load system prompt
const systemMessage = fs.readFileSync("./system_prompt.md", "utf8");
 
const app = express();
app.use(express.json());
app.use(cors());
 
/* ------------------------------
   Pinecone Setup
------------------------------ */
 
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});
 
const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
 
/* ------------------------------
   Embeddings
------------------------------ */
 
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GOOGLE_API_KEY,
  model: "models/gemini-embedding-2"
});
 
/* ------------------------------
   Vector Store (Initialized Once)
------------------------------ */
 
let vectorStore;
 
async function initVectorStore() {
  vectorStore = await PineconeStore.fromExistingIndex(
    embeddings,
    { pineconeIndex }
  );
  console.log("✅ Vector store initialized");
}
 
/* ------------------------------
   Gemini LLM
------------------------------ */
 
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
  model: "gemini-2.5-flash",
  temperature: 0
});
 
/* ------------------------------
   Hybrid Keyword Scoring
------------------------------ */
 
function keywordScore(text, question) {
  const qWords = question.toLowerCase().split(/\s+/);
  const tWords = text.toLowerCase();
 
  let score = 0;
  qWords.forEach(word => {
    if (tWords.includes(word)) score++;
  });
 
  return score;
}
 
/* ------------------------------
   RAG Endpoint
------------------------------ */
 
 
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
 
// ✅ Retry with backoff — reads the retry delay from the error message itself
async function invokeWithRetry(llm, prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await llm.invoke(prompt);
    } catch (err) {
      const retryMatch = err.message.match(/retry in (\d+(\.\d+)?)s/i);
      const waitMs = retryMatch
        ? Math.ceil(parseFloat(retryMatch[1])) * 1000
        : 60000;
 
      if (attempt === retries) throw err;
 
      console.log(
        `   ⚠️  Rate limited. Retrying in ${waitMs / 1000}s... (attempt ${attempt}/${retries})`,
      );
      await sleep(waitMs);
    }
  }
}
 
async function search(question) {
  try {
    console.log("🔎 Searching Pinecone...\n");
 
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
    });
 
    // Retrieve more chunks from Pinecone
    const results = await vectorStore.similaritySearch(question, 10);
 
    // Rerank chunks using Gemini
    const rankingPrompt = `
    You are ranking document chunks by relevance.
 
    Question:
    ${question}
 
    Chunks:
    ${results.map((r, i) => `[${i}] ${r.pageContent}`).join("\n\n")}
 
    Return ONLY the 3 most relevant chunk numbers separated by commas.
    Example: 0,2,5
    `;
 
    const rankingResponse = await llm.invoke(rankingPrompt);
 
    const rankedIndexes = rankingResponse.content
    .match(/\d+/g)
    ?.map(Number)
    ?.slice(0, 3) || [0, 1, 2];
 
    const topResults = rankedIndexes.map(i => results[i]);
 
    if (!results.length) {
      console.log("❌ No results found.");
      return;
    }
 
    // Build context with numbered source tags
    const context = topResults
    .map(
        (doc, i) =>
        `[Source ${i + 1}: ${doc.metadata?.filename || "Unknown"}]\n${doc.pageContent}`,
    )
    .join("\n\n");
 
    // Build citation reference list
    const citationMap = topResults.map((doc, i) => ({
      id: i + 1,
      filename: doc.metadata?.filename || "Unknown",
      chunk: doc.metadata?.chunk ?? "?",
      excerpt: doc.pageContent.substring(0, 120).replace(/\n/g, " ") + "...",
    }));
 
    const prompt = `You are a helpful assistant. Use ONLY the context below to answer the question.
When you use information from a source, cite it inline using the format [Source N] where N is the source number.
If the answer is not found in the context, say "I don't have enough information to answer that."
 
Context:
${context}
 
Question: ${question}
 
Answer (with inline [Source N] citations):`;
 
    console.log("🤖 Generating consolidated answer...\n");
 
    const response = await invokeWithRetry(llm, prompt);
 
    // Print the answer
    console.log("✅ Answer:");
    console.log("------------------------------------");
    console.log(response.content);
    return response;
 
    // Print the citation reference list
    console.log("\n📚 Citations:");
    console.log("------------------------------------");
    citationMap.forEach((c) => {
      console.log(`[Source ${c.id}] ${c.filename} (chunk ${c.chunk})`);
      console.log(`  └─ "...${c.excerpt}"`);
    });
  } catch (error) {
    if (error.message.includes("Quota exceeded")) {
      console.error(
        "❌ Daily quota exceeded. Please wait until tomorrow or upgrade your Google AI Studio plan at https://ai.google.dev",
      );
    } else {
      console.error("❌ Search error:", error.message);
    }
  }
}
 
function convertMedia(text) {
 
  const urlRegex = /(https?:\/\/[^\s]+)/g;
 
  return text.replace(urlRegex, (url) => {
 
    /* IMAGE */
 
    if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
      return `<img src="${url}" />`;
    }
 
    /* VIDEO FILE */
 
    if (url.match(/\.(mp4|webm|ogg|mov)$/i)) {
      return `<video src="${url}" controls></video>`;
    }
 
    /* YOUTUBE */
 
    if (url.includes("youtube.com/watch") || url.includes("youtu.be/")) {
 
      let videoId = "";
 
      if (url.includes("watch?v=")) {
        videoId = url.split("watch?v=")[1].split("&")[0];
      }
 
      if (url.includes("youtu.be/")) {
        videoId = url.split("youtu.be/")[1].split("?")[0];
      }
 
      if (videoId) {
        return `<iframe width="560" height="315"
          src="https://www.youtube.com/embed/${videoId}"
          frameborder="0"
          allowfullscreen>
        </iframe>`;
      }
 
      return url;
    }
 
    /* NORMAL LINK */
 
    return `<a href="${url}" target="_blank">${url}</a>`;
 
  });
 
}
 
app.post("/extractRAG", async (req, res) => {
 
  try {
    console.log("🔍 Received RAG request", req.body);
    const { question } = req.body;
 
    if (!question) {
      return res.status(400).json({ error: "Question required" });
    }
 
    /* Step 1: Semantic Retrieval (MMR) */
 
    const isListQuery =
    /list|all|show|who are|names|directors|members/i.test(question)

  const docs = await vectorStore.maxMarginalRelevanceSearch(
    question,
    {
      k: isListQuery ? 30 : 12,
      fetchK: isListQuery ? 50 : 25,
      lambda: 0.7
    }
  )
 
    /* Step 2: Hybrid Keyword Reranking */
 
 
    const rankedDocs = docs
    .map(doc => ({
      doc,
      score: keywordScore(doc.pageContent, question)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, isListQuery ? 20 : 6)
    .map(d => d.doc);
 
 
    /* Step 3: Build Context */
 
    // const context = rankedDocs
    //   .map((d, i) => {
 
    //     let media = ""
 
    //     if (d.metadata?.image_url) {
    //       media += "\n" + d.metadata.image_url
    //     }
 
    //     if (d.metadata?.video_url) {
    //       media += "\n" + d.metadata.video_url
    //     }
 
    //     if (d.metadata?.links) {
    //       d.metadata.links.forEach(link => {
    //         media += "\n" + link
    //       })
    //     }
 
        const context = rankedDocs
          .map((d, i) => {
            return `[Source ${i+1}]
        ${d.pageContent}`
          })
          .join("\n\n")
 
    /* Step 4: Build Prompt */
 
    const prompt = `
${systemMessage}
 
Context:
${context}
 
Question:
${question}
 
Answer:
`;
 
    /* Step 5: Generate Answer */
 
//    const response = await llm.invoke(prompt);
const response = await invokeWithRetry(llm, prompt);
 
let cleanText = response?.content || ""
 
cleanText = cleanText.replace(/\[Source\s*\d+\]/gi,'')
cleanText = cleanText.replace(/\*/g,'')
cleanText = cleanText.replace(/\n\s*\n/g,'\n')
cleanText = cleanText.trim()
 
let answer = convertMedia(cleanText)
// Detect person name from answer
let detectedPerson = null

// detect name from QUESTION first
const questionName = question.match(/\b[A-Z][a-z]+\s[A-Z][a-z]+\b/)

if (questionName) {
  detectedPerson = questionName[0].toLowerCase()
} else {
  // fallback to answer
  const answerName = cleanText.match(/\b[A-Z][a-z]+\s[A-Z][a-z]+\b/)
  if (answerName) {
    detectedPerson = answerName[0].toLowerCase()
  }
}
// extract important words from the answer
const answerKeywords = cleanText
  .toLowerCase()
  .replace(/[^\w\s]/g, "")
  .split(" ")
  .filter(w => w.length > 3)
 
// 🚨 If Gemini says no info → remove media
if (cleanText.toLowerCase().includes("don't have enough information")) {
 
  console.log("⚠️ No relevant answer → clearing media")
 
  return res.json({
    response: answer,
    images: [],
    videos: [],
    links: []
  })
 
}
 
    /* Step 6: Unique Sources */
 
    const sources = [...new Set(
      rankedDocs.map(d => d.metadata?.filename || "Unknown")
    )];
    /* collect media */
 
let images = []
let videos = []
let links = []



  const questionWords = question
    .toLowerCase()
    .replace(/[^\w\s]/g,"")
    .split(" ")
    .filter(w => w.length > 3)

  rankedDocs.forEach(d => {

  const text = d.pageContent.toLowerCase()

  const answerMatch = answerKeywords.some(k => text.includes(k))
  const questionMatch = questionWords.some(q => text.includes(q))

  let personMatch = true

  // Only apply person filtering if NOT a list query
  if (detectedPerson && !isListQuery) {
    const nameParts = detectedPerson.split(" ")
personMatch = nameParts.every(n => text.includes(n))
  }

  const relevant = isListQuery
  ? answerMatch
  : answerMatch && questionMatch && personMatch

  if (!relevant) return

  if (d.metadata?.image_url && d.metadata.image_url.startsWith("http")) {
    images.push({ url: d.metadata.image_url })
  }

  if (d.metadata?.video_url) {
    videos.push({ url: d.metadata.video_url })
  }

  if (d.metadata?.links) {
    d.metadata.links.forEach(link => {
      links.push({ url: link })
    })
  }

})

images = [...new Map(images.map(i => [i.url, i])).values()]
videos = [...new Map(videos.map(i => [i.url, i])).values()]
links = [...new Map(links.map(i => [i.url, i])).values()]
 
    console.log("✅ RAG response generated", response);
 
     res.json({
      response: answer,
      images,
      videos,
      links
    });
 
  } catch (error) {
 
    res.status(500).json({
      error: error.message
    });
 
  }
 
});
 
/* ------------------------------
   Start Server
------------------------------ */
 
async function startServer() {
 
  await initVectorStore();
 
  app.listen(5000, () => {
    console.log("🚀 RAG API running on port 5000");
  });
 
}
 
startServer();  