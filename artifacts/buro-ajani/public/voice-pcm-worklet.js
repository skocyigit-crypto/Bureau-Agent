// AudioWorklet processor: downsample the mic input (typically 48kHz
// on Chrome) to 16kHz int16 PCM mono and post chunks to the main
// thread. This is what Gemini Live expects for realtime audio input.
//
// Protocol: posts ArrayBuffer payloads of Int16 samples at 16kHz.
// Chunk size is ~640 samples = 40ms which gives smooth streaming
// without overwhelming the WebSocket.

class PcmDownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Target rate is fixed for Gemini Live.
    this.targetRate = 16000;
    // Downsample ratio = inputRate / targetRate (e.g. 48000/16000 = 3).
    // sampleRate is a global available inside AudioWorkletGlobalScope.
    this.ratio = sampleRate / this.targetRate;
    // Carry-over fractional index across processing blocks for stable
    // resampling at non-integer ratios.
    this.indexFloat = 0;
    // Output buffer (Int16). 640 samples @ 16kHz = 40ms.
    this.outBufSize = 640;
    this.outBuf = new Int16Array(this.outBufSize);
    this.outIdx = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // Simple linear-interpolation resampler. For speech this is
    // perfectly adequate and far cheaper than FIR.
    while (this.indexFloat < channel.length) {
      const i0 = Math.floor(this.indexFloat);
      const i1 = Math.min(i0 + 1, channel.length - 1);
      const frac = this.indexFloat - i0;
      const sample = channel[i0] * (1 - frac) + channel[i1] * frac;
      // Clamp + convert float [-1,1] -> int16.
      const s = Math.max(-1, Math.min(1, sample));
      this.outBuf[this.outIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.outIdx >= this.outBufSize) {
        // Transfer as ArrayBuffer for zero-copy.
        const chunk = this.outBuf.slice(0).buffer;
        this.port.postMessage(chunk, [chunk]);
        this.outIdx = 0;
      }
      this.indexFloat += this.ratio;
    }
    // Reset index relative to next block start.
    this.indexFloat -= channel.length;
    return true;
  }
}

registerProcessor("pcm-downsample", PcmDownsampleProcessor);
