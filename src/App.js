import React, { useState, useEffect, useRef } from 'react';

const BrightSoftwareHost = () => {
  const [status, setStatus] = useState('SYSTEM_OFFLINE');
  const [chat, setChat] = useState([]);
  const [interimText, setInterimText] = useState('');
  const [isWaked, setIsWaked] = useState(false); 

  const recognitionRef = useRef(null);
  const isActiveRef = useRef(false);
  const isConversingRef = useRef(false); 
  const isAISpeakingRef = useRef(false);
  const synthRef = window.speechSynthesis;
  const chatEndRef = useRef(null);
  const currentUtteranceRef = useRef(null);
  const ACCION_RED = "#E31E24";
  const GLOW_CYAN = "#00FFFF";
  const GLOW_BLUE = "#3B82F6";

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

  const safeStart = () => {
    if (!recognitionRef.current || !isActiveRef.current || isAISpeakingRef.current) return;
    try { recognitionRef.current.start(); } catch (e) {}
  };

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || !isWaked) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true; 
    recognition.interimResults = true;
    
    recognition.onstart = () => {
      setStatus(isConversingRef.current ? 'LISTENING' : 'STANDBY (Say Namaste)');
    };

   recognition.onresult = (e) => {
  if (isAISpeakingRef.current) return;

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
    // --- MODIFIED SECTION START ---
    if (lowerFinal.includes("stop") || lowerFinal.includes("pause") || lowerFinal.includes("go to sleep")) {
      
      // Stop any video currently playing in the chat window
      const videos = document.querySelectorAll('video');
      videos.forEach(v => v.pause());

      isConversingRef.current = false;
      setInterimText('');
      setStatus('STANDBY (Say Namaste)');
      speak("Understood. I'll be here if you need me. Just say Namaste to wake me up.");
      return;
    }
    // --- MODIFIED SECTION END ---
    
    if (lowerFinal.includes("show me a test image")) {
        handleTurn("DEBUG_IMAGE"); 
        return;
    }
    if (lowerFinal.includes("show me a test video")) {
        handleTurn("DEBUG_VIDEO");
        return;
    }

    setInterimText(interim);
    if (final.trim()) handleTurn(final);
  }
};

  recognition.onend = () => {
  // Only restart if the app is active AND we aren't currently 
  // processing a request or speaking a response.
  if (isActiveRef.current && !isAISpeakingRef.current) {
    safeStart();
  }
};

    recognition.onerror = () => { if (isActiveRef.current) safeStart(); };
    recognitionRef.current = recognition;
    safeStart();

    return () => {
      isActiveRef.current = false;
      recognition.stop();
    };
  }, [isWaked]);

  const handleStopMedia = () => {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      video.pause();
      // Optional: video.currentTime = 0; // Reset to beginning if desired
    });
  };
  const handleTurn = async (text) => {
  // 1. Immediately block recognition and change status
  isAISpeakingRef.current = true; 
  recognitionRef.current?.stop();
  
  setStatus('PROCESSING...');
  setInterimText('');

  setChat(prev => [
    ...prev,
    {
      role: 'user',
      content:
        text === "DEBUG_IMAGE"
          ? "Show me a test image"
          : text === "DEBUG_VIDEO"
          ? "Show me a test video"
          : text
    }
  ]);

  try {
    let botMessage = {
      role: "assistant",
      content: "",
      images: [],
      videos: [],
      links: []
    };

    if (text === "DEBUG_IMAGE") {
      botMessage.images = [{ url: "https://picsum.photos/800/450" }];
    } else if (text === "DEBUG_VIDEO") {
      botMessage.videos = [{ url: "https://www.w3schools.com/html/mov_bbb.mp4" }];
    } else {
      const res = await fetch(`http://localhost:5000/extractRAG`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text })
      });

      const data = await res.json();
      botMessage.content = data.response || "";
      botMessage.images = data.images || [];
      botMessage.videos = data.videos || [];
      botMessage.links = data.links || [];
    }

    setChat(prev => [...prev, botMessage]);

    // 2. Speak the response. 
    // The 'speak' function will set isAISpeakingRef to false ONLY when finished.
    if (botMessage.content) {
      speak(botMessage.content);
    } else {
      // If no text, unlock and resume listening
      isAISpeakingRef.current = false;
      setStatus(isConversingRef.current ? 'LISTENING' : 'STANDBY (Say Namaste)');
      setTimeout(safeStart, 300);
    }

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
  const chunks = text.match(/.{1,120}(\s|$)/g); // 120 chars per chunk

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

 const wakeSystem = () => {
    setIsWaked(true);
    isActiveRef.current = true;
    
    // Pre-warm the engine with a silent, tiny utterance
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
        {[['18+', 'Years'], ['340+', 'Projects'], ['92%', 'Retention']].map(([val, label]) => (
          <div key={label} className="stat-card">
            <div style={{ color: '#7C3AED', fontSize: '18px', fontWeight: 800 }}>{val}</div>
            <div style={{ fontSize: '10px', color: '#888' }}>{label}</div>
          </div>
        ))}
      </div>

      <div className="mic-outer" style={{ margin: '15px 0', transform: isChatVisible ? 'scale(0.8)' : 'scale(1)', flexShrink: 0 }}>
        <div className={`mic-glow ${isConversingRef.current && !isAISpeakingRef.current ? "mic-glow-active" : ""}`} />
        <div style={{
          width: '75px', height: '75px', background: 'rgba(255,255,255,0.1)', 
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2
        }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill={isConversingRef.current ? GLOW_CYAN : "white"}>
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        </div>
      </div>

      <p style={{ fontSize: '12px', color: isConversingRef.current ? GLOW_CYAN : '#666', fontWeight: 600 }}>
        {status}
      </p>

      {isChatVisible ? (
        <div className="chat-window">
          {chat.map((msg, i) => (
            <div key={i} className={`bubble ${msg.role === 'user' ? 'user-bubble' : 'ai-bubble'}`}>
              <div style={{ fontSize: '10px', opacity: 0.6, marginBottom: '4px', fontWeight: 800 }}>
                 {msg.role === 'user' ? 'YOU' : 'INSIGHT HOST'}
              </div>
              
              {/* MEDIA RENDERER LOGIC */}
              {/* TEXT */}
              {msg.content && (
                <div style={{ marginBottom: '8px', lineHeight: '1.5' }}>
                  {msg.content}
                </div>
              )}

              {/* IMAGES */}
              {msg.images && msg.images.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '8px' }}>
                  {msg.images.map((img, idx) => (
                    <img
                      key={idx}
                      src={img.url}
                      alt="Insight"
                      style={{
                        width: '100%',
                        borderRadius: '10px',
                        objectFit: 'cover',
                        cursor: 'pointer'
                      }}
                      onClick={() => window.open(img.url, '_blank')}
                    />
                  ))}
                </div>
              )}

              {/* VIDEOS */}
              {msg.videos && msg.videos.length > 0 && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {msg.videos.map((vid, idx) => (
                  vid.type === "youtube" ? (
                    <iframe
                      key={idx}
                      src={vid.url}
                      style={{ width: '100%', height: '300px', borderRadius: '10px' }}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      title="YouTube video"
                    />
                  ) : (
                    <video key={idx} controls style={{ width: '100%', borderRadius: '10px' }}>
                      <source src={vid.url} type="video/mp4" />
                    </video>
                  )
                ))}
              </div>
            )}

              {/* LINKS */}
              {msg.links && msg.links.length > 0 && (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {msg.links.map((link, idx) => (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: '#38BDF8',
                        fontSize: '12px',
                        textDecoration: 'none',
                        wordBreak: 'break-all'
                      }}
                    >
                      🔗 {link.url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
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

      <div style={{ display: 'grid', gridTemplateColumns: isChatVisible ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)', gap: '12px', width: '100%', maxWidth: '750px', paddingBottom: '10px', flexShrink: 0 }}>
        {['Our story', 'Portfolio', 'Key people', 'Services'].map((item) => (
          <div key={item} className="category-tile">
            <div style={{ fontSize: '12px', fontWeight: 600 }}>{item}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BrightSoftwareHost;