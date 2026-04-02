import React from 'react';
import type { Theme, Platform } from './types';

// ─── Themes ──────────────────────────────────────────────────────────────────

export const THEMES: Record<string, Theme> = {
  midnight:  { label: 'Midnight',      accent: '#d4a853', void: '#07070d', surface: '#0d0d16', card: '#101018', cardUp: '#16161f', text: '#e8e4de', text2: '#b0aaa0', text3: '#706b63', text4: '#3d3a35', glass: 'rgba(255,255,255,0.03)', glassBorder: 'rgba(255,255,255,0.06)', glow: 'rgba(255,255,255,0.08)', bodyBg: '#07070d', preview: ['#07070d','#d4a853','#0d0d16','#e8e4de'] },
  obsidian:  { label: 'Obsidian',      accent: '#8b5cf6', void: '#09090b', surface: '#0f0f14', card: '#13131a', cardUp: '#1a1a22', text: '#e4e2ef', text2: '#a8a4b8', text3: '#5f5b72', text4: '#36333f', glass: 'rgba(139,92,246,0.04)', glassBorder: 'rgba(139,92,246,0.08)', glow: 'rgba(139,92,246,0.1)', bodyBg: '#09090b', preview: ['#09090b','#8b5cf6','#0f0f14','#e4e2ef'] },
  aurora:    { label: 'Aurora',        accent: '#34d399', void: '#060d0b', surface: '#0a1410', card: '#0e1a15', cardUp: '#13211c', text: '#dceee6', text2: '#9abfad', text3: '#4e7363', text4: '#2d4238', glass: 'rgba(52,211,153,0.04)', glassBorder: 'rgba(52,211,153,0.08)', glow: 'rgba(52,211,153,0.1)', bodyBg: '#060d0b', preview: ['#060d0b','#34d399','#0a1410','#dceee6'] },
  ember:     { label: 'Ember',          accent: '#f97316', void: '#0d0806', surface: '#14100c', card: '#1a1410', cardUp: '#221b15', text: '#f0e6dc', text2: '#bfad9a', text3: '#73644f', text4: '#403729', glass: 'rgba(249,115,22,0.04)', glassBorder: 'rgba(249,115,22,0.08)', glow: 'rgba(249,115,22,0.1)', bodyBg: '#0d0806', preview: ['#0d0806','#f97316','#14100c','#f0e6dc'] },
  arctic:    { label: 'Arctic',        accent: '#38bdf8', void: '#060a0f', surface: '#0a1018', card: '#0e1520', cardUp: '#141c28', text: '#dce8f0', text2: '#96b0c4', text3: '#4a6578', text4: '#283848', glass: 'rgba(56,189,248,0.04)', glassBorder: 'rgba(56,189,248,0.08)', glow: 'rgba(56,189,248,0.1)', bodyBg: '#060a0f', preview: ['#060a0f','#38bdf8','#0a1018','#dce8f0'] },
  rose:      { label: 'Ros\u00e9',     accent: '#f472b6', void: '#0d060a', surface: '#140c12', card: '#1a1018', cardUp: '#22161f', text: '#f0dce6', text2: '#c49aaf', text3: '#7a5068', text4: '#42293a', glass: 'rgba(244,114,182,0.04)', glassBorder: 'rgba(244,114,182,0.08)', glow: 'rgba(244,114,182,0.1)', bodyBg: '#0d060a', preview: ['#0d060a','#f472b6','#140c12','#f0dce6'] },
  carbon:    { label: 'Carbon',        accent: '#a1a1aa', void: '#09090b', surface: '#111113', card: '#18181b', cardUp: '#1f1f23', text: '#e4e4e7', text2: '#a1a1aa', text3: '#63636b', text4: '#3a3a40', glass: 'rgba(255,255,255,0.04)', glassBorder: 'rgba(255,255,255,0.07)', glow: 'rgba(255,255,255,0.09)', bodyBg: '#09090b', preview: ['#09090b','#a1a1aa','#111113','#e4e4e7'] },
  sakura:    { label: 'Sakura',        accent: '#e879a0', void: '#0c070a', surface: '#120e11', card: '#1a1318', cardUp: '#201920', text: '#eedde4', text2: '#c4a0af', text3: '#7a5a6a', text4: '#402838', glass: 'rgba(232,121,160,0.04)', glassBorder: 'rgba(232,121,160,0.08)', glow: 'rgba(232,121,160,0.1)', bodyBg: '#0c070a', preview: ['#0c070a','#e879a0','#120e11','#eedde4'] },
  contrast:  { label: 'Contrast',      accent: '#ffff00', void: '#000000', surface: '#0a0a0a', card: '#111111', cardUp: '#1c1c1c', text: '#ffffff', text2: '#ffffff', text3: '#cccccc', text4: '#999999', glass: 'rgba(255,255,255,0.06)', glassBorder: 'rgba(255,255,255,0.45)', glow: 'rgba(255,255,0,0.2)', bodyBg: '#000000', preview: ['#000000','#ffff00','#111111','#ffffff'] },
};

