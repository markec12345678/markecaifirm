'use client';

// v8.51: Sound Notifications — Web Audio API based sound effects.
// No external files needed — generates tones programmatically.
// Sounds: success, error, warning, notification, achievement, click.

type SoundType = 'success' | 'error' | 'warning' | 'notification' | 'achievement' | 'click';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioContext;
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.1, delay = 0): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;

  const startTime = ctx.currentTime + delay;
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

const SOUNDS: Record<SoundType, () => void> = {
  // C-E-G chord (rising) — success
  success: () => {
    playTone(523.25, 0.15, 'sine', 0.08, 0);      // C5
    playTone(659.25, 0.15, 'sine', 0.08, 0.08);   // E5
    playTone(783.99, 0.25, 'sine', 0.1, 0.16);    // G5
  },

  // Low buzz — error
  error: () => {
    playTone(196, 0.1, 'sawtooth', 0.08, 0);       // G3
    playTone(185, 0.15, 'sawtooth', 0.08, 0.1);    // F#3
  },

  // Two-tone warning
  warning: () => {
    playTone(440, 0.1, 'square', 0.06, 0);         // A4
    playTone(440, 0.1, 'square', 0.06, 0.15);      // A4 (repeat)
  },

  // Gentle notification chime
  notification: () => {
    playTone(880, 0.08, 'sine', 0.05, 0);          // A5
    playTone(1108.73, 0.12, 'sine', 0.05, 0.06);   // C#6
  },

  // Achievement fanfare — C-E-G-C (octave up)
  achievement: () => {
    playTone(523.25, 0.1, 'sine', 0.08, 0);        // C5
    playTone(659.25, 0.1, 'sine', 0.08, 0.1);      // E5
    playTone(783.99, 0.1, 'sine', 0.08, 0.2);      // G5
    playTone(1046.5, 0.3, 'sine', 0.1, 0.3);       // C6
  },

  // Subtle click
  click: () => {
    playTone(1000, 0.02, 'sine', 0.03, 0);
  },
};

// v8.51: Settings — check if sound is enabled
let soundEnabled = true;

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('soundEnabled', String(enabled));
  }
}

export function isSoundEnabled(): boolean {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('soundEnabled');
    if (stored !== null) return stored === 'true';
  }
  return soundEnabled;
}

// Initialize from localStorage
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('soundEnabled');
  if (stored !== null) soundEnabled = stored === 'true';
}

export function playSound(type: SoundType): void {
  if (!isSoundEnabled()) return;
  try {
    SOUNDS[type]();
  } catch {
    // Silently fail — sound is non-critical
  }
}

// Convenience hook
export function useSound() {
  return {
    play: playSound,
    success: () => playSound('success'),
    error: () => playSound('error'),
    warning: () => playSound('warning'),
    notification: () => playSound('notification'),
    achievement: () => playSound('achievement'),
    click: () => playSound('click'),
    enabled: isSoundEnabled,
    setEnabled: setSoundEnabled,
  };
}
