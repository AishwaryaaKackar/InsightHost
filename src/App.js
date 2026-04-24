import React, { useState, useEffect, useRef } from 'react';

const BrightSoftwareHost = () => {
  const [status, setStatus] = useState('SYSTEM_READY');
  const [chat, setChat] = useState([]);
  const [interimText, setInterimText] = useState('');

  const recognitionRef = useRef(null);
  const isActiveRef = useRef(false);
  const synthRef = window.speechSynthesis;
  const chatEndRef = useRef(null);

  const ACCION_RED = "#E31E24";
  const GLOW_CYAN = "#00FFFF";
  const GLOW_BLUE = "#3B82F6";
  const SOFT_BLUE = "#60A5FA";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, interimText]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onstart = () => setStatus('LISTENING');
    recognition.onresult = (e) => {
      let final = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInterimText(interim);
      if (final.trim()) handleTurn(final);
    };
    recognition.onerror = () => { if (isActiveRef.current) safeStart(); };
    recognitionRef.current = recognition;
  }, []);

  const safeStart = () => {
    if (!recognitionRef.current || !isActiveRef.current) return;
    try { recognitionRef.current.start(); } catch (e) {}
  };

  const handleTurn = async (text) => {
    recognitionRef.current.stop();
    setStatus('PROCESSING...');
    setChat(prev => [...prev, { role: 'user', content: text }]);
    try {
      const res = await fetch(`http://localhost:3000/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      setChat(prev => [...prev, { role: 'assistant', content: data.response }]);
      speak(data.response);
    } catch (err) {
      speak("Network connection interrupted.");
    }
  };

  const speak = (text) => {

    setStatus('Speaking...');

    const utterance = new SpeechSynthesisUtterance(text);

    const voices = synthRef.getVoices();

    const femaleVoice = voices.find(voice => 

      voice.name.toLowerCase().includes('female') || 

      voice.name.toLowerCase().includes('google us english') || 

      voice.name.toLowerCase().includes('zira') || 

      voice.name.toLowerCase().includes('samantha') ||

      voice.name.toLowerCase().includes('victoria')

    );



    if (femaleVoice) utterance.voice = femaleVoice;

    utterance.pitch = 1.1;

    utterance.rate = 1.0;



    utterance.onend = () => {

      if (isActiveRef.current) {

        setStatus('Listening');

        safeStart(); 

      }

    };

    synthRef.speak(utterance);

  };


  const toggleSession = () => {
    isActiveRef.current = !isActiveRef.current;
    if (!isActiveRef.current) {
      recognitionRef.current.stop();
      synthRef.cancel();
      setStatus('SYSTEM_READY');
    } else {
      safeStart();
    }
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', 
      padding: '40px 20px', fontFamily: '"Inter", sans-serif', color: '#FFFFFF',
      backgroundColor: '#1A1A1A', overflowY: 'auto'
    }}>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap');
          
          .stat-card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 20px; border-radius: 12px; width: 160px; text-align: center;
          }

          .mic-outer {
            position: relative; width: 120px; height: 120px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; margin: 40px 0;
          }

          /* The Glowing Rings from UI */
          .mic-glow {
            position: absolute; width: 100%; height: 100%;
            border-radius: 50%;
            border: 2px solid ${GLOW_CYAN};
            box-shadow: 0 0 20px ${GLOW_CYAN}, inset 0 0 15px ${GLOW_CYAN};
            opacity: 0.3;
          }

          .mic-glow-active {
            opacity: 1;
            animation: pulse-glow 2s infinite ease-in-out;
            box-shadow: 0 0 30px ${GLOW_CYAN}, 0 0 50px ${GLOW_BLUE};
          }

          @keyframes pulse-glow {
            0%, 100% { transform: scale(1); opacity: 0.6; }
            50% { transform: scale(1.1); opacity: 1; }
          }

          .chat-box {
            width: 100%; max-width: 650px; display: flex; flex-direction: column; gap: 12px;
          }

          .bubble {
            padding: 14px 20px; border-radius: 20px; font-size: 14px; max-width: 90%;
            line-height: 1.5; animation: fadeIn 0.4s ease forwards;
          }

          .user-bubble {
            align-self: center; background: rgba(255, 255, 255, 0.95); color: #1A1A1A;
            border-bottom-right-radius: 4px;
          }

          .ai-bubble {
            align-self: center; background: rgba(45, 55, 72, 0.8); color: white;
            border-bottom-left-radius: 4px; border: 1px solid rgba(255,255,255,0.1);
          }

          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        `}
      </style>

      {/* Header */}
      <header style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h2 style={{ fontSize: '30px', fontWeight: 600, margin: 0 }}>Insight<span style={{color: ACCION_RED}}>Host</span></h2>
        <p style={{ fontSize: '20px', color: '#888', letterSpacing: '1px', marginTop: '4px' }}>ACCION XPERIENCE CENTER</p>
      <p style={{ fontSize: '13px', color: '#AAA', lineHeight: '1.6' }}>
          Your interactive guide to everything we do — explore our story, team, projects, and more. Use voice or text to ask anything.
        </p>
      </header>

      {/* Welcome Section */}
     

      {/* Stats Row */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '40px' }}>
        <div className="stat-card">
          <div style={{ color: '#7C3AED', fontSize: '20px', fontWeight: 800 }}>18+</div>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>Years of expertise</div>
        </div>
        <div className="stat-card">
          <div style={{ color: '#7C3AED', fontSize: '20px', fontWeight: 800 }}>340+</div>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>Projects delivered</div>
        </div>
        <div className="stat-card">
          <div style={{ color: '#7C3AED', fontSize: '20px', fontWeight: 800 }}>92%</div>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>Client retention</div>
        </div>
      </div>

      {/* Centered Mic Section */}
      <div className="mic-outer" onClick={toggleSession}>
        <div className={`mic-glow ${isActiveRef.current ? "mic-glow-active" : ""}`} />
        <div style={{
          width: '150px', height: '120px', background: 'rgba(255,255,255,0.1)', 
          borderRadius: '70%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2, backdropFilter: 'blur(10px)'
        }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="white">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        </div>
      </div>

      <p style={{ fontSize: '14px', color: '#888', marginBottom: '30px' }}>
        {status === 'LISTENING' ? 'Listening...' : 'Ask me anything...'}
      </p>

      {/* Chat Display Area */}
      <div className="chat-box">
        {chat.map((msg, i) => (
          <div key={i} className={`bubble ${msg.role === 'user' ? 'user-bubble' : 'ai-bubble'}`}>
            {msg.role === 'assistant' && <strong style={{color: GLOW_BLUE, marginRight: '8px'}}>Insight Host:</strong>}
            {msg.role === 'user' && (
              <strong style={{ color: SOFT_BLUE, marginRight: '8px' }}>
                You:
              </strong>
            )}
            {msg.content}
          </div>
        ))}
        {interimText && (
          <div className="bubble user-bubble" style={{ opacity: 0.5 }}>{interimText}</div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Bottom Categories (Visual Only) */}
      <div style={{ 
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px', 
        width: '100%', maxWidth: '650px', marginTop: '60px' 
      }}>
        {['Our story', 'Portfolio', 'Key people', 'Services'].map((item) => (
          <div key={item} style={{
            padding: '20px', borderRadius: '12px', background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer'
          }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>{item}</div>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '6px' }}>Click to learn more about our {item.toLowerCase()}.</div>
          </div>
        ))}
      </div>

    </div>
  );
};

export default BrightSoftwareHost;