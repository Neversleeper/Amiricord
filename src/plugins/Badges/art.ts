/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The pictures of the two badges that need no list and no download. Drawn for Amiricord (nothing is copied from another mod): small vector images kept
// inside the program as data addresses, so showing them never touches the network.

const asData = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The owners' badge: a gold crown on a deep purple disc. */
export const OWNER_ICON = asData(
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#7a3cff\"/><stop offset=\"1\" stop-color=\"#3b1a8f\"/></linearGradient></defs><circle cx=\"16\" cy=\"16\" r=\"16\" fill=\"url(#g)\"/><path d=\"M7 22 5.5 11.5 11 16l5-8 5 8 5.5-4.5L25 22z\" fill=\"#ffc83d\"/><rect x=\"7\" y=\"23\" width=\"18\" height=\"2.2\" rx=\"1\" fill=\"#ffc83d\"/></svg>"
);

/** The badge of everyone who uses Amiricord: a white letter A on a purple disc. */
export const USER_ICON = asData(
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><circle cx=\"16\" cy=\"16\" r=\"16\" fill=\"#5b2fd6\"/><path d=\"M16 7 8 25h3.4l1.5-3.7h6.2l1.5 3.7H24zm0 7.2 1.9 4.7h-3.8z\" fill=\"#fff\"/></svg>"
);
