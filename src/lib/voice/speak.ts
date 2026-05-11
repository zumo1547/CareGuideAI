"use client";

const THAI_LANG = "th-TH";
let lastSpokenText = "";
let lastSpokenAt = 0;

const pickThaiVoice = () => {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const thaiVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith("th"));
  const siriThaiVoice = thaiVoices.find((voice) => voice.name.toLowerCase().includes("siri"));

  return siriThaiVoice ?? thaiVoices[0] ?? voices.find((voice) => voice.default) ?? voices[0];
};

const createThaiUtterance = (text: string, rate = 1) => {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = THAI_LANG;
  utterance.rate = rate;

  const pickedVoice = pickThaiVoice();
  if (pickedVoice) {
    utterance.voice = pickedVoice;
    utterance.lang = pickedVoice.lang || THAI_LANG;
  }

  return utterance;
};

const shouldSkipDuplicateSpeech = (text: string) => {
  const now = Date.now();
  if (text === lastSpokenText && now - lastSpokenAt < 1200) {
    return true;
  }
  return false;
};

const markSpoken = (text: string) => {
  lastSpokenText = text;
  lastSpokenAt = Date.now();
};

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export const speakThai = (text: string, rate = 1) => {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) {
    return;
  }

  if (shouldSkipDuplicateSpeech(text)) {
    return;
  }

  const utterance = createThaiUtterance(text, rate);
  window.speechSynthesis.speak(utterance);
  markSpoken(text);
};

export const speakThaiAndWait = async (text: string, rate = 1, afterMs = 250) => {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) {
    return;
  }

  if (shouldSkipDuplicateSpeech(text)) {
    if (afterMs > 0) {
      await wait(afterMs);
    }
    return;
  }

  await new Promise<void>((resolve) => {
    const utterance = createThaiUtterance(text, rate);
    let finished = false;
    const expectedMs = Math.min(12_000, Math.max(2_500, text.length * 95));

    const cleanup = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
    }, expectedMs);

    utterance.onend = () => {
      window.clearTimeout(timeoutId);
      cleanup();
    };

    utterance.onerror = () => {
      window.clearTimeout(timeoutId);
      cleanup();
    };

    window.speechSynthesis.speak(utterance);
  });

  markSpoken(text);
  if (afterMs > 0) {
    await wait(afterMs);
  }
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
