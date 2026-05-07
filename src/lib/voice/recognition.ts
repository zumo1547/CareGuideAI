"use client";

interface SpeechRecognitionAlternativeLike {
  transcript?: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  length?: number;
  [index: number]: SpeechRecognitionAlternativeLike | number | undefined;
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
  signal?: AbortSignal;
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
  signal,
}: ListenOptions = {}): Promise<SpeechListenResult> => {
  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) {
    throw new Error("BROWSER_SPEECH_NOT_SUPPORTED");
  }

  return new Promise<SpeechListenResult>((resolve) => {
    const recognition = new Recognition();
    let done = false;
    let timeoutId: number | null = null;
    let abortCleanup: (() => void) | null = null;
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
      if (abortCleanup) {
        abortCleanup();
        abortCleanup = null;
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

    if (signal) {
      const onAbort = () => {
        finish({
          text: "",
          confidence: 0,
          timedOut: false,
          noMatch: true,
        });
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      abortCleanup = () => signal.removeEventListener("abort", onAbort);
    }

    recognition.onresult = (event) => {
      const resultSet = event.results?.[0];
      if (!resultSet) return;

      const maxFromBrowser =
        typeof resultSet.length === "number" ? Number(resultSet.length) : maxAlternatives;
      const scanCount = Math.max(1, Math.min(maxAlternatives, maxFromBrowser));

      const candidates: Array<{ transcript: string; confidence: number }> = [];
      for (let index = 0; index < scanCount; index += 1) {
        const candidate = resultSet[index];
        if (!candidate || typeof candidate !== "object") continue;
        const transcript = (candidate.transcript ?? "").trim();
        if (!transcript) continue;
        const confidence = Number.isFinite(candidate.confidence) ? Number(candidate.confidence) : 0;
        candidates.push({ transcript, confidence });
      }

      if (!candidates.length) return;
      candidates.sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return b.transcript.length - a.transcript.length;
      });

      const best = candidates[0];
      lastResult = {
        text: best.transcript,
        confidence: best.confidence,
        timedOut: false,
        noMatch: best.transcript.length === 0,
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