// ─── Platforms ────────────────────────────────────────────────────────────────

export const PLATFORMS: Record<string, Platform> = {
  steam: {
    label: 'Steam', letter: 'S', color: '#66c0f4',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="plat-logo"><path d="M11.979 0C5.678 0 .511 4.86.022 10.95l6.432 2.658a3.387 3.387 0 0 1 1.912-.588c.063 0 .125.002.188.006l2.861-4.142V8.83a4.528 4.528 0 0 1 4.524-4.524 4.528 4.528 0 0 1 4.523 4.524 4.528 4.528 0 0 1-4.523 4.524h-.105l-4.076 2.911c0 .052.004.105.004.159a3.392 3.392 0 0 1-3.39 3.393 3.406 3.406 0 0 1-3.328-2.726L.458 15.167A12.015 12.015 0 0 0 11.979 24c6.627 0 12-5.373 12-12s-5.372-12-12-12zM7.54 18.21l-1.473-.61a2.541 2.541 0 0 0 4.618-.98 2.54 2.54 0 0 0-2.54-2.541 2.52 2.52 0 0 0-1.14.272l1.522.63a1.868 1.868 0 0 1-1.426 3.451l-.002-.001.441-.221zm8.4-6.065a3.02 3.02 0 0 0 3.015-3.015 3.02 3.02 0 0 0-3.015-3.015 3.02 3.02 0 0 0-3.015 3.015 3.02 3.02 0 0 0 3.015 3.015zm-.005-5.27a2.258 2.258 0 1 1 0 4.515 2.258 2.258 0 0 1 0-4.515z"/></svg>,
  },
  epic: {
    label: 'Epic Games', letter: 'E', color: '#a0a0a0',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="plat-logo"><path d="M3.537 0C2.165 0 1.66.506 1.66 1.879V18.44a4.262 4.262 0 0 0 .04.585c.126.767.534 1.274 1.276 1.456.148.037 3.896 1.062 3.896 1.062a.327.327 0 0 0 .11.019c.19 0 .305-.168.305-.168l6.848-8.997.057-.074 2.381-3.126.018-.023s.142-.18.142-.39a.46.46 0 0 0-.143-.348c-.1-.088-2.365-1.584-2.365-1.584a.391.391 0 0 0-.217-.067.393.393 0 0 0-.303.156l-4.36 5.721-3.04-2.19V3.373h9.882v2.404l-3.575-.005s-.352-.006-.352.353.352.353.352.353h4.574s.953-.006.953-.95V1.878C18.14.506 17.634 0 16.262 0H3.537zm3.14 13.063 3.924 2.831-3.924 5.15V13.063z"/></svg>,
  },
  gog: {
    label: 'GOG', letter: 'G', color: '#b44aff',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="plat-logo"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 3.429a8.571 8.571 0 1 1 0 17.142A8.571 8.571 0 0 1 12 3.43zm0 2.857a5.714 5.714 0 1 0 0 11.428A5.714 5.714 0 0 0 12 6.286zm0 2.857a2.857 2.857 0 1 1 0 5.714 2.857 2.857 0 0 1 0-5.714zm-5.09 2.093-.818 3.056 1.09.29.819-3.055zm10.18 0-1.09.29.818 3.056 1.09-.291zM12 6.43l-.546 1.057-.545-1.057h1.09zm0 9.6h-1.09l.544 1.057.546-1.057z"/></svg>,
  },
  psn: {
    label: 'PlayStation', letter: 'P', color: '#0070d1',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="plat-logo"><path d="M8.985 2.596v17.548l3.915 1.261V6.688c0-.69.304-1.151.794-.991.636.181.76.814.76 1.505v5.876c2.441 1.193 4.362-.002 4.362-3.153 0-3.093-1.258-4.15-5.003-5.564-1.907-.718-3.789-1.393-4.828-1.756zM22.07 15.553c-2.127.588-4.35.404-5.889-.263l-.576.249-3.29 1.3-.143.055v2.07l5.803-2.295c.474-.183.84-.076.84.248 0 .325-.366.59-.84.775L12.172 20l-3.187 1.263V23.5l8.96-3.538c.856-.338 1.86-.28 2.685.14.825.42 2.09.267 2.829-.089.74-.357 1.308-.97.541-1.417-.768-.449-1.396-.586-1.93-.413v-2.63zM1.93 16.087c-1.08.353-1.674.979-1.93 1.558v1.762l5.02-1.982c.474-.183.84-.076.84.248 0 .325-.366.59-.84.775L0 20.661v.833c.39.232 1.332.418 2.288.095l5.632-2.227c.856-.337.907-1.078.081-1.498-.826-.42-2.39-.569-3.776-.137l-2.295.909v-2.549z"/></svg>,
  },
  xbox: {
    label: 'Xbox', letter: 'X', color: '#107c10',
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="plat-logo"><path d="M4.102 21.033A11.947 11.947 0 0 0 12 24a11.96 11.96 0 0 0 7.898-2.967c1.58-1.381.208-4.823-2.504-8.368C14.638 9.448 12.756 7.9 12 7.9c-.756 0-2.638 1.548-5.394 4.765-2.712 3.545-4.084 6.987-2.504 8.368zM12 2.4a9.57 9.57 0 0 0-4.56 1.152c1.735.677 3.174 1.773 3.885 2.515.33.345.675.345 1.005.013A12.4 12.4 0 0 1 16.56 3.55 9.57 9.57 0 0 0 12 2.4zM1.59 6.985C.54 8.672 0 10.577 0 12.6c0 2.86 1.005 5.49 2.682 7.554.192-.82.682-1.996 1.678-3.543C6.182 13.863 7.46 12.3 8.538 11.1 6.254 8.547 3.876 7.14 1.59 6.985zm20.82 0c-2.286.155-4.664 1.562-6.948 4.115 1.078 1.2 2.356 2.763 4.178 5.511.996 1.547 1.486 2.723 1.678 3.543A11.94 11.94 0 0 0 24 12.6c0-2.023-.54-3.928-1.59-5.615z"/></svg>,
  },
  custom: {
    label: 'Custom', letter: 'C', color: '#7a7586',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="plat-logo"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
  },
};

