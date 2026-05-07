"use client";

interface SpeechRecognitionAlternativeLike {
  transcript?: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  0?: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  results?: {
    0?: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onnomatch: (() => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

export interface SpeechListenResult {
  text: string;
  confidence: number;
  timedOut: boolean;
  noMatch: boolean;
}

interface ListenOptions {
  lang?: string;
  timeoutMs?: number;
  interimResults?: boolean;
  maxAlternatives?: number;
}

export const getSpeechRecognitionConstructor = (): BrowserSpeechRecognitionConstructor | null => {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
};

export const isSpeechRecognitionSupported = () => Boolean(getSpeechRecognitionConstructor());

export const listenForSpeechOnce = async ({
  lang = "th-TH",
  timeoutMs = 7000,
  interimResults = false,
  maxAlternatives = 1,
}: ListenOptions = {}): Promise<SpeechListenResult> => {
  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) {
    throw new Error("BROWSER_SPEECH_NOT_SUPPORTED");
  }

  return new Promise<SpeechListenResult>((resolve) => {
    const recognition = new Recognition();
    let done = false;
    let timeoutId: number | null = null;
    let lastResult: SpeechListenResult = {
      text: "",
      confidence: 0,
      timedOut: false,
      noMatch: false,
    };

    const finish = (result: SpeechListenResult) => {
      if (done) return;
      done = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      try {
        recognition.onresult = null;
        recognition.onnomatch = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop();
      } catch {
        // Ignore browser-specific stop errors during cleanup.
      }
      resolve(result);
    };

    recognition.lang = lang;
    recognition.interimResults = interimResults;
    recognition.maxAlternatives = maxAlternatives;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const result = event.results?.[0]?.[0];
      if (!result) return;
      const transcript = (result.transcript ?? "").trim();
      lastResult = {
        text: transcript,
        confidence: Number.isFinite(result.confidence) ? Number(result.confidence) : 0,
        timedOut: false,
        noMatch: transcript.length === 0,
      };
      finish(lastResult);
    };

    recognition.onnomatch = () => {
      lastResult = {
        text: "",
        confidence: 0,
        timedOut: false,
        noMatch: true,
      };
    };

    recognition.onerror = () => {
      finish({
        text: "",
        confidence: 0,
        timedOut: false,
        noMatch: true,
      });
    };

    recognition.onend = () => {
      finish(lastResult);
    };

    timeoutId = window.setTimeout(() => {
      finish({
        text: "",
        confidence: 0,
        timedOut: true,
        noMatch: true,
      });
    }, timeoutMs);

    try {
      recognition.start();
    } catch {
      finish({
        text: "",
        confidence: 0,
        timedOut: false,
        noMatch: true,
      });
    }
  });
};
