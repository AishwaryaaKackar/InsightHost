import React, { useState, useEffect, useRef } from 'react';

const BrightSoftwareHost = () => {
  const [status, setStatus] = useState('SYSTEM_OFFLINE');
  const [chat, setChat] = useState([]);
  const [interimText, setInterimText] = useState('');
  const [isWaked, setIsWaked] = useState(false); 
  // 🔥 Logic fix: track media state
  const [mediaActive, setMediaActive] = useState(false);

  const recognitionRef = useRef(null);
  const isActiveRef = useRef(false);
  const isConversingRef = useRef(false); 
  const isAISpeakingRef = useRef(false);
  const mediaActiveRef = useRef(false); // Ref for immediate sync
  const synthRef = window.speechSynthesis || {
    getVoices: () => [],
    speak: () => {},
    cancel: () => {}
  };
  const chatEndRef = useRef(null);
  const currentUtteranceRef = useRef(null);
  const ACCION_RED = "#E31E24";
  const GLOW_CYAN = "#00FFFF";
  const GLOW_BLUE = "#3B82F6";
  const cleanResponseText = (text = "") => text
    .replace(/\s*\[Source\s*\d+\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const CATEGORY_DATA = [
  { 
    name: 'Our services', 
  },
  { 
    name: 'our global talent base', 
  },
  { 
    name: 'our solutions accelerators and services',  
  },
  { 
    name: 'talent at accion',  
  },
  {
    name : 'awards',
  },
  {
    name : 'partnerships and alliances',
  }
];
  const isChatVisible = chat.length > 0 || interimText.length > 0;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, interimText]);

  useEffect(() => {
    const loadVoices = () => { synthRef.getVoices(); };
    loadVoices();
    if (synthRef.onvoiceschanged !== undefined) {
      synthRef.onvoiceschanged = loadVoices;
    }
  }, []);

  // 🔥 Updated safeStart to check for media
  const safeStart = () => {
    if (!recognitionRef.current || !isActiveRef.current || isAISpeakingRef.current || mediaActiveRef.current) return;
    try { recognitionRef.current.start(); } catch (e) {}
  };

  // 🔥 Helper to toggle mic when video plays/pauses
  const toggleMediaMic = (isActive) => {
    mediaActiveRef.current = isActive;
    setMediaActive(isActive);
    if (isActive) {
      recognitionRef.current?.stop();
      setStatus('VIDEO PLAYING (MIC MUTED)');
    } else {
      setStatus(isConversingRef.current ? 'LISTENING' : 'STANDBY (Say Namaste)');
      setTimeout(safeStart, 300);
    }
  };

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || !isWaked) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true; 
    recognition.interimResults = true;
    
    recognition.onstart = () => {
      if (!mediaActiveRef.current) {
        setStatus(isConversingRef.current ? 'LISTENING' : 'STANDBY (Say Namaste)');
      }
    };

    recognition.onresult = (e) => {
      // 🔥 Safety: Ignore results if media is active
      if (isAISpeakingRef.current || mediaActiveRef.current) return;

      let final = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }

      const lowerFinal = final.toLowerCase().trim();

      if (!isConversingRef.current) {
        if (lowerFinal.includes("namaste")) {
          isConversingRef.current = true;
          setStatus('LISTENING');
          speak("Welcome to Accion Experience Center, how can I help you today?");
          setInterimText('');
        }
      } else {
        if (lowerFinal.includes("stop") || lowerFinal.includes("pause") || lowerFinal.includes("go to sleep")) {
          const videos = document.querySelectorAll('video');
          videos.forEach(v => v.pause());
          toggleMediaMic(false); // Unlock mic if stopped by voice

          isConversingRef.current = false;
          setInterimText('');
          setStatus('STANDBY (Say Namaste)');
          speak("Understood. I'll be here if you need me. Just say Namaste to wake me up.");
          return;
        }
        setInterimText(interim);
        if (final.trim()) handleTurn(final);
      }
    };

    recognition.onend = () => {
      if (isActiveRef.current && !isAISpeakingRef.current && !mediaActiveRef.current) {
        safeStart();
      }
    };

    recognition.onerror = () => { if (isActiveRef.current && !mediaActiveRef.current) safeStart(); };
    recognitionRef.current = recognition;
    safeStart();

    return () => {
      isActiveRef.current = false;
      recognition.stop();
    };
  }, [isWaked]);

  const handleTurn = async (text, localMedia = null) => {
  console.log("🎤 USER SAID:", text);
  console.log("🟡 Starting handleTurn");
  isAISpeakingRef.current = true;
  recognitionRef.current?.stop();
  console.log("🛑 Recognition stopped");

  setStatus('PROCESSING...');
  console.log("🟡 Status set to PROCESSING");
  setInterimText('');

  // 1. Add the User's message to chat
  setChat(prev => [
    ...prev,
    {
      role: 'user',
      content: text
    }
  ]);

  try {
    // 2. SHORT-CIRCUIT: If we already have the media (from a Tile click)
    if (localMedia && (localMedia.url || localMedia.video)) {
      const botMessage = {
        role: 'assistant',
        content: "Here is the information you requested.", 
        images: localMedia.url ? [{ url: localMedia.url }] : [],
        videos: localMedia.video ? [{ url: localMedia.video }] : [],
        links: []
      };

      setChat(prev => [...prev, botMessage]);
      speak(botMessage.content); 
      return; // 🔥 Exit here, do not call backend
    }

    // 3. BACKEND FALLBACK: Only runs if no localMedia is provided (Voice commands)
    let botMessage = { role: "assistant", content: "", images: [], videos: [], links: [] };
      const res = await fetch(`http://localhost:5000/extractRAG`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text })
      });
      const data = await res.json();
      console.log("📦 Parsed response:", data);
      botMessage.content = cleanResponseText(data.response || "");
      botMessage.images = data.images || [];
      botMessage.videos = data.videos || [];
      botMessage.links = data.links || [];
    
    setChat(prev => [...prev, botMessage]);
    if (botMessage.content) speak(botMessage.content);

  } catch (err) {
    console.error(err);
    speak("Connection interrupted.");
  }
};

  const speak = (text) => {

  window.speechSynthesis.cancel();
  isAISpeakingRef.current = true;
  recognitionRef.current?.stop();
  setStatus('Speaking...');
  const voices = synthRef.getVoices();
  const selectedVoice =
    voices.find(v => v.name === 'Google US English' && !v.name.includes('Online')) ||
    voices.find(v => v.name.includes('Microsoft Aria')) ||
    voices[0];
  // 🔥 Split into chunks
const chunks = text.match(/.{1,220}(\s|$)/g);// 120 chars per chunk
  let index = 0;
  const speakChunk = () => {

    if (index >= chunks.length) {

      isAISpeakingRef.current = false;

      if (isActiveRef.current) {

        setStatus(isConversingRef.current ? 'LISTENING' : 'STANDBY (Say Namaste)');

        setTimeout(safeStart, 300);

      }

      return;

    }
    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    window.activeUtterance = utterance;
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => {
      index++;
      speakChunk(); // 🔁 speak next chunk
    };
    utterance.onerror = () => {
      index++;
      speakChunk();
    };

    speechSynthesis.speak(utterance);
  };

  speakChunk();
};
const handleTabClick = (category) => {
  // Map the tab name to a high-quality prompt that matches your PDF content
const prompts = {
  "Our services": {
    text: "What specialized digital engineering and cloud services does Accion provide?",
    image: "/assets/OurServices.png"
  },  
  "our global talent base": {
    text: "What is the scale and reach of Accion's global talent base across its international locations?",
    image: "/assets/GlobalTalentBase.png"
  },
  "our solutions accelerators and services": {
    text: "How do Accion's proprietary solutions and accelerators speed up the digital transformation journey?",
    image: "/assets/SolutionsAccelerators.png"
  },
  "talent at accion": {
    text: "What defines the engineering culture and talent development approach at Accion?",
    image: "/assets/TalentAtAccion.png"
  },
  "awards": {
    text: "What industry awards and recognitions has Accion received for its technical excellence?",
    image: "/assets/Awards.png"
  },
  "partnerships and alliances": {
    text: "Which strategic partnerships and technology alliances does Accion leverage for client success?",
    image: "/assets/Partnerships.png"
  }
};

  const selectedPrompt = prompts[category];
  
  if (selectedPrompt) {
    // Interrupt any current speech
    window.speechSynthesis.cancel();
    
    // Wake the AI if it is sleeping
    if (!isWaked) wakeSystem();
    
    // Set UI to conversing state and trigger RAG
    isConversingRef.current = true;
    handleTurn(selectedPrompt.text, { url: selectedPrompt.image }); 
  }
};
  const wakeSystem = () => {
    setIsWaked(true);
    isActiveRef.current = true;
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    synthRef.speak(silent);
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', 
      padding: '20px', fontFamily: '"Inter", sans-serif', color: '#FFFFFF',
      backgroundColor: '#1A1A1A', overflow: 'hidden', position: 'relative'
    }}>
      
      {!isWaked && (
        <div onClick={wakeSystem} style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: '#1A1A1A', zIndex: 100, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer'
        }}>
          <div style={{ textAlign: 'center' }}>
             <h1 style={{ fontSize: '40px', fontWeight: 800, margin: 0 }}>Insight<span style={{color: ACCION_RED}}>Host</span></h1>
             <p style={{ color: GLOW_CYAN, letterSpacing: '2px', fontWeight: 600, marginTop: '10px' }}>TAP ANYWHERE TO ACTIVATE</p>
          </div>
        </div>
      )}

      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap');
          .stat-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); padding: 12px; border-radius: 12px; min-width: 120px; text-align: center; }
          .mic-outer { position: relative; width: 90px; height: 90px; display: flex; align-items: center; justify-content: center; }
          .mic-glow { position: absolute; width: 100%; height: 100%; border-radius: 50%; border: 2px solid ${GLOW_CYAN}; opacity: 0.3; }
          .mic-glow-active { opacity: 1; animation: pulse-glow 2s infinite ease-in-out; box-shadow: 0 0 25px ${GLOW_CYAN}, 0 0 40px ${GLOW_BLUE}; }
          @keyframes pulse-glow { 0%, 100% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.1); opacity: 1; } }
          .chat-window { 
             width: 100%; max-width: 750px; flex: 1; background: rgba(255, 255, 255, 0.02); 
             border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 20px; 
             margin: 15px 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;
             scrollbar-gutter: stable;
          }
          .chat-window::-webkit-scrollbar { width: 8px; }
          .chat-window::-webkit-scrollbar-track { background: transparent; margin: 10px; }
          .chat-window::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; border: 2px solid transparent; background-clip: content-box; }
          .chat-window::-webkit-scrollbar-thumb:hover { background-color: ${GLOW_CYAN}; }
          .bubble { padding: 12px 18px; border-radius: 15px; font-size: 14px; max-width: 85%; animation: fadeIn 0.3s ease forwards; }
          .user-bubble { align-self: flex-end; background: #FFFFFF; color: #1A1A1A; border-bottom-right-radius: 2px; }
          .ai-bubble { align-self: flex-start; background: rgba(255, 255, 255, 0.08); border-bottom-left-radius: 2px; border: 1px solid rgba(255,255,255,0.1); }
          .category-tile { padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); text-align: center; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        `}
      </style>

      <header style={{ textAlign: 'center', flexShrink: 0 }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>Insight<span style={{color: ACCION_RED}}>Host</span></h2>
        <p style={{ fontSize: '14px', color: '#888', letterSpacing: '1px', marginTop: '4px' }}>ACCION XPERIENCE CENTER</p>
      </header>

      <div style={{ display: 'flex', gap: '15px', marginTop: '10px', flexShrink: 0 }}>
        {[['5000+', 'Employees Globally'], ['23+', 'Global Locations'], ['34+', 'Proprietary platforms and IP accelerators']].map(([val, label]) => (
          <div key={label} className="stat-card">
            <div style={{ color: '#7C3AED', fontSize: '18px', fontWeight: 800 }}>{val}</div>
            <div style={{ fontSize: '10px', color: '#888' }}>{label}</div>
          </div>
        ))}
      </div>

      <div className="mic-outer" style={{ margin: '15px 0', transform: isChatVisible ? 'scale(0.8)' : 'scale(1)', flexShrink: 0 }}>
        <div className={`mic-glow ${isConversingRef.current && !isAISpeakingRef.current && !mediaActive ? "mic-glow-active" : ""}`} />
        <div style={{
          width: '75px', height: '75px', background: 'rgba(255,255,255,0.1)', 
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2
        }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill={isConversingRef.current && !mediaActive ? GLOW_CYAN : "white"}>
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        </div>
      </div>

      <p style={{ fontSize: '12px', color: mediaActive ? ACCION_RED : (isConversingRef.current ? GLOW_CYAN : '#666'), fontWeight: 600 }}>
        {status}
      </p>

      {isChatVisible ? (
        <div className="chat-window">
          {chat.map((msg, i) => {
            const hasMedia = msg.role === 'assistant' && (
              (msg.images && msg.images.length > 0) ||
              (msg.videos && msg.videos.length > 0)
            );

            return (
            <div key={i} className={`bubble ${msg.role === 'user' ? 'user-bubble' : 'ai-bubble'}`} style={hasMedia ? { maxWidth: '95%', width: '95%' } : undefined}>
              <div style={{ fontSize: '10px', opacity: 0.6, marginBottom: '4px', fontWeight: 800 }}>
                 {msg.role === 'user' ? 'YOU' : 'INSIGHT HOST'}
              </div>
              
              <div
                  style={
                    hasMedia
                      ? {
                          display: "flex",
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "18px",
                          width: "100%"
                        }
                      : undefined
                  }
                >
                {msg.content && (
                  <div
                    style={{
                      marginBottom: hasMedia ? 0 : "8px",
                      lineHeight: "1.5",
                      flex: 1,
                      minWidth: 0
                    }}
                  >
                    {msg.content}
                  </div>
                )}

                <div
                  style={{
                    width: "260px",
                    minWidth: "260px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px"
                  }}
                >
                  {msg.images && msg.images.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          msg.images.length > 1 ? "1fr 1fr" : "1fr",
                        gap: "10px"
                      }}
                    >
                      {msg.images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img.url}
                          alt="Insight"
                          onClick={() => window.open(img.url, "_blank")}
                          style={{
                            width: "100%",
                            height: "220px",
                            borderRadius: "12px",
                            objectFit: "cover",
                            cursor: "pointer",
                            border: "1px solid rgba(255,255,255,0.1)"
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {msg.videos && msg.videos.length > 0 && (
                    <div style={{ marginTop: msg.images && msg.images.length > 0 ? '10px' : 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {msg.videos.map((vid, idx) => (
                        <div key={idx}>
                          {vid.type === "youtube" ? (
                            <>
                              <iframe src={vid.url} style={{ width: '100%', height: '240px', borderRadius: '10px' }} frameBorder="0" allowFullScreen title="YouTube video" />
                              {/* 🔥 UI logic fix: YouTube needs a manual resume button because it doesn't trigger JS events */}
                              <button 
                                onClick={() => toggleMediaMic(!mediaActive)}
                                style={{ width: '100%', marginTop: '8px', padding: '10px', borderRadius: '8px', background: mediaActive ? GLOW_CYAN : 'rgba(255,255,255,0.1)', color: mediaActive ? 'black' : 'white', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                              >
                                {mediaActive ? "✅ TAP TO RESUME LISTENING" : "🔇 TAP TO MUTE MIC WHILE WATCHING"}
                              </button>
                            </>
                          ) : (
                            <video controls style={{ width: '100%', borderRadius: '10px' }} onPlay={() => toggleMediaMic(true)} onPause={() => toggleMediaMic(false)} onEnded={() => toggleMediaMic(false)}>
                              <source src={vid.url} type={vid.mimeType || "video/mp4"} />
                            </video>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {msg.links && msg.links.length > 0 && (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {msg.links.map((link, idx) => (
                    <a key={idx} href={link.url} target="_blank" rel="noreferrer" style={{ color: '#38BDF8', fontSize: '12px', textDecoration: 'none', wordBreak: 'break-all' }}>
                      🔗 {link.url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )})}
          {interimText && (
            <div className="bubble user-bubble" style={{ opacity: 0.5 }}>
                <div style={{ fontSize: '10px', fontWeight: 800 }}>YOU (Listening...)</div>
                {interimText}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: '#444', fontStyle: 'italic' }}>Say "Namaste" to wake me up</p>
        </div>
      )}

      {/* Updated Askable Tiles Section */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '10px', 
        width: '100%', 
        maxWidth: '785px', 
        paddingBottom: '20px', 
        flexShrink: 0 
      }}>
        {CATEGORY_DATA.map((cat) => (
          <div 
            key={cat.name} 
            className="category-tile" 
            style={{ 
              position: 'relative', 
              overflow: 'hidden', 
              height: '20px', // Slimmer height
              cursor: 'pointer',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(255,255,255,0.1)'
            }}
            onClick={() => handleTabClick(cat.name)}
          >
            {/* Background Overlay */}
            <div style={{
              position: 'absolute',
              top: 0, left: 0, width: '100%', height: '100%',
              backgroundImage: `url(${cat.img})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'brightness(0.3)',
              zIndex: 1
            }} />
            
            {/* Label */}
            <div style={{ 
              position: 'relative', 
              zIndex: 2, 
              fontWeight: '700', 
              fontSize: '11px', // Slightly smaller font for slim tiles
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              textAlign: 'center',
              padding: '0 5px'
            }}>
              {cat.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BrightSoftwareHost;
