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
   Vector Store
------------------------------ */
let vectorStore;
async function initVectorStore() {
  vectorStore = await PineconeStore.fromExistingIndex(
    embeddings,
    { pineconeIndex }
  );
  console.log("✅ Vector store initialized");
}

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
  model: "gemini-2.5-flash",
  temperature: 0
});

/* ------------------------------
   Helper Functions
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

function cleanTextFormatting(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "") 
    .replace(/<[^>]*>/g, "")                    
    .replace(urlRegex, "")                      
    .replace(/\[Source\s*\d+\]/gi, '')          
    .replace(/\*/g, '')                         
    .replace(/\n\s*\n/g, '\n')                  
    .trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function invokeWithRetry(llm, prompt, retries = 2) { // Reduced retries
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await llm.invoke(prompt);
    } catch (err) {
      if (attempt === retries) throw err;
      
      // If no specific retry time, wait only 2 seconds, not 60
      const waitMs = attempt * 2000; 
      console.log(`⚠️ Attempt ${attempt} failed. Retrying in ${waitMs / 1000}s...`);
      await sleep(waitMs);
    }
  }
}

/* ------------------------------
   RAG Endpoint
------------------------------ */
app.post("/extractRAG", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });

    // --- NEW: INTENT DETECTION ---
    const wantsVideo = /video|youtube|watch|clip|play/i.test(question);
    const wantsImage = /image|photo|picture|look like|show me/i.test(question);
    const wantsLinks = /link|website|linkedin|profile|url/i.test(question);
    // If user didn't specify, we treat it as a general query
    const generalQuery = !wantsVideo && !wantsImage && !wantsLinks;

    /* Step 1: Retrieval */
    const isListQuery = /list|all|show|who are/i.test(question);
  const docs = await vectorStore.maxMarginalRelevanceSearch(question, {
    k: isListQuery ? 15 : 5,      // Reduced from 30/12
    fetchK: isListQuery ? 30 : 20, // Reduced from 50/25
    lambda: 0.8                    // Higher lambda is faster (less diversity checking)
  });

  /* Step 2: Simplified Reranking */
  // Only rerank the top results to save CPU time
  const rankedDocs = docs
    .map(doc => ({ doc, score: keywordScore(doc.pageContent, question) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, isListQuery ? 10 : 5) // Keep context window smaller
    .map(d => d.doc);

    /* Step 3: Prompt Building */
    const context = rankedDocs.map((d, i) => `[Source ${i + 1}]\n${d.pageContent}`).join("\n\n");
    const prompt = `${systemMessage}\n\nContext:\n${context}\n\nQuestion:\n${question}\n\nAnswer:`;

    /* Step 4: Generate Answer */
    const response = await invokeWithRetry(llm, prompt);
    let rawContent = response?.content || "";

    if (rawContent.toLowerCase().includes("don't have enough information")) {
      return res.json({ response: rawContent, images: [], videos: [], links: [] });
    }

    /* Step 5: Media Detection with Intent Filtering */
    let images = [];
    let videos = [];
    let links = [];
    
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const foundUrls = rawContent.match(urlRegex) || [];

    // Filter URLs found in AI text by intent
    foundUrls.forEach(url => {
      if ((wantsVideo || generalQuery) && (url.includes("youtube.com") || url.includes("youtu.be"))) {
        let videoId = url.includes("watch?v=") ? url.split("watch?v=")[1].split("&")[0] : url.split("youtu.be/")[1].split("?")[0];
        videos.push({ url: `https://www.youtube.com/embed/${videoId}`, type: "youtube" });
      } else if ((wantsVideo || generalQuery) && url.match(/\.(mp4|webm|ogg)$/i)) {
        videos.push({ url, type: "file" });
      } else if ((wantsImage || generalQuery) && url.match(/\.(jpg|jpeg|png|webp)$/i)) {
        images.push({ url });
      } else if (wantsLinks || generalQuery) {
        links.push({ url });
      }
    });

    // Detect media from Metadata with strict intent matching
    const answerKeywords = rawContent.toLowerCase().replace(/[^\w\s]/g, "").split(" ").filter(w => w.length > 3);
    
    rankedDocs.forEach(d => {
      const text = d.pageContent.toLowerCase();
      const isRelevantChunk = answerKeywords.some(k => text.includes(k));
      if (!isRelevantChunk) return;

      // Only extract if it matches what the user asked for
      if ((wantsImage || generalQuery) && d.metadata?.image_url?.startsWith("http")) {
        images.push({ url: d.metadata.image_url });
      }

      if ((wantsVideo || generalQuery) && d.metadata?.video_url) {
        let vUrl = d.metadata.video_url;
        if (vUrl.includes("youtube.com") || vUrl.includes("youtu.be")) {
           let id = vUrl.includes("watch?v=") ? vUrl.split("watch?v=")[1].split("&")[0] : vUrl.split("youtu.be/")[1].split("?")[0];
           videos.push({ url: `https://www.youtube.com/embed/${id}`, type: "youtube" });
        } else {
           videos.push({ url: vUrl, type: "file" });
        }
      }

      if ((wantsLinks || generalQuery) && d.metadata?.links) {
        d.metadata.links.forEach(l => links.push({ url: l }));
      }
    });

    // Deduplicate
    images = [...new Map(images.map(i => [i.url, i])).values()];
    videos = [...new Map(videos.map(v => [v.url, v])).values()];
    links = [...new Map(links.map(l => [l.url, l])).values()];

    /* Step 6: Final Clean Response */
    const finalAnswer = cleanTextFormatting(rawContent);

    res.json({
      response: finalAnswer,
      images,
      videos,
      links
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  await initVectorStore();
  app.listen(5000, () => console.log("🚀 RAG API running on port 5000"));
}
startServer();