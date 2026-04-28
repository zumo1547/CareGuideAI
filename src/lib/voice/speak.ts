"use client";

const THAI_LANG = "th-TH";
let lastSpokenText = "";
let lastSpokenAt = 0;

const pickThaiVoice = () => {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const thaiVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith("th"));
  const siriThaiVoice = thaiVoices.find((voice) => voice.name.toLowerCase().includes("siri"));

  return (
    siriThaiVoice ??
    thaiVoices[0] ??
    voices.find((voice) => voice.default) ??
    voices[0]
  );
};

export const speakThai = (text: string, rate = 1) => {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) {
    return;
  }

  const now = Date.now();
  if (text === lastSpokenText && now - lastSpokenAt < 1200) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = THAI_LANG;
  utterance.rate = rate;

  const pickedVoice = pickThaiVoice();
  if (pickedVoice) {
    utterance.voice = pickedVoice;
    utterance.lang = pickedVoice.lang || THAI_LANG;
  }

  window.speechSynthesis.speak(utterance);
  lastSpokenText = text;
  lastSpokenAt = now;
};

export const warmupSpeechSynthesis = () => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(" ");
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
};

export const stopThaiSpeech = () => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  lastSpokenText = "";
  lastSpokenAt = 0;
};
