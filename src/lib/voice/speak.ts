"use client";

const THAI_LANG = "th-TH";

export const speakThai = (text: string, rate = 1) => {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = THAI_LANG;
  utterance.rate = rate;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
};
