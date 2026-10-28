/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getContext, reportProblem } from "./context";

export interface AudioPlayerInterface {
    play(): void;
    stop(): void;
}

interface AudioOptions {
    volume?: number;
    onEnded?(): void;
    onError?(): void;
}

interface DiscordSounds {
    playSound(name: string, volume?: number): unknown;
}

const isUrl = (sound: string) => /^(https?:|data:audio\/|blob:)/i.test(sound);

export function createAudioPlayer(sound: string, options: AudioOptions = {}): AudioPlayerInterface | null {
    const volume = Math.max(0, Math.min(100, options.volume ?? 100)) / 100;
    if (isUrl(sound)) {
        const element = new Audio(sound);
        element.volume = volume;
        if (options.onEnded) element.addEventListener("ended", options.onEnded, { once: true });
        return {
            play: () => { element.play().catch(error => { reportProblem("audio", error); options.onError?.(); }); },
            stop: () => { element.pause(); element.currentTime = 0; }
        };
    }
    return {
        play: () => {
            try {
                if (getContext().sounds?.play(sound, volume)) {
                    if (options.onEnded) setTimeout(options.onEnded, 1500);
                    return;
                }
            } catch (error) {
                reportProblem("audio", error);
            }
            const sounds = getContext().finders.byProps<DiscordSounds>("createSound", "playSound").get();
            if (sounds) {
                try {
                    sounds.playSound(sound, volume);
                    return;
                } catch (error) {
                    reportProblem("audio", error);
                }
            }
            playTones(TONES[sound] ?? TONES.discodo, volume, options.onEnded);
        },
        stop: () => undefined
    };
}

const TONES: Record<string, ReadonlyArray<readonly [number, number]>> = {
    discodo: [[784, 110], [1047, 160]],
    bop_message1: [[660, 90], [880, 120]],
    message1: [[740, 100], [988, 140]],
    message2: [[880, 80], [1175, 120]],
    mention1: [[587, 100], [784, 100], [1047, 150]],
    deafen: [[523, 120], [392, 160]],
    undeafen: [[392, 120], [523, 160]],
    user_join: [[523, 90], [659, 90], [784, 130]],
    user_leave: [[784, 90], [659, 90], [523, 130]],
    ptt_start: [[880, 60]],
    ptt_stop: [[660, 60]]
};

let audioContext: AudioContext | undefined;

function playTones(notes: ReadonlyArray<readonly [number, number]>, volume: number, onEnded?: () => void): void {
    try {
        const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext; }).AudioContext
            ?? (globalThis as { webkitAudioContext?: typeof AudioContext; }).webkitAudioContext;
        if (!Ctor) return;
        audioContext ??= new Ctor();
        const audio = audioContext;
        void audio.resume();
        let at = audio.currentTime + 0.02;
        for (const [frequency, length] of notes) {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.type = "sine";
            oscillator.frequency.value = frequency;
            const seconds = length / 1000;
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.3 * volume), at + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
            oscillator.connect(gain).connect(audio.destination);
            oscillator.start(at);
            oscillator.stop(at + seconds + 0.02);
            at += seconds;
        }
        if (onEnded) setTimeout(onEnded, Math.ceil((at - audio.currentTime) * 1000) + 30);
    } catch (error) {
        reportProblem("audio", error);
    }
}

export function playAudio(sound: string | null | undefined, options: AudioOptions = {}): void {
    if (!sound) return;
    createAudioPlayer(sound, options)?.play();
}

export function defaultAudioNames(): string[] {
    let real: string[] = [];
    try {
        real = getContext().sounds?.list() ?? [];
    } catch {
        real = [];
    }
    return [...new Set([...real, ...Object.keys(TONES)])].sort();
}
