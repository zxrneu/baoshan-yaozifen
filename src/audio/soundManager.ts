/**
 * 轻量 Web Audio 拟真音效管理器（0 外部静态资源依赖，体积 0KB）。
 * 通过合成器算法模拟扑克牌的清脆出牌声、选牌升起音、吃分金币声、杀牌重击与终局号角。
 */

class SoundManager {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;

  constructor() {
    try {
      const saved = localStorage.getItem('baoshan_sound_muted');
      if (saved !== null) {
        this.muted = saved === 'true';
      }
    } catch {
      // 忽略 localStorage 不可用情况
    }
  }

  private initCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const legacyWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
      const AudioCtx = window.AudioContext || legacyWindow.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    } catch (e) {
      console.warn('Web Audio API 初始化失败:', e);
    }
    return this.ctx;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** 在用户交互中恢复音频上下文，兼容移动浏览器的自动播放限制。 */
  unlock(): void {
    if (this.muted) return;
    const ctx = this.initCtx();
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem('baoshan_sound_muted', String(muted));
    } catch {}
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** 出牌声：极短而清脆的击打纸牌拍桌声 (Card Slap) */
  playCard(): void {
    if (this.muted) return;
    const ctx = this.initCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime;

    // 白噪音脉冲模拟扑克牌碰撞
    const bufferSize = Math.floor(ctx.sampleRate * 0.05); // 50ms
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.Q.setValueAtTime(1.8, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    whiteNoise.start(t);
  }

  /** 选牌升起声：柔和的高频微动音 (Card Pick) */
  selectCard(): void {
    if (this.muted) return;
    const ctx = this.initCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(750, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.035);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.04);
  }

  /** 收牌/吃分声：清脆愉悦的双音和弦 (Trick Win) */
  trickWin(): void {
    if (this.muted) return;
    const ctx = this.initCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime;
    const freqs = [523.25, 659.25]; // C5, E5
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t + idx * 0.06;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.13);
    });
  }

  /** 主牌杀牌/毙牌重击：厚重有力 (Trump Kill) */
  trumpKill(): void {
    if (this.muted) return;
    const ctx = this.initCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);

    gain.gain.setValueAtTime(0.65, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.14);

    // 叠加一次清脆拍击
    this.playCard();
  }

  /** 叫分确认轻快滴答声 (Bid Sound) */
  bidding(): void {
    if (this.muted) return;
    const ctx = this.initCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, t); // D5
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.05);
  }

  /** 终局大三和弦号角 (Victory Fanfare) */
  victory(): void {
    if (this.muted) return;
    const ctx = this.initCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t + idx * 0.08;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.22, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.36);
    });
  }
}

export const soundManager = new SoundManager();
