import { useState, useRef, useCallback, useEffect } from "react";

const SpeechRecognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export function useVoiceDump({ onTranscript, onError, onEnd }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [supported] = useState(() => !!SpeechRecognition);
  const recognitionRef = useRef(null);
  const interimRef = useRef("");
  const endedByErrorRef = useRef(false);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
    interimRef.current = "";
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognition) {
      onError?.("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }

    endedByErrorRef.current = false;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          const trimmed = text.trim();
          if (trimmed) onTranscript(trimmed);
        } else {
          interimText += text;
        }
      }
      const trimmed = interimText.trim();
      interimRef.current = trimmed;
      setInterim(trimmed);
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      endedByErrorRef.current = true;
      const messages = {
        "not-allowed": "Microphone access denied — allow mic permission in browser settings.",
        "no-speech": "Didn't catch that — tap Voice dump and try again.",
        network: "Voice recognition needs an internet connection.",
      };
      onError?.(messages[event.error] || `Voice error: ${event.error}`);
      recognition.stop();
    };

    recognition.onend = () => {
      setListening(false);
      const pendingInterim = interimRef.current;
      interimRef.current = "";
      setInterim("");
      if (!endedByErrorRef.current) {
        onEnd?.(pendingInterim);
      }
      endedByErrorRef.current = false;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      onError?.("Could not start voice recognition.");
    }
  }, [onTranscript, onError, onEnd, stop]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  return { listening, interim, supported, toggle, stop };
}
