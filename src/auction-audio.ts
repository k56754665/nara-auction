import { useEffect, useState } from 'react';

const preferenceKey = 'nara-auction-sound';
function readPreference() {
  try { return localStorage.getItem(preferenceKey) !== 'off'; } catch { return true; }
}
let enabled = readPreference();
let context: AudioContext | null = null;
let volume: GainNode | null = null;

// 사용자 입력에서만 오디오를 준비합니다. 차단된 소리를 나중에 몰아서 재생하지 않습니다.
function unlock() {
  if (!enabled || !window.AudioContext) return;
  try {
    if (!context || context.state === 'closed') {
      context = new AudioContext({ latencyHint: 'interactive' });
      volume = context.createGain(); volume.gain.value = 0.6; volume.connect(context.destination);
    }
    if (context.state !== 'running') void context.resume().catch(() => {});
  } catch { /* 오디오를 사용할 수 없어도 경기는 계속 진행합니다. */ }
}

function gavelBuffer(audio: AudioContext) {
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 1.2), audio.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 9187;
  // 망치 애니메이션의 세 타격 시각과 동일합니다. 짧은 나무 울림과 타격음을 합성합니다.
  for (const [hit, offset] of [0.18, 0.50, 0.84].entries()) {
    const start = Math.round(offset * audio.sampleRate);
    for (let i = 0; i < audio.sampleRate * 0.19; i++) {
      const t = i / audio.sampleRate;
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const noise = (seed >>> 0) / 2147483648 - 1;
      const body = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-34 * t) * 0.45;
      const wood = Math.sin(2 * Math.PI * 740 * t) * Math.exp(-58 * t) * 0.22;
      const click = noise * Math.exp(-110 * t) * 0.32;
      samples[start + i] += (body + wood + click) * Math.min(1, t / 0.001) * (hit === 1 ? 0.9 : 1);
    }
  }
  return buffer;
}

export function playGavel() {
  if (!enabled || !context || context.state !== 'running' || !volume || document.visibilityState !== 'visible') return;
  try {
    const source = context.createBufferSource();
    source.buffer = gavelBuffer(context); source.connect(volume);
    source.onended = () => source.disconnect();
    source.start();
    return () => { source.stop(); source.disconnect(); };
  } catch { return; }
}

export function useAuctionSound() {
  const [soundEnabled, setSoundEnabled] = useState(enabled);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key !== 'Tab') unlock(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', keydown); };
  }, []);
  function toggleSound() {
    enabled = !enabled; setSoundEnabled(enabled);
    try { localStorage.setItem(preferenceKey, enabled ? 'on' : 'off'); } catch { /* 설정 저장은 선택 사항입니다. */ }
    if (volume && context) volume.gain.setValueAtTime(enabled ? 0.6 : 0, context.currentTime);
    if (enabled) unlock();
  }
  return { soundEnabled, toggleSound, soundSupported: typeof window.AudioContext !== 'undefined' };
}
