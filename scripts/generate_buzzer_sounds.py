#!/usr/bin/env python3
"""
Generate simple buzzer sound effects for the Buzz Board game.
These sounds are generated programmatically and are open-source.
"""

import wave
import os
import numpy as np

def generate_buzz_in_sound(filename, duration=0.5, sample_rate=44100):
    """Generate a pleasant buzz-in sound (rising tone)"""
    num_samples = int(sample_rate * duration)

    # Create time array
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # Rising frequency from 440Hz to 880Hz (one octave)
    freq_start = 440.0
    freq_end = 880.0
    progress = t / duration
    frequency = freq_start + (freq_end - freq_start) * progress

    # Generate sine wave with linear frequency sweep
    # Use cumulative sum to handle varying frequency
    phase = 2 * np.pi * np.cumsum(frequency) / sample_rate
    samples = np.sin(phase)

    # Apply envelope (fade in and fade out)
    fade_samples = int(0.05 * sample_rate)  # 50ms fade
    envelope = np.ones(num_samples)

    # Fade in
    envelope[:fade_samples] = np.linspace(0, 1, fade_samples)
    # Fade out
    envelope[-fade_samples:] = np.linspace(1, 0, fade_samples)

    # Apply envelope and volume
    samples *= envelope * 0.5

    # Convert to 16-bit integer
    samples_int = np.clip(samples * 32767, -32768, 32767).astype(np.int16)

    # Write to WAV file
    with wave.open(filename, 'w') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 2 bytes per sample
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(samples_int.tobytes())

def generate_wrong_answer_sound(filename, duration=0.8, sample_rate=44100):
    """Generate a wrong answer sound (descending tone)"""
    num_samples = int(sample_rate * duration)

    # Create time array
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # Descending frequency from 300Hz to 150Hz
    freq_start = 300.0
    freq_end = 150.0
    progress = t / duration
    frequency = freq_start + (freq_end - freq_start) * progress

    # Generate sawtooth wave for more "buzzer" like sound
    # Sawtooth: 2 * (freq * t - floor(freq * t + 0.5))
    phase = np.cumsum(frequency) / sample_rate
    samples = 2 * (phase - np.floor(phase + 0.5))

    # Apply envelope (quick fade in, slow fade out)
    fade_in_samples = int(0.02 * sample_rate)  # 20ms fade in
    fade_out_samples = int(0.2 * sample_rate)   # 200ms fade out

    envelope = np.ones(num_samples)

    # Fade in
    envelope[:fade_in_samples] = np.linspace(0, 1, fade_in_samples)
    # Fade out
    envelope[-fade_out_samples:] = np.linspace(1, 0, fade_out_samples)

    # Apply envelope and volume
    samples *= envelope * 0.4  # Reduce volume to 40%

    # Convert to 16-bit integer
    samples_int = np.clip(samples * 32767, -32768, 32767).astype(np.int16)

    # Write to WAV file
    with wave.open(filename, 'w') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 2 bytes per sample
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(samples_int.tobytes())

def main():
    """Generate all buzzer sounds"""
    sounds_dir = "public/sounds"
    os.makedirs(sounds_dir, exist_ok=True)

    print("Generating buzzer sound effects...")

    # Generate buzz-in sound (pleasant, rising tone)
    buzz_in_file = os.path.join(sounds_dir, "buzz-in.wav")
    generate_buzz_in_sound(buzz_in_file)
    print(f"Generated: {buzz_in_file}")

    # Generate wrong answer sound (descending, buzzer-like)
    wrong_answer_file = os.path.join(sounds_dir, "wrong-answer.wav")
    generate_wrong_answer_sound(wrong_answer_file)
    print(f"Generated: {wrong_answer_file}")

    print("Sound generation complete!")
    print("These sounds are programmatically generated and open-source.")

if __name__ == "__main__":
    main()
