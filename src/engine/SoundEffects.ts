/**
 * ============================================================================
 * GRIDFORGE 3D — WEB AUDIO RETRO SOUND CUE SYNTHESIZER (PHASE 1)
 * ============================================================================
 * Plays procedural Web Audio sound cues triggered by `simState.soundsPlayed`
 * (`play_sound` actions and built-in door/key/secret interactions).
 * Zero external audio file URLs required.
 */

export class SoundEffects {
  private static ctx: AudioContext | null = null;

  private static getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public static playById(soundId: string): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    switch (soundId) {
      case 'door_open':
      case 'door_close': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        const startFreq = soundId === 'door_open' ? 95 : 165;
        const endFreq = soundId === 'door_open' ? 175 : 85;
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.24);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.26);
        break;
      }

      case 'door_locked': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(130, now);
        osc.frequency.setValueAtTime(98, now + 0.08);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.19);
        break;
      }

      case 'key_pickup': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          const t = now + idx * 0.055;
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.09, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.13);
        });
        break;
      }

      case 'secret_found': {
        // Classic Wolf3D-inspired low stone rumble + discovery chime
        const rumble = ctx.createOscillator();
        const rumbleGain = ctx.createGain();
        rumble.type = 'sawtooth';
        rumble.frequency.setValueAtTime(68, now);
        rumble.frequency.linearRampToValueAtTime(52, now + 0.45);
        rumbleGain.gain.setValueAtTime(0.1, now);
        rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
        rumble.connect(rumbleGain);
        rumbleGain.connect(ctx.destination);
        rumble.start(now);
        rumble.stop(now + 0.47);

        const chimeFreqs = [440, 554.37, 659.25, 880];
        chimeFreqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const t = now + 0.12 + idx * 0.07;
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.08, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.19);
        });
        break;
      }

      case 'switch_click': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.setValueAtTime(640, now + 0.04);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.11);
        break;
      }

      case 'level_exit': {
        const fanfare = [392.0, 523.25, 659.25, 783.99, 1046.5];
        fanfare.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          const t = now + idx * 0.08;
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.1, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.26);
        });
        break;
      }

      default: {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(330, now);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.13);
        break;
      }
    }
  }
}
