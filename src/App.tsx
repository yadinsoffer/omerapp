import React, { useState, useEffect, useRef } from 'react';
import * as speechsdk from 'microsoft-cognitiveservices-speech-sdk';
import './App.css';

function App() {
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [transcripts, setTranscripts] = useState<{speaker: string, text: string}[]>([]);
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [backgroundLevel, setBackgroundLevel] = useState<number>(0);
  const [speakerLevel, setSpeakerLevel] = useState<number>(0);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const baselineNoiseRef = useRef<number>(0);
  const recentNoiseLevelsRef = useRef<number[]>([]);

  const calculateAudioLevel = (dataArray: Uint8Array): number => {
    const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
    return Math.round((average / 255) * 100);
  };

  const calculateBaseline = () => {
    if (recentNoiseLevelsRef.current.length > 0) {
      baselineNoiseRef.current = Math.round(
        recentNoiseLevelsRef.current.reduce((a, b) => a + b, 0) / 
        recentNoiseLevelsRef.current.length
      );
      console.log('New baseline established:', baselineNoiseRef.current);
    }
  };

  const startAudioMonitoring = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      
      analyserRef.current.fftSize = 256;
      sourceRef.current.connect(analyserRef.current);
      
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      
      const updateLevels = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray);
          const currentLevel = calculateAudioLevel(dataArray);
          
          // Keep track of recent noise levels
          recentNoiseLevelsRef.current.push(currentLevel);
          if (recentNoiseLevelsRef.current.length > 120) { // 2 seconds at 60fps
            recentNoiseLevelsRef.current.shift();
          }

          // Update levels based on current speaker
          if (currentSpeaker === 'Speaker Guest-1') {
            const differential = Math.max(0, currentLevel - baselineNoiseRef.current);
            console.log({
              currentLevel,
              baseline: baselineNoiseRef.current,
              differential,
              speaker: currentSpeaker
            });
            setSpeakerLevel(differential);
            setBackgroundLevel(baselineNoiseRef.current);
          } else {
            setBackgroundLevel(currentLevel);
            setSpeakerLevel(0);
          }
        }
        requestAnimationFrame(updateLevels);
      };
      
      updateLevels();
    } catch (error) {
      console.error('Error accessing microphone:', error);
    }
  };

  const startListening = () => {
    const speechConfig = speechsdk.SpeechConfig.fromSubscription(
      "2Dk3o2itQmmnxiwj9A8cQvaebhwNMMVNDUq3XAbQ0mZwvdjwMcsOJQQJ99ALACYeBjFXJ3w3AAAYACOGdiLU",
      "eastus"
    );
    
    speechConfig.speechRecognitionLanguage = "en-US";
    
    const audioConfig = speechsdk.AudioConfig.fromDefaultMicrophoneInput();
    const transcriber = new speechsdk.ConversationTranscriber(speechConfig, audioConfig);

    transcriber.transcribed = (s, e) => {
      console.log('Transcription event:', e);
      const speakerId = e.result.speakerId || 'unknown';
      const text = e.result.text;
      
      if (text.trim()) {
        const speaker = `Speaker ${speakerId}`;
        console.log('Speaker detected:', speaker);
        
        // Calculate new baseline when Speaker Guest-1 is detected
        if (speaker === 'Speaker Guest-1') {
          calculateBaseline();
        }
        
        setCurrentSpeaker(speaker);
        if (!activeSpeakers.includes(speaker)) {
          setActiveSpeakers(prev => [...prev, speaker]);
        }
        
        setTranscripts(prev => [...prev, {
          speaker: speaker,
          text: text
        }]);

        setTimeout(() => {
          console.log('Resetting current speaker');
          setCurrentSpeaker(null);
        }, 3000);
      }
    };

    transcriber.canceled = (s, e) => {
      console.log(`CANCELED: Reason=${e.reason}`);
      if (e.reason === speechsdk.CancellationReason.Error) {
        console.log(`"CANCELED: ErrorCode=${e.errorCode}`);
        console.log(`"CANCELED: ErrorDetails=${e.errorDetails}`);
      }
    };

    transcriber.sessionStarted = (s, e) => {
      console.log('Session started');
      startAudioMonitoring();
    };

    transcriber.sessionStopped = (s, e) => {
      console.log('Session stopped');
    };

    console.log('Starting transcription...');
    transcriber.startTranscribingAsync(
      () => {
        setIsListening(true);
        console.log('Transcription started successfully');
      },
      (err) => {
        console.error('Error starting transcription:', err);
        setIsListening(false);
      }
    );

    return () => {
      if (isListening) {
        transcriber.stopTranscribingAsync();
        setIsListening(false);
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
      }
    };
  };

  // Audio level indicator component
  const AudioLevelIndicator = ({ level, label, color, baseline = null }: 
    { level: number, label: string, color: string, baseline?: number | null }) => (
    <div style={{
      marginBottom: '20px',
      textAlign: 'left',
      width: '200px'
    }}>
      <div style={{ marginBottom: '5px', color: '#fff' }}>
        {label}: {level}dB
        {baseline !== null && ` (Baseline: ${baseline}dB)`}
      </div>
      <div style={{
        width: '100%',
        height: '20px',
        backgroundColor: '#333',
        borderRadius: '10px',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {baseline !== null && (
          <div style={{
            position: 'absolute',
            left: `${baseline}%`,
            top: 0,
            bottom: 0,
            width: '2px',
            backgroundColor: '#fff',
            opacity: 0.5
          }} />
        )}
        <div style={{
          width: `${level}%`,
          height: '100%',
          backgroundColor: color,
          transition: 'width 0.1s ease'
        }} />
      </div>
    </div>
  );

  return (
    <div style={{ 
      backgroundColor: '#f8fafc',
      minHeight: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Header */}
      <header style={{
        backgroundColor: 'white',
        borderBottom: '1px solid #e2e8f0',
        padding: '1rem 2rem',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10
      }}>
        <h1 style={{ 
          margin: 0,
          fontSize: '1.5rem',
          fontWeight: 600,
          color: '#1e293b'
        }}>
          Omer App
          <span style={{
            marginLeft: '0.5rem',
            fontSize: '0.875rem',
            color: '#64748b',
            fontWeight: 'normal'
          }}>
            Voice Analytics Dashboard
          </span>
        </h1>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '1200px',
        margin: '5rem auto 2rem',
        padding: '0 2rem',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '2rem'
      }}>
        {/* Left Column */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2rem'
        }}>
          {/* Status Card */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '1rem',
            padding: '2rem',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2rem'
          }}>
            {/* Speaking Indicator */}
            <div style={{
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              backgroundColor: currentSpeaker ? 
                (currentSpeaker === 'Speaker Guest-1' ? '#22c55e' : '#ef4444') : 
                '#94a3b8',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
            }} />
            
            <div style={{
              fontSize: '1.125rem',
              color: '#475569',
              fontWeight: 500
            }}>
              {currentSpeaker || 'No one speaking'}
            </div>

            {/* Control Button */}
            <button 
              onClick={() => !isListening ? startListening() : null}
              style={{ 
                width: '100%',
                maxWidth: '300px',
                padding: '0.75rem',
                fontSize: '1rem',
                backgroundColor: isListening ? '#ef4444' : '#22c55e',
                color: 'white',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                fontWeight: 500,
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
              }}
            >
              {isListening ? 'Stop Recording' : 'Start Recording'}
            </button>
          </div>

          {/* Metrics Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem'
          }}>
            {/* Speaker Level */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '1rem',
              padding: '1.5rem',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
            }}>
              <div style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                Speaker
              </div>
              <div style={{ color: '#1e293b', fontSize: '1.5rem', fontWeight: 600 }}>
                {baselineNoiseRef.current}dB
              </div>
            </div>

            {/* Background Level */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '1rem',
              padding: '1.5rem',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
            }}>
              <div style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                Background
              </div>
              <div style={{ color: '#1e293b', fontSize: '1.5rem', fontWeight: 600 }}>
                {backgroundLevel}dB
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Conversation History */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '1rem',
          padding: '2rem',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          height: 'calc(100vh - 8rem)',
          position: 'sticky',
          top: '6rem'
        }}>
          <h2 style={{ 
            margin: 0,
            color: '#1e293b',
            fontSize: '1.25rem',
            fontWeight: 600
          }}>
            Conversation History
          </h2>

          {/* Active Speakers */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem'
          }}>
            {activeSpeakers.map((speaker, index) => (
              <div
                key={index}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#f1f5f9',
                  color: '#475569',
                  borderRadius: '2rem',
                  fontSize: '0.875rem',
                  fontWeight: 500
                }}
              >
                {speaker}
              </div>
            ))}
          </div>

          {/* Transcripts */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            {transcripts.map((transcript, index) => (
              <div 
                key={index}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem'
                }}
              >
                <div style={{ 
                  color: transcript.speaker === 'Speaker Guest-1' ? '#22c55e' : '#ef4444',
                  fontSize: '0.875rem',
                  fontWeight: 500
                }}>
                  {transcript.speaker}
                </div>
                <div style={{ 
                  color: '#475569',
                  backgroundColor: '#f8fafc',
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem'
                }}>
                  {transcript.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