export const STREAMING_PLATFORMS: string[] = ['psn', 'xbox'];

// ─── Galaxy layout ───────────────────────────────────────────────────────────

export const GALAXY_W = 3000;
export const GALAXY_H = 2000;

export const CLUSTER_CENTERS: Record<string, { x: number; y: number }> = {
  steam:  { x: 480,  y: 580  },
  epic:   { x: 1450, y: 400  },
  gog:    { x: 2400, y: 560  },
  psn:    { x: 560,  y: 1400 },
  xbox:   { x: 1600, y: 1350 },
  custom: { x: 2500, y: 1350 },
};

// ─── Icon set ────────────────────────────────────────────────────────────────

export const I: Record<string, React.ReactNode> = {
  search:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  play:     <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 001.5.86l11.04-6.86a1 1 0 000-1.72L9.5 4.28A1 1 0 008 5.14z"/></svg>,
  plus:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  scan:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><path d="M8 12h8"/></svg>,
  star:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  starFill: <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  min:      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 6h8"/></svg>,
  max:      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>,
  close:    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3l6 6M9 3l-6 6"/></svg>,
  gear:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  link:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>,
  globe:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
  trash:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
  edit:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  fit:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>,
  zIn:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/></svg>,
  zOut:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M8 11h6"/></svg>,
  orbit:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/></svg>,
  sync:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
  account:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  grid:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  download: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
};
