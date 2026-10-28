/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's own objects are only partly described here */

export interface FluxStore {
    getName?(): string;
    addChangeListener(listener: () => void): void;
    removeChangeListener(listener: () => void): void;
    [key: string]: any;
}

export interface User {
    id: string;
    username?: string;
    [key: string]: any;
}

export interface ModalProps {
    transitionState: number;
    onClose(): void;
    [key: string]: any;
}

export type RenderModalProps = ModalProps;

export interface ModalOptions {
    modalKey?: string;
    onCloseRequest?(): void;
    onCloseCallback?(): void;
    [key: string]: any;
}
