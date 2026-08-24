// ─────────────────────────────────────────────────────────────────────────────
// VOLLEYBALL STAT TRACKER — 5-1 Rotation + Full Court
// ─────────────────────────────────────────────────────────────────────────────
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Dimensions, KeyboardAvoidingView, Modal, PanResponder, Platform,
  SafeAreaView, ScrollView, StatusBar,
  StyleSheet, Text, TextInput,
  TouchableOpacity, View, Alert,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import {
  Barlow_400Regular,
  Barlow_500Medium,
  Barlow_600SemiBold,
  Barlow_700Bold,
} from '@expo-google-fonts/barlow';

const { width: SW, height: SH } = Dimensions.get('window');

// Haptic feedback — disabled
const haptic = () => {};
const IS_TABLET = SW > 700;
// fs() is identity — fixed sizes work well across iPad Air and laptop
const fs = (size) => size;

// ── COLOURS ───────────────────────────────────────────────────────────────────
const DARK = {
  bg:      '#0D0D12', surface: '#16181F', card: '#1C1F2A',
  border:  '#252836', muted: '#3A3F55',  dim: '#7A84A0',
  text:    '#E8ECF4', accent: '#B57BEE', accentD: '#6B3FA0',
  green:   '#2EC27E', red: '#E05252',    amber: '#E8A838',
  ourTeam: '#B57BEE', oppTeam: '#E8727A', net: '#B57BEE',
};
const LIGHT = {
  bg:      '#F0F2F8', surface: '#FFFFFF', card: '#E8EBF5',
  border:  '#D0D4E8', muted: '#9099BB',  dim: '#5A6080',
  text:    '#1A1D2E', accent: '#7B3FBF', accentD: '#5A2E8A',
  green:   '#1A9E5C', red: '#CC3333',    amber: '#C07800',
  ourTeam: '#7B3FBF', oppTeam: '#CC3344', net: '#7B3FBF',
};
// C is set dynamically based on theme — default dark
let C = DARK;

// ── ACTIONS ───────────────────────────────────────────────────────────────────
const ACTIONS = {
  spin:     { label: 'Spin',      color: C.accent },
  float:    { label: 'Float',     color: '#7F77DD' },
  receive:  { label: 'Receive',   color: C.green },
  block:    { label: 'Block',     color: C.amber },
  set:      { label: 'Set',       color: '#4F7FFF' },
  attack:   { label: 'Attack',    color: '#F07B5A' },
};

// Actions available per touch context
// our: keyed by touchIndex (capped at 3 for cycling)
// Actions available for OUR team based on position in OUR touch cycle
// ourCyclePos: where we are within our own sequence of touches
//   0 = serve (touch 0 when serving) OR receive/block (first touch in our cycle when receiving)
//   1 = set or attack (second touch in our cycle)
//   2 = attack only (third touch in our cycle)
function getOurActions(touchCount, servingUs) {
  if (servingUs) {
    if (touchCount === 0) return ['spin', 'float']; // we serve
    // After serve: opponent has 3 touches (1,2,3), then we have 3 (4,5,6), repeat
    // Our touches when serving: 4,5,6,10,11,12,...
    // Position within our cycle: (touchCount - 4) % 3 for touches >= 4
    if (touchCount < 4) return null; // not our touch
    const pos = (touchCount - 4) % 3;
    if (pos === 0) return ['receive', 'block'];
    if (pos === 1) return ['set', 'attack'];
    return ['attack'];
  } else {
    // They serve: our touches are 0,1,2,6,7,8,...
    // Position within our cycle: touchCount % 6, first 3 are ours
    const pos = touchCount % 3;
    if (touchCount % 6 < 3) {
      // Our turn in the cycle
      if (pos === 0) return ['receive', 'block'];
      if (pos === 1) return ['set', 'attack'];
      return ['attack'];
    }
    return null; // not our touch
  }
}

const OPP_ACTIONS = ['receive', 'set', 'attack'];

const QUALITY_LABELS = ['Error', 'Poor', 'Good', 'Perfect'];

// ── ROSTERS ───────────────────────────────────────────────────────────────────
// role field distinguishes O1/O2 and M1/M2 within each position group.
// O1 = Smith #3, O2 = Patel #9, M1 = Jones #5, M2 = Okafor #11
// Fallback roster used only if no saved squad exists
const DEFAULT_OUR_ROSTER = [];

// Storage keys
const STORAGE_SQUAD  = '@vb_squad';
const STORAGE_MATCH  = '@vb_last_match';
const STORAGE_HISTORY = '@vb_match_history';

const DEFAULT_OPP_ROSTER = [
  { id: 'p1', num: 1,  name: '', pos: 'S',   role: 'S',   setter: true },
  { id: 'p2', num: 2,  name: '', pos: 'OH',  role: 'O1' },
  { id: 'p3', num: 3,  name: '', pos: 'MB',  role: 'M1' },
  { id: 'p4', num: 4,  name: '', pos: 'OPP', role: 'OPP' },
  { id: 'p5', num: 5,  name: '', pos: 'OH',  role: 'O2' },
  { id: 'p6', num: 6,  name: '', pos: 'MB',  role: 'M2' },
  { id: 'p7', num: 7,  name: '', pos: 'L',   role: 'L',   libero: true },
];

// ── ROTATION SYSTEM ──────────────────────────────────────────────────────────
//
// Three formation types:
//   BASE         — serving formation (and default after rally)
//   RECEIVE      — serve receive formation (fine grid, fractional positions)
//   RECEIVE_BASE — where players move to after the first touch when receiving
//                  (same as BASE for Rot 2-6; Rot 1 has OPP/O1 swapped in front)
//
// BASE uses a coarse 3-col × 2-row grid, expressed as {r, c}
//   r: 0=front(near net), 1=back    c: 0=left, 1=mid, 2=right
//
// RECEIVE uses normalised {x, y} coordinates (0–1 across each axis)
//   x: 0=left → 1=right
//   y: 0.5=net → 1.0=baseline (our half only)

// ── OPP ROTATION SLOTS ───────────────────────────────────────────────────────
// Mirrored from our team's slots. L replaces back-row MB same as our team.
// For opp: r=0 = front (near net), r=1 = back
// x is mirrored: col 0→right, col 2→left (since opp faces opposite direction)
// Libero swap: Rot 1,2,4,5 = L replaces M1/M2; Rot 3,6 = no swap

const OPP_BASE_SLOTS = [
  // Mirrored from our BASE_SLOTS (x flipped: our 1/6→5/6, our 5/6→1/6)
  // Rot 1: Front: O1(5/6) M2(3/6) OPP(1/6) | Back: L(5/6) O2(3/6) S(1/6)
  { S:{x:1/6,y:0.125}, OPP:{x:1/6,y:0.375}, O1:{x:5/6,y:0.375}, O2:{x:3/6,y:0.125}, L:{x:5/6,y:0.125}, M2:{x:3/6,y:0.375} },
  // Rot 2: Front: O2(5/6) M2(3/6) OPP(1/6) | Back: L(5/6) O1(3/6) S(1/6)
  { S:{x:1/6,y:0.125}, OPP:{x:1/6,y:0.375}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, L:{x:5/6,y:0.125}, M2:{x:3/6,y:0.375} },
  // Rot 3: Front: O2(5/6) M1(3/6) OPP(1/6) | Back: M2(5/6) O1(3/6) S(1/6) — no libero
  { S:{x:1/6,y:0.125}, OPP:{x:1/6,y:0.375}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, M1:{x:3/6,y:0.375}, M2:{x:5/6,y:0.125} },
  // Rot 4: Front: S(1/6) M1(3/6) O2(5/6) | Back: OPP(1/6) O1(3/6) L(5/6)
  { S:{x:1/6,y:0.375}, OPP:{x:1/6,y:0.125}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, M1:{x:3/6,y:0.375}, L:{x:5/6,y:0.125} },
  // Rot 5: Front: S(1/6) M1(3/6) O1(5/6) | Back: OPP(1/6) O2(3/6) L(5/6)
  { S:{x:1/6,y:0.375}, OPP:{x:1/6,y:0.125}, O1:{x:5/6,y:0.375}, O2:{x:3/6,y:0.125}, M1:{x:3/6,y:0.375}, L:{x:5/6,y:0.125} },
  // Rot 6: Front: S(1/6) M2(3/6) O1(5/6) | Back: OPP(1/6) O2(3/6) M1(5/6) — no libero
  { S:{x:1/6,y:0.375}, OPP:{x:1/6,y:0.125}, O1:{x:5/6,y:0.375}, O2:{x:3/6,y:0.125}, M1:{x:5/6,y:0.125}, M2:{x:3/6,y:0.375} },
];

// Opp serve receive — mirrored from our RECEIVE_SLOTS
// y coords mirrored: our y=0.60 → opp y=1-0.60=0.40, etc.
// x coords mirrored: our x → 1-x
const OPP_RECEIVE_SLOTS = [
  // Rot 1: mirrored
  { OPP:{x:5/6,y:0.40}, M2:{x:3/6,y:0.40}, O2:{x:5/6,y:0.20}, L:{x:3/6,y:0.20},  O1:{x:1/6,y:0.25}, S:{x:1/6,y:0.08} },
  // Rot 2: mirrored
  { OPP:{x:3/6,y:0.42}, S:{x:3/6,y:0.32}, M2:{x:1/6,y:0.38}, O2:{x:5/6,y:0.18}, L:{x:3/6,y:0.18},  O1:{x:1/6,y:0.18} },
  // Rot 3: mirrored
  { M1:{x:5/6,y:0.42}, S:{x:5/6,y:0.32}, OPP:{x:1/6,y:0.40}, O2:{x:5/6,y:0.18}, O1:{x:3/6,y:0.18}, L:{x:1/6,y:0.18}  },
  // Rot 4: mirrored
  { S:{x:5/6,y:0.42}, M1:{x:4/6,y:0.32}, O2:{x:5/6,y:0.18}, O1:{x:3.5/6,y:0.18}, L:{x:2.2/6,y:0.18},  OPP:{x:0.8/6,y:0.09} },
  // Rot 5: mirrored
  { S:{x:3/6,y:0.40}, M1:{x:1/6,y:0.40}, O1:{x:5/6,y:0.18}, L:{x:3/6,y:0.18},  OPP:{x:1.8/6,y:0.09}, O2:{x:1/6,y:0.18} },
  // Rot 6: mirrored
  { M2:{x:5/6,y:0.40}, S:{x:1/6,y:0.40}, OPP:{x:5.5/6,y:0.08}, O1:{x:4.2/6,y:0.18}, O2:{x:3/6,y:0.18}, L:{x:1/6,y:0.18}  },
];

// Opp after-receive base — direct xy coords (top half, x mirrored)
// front row y=0.375, back row y=0.125
// x: left=1/6, mid=3/6, right=5/6 BUT mirrored so col0=right=5/6
const OPP_RECEIVE_BASE_SLOTS = [
  // Rot 1: OPP left from their pov = RIGHT from our view (x=5/6)
  { OPP:{x:5/6,y:0.375}, M2:{x:3/6,y:0.375}, O1:{x:1/6,y:0.375}, L:{x:5/6,y:0.125}, O2:{x:3/6,y:0.125}, S:{x:1/6,y:0.125} },
  // Rot 2: OPP right from their pov = LEFT from our view (x=1/6)
  { S:{x:1/6,y:0.125}, OPP:{x:1/6,y:0.375}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, L:{x:5/6,y:0.125}, M2:{x:3/6,y:0.375} },
  // Rot 3: OPP right from their pov = LEFT from our view (x=1/6)
  { S:{x:1/6,y:0.125}, OPP:{x:1/6,y:0.375}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, M1:{x:3/6,y:0.375}, L:{x:5/6,y:0.125} },
  // Rot 4: OPP right from their pov = LEFT from our view (x=1/6)
  { S:{x:1/6,y:0.375}, OPP:{x:1/6,y:0.125}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, M1:{x:3/6,y:0.375}, L:{x:5/6,y:0.125} },
  // Rot 5: OPP right from their pov = LEFT from our view (x=1/6)
  { S:{x:1/6,y:0.375}, OPP:{x:1/6,y:0.125}, O1:{x:5/6,y:0.375}, O2:{x:3/6,y:0.125}, M1:{x:3/6,y:0.375}, L:{x:5/6,y:0.125} },
  // Rot 6: OPP right from their pov = LEFT from our view (x=1/6)
  { S:{x:1/6,y:0.375}, OPP:{x:1/6,y:0.125}, O1:{x:5/6,y:0.375}, O2:{x:3/6,y:0.125}, L:{x:5/6,y:0.125}, M2:{x:3/6,y:0.375} },
];

// ── BASE SLOTS (OUR TEAM) ─────────────────────────────────────────────────────
// L (libero) replaces the back-row MB in Rot 1,2,4,5
// Rot 3,6: MB stays in back row (libero not on court)
const BASE_SLOTS = [
  // Rot 1: Front: O1 M2 OPP | Back: L  O2 S   (L replaces M1)
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, L:{r:1,c:0},  M2:{r:0,c:1} },
  // Rot 2: Front: O2 M2 OPP | Back: L  O1 S   (L replaces M1)
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, L:{r:1,c:0},  M2:{r:0,c:1} },
  // Rot 3: Front: O2 M1 OPP | Back: M2 O1 S   (M2 serving from back, no libero)
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:0,c:1}, M2:{r:1,c:0} },
  // Rot 4: Front: O2 M1 S   | Back: L  O1 OPP (L replaces M2)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:0,c:1}, L:{r:1,c:0}  },
  // Rot 5: Front: O1 M1 S   | Back: L  O2 OPP (L replaces M2)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, M1:{r:0,c:1}, L:{r:1,c:0}  },
  // Rot 6: Front: O1 M2 S   | Back: M1 O2 OPP (M1 serving from back, no libero)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, M1:{r:1,c:0}, M2:{r:0,c:1} },
];

// ── SERVE RECEIVE SLOTS (fine grid, fractional x/y) ──────────────────────────
// L replaces the back-row MB in all 6 rotations
const RECEIVE_SLOTS = [
  // Rot 1: L replaces M1 (back-mid)
  { OPP:{x:1/6,y:0.60}, M2:{x:3/6,y:0.60}, O2:{x:1/6,y:0.80}, L:{x:3/6,y:0.80},  O1:{x:5/6,y:0.75}, S:{x:5/6,y:0.92} },
  // Rot 2: L replaces M1 (back-mid)
  { OPP:{x:3/6,y:0.58}, S:{x:3/6,y:0.68}, M2:{x:5/6,y:0.62}, O2:{x:1/6,y:0.82}, L:{x:3/6,y:0.82},  O1:{x:5/6,y:0.82} },
  // Rot 3: L replaces M2 (back-right)
  { M1:{x:1/6,y:0.58}, S:{x:1/6,y:0.68}, OPP:{x:5/6,y:0.60}, O2:{x:1/6,y:0.82}, O1:{x:3/6,y:0.82}, L:{x:5/6,y:0.82}  },
  // Rot 4: L replaces M2 (back-mid-right)
  { S:{x:1/6,y:0.58}, M1:{x:2/6,y:0.68}, O2:{x:1/6,y:0.82}, O1:{x:2.5/6,y:0.82}, L:{x:3.8/6,y:0.82},  OPP:{x:5.2/6,y:0.91} },
  // Rot 5: L replaces M2 (back-mid)
  { S:{x:3/6,y:0.60}, M1:{x:5/6,y:0.60}, O1:{x:1/6,y:0.82}, L:{x:3/6,y:0.82},  OPP:{x:4.2/6,y:0.91}, O2:{x:5/6,y:0.82} },
  // Rot 6: L replaces M1 (back-right)
  { M2:{x:1/6,y:0.60}, S:{x:5/6,y:0.60}, OPP:{x:0.5/6,y:0.92}, O1:{x:1.8/6,y:0.82}, O2:{x:3/6,y:0.82}, L:{x:5/6,y:0.82}  },
];

// ── AFTER RECEIVE → BASE SLOTS ────────────────────────────────────────────────
// L replaces back-row MB in all 6 rotations (same rule as serve receive)
// Rot 1 also has OPP/O1 swapped in front row vs serving base
const RECEIVE_BASE_SLOTS = [
  // Rot 1: OPP LEFT (c:0) — only rotation where OPP is on left
  { OPP:{r:0,c:0}, M2:{r:0,c:1}, O1:{r:0,c:2}, L:{r:1,c:0},  O2:{r:1,c:1}, S:{r:1,c:2} },
  // Rot 2: OPP RIGHT (c:2)
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, L:{r:1,c:0},  M2:{r:0,c:1} },
  // Rot 3: OPP RIGHT (c:2)
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:0,c:1}, L:{r:1,c:0}  },
  // Rot 4: OPP RIGHT back (c:2)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:0,c:1}, L:{r:1,c:0}  },
  // Rot 5: OPP RIGHT back (c:2)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, M1:{r:0,c:1}, L:{r:1,c:0}  },
  // Rot 6: OPP RIGHT back (c:2)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, M1:{r:1,c:0}, M2:{r:0,c:1} },
];

// Convert a BASE {r,c} slot to normalised {x,y} for our team (bottom half)
// or opponent team (top half)
function baseSlotToXY(slot, isOur = true) {
  if (isOur) {
    const x = (slot.c * 2 + 1) / 6;
    const y = 0.5 + (slot.r === 0 ? 0.25 : 0.75) * 0.5;
    return { x, y };
  } else {
    // Opponent: x is mirrored (col 0 = right side, col 2 = left side)
    const x = 1 - (slot.c * 2 + 1) / 6;
    const y = slot.r === 0 ? 0.375 : 0.125;
    return { x, y };
  }
}

// Build lineup from roster + rotation index + formation type
// formation: 'base' | 'receive' | 'receiveBase'
// isOur: true for our team (bottom half), false for opponents (top half)
// Each entry: { ...playerData, xy: {x,y}, roleLabel }
function buildLineup(roster, rotIdx, formation = 'base', isOur = true) {
  const byRole = {};
  roster.forEach(p => { byRole[p.role] = p; });

  let slots;

  if (isOur) {
    // Our team — use our slot tables
    slots = formation === 'receive'
      ? RECEIVE_SLOTS[rotIdx]
      : formation === 'receiveBase'
        ? RECEIVE_BASE_SLOTS[rotIdx]
        : BASE_SLOTS[rotIdx];

    return Object.entries(slots).map(([role, slotOrXY]) => {
      const player = byRole[role];
      if (!player) return null;
      // RECEIVE slots use xy directly; others use {r,c} and need conversion
      const xy = formation === 'receive'
        ? slotOrXY
        : baseSlotToXY(slotOrXY, true);
      return { ...player, xy, roleLabel: role };
    }).filter(Boolean);
  } else {
    // Opponent — all tables use direct xy coords
    slots = formation === 'receive'
      ? OPP_RECEIVE_SLOTS[rotIdx]
      : formation === 'receiveBase'
        ? OPP_RECEIVE_BASE_SLOTS[rotIdx]
        : OPP_BASE_SLOTS[rotIdx];

    return Object.entries(slots).map(([role, xy]) => {
      const player = byRole[role];
      if (!player) return null;
      return { ...player, xy, roleLabel: role };
    }).filter(Boolean);
  }
}

// ── STATS ─────────────────────────────────────────────────────────────────────
// Libero rules:
//   - CAN: receive, dig, set (from behind attack line)
//   - CANNOT: serve, attack above net, block
//   Stats tracked: receives, digs only (no kills/blocks/aces)
function calcStats(rallies, roster) {
  const ps = {};
  roster.forEach(p => {
    ps[p.id] = {
      kills:0, attackErr:0, attackAtt:0,
      aces:0, serveErr:0, serveAtt:0,
      blocks:0, blockErr:0,
      digs:0, recvTotal:0, recvQual:0,
      netErrors:0,
      isLibero: p.pos === 'L',
    };
  });
  let teamKills=0, teamAces=0, teamBlocks=0, teamServes=0, recvTotal=0, recvPerf=0;

  rallies.forEach(r => {
    const touches   = r.touches || [];
    const endReason = r.endReason || '';
    const weWon     = r.outcome === 'our';
    const lastTouch = touches[touches.length - 1];

    touches.forEach((t, idx) => {
      if (!t.playerId || t.team !== 'our') return;
      const p = ps[t.playerId]; if (!p) return;
      const isLastTouch = idx === touches.length - 1;

      // ── ATTACK ──────────────────────────────────────────────────────
      if (t.action === 'attack' && !p.isLibero) {
        p.attackAtt++;
        // Kill: our attack was the last touch and we won
        if (isLastTouch && weWon && (endReason==='floor' || endReason==='block_stuff')) {
          p.kills++; teamKills++;
        }
        // Attack error: our attack was the last touch and we lost
        if (isLastTouch && !weWon && (endReason==='floor' || endReason==='net')) {
          p.attackErr++;
        }
      }

      // ── SERVE ───────────────────────────────────────────────────────
      if ((t.action==='spin' || t.action==='float') && !p.isLibero) {
        p.serveAtt++; teamServes++;
        // Ace: serve result was an ace
        if (endReason==='ace') { p.aces++; teamAces++; }
        // Serve error: serve fault or net on serve
        if (endReason==='serve_fault' || (endReason==='net' && isLastTouch && !weWon)) {
          p.serveErr++;
        }
      }

      // ── BLOCK ───────────────────────────────────────────────────────
      if (t.action==='block' && !p.isLibero) {
        p.blocks++; teamBlocks++;
        // Block error: block was last touch and we lost
        if (isLastTouch && !weWon) p.blockErr++;
      }

      // ── DIGS — mid-rally receives (not serve receive) ────────────────
      if (t.action==='receive') {
        // Serve receive: all opponent touches before this were serves
        const priorOurTouch = touches.slice(0, idx).find(x => x.team==='our');
        const isServeReceive = !priorOurTouch; // first our touch = serve receive
        if (isServeReceive) {
          // Serve receive — track quality
          p.recvTotal++; recvTotal++;
          p.recvQual += (t.quality || 0);
          if (t.quality===3) recvPerf++;
        } else {
          // Mid-rally receive = dig
          p.digs++;
        }
      }
    });

    // Net errors
    if (endReason==='net' && lastTouch?.team==='our' && ps[lastTouch.playerId]) {
      ps[lastTouch.playerId].netErrors++;
    }
  });

  // ── FIRST BALL SIDEOUT % ─────────────────────────────────────────────────
  // How often we win the point when receiving serve
  let sideoutWon = 0, sideoutTotal = 0;
  rallies.forEach(r => {
    const touches = r.touches || [];
    // We were receiving if our first touch is a receive action
    const ourFirstTouch = touches.find(t => t.team === 'our');
    const weReceived = ourFirstTouch?.action === 'receive';
    if (weReceived) {
      sideoutTotal++;
      if (r.outcome === 'our') sideoutWon++;
    }
  });

  // ── PER-ROTATION STATS ───────────────────────────────────────────────────
  // Points won/lost per rotation (rotation at rally start)
  const rotStats = [0,1,2,3,4,5].map(i => ({ rot: i+1, won:0, lost:0 }));
  rallies.forEach(r => {
    const rot = r.ourRotation !== undefined ? r.ourRotation : null;
    if (rot === null) return;
    if (r.outcome === 'our') rotStats[rot].won++;
    else rotStats[rot].lost++;
  });

  return { ps, teamKills, teamAces, teamBlocks, teamServes, recvTotal, recvPerf,
    sideoutWon, sideoutTotal, rotStats };
}

// ── OPPONENT STATS CALCULATION ───────────────────────────────────────────────
function calcOppStats(rallies, oppRoster) {
  const ps = {};
  oppRoster.forEach(p => {
    ps[p.id] = {
      kills:0, attackErr:0, attackAtt:0,
      aces:0, serveErr:0, serveAtt:0,
      blocks:0, digs:0, recvTotal:0, recvQual:0,
    };
  });
  let teamKills=0, teamAces=0, teamBlocks=0;

  rallies.forEach(r => {
    const touches = r.touches || [];
    const endReason = r.endReason || '';
    const weWon = r.outcome === 'our'; // from our perspective
    const lastTouch = touches[touches.length - 1];

    touches.forEach((t, idx) => {
      if (t.team !== 'opp') return;
      const p = ps[t.playerId]; if (!p) return;
      const isLastTouch = idx === touches.length - 1;

      // Attack
      if (t.action === 'attack') {
        p.attackAtt++;
        // Opp kill = opp attacked last + they won (we lost)
        if (isLastTouch && !weWon && (endReason==='floor' || endReason==='block_stuff')) {
          p.kills++; teamKills++;
        }
        if (isLastTouch && weWon && (endReason==='floor' || endReason==='net')) {
          p.attackErr++;
        }
      }
      // Serve
      if (t.action==='spin' || t.action==='float') {
        p.serveAtt++;
        if (endReason==='ace' && !weWon) { p.aces++; teamAces++; }
        if (endReason==='serve_fault' || (endReason==='net' && isLastTouch && weWon)) p.serveErr++;
      }
      // Block
      if (t.action==='block') {
        p.blocks++; teamBlocks++;
      }
      // Digs
      if (t.action==='receive') {
        const isServeReceive = touches.slice(0,idx).every(prev => prev.team==='our');
        if (!isServeReceive) p.digs++;
        else { p.recvTotal++; p.recvQual += (t.quality||0); }
      }
    });
  });

  return { ps, teamKills, teamAces, teamBlocks };
}

// ── MVP CALCULATION ──────────────────────────────────────────────────────────
function calcMVP(ps, roster) {
  let best = null, bestScore = -Infinity;

  roster.forEach(p => {
    const s = ps[p.id];
    if (!s) return;

    // Reception breakdown (quality 3 = perfect, 2 = good, 1 = poor, 0 = error)
    const perfectRecv = s.recvTotal > 0 ? Math.round(s.recvQual / s.recvTotal >= 2.5 ? s.recvTotal * 0.4 : s.recvTotal * 0.2) : 0;
    const goodRecv    = s.recvTotal > 0 ? Math.round(s.recvTotal * 0.4) : 0;
    const recvErrors  = s.recvTotal > 0 ? Math.round(s.recvTotal * (1 - s.recvQual / s.recvTotal / 3)) : 0;

    const score =
      (s.kills     * 4) +
      (s.aces      * 4) +
      (s.blocks    * 3) +   // stuff blocks
      (s.digs      * 1.5) +
      (perfectRecv * 2) +
      (goodRecv    * 1) -
      (s.attackErr * 2) -
      (s.serveErr  * 2) -
      (recvErrors  * 1);

    const attEff  = s.attackAtt > 0 ? (s.kills - s.attackErr) / s.attackAtt : 0;
    const recvPct = s.recvTotal > 0 ? s.recvQual / s.recvTotal / 3 : 0;

    if (score > bestScore) {
      bestScore = score;
      best = {
        player: p,
        stats: s,
        score: score.toFixed(1),
        highlights: buildHighlights(s, recvPct, attEff),
      };
    }
  });

  return best;
}

function buildHighlights(s, recvPct, attEff) {
  const h = [];
  if (s.kills > 0)      h.push(`${s.kills} Kill${s.kills>1?'s':''}`);
  if (s.aces > 0)       h.push(`${s.aces} Ace${s.aces>1?'s':''}`);
  if (s.blocks > 0)     h.push(`${s.blocks} Block${s.blocks>1?'s':''}`);
  if (s.digs > 0)       h.push(`${s.digs} Dig${s.digs>1?'s':''}`);
  if (s.recvTotal > 0)  h.push(`${Math.round(recvPct*100)}% Reception`);
  if (s.attackAtt > 0)  h.push(`${Math.round(attEff*100)}% Att Eff`);
  if (s.attackErr > 0)  h.push(`${s.attackErr} Err`);
  return h;
}

// ── OUTCOME LOGIC ─────────────────────────────────────────────────────────────
function determineOutcomeFromTap(x, y, cw, ch, lastTouchTeam, flipped = false) {
  const LEFT=cw*0.08, RIGHT=cw*0.92, TOP=ch*0.05, BOTTOM=ch*0.95, NET=ch*0.5;
  const inBounds = x>LEFT && x<RIGHT && y>TOP && y<BOTTOM;
  // When flipped (sides switched), opponent is at bottom (y > NET)
  const oppSide  = flipped ? y > NET : y < NET;

  if (!inBounds) {
    return lastTouchTeam === 'our'
      ? { outcome:'them', reason:'Ball out of bounds — our error' }
      : { outcome:'our',  reason:'Ball out of bounds — their error' };
  }
  return oppSide
    ? { outcome:'our',  reason:'Ball landed in opponent court' }
    : { outcome:'them', reason:'Ball landed on our court' };
}

// ── TOUCH SEQUENCE ───────────────────────────────────────────────────────────
// When WE serve:
//   Touch 0 → serve (us)
//   Touch 1 → receive (them)
//   Touch 2 → set (them)
//   Touch 3 → attack (them)
//   Touch 4 → receive (us)  ← loops
//   ...
//
// When THEY serve:
//   Opponent serve is NOT logged — we start from our receive:
//   Touch 0 → receive (us)
//   Touch 1 → set (us)
//   Touch 2 → attack (us)
//   Touch 3 → receive (them) ← loops
//   ...
// Count non-block touches for sequence tracking
// Blocks don't consume one of the 3 touches
function countNonBlockTouches(touches) {
  return touches.filter(t => t.action !== 'block').length;
}

// Get last non-block touch
function lastNonBlockTouch(touches) {
  for (let i = touches.length - 1; i >= 0; i--) {
    if (touches[i].action !== 'block') return touches[i];
  }
  return null;
}

function inferNextAction(touchCount, servingUs) {
  // Each team gets receive→set→attack per 3-touch cycle
  if (servingUs) {
    if (touchCount === 0) return 'spin'; // our serve
    const pos = (touchCount - 1) % 3;
    if (pos === 0) return 'receive';
    if (pos === 1) return 'set';
    return 'attack';
  } else {
    const pos = touchCount % 3;
    if (pos === 0) return 'receive';
    if (pos === 1) return 'set';
    return 'attack';
  }
}

// ── HIGHLIGHT RULES ──────────────────────────────────────────────────────────
// Server for each rotation (role that just crossed from front to back-right)
const SERVERS = ['S', 'O1', 'M2', 'OPP', 'O2', 'M1'];

// Back row for SERVING team (libero not on court when MB is serving in Rot 3, 6)
const BACK_ROW_SERVE = [
  ['L',  'O2', 'S'],   // Rot 1
  ['L',  'O1', 'S'],   // Rot 2
  ['M2', 'O1', 'S'],   // Rot 3 (M2 serving, no libero)
  ['L',  'O1', 'OPP'], // Rot 4
  ['L',  'O2', 'OPP'], // Rot 5
  ['M1', 'O2', 'OPP'], // Rot 6 (M1 serving, no libero)
];

// Back row for RECEIVING team (libero always on court)
const BACK_ROW_RECEIVE = [
  ['L',  'O2', 'S'],   // Rot 1
  ['L',  'O1', 'S'],   // Rot 2
  ['L',  'O1', 'S'],   // Rot 3 (L replaces M2)
  ['L',  'O1', 'OPP'], // Rot 4
  ['L',  'O2', 'OPP'], // Rot 5
  ['L',  'O2', 'OPP'], // Rot 6 (L replaces M1)
];

// Alias for backward compat — defaults to receive version
const BACK_ROW = BACK_ROW_RECEIVE;

// Front row attack highlights per rotation
// Rot 1-3: full front row. Rot 4-6: replace S with OPP (S doesn't attack)
const ATTACKERS = [
  ['O1', 'M2', 'OPP'], // Rot 1
  ['O2', 'M2', 'OPP'], // Rot 2
  ['O2', 'M1', 'OPP'], // Rot 3
  ['O2', 'M1', 'OPP'], // Rot 4
  ['O1', 'M1', 'OPP'], // Rot 5
  ['O1', 'M2', 'OPP'], // Rot 6
];

// Front row blockers per rotation — who should jump when opponent attacks
// Same as ATTACKERS but for our team defending
const BLOCKERS = [
  ['O1', 'M2', 'OPP'], // Rot 1
  ['O2', 'M2', 'OPP'], // Rot 2
  ['O2', 'M1', 'OPP'], // Rot 3
  ['O2', 'M1', 'S'],   // Rot 4 (S in front)
  ['O1', 'M1', 'S'],   // Rot 5
  ['O1', 'M2', 'S'],   // Rot 6
];

// Returns true if the next touch is expected to be OUR team
function isOurTouch(touchCount, servingUs) {
  if (servingUs) {
    if (touchCount === 0) return true; // our serve
    // After serve: opp gets 3, we get 3, alternating
    const afterServe = touchCount - 1;
    const cycle = Math.floor(afterServe / 3);
    return cycle % 2 === 1; // odd cycles = ours
  } else {
    // They serve: we get 3, they get 3, alternating
    const cycle = Math.floor(touchCount / 3);
    return cycle % 2 === 0; // even cycles = ours
  }
}

// Returns array of player IDs to highlight given current touch and rotation
// Only highlights OUR players — returns empty array when it's the opponent's turn
function getHighlightIds(touchCount, servingUs, rotIdx, lineup, touches = [], oppServed = false, formation = 'base') {
  const byRole = {};
  lineup.forEach(p => { byRole[p.roleLabel] = p.id; });

  // When they serve and server NOT yet tapped → no highlights for our team
  if (!servingUs && !oppServed) return [];

  // When they serve and server HAS been tapped but we haven't received yet
  if (!servingUs && oppServed && touchCount === 0) {
    return ['O1', 'O2', 'L'].map(r => byRole[r]).filter(Boolean);
  }

  // Don't highlight our players when it's the other team's touch
  if (!isOurTouch(touchCount, servingUs)) return [];

  const action = inferNextAction(touchCount, servingUs);
  let roles = [];

  // If last non-block touch was an opponent attack — use actual back row on court
  if (action === 'receive' && lastTouchWasOppAttack(touches)) {
    const backRow = formation === 'base' ? BACK_ROW_SERVE : BACK_ROW_RECEIVE;
    return backRow[rotIdx].map(r => byRole[r]).filter(Boolean);
  }

  if (action === 'spin' || action === 'float') {
    roles = [SERVERS[rotIdx]];
  } else if (action === 'receive') {
    if (!servingUs && touchCount === 0) {
      roles = ['O1', 'O2', 'L'];
    } else {
      const backRow = formation === 'base' ? BACK_ROW_SERVE : BACK_ROW_RECEIVE;
      roles = backRow[rotIdx];
    }
  } else if (action === 'set') {
    // If setter received the previous touch, libero sets instead
    const prevTouch = touches[touches.length - 1];
    const setterReceivedLast = prevTouch?.team === 'our' &&
      lineup.find(p => p.id === prevTouch.playerId)?.roleLabel === 'S';
    roles = setterReceivedLast ? ['L'] : ['S'];
  } else if (action === 'attack') {
    roles = ATTACKERS[rotIdx];
  }

  return roles.map(r => byRole[r]).filter(Boolean);
}

// Returns true if the last touch was an opponent attack (we should be blocking)
function lastTouchWasOppAttack(touches) {
  const last = lastNonBlockTouch(touches);
  return last && last.team === 'opp' && last.action === 'attack';
}

// Returns front row blocker IDs (highlighted amber) when opponent attacks
function getBlockerIds(touchCount, servingUs, rotIdx, lineup, touches) {
  if (!isOurTouch(touchCount, servingUs)) return [];
  const action = inferNextAction(touchCount, servingUs);
  if (action !== 'receive') return [];
  if (!lastTouchWasOppAttack(touches)) return [];
  const byRole = {};
  lineup.forEach(p => { byRole[p.roleLabel] = p.id; });
  return BLOCKERS[rotIdx].map(r => byRole[r]).filter(Boolean);
}

// Returns opponent front row blocker IDs (amber) when our team attacks
function getOppBlockerIds(touchCount, servingUs, rotIdx, oppLineup, touches) {
  // Only when it's opp's turn to receive (after our attack)
  if (isOurTouch(touchCount, servingUs)) return [];
  const action = inferNextAction(touchCount, servingUs);
  if (action !== 'receive') return [];
  // Last touch must be our attack
  const last = lastNonBlockTouch(touches);
  if (!last || last.team !== 'our' || last.action !== 'attack') return [];
  const byRole = {};
  oppLineup.forEach(p => { byRole[p.roleLabel] = p.id; });
  return OPP_ATTACKERS[rotIdx].map(r => byRole[r]).filter(Boolean); // front row = their blockers
}

// ── OPP HIGHLIGHT TABLES ─────────────────────────────────────────────────────
// Same structure as our team — mirrored rotation logic

// Opp back row per rotation (for mid-rally receives/digs)
// OPP back row — same split logic
const OPP_BACK_ROW_SERVE = [
  ['L',  'O2', 'S'],   // Rot 1
  ['L',  'O1', 'S'],   // Rot 2
  ['M2', 'O1', 'S'],   // Rot 3 (M2 serving, no libero)
  ['L',  'O1', 'OPP'], // Rot 4
  ['L',  'O2', 'OPP'], // Rot 5
  ['M1', 'O2', 'OPP'], // Rot 6 (M1 serving, no libero)
];
const OPP_BACK_ROW_RECEIVE = [
  ['L',  'O2', 'S'],   // Rot 1
  ['L',  'O1', 'S'],   // Rot 2
  ['L',  'O1', 'S'],   // Rot 3
  ['L',  'O1', 'OPP'], // Rot 4
  ['L',  'O2', 'OPP'], // Rot 5
  ['L',  'O2', 'OPP'], // Rot 6
];
const OPP_BACK_ROW = OPP_BACK_ROW_RECEIVE;

// Opp front row attackers per rotation
// Rot 1-3: full front row. Rot 4-6: OPP highlighted instead of S
const OPP_ATTACKERS = [
  ['O1', 'M2', 'OPP'], // Rot 1
  ['O2', 'M2', 'OPP'], // Rot 2
  ['O2', 'M1', 'OPP'], // Rot 3
  ['O2', 'M1', 'OPP'], // Rot 4
  ['O1', 'M1', 'OPP'], // Rot 5
  ['O1', 'M2', 'OPP'], // Rot 6
];

// Returns array of opponent player IDs to highlight
function getOppHighlightIds(touchCount, servingUs, rotIdx, oppLineup, touches, oppServed = true) {
  const byRole = {};
  oppLineup.forEach(p => { byRole[p.roleLabel] = p.id; });

  // When they serve and server hasn't been tapped yet → highlight their server
  if (!servingUs && !oppServed) {
    return [byRole[SERVERS[rotIdx]]].filter(Boolean);
  }

  // Only highlight opp when it's their turn
  if (isOurTouch(touchCount, servingUs)) return [];

  const action = inferNextAction(touchCount, servingUs);
  let roles = [];

  if (action === 'spin' || action === 'float') {
    roles = [SERVERS[rotIdx]];
  } else if (action === 'receive') {
    if (servingUs && touchCount === 1) {
      roles = ['O1', 'O2', 'L'];
    } else {
      // Opp is receiving/digging → libero always on court
      roles = OPP_BACK_ROW_RECEIVE[rotIdx];
    }
  } else if (action === 'set') {
    const lastOppTouch = [...touches].reverse().find(t => t.team === 'opp');
    const lastWasSetter = lastOppTouch &&
      oppLineup.find(p => p.id === lastOppTouch.playerId)?.roleLabel === 'S';
    roles = lastWasSetter ? ['L'] : ['S'];
  } else if (action === 'attack') {
    roles = OPP_ATTACKERS[rotIdx];
  }

  return roles.map(r => byRole[r]).filter(Boolean);
}

const SUB_LIMIT = 6;

// ─────────────────────────────────────────────────────────────────────────────
// HOME SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function HomeScreen({ onNewMatch, onContinue, hasLastMatch, matchHistory = [] }) {
  // Compute record from history
  const wins   = matchHistory.filter(m => m.ourSets > m.theirSets).length;
  const losses = matchHistory.filter(m => m.ourSets < m.theirSets).length;
  const lastMatch = matchHistory[0] || null;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView contentContainerStyle={{flexGrow:1, padding:24}}>

        {/* Header */}
        <View style={{alignItems:'center', paddingTop:32, paddingBottom:24}}>
          <Text style={{fontSize:fs(42), fontWeight:'700', color:C.accent,
            fontFamily:'Barlow_700Bold', letterSpacing:3, lineHeight:46}}>
            VOLLEY
          </Text>
          <Text style={{fontSize:fs(42), fontWeight:'700', color:C.text,
            fontFamily:'Barlow_700Bold', letterSpacing:3, marginTop:-6}}>
            STATS
          </Text>
          <Text style={{fontSize:fs(12), color:C.dim, fontFamily:'Barlow_400Regular',
            marginTop:8, letterSpacing:1}}>
            Performance tracking for volleyball
          </Text>
        </View>

        {/* Win/loss record */}
        {matchHistory.length > 0 && (
          <View style={{flexDirection:'row', gap:10, justifyContent:'center', marginBottom:24}}>
            <View style={{alignItems:'center', paddingHorizontal:20, paddingVertical:10,
              backgroundColor:C.green+'22', borderRadius:12, borderWidth:1, borderColor:C.green+'44'}}>
              <Text style={{color:C.green, fontSize:fs(28), fontFamily:'Barlow_700Bold'}}>{wins}</Text>
              <Text style={{color:C.green, fontSize:fs(11), fontFamily:'Barlow_500Medium'}}>WINS</Text>
            </View>
            <View style={{alignItems:'center', paddingHorizontal:16, paddingVertical:10,
              backgroundColor:C.surface, borderRadius:12, borderWidth:1, borderColor:C.border}}>
              <Text style={{color:C.text, fontSize:fs(28), fontFamily:'Barlow_700Bold'}}>{wins+losses}</Text>
              <Text style={{color:C.dim, fontSize:fs(11), fontFamily:'Barlow_500Medium'}}>PLAYED</Text>
            </View>
            <View style={{alignItems:'center', paddingHorizontal:20, paddingVertical:10,
              backgroundColor:C.red+'22', borderRadius:12, borderWidth:1, borderColor:C.red+'44'}}>
              <Text style={{color:C.red, fontSize:fs(28), fontFamily:'Barlow_700Bold'}}>{losses}</Text>
              <Text style={{color:C.red, fontSize:fs(11), fontFamily:'Barlow_500Medium'}}>LOSSES</Text>
            </View>
          </View>
        )}

        {/* Last match summary */}
        {lastMatch && (
          <View style={{padding:14, borderRadius:12, backgroundColor:C.card,
            borderWidth:1, borderColor:C.border, marginBottom:20}}>
            <Text style={{color:C.muted, fontSize:fs(10), letterSpacing:1.5,
              textTransform:'uppercase', fontFamily:'Barlow_600SemiBold', marginBottom:8}}>
              Last Match
            </Text>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center'}}>
              <View style={{flex:1}}>
                <Text style={{color:C.text, fontSize:fs(16), fontFamily:'Barlow_700Bold'}}>
                  {lastMatch.ourName}
                </Text>
                <Text style={{color:C.muted, fontSize:fs(12), fontFamily:'Barlow_400Regular'}}>vs {lastMatch.theirName}</Text>
                <Text style={{color:C.dim, fontSize:fs(11), marginTop:4}}>{lastMatch.date}</Text>
              </View>
              <View style={{alignItems:'center', gap:4}}>
                <Text style={{
                  color: lastMatch.ourSets > lastMatch.theirSets ? C.accent : C.oppTeam,
                  fontSize:fs(32), fontFamily:'Barlow_700Bold', lineHeight:36,
                }}>
                  {lastMatch.ourSets}–{lastMatch.theirSets}
                </Text>
                <View style={{paddingHorizontal:12, paddingVertical:2, borderRadius:8,
                  backgroundColor: lastMatch.ourSets > lastMatch.theirSets ? C.green+'22' : C.red+'22'}}>
                  <Text style={{
                    color: lastMatch.ourSets > lastMatch.theirSets ? C.green : C.red,
                    fontSize:fs(11), fontFamily:'Barlow_700Bold',
                  }}>
                    {lastMatch.ourSets > lastMatch.theirSets ? 'WIN' : 'LOSS'}
                  </Text>
                </View>
              </View>
            </View>
            {lastMatch.setHistory && (
              <View style={{flexDirection:'row', gap:8, marginTop:8, flexWrap:'wrap'}}>
                {lastMatch.setHistory.map((sh, i) => (
                  <Text key={i} style={{
                    color: sh.winner==='our' ? C.accent : C.oppTeam,
                    fontSize:fs(12), fontFamily:'Barlow_600SemiBold',
                  }}>{sh.ourScore}–{sh.theirScore}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Action buttons */}
        <View style={{gap:12, marginBottom:28}}>
          <TouchableOpacity style={s.bigBtn} onPress={onNewMatch}>
            <Text style={s.bigBtnText}>＋  New Match</Text>
          </TouchableOpacity>
          {hasLastMatch && (
            <TouchableOpacity
              style={[s.bigBtn, {backgroundColor:C.surface, borderWidth:1, borderColor:C.accent}]}
              onPress={onContinue}
            >
              <Text style={[s.bigBtnText, {color:C.accent}]}>▶  Continue Last Match</Text>
            </TouchableOpacity>
          )}

        </View>

        {/* Full match history list — skip first since shown above */}
        {matchHistory.length > 1 && (
          <View style={{marginBottom:20}}>
            <Text style={{color:C.dim, fontSize:fs(11), letterSpacing:1.5,
              textTransform:'uppercase', fontFamily:'Barlow_600SemiBold', marginBottom:10}}>
              Previous Matches
            </Text>
            {matchHistory.slice(1, 5).map(m => (
              <View key={m.id} style={{
                padding:12, borderRadius:10, backgroundColor:C.card,
                borderWidth:1, borderColor:C.border, marginBottom:8,
              }}>
                <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center'}}>
                  <View style={{flex:1}}>
                    <Text style={{color:C.text, fontSize:fs(13), fontFamily:'Barlow_600SemiBold'}}>
                      {m.ourName} vs {m.theirName}
                    </Text>
                    <Text style={{color:C.dim, fontSize:fs(11), fontFamily:'Barlow_400Regular', marginTop:2}}>
                      {m.date} · {m.ralliesCount} rallies
                    </Text>
                  </View>
                  <View style={{alignItems:'center'}}>
                    <Text style={{color: m.ourSets > m.theirSets ? C.accent : C.oppTeam,
                      fontSize:fs(18), fontFamily:'Barlow_700Bold'}}>
                      {m.ourSets}–{m.theirSets}
                    </Text>
                    <Text style={{color: m.ourSets > m.theirSets ? C.green : C.red,
                      fontSize:fs(10), fontFamily:'Barlow_600SemiBold'}}>
                      {m.ourSets > m.theirSets ? 'WIN' : 'LOSS'}
                    </Text>
                  </View>
                </View>
                {m.setHistory && (
                  <View style={{flexDirection:'row', gap:6, marginTop:6}}>
                    {m.setHistory.map((sh, i) => (
                      <Text key={i} style={{color: sh.winner==='our' ? C.accent : C.oppTeam,
                        fontSize:fs(11), fontFamily:'Barlow_600SemiBold'}}>
                        {sh.ourScore}–{sh.theirScore}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP SCREEN
// ─────────────────────────────────────────────────────────────────────────────
const ROLES = ['S','O1','O2','M1','M2','OPP','L'];
const ROLE_LABELS = { S:'Setter', O1:'Outside 1', O2:'Outside 2', M1:'Middle 1', M2:'Middle 2', OPP:'Opposite', L:'Libero' };
const ROLE_POS = { S:'S', O1:'OH', O2:'OH', M1:'MB', M2:'MB', OPP:'OPP', L:'L' };

function SetupScreen({ squad, onSaveSquad, onStartMatch }) {
  const [step, setStep] = useState(1); // 1=squad, 2=starting6, 3=matchInfo
  const [localSquad, setLocalSquad] = useState(squad.length > 0 ? squad : []);
  const [assignments, setAssignments] = useState({ S:null,O1:null,O2:null,M1:null,M2:null,OPP:null,L:null });
  const [pickingRole, setPickingRole] = useState(null); // which role slot is being picked
  const [ourName, setOurName] = useState('');
  const [theirName, setTheirName] = useState('');
  const [rotation, setRotation] = useState(0);
  const [servingUs, setServingUs] = useState(true);
  // Opponent jersey numbers (7 players: S, O1, O2, M1, M2, OPP, L)
  const OPP_ROLES_ORDER = ['S','O1','O2','M1','M2','OPP','L'];
  const [oppNums, setOppNums] = useState({S:'',O1:'',O2:'',M1:'',M2:'',OPP:'',L:''});

  // Squad editor state
  const [editPlayer, setEditPlayer] = useState(null); // {id, num, name, pos} or null for new
  const [editNum,  setEditNum]  = useState('');
  const [editName, setEditName] = useState('');

  function openAddPlayer() {
    setEditPlayer({id: null});
    setEditNum(''); setEditName('');
  }

  function openEditPlayer(p) {
    setEditPlayer(p);
    setEditNum(String(p.num)); setEditName(p.name);
  }

  function savePlayer() {
    if (!editName.trim() || !editNum.trim()) return;
    const num = parseInt(editNum);
    if (isNaN(num)) return;
    let newSquad;
    if (editPlayer.id) {
      newSquad = localSquad.map(p => p.id === editPlayer.id
        ? { ...p, num, name: editName.trim() }
        : p
      );
    } else {
      const id = 'p_' + Date.now();
      newSquad = [...localSquad, { id, num, name: editName.trim(), pos: null, role: null }];
    }
    setLocalSquad(newSquad);
    setEditPlayer(null);
  }

  function removePlayer(id) {
    setLocalSquad(prev => prev.filter(p => p.id !== id));
    // Clear any assignment using this player
    setAssignments(prev => {
      const next = {...prev};
      Object.keys(next).forEach(r => { if (next[r]?.id === id) next[r] = null; });
      return next;
    });
  }

  function assignPlayer(player) {
    if (!pickingRole) return;
    // Un-assign this player from any other role first
    setAssignments(prev => {
      const next = {...prev};
      Object.keys(next).forEach(r => { if (next[r]?.id === player.id) next[r] = null; });
      next[pickingRole] = player;
      return next;
    });
    setPickingRole(null);
  }

  function canStartMatch() {
    return ROLES.every(r => assignments[r] !== null);
  }

  function handleStartMatch() {
    if (!canStartMatch()) return;
    // Build roster from assignments
    const roster = ROLES.map(role => {
      const p = assignments[role];
      return {
        ...p,
        role,
        pos: ROLE_POS[role],
        setter: role === 'S',
        libero: role === 'L',
      };
    });
    onSaveSquad(localSquad);
    onStartMatch({ roster, ourName, theirName, rotation, servingUs, oppNums });
  }

  // ── Assigned player IDs (to grey out in squad list)
  const assignedIds = new Set(Object.values(assignments).filter(Boolean).map(p => p.id));

  const posColor = { S: C.accent, OH: C.green, MB: '#4F7FFF', OPP: C.oppTeam, L: C.amber };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView
        style={{flex:1}}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >

      {/* Header */}
      <View style={s.scoreBar}>
        <Text style={{fontSize:16, fontWeight:'700', color:C.text, fontFamily:'Barlow_700Bold'}}>
          {step === 1 ? 'Squad' : step === 2 ? 'Starting 6' : 'Match Info'}
        </Text>
        <View style={{flexDirection:'row', gap:6}}>
          {[1,2,3].map(n => (
            <View key={n} style={{width:24, height:4, borderRadius:2,
              backgroundColor: n <= step ? C.accent : C.border}} />
          ))}
        </View>
      </View>

      {/* ── STEP 1: Squad editor ── */}
      {step === 1 && (
        <View style={{flex:1}}>
          <ScrollView style={{flex:1}} contentContainerStyle={{padding:14, gap:8, paddingBottom:20}}>
            <Text style={{color:C.dim, fontSize:12, fontFamily:'Barlow_400Regular', marginBottom:4}}>
              Add up to 14 players. You'll pick the starting 6 next.
            </Text>

            {localSquad.map(p => (
              <View key={p.id} style={[s.card, {flexDirection:'row', alignItems:'center', gap:10}]}>
                <View style={{width:36, height:36, borderRadius:18, backgroundColor:C.surface,
                  borderWidth:1.5, borderColor:C.accent,
                  alignItems:'center', justifyContent:'center'}}>
                  <Text style={{fontSize:13, fontWeight:'700', color:C.accent, fontFamily:'Barlow_700Bold'}}>
                    #{p.num}
                  </Text>
                </View>
                <Text style={{flex:1, color:C.text, fontSize:14, fontFamily:'Barlow_500Medium'}}>{p.name}</Text>
                <TouchableOpacity onPress={() => openEditPlayer(p)} style={{padding:8}}>
                  <Text style={{color:C.dim, fontSize:12}}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removePlayer(p.id)} style={{padding:8}}>
                  <Text style={{color:C.red, fontSize:12}}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}

            {localSquad.length < 14 && (
              <TouchableOpacity
                style={[s.card, {borderStyle:'dashed', borderColor:C.muted, alignItems:'center', padding:16}]}
                onPress={openAddPlayer}
              >
                <Text style={{color:C.muted, fontSize:14, fontFamily:'Barlow_500Medium'}}>+ Add Player</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          <View style={{padding:14}}>
            <TouchableOpacity
              style={[s.bigBtn, {backgroundColor: localSquad.length >= 7 ? C.accent : C.muted}]}
              onPress={() => { if (localSquad.length >= 7) setStep(2); }}
            >
              <Text style={s.bigBtnText}>Next: Pick Starting 6 →</Text>
            </TouchableOpacity>
            {localSquad.length < 7 && (
              <Text style={{textAlign:'center', color:C.red, fontSize:11, marginTop:6, fontFamily:'Barlow_400Regular'}}>
                Need at least 7 players (6 + libero)
              </Text>
            )}
          </View>
        </View>
      )}

      {/* ── STEP 2: Assign starting 6 ── */}
      {step === 2 && (
        <View style={{flex:1, flexDirection: IS_TABLET ? 'row' : 'column'}}>

          {/* Role slots */}
          <ScrollView style={{flex:1}} contentContainerStyle={{padding:14, gap:8, paddingBottom:80}}>
            <Text style={{color:C.dim, fontSize:12, fontFamily:'Barlow_400Regular', marginBottom:4}}>
              Tap a role to assign a player from your squad.
            </Text>
            {ROLES.map(role => {
              const assigned = assignments[role];
              const isActive = pickingRole === role;
              const roleColor = posColor[ROLE_POS[role]] || C.muted;
              return (
                <TouchableOpacity
                  key={role}
                  style={[s.card, {flexDirection:'row', alignItems:'center', gap:12,
                    borderColor: isActive ? C.accent : assigned ? roleColor+'66' : C.border,
                    borderWidth: isActive ? 2 : 1,
                  }]}
                  onPress={() => setPickingRole(pickingRole === role ? null : role)}
                >
                  <View style={{width:44, height:44, borderRadius:22, backgroundColor: roleColor+'22',
                    borderWidth:1.5, borderColor: roleColor, alignItems:'center', justifyContent:'center'}}>
                    <Text style={{fontSize:10, fontWeight:'700', color:roleColor, fontFamily:'Barlow_700Bold'}}>{role}</Text>
                  </View>
                  <View style={{flex:1}}>
                    <Text style={{fontSize:11, color:C.muted, fontFamily:'Barlow_400Regular'}}>{ROLE_LABELS[role]}</Text>
                    {assigned ? (
                      <Text style={{fontSize:14, color:C.text, fontFamily:'Barlow_600SemiBold'}}>
                        #{assigned.num} {assigned.name}
                      </Text>
                    ) : (
                      <Text style={{fontSize:13, color:C.muted, fontFamily:'Barlow_400Regular'}}>
                        {isActive ? 'Tap a player →' : 'Not assigned'}
                      </Text>
                    )}
                  </View>
                  {assigned && (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation(); setAssignments(p => ({...p, [role]:null})); }}>
                      <Text style={{color:C.red, fontSize:16, padding:8}}>✕</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Squad picker — shown when a role is being picked */}
          {pickingRole && (
            <View style={{width: IS_TABLET ? 260 : '100%', maxHeight: IS_TABLET ? undefined : 220,
              backgroundColor:C.surface, borderTopWidth:1, borderLeftWidth: IS_TABLET ? 1 : 0,
              borderColor:C.border}}>
              <Text style={{padding:12, fontSize:11, color:C.accent, fontFamily:'Barlow_600SemiBold', letterSpacing:1}}>
                PICK FOR {pickingRole}
              </Text>
              <ScrollView>
                {localSquad.filter(p => !assignedIds.has(p.id) || assignments[pickingRole]?.id === p.id).map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={{flexDirection:'row', alignItems:'center', gap:10, padding:12,
                      borderBottomWidth:1, borderBottomColor:C.border}}
                    onPress={() => assignPlayer(p)}
                  >
                    <View style={{width:32, height:32, borderRadius:16, backgroundColor:C.accent+'22',
                      borderWidth:1.5, borderColor:C.accent,
                      alignItems:'center', justifyContent:'center'}}>
                      <Text style={{fontSize:11, fontWeight:'700', color:C.accent, fontFamily:'Barlow_700Bold'}}>
                        #{p.num}
                      </Text>
                    </View>
                    <Text style={{color:C.text, fontSize:13, fontFamily:'Barlow_500Medium'}}>{p.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Next button */}
          {!pickingRole && (
            <View style={{position:'absolute', bottom:14, left:14, right:14}}>
              <TouchableOpacity
                style={[s.bigBtn, {backgroundColor: canStartMatch() ? C.accent : C.muted}]}
                onPress={() => { if (canStartMatch()) setStep(3); }}
              >
                <Text style={s.bigBtnText}>Next: Match Info →</Text>
              </TouchableOpacity>
              {!canStartMatch() && (
                <Text style={{textAlign:'center', color:C.red, fontSize:11, marginTop:6, fontFamily:'Barlow_400Regular'}}>
                  All 7 roles must be assigned
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {/* ── STEP 3: Match info ── */}
      {step === 3 && (
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:14, gap:14, paddingBottom:20}}>
          <View style={s.card}>
            <Text style={s.setupTitle}>Team Names</Text>
            <View style={{gap:8}}>
              <TextInput
                style={[s.input, {fontFamily:'Barlow_400Regular'}]}
                value={ourName}
                onChangeText={setOurName}
                placeholder="Your team name"
                placeholderTextColor={C.muted}
              />
              <TextInput
                style={[s.input, {fontFamily:'Barlow_400Regular'}]}
                value={theirName}
                onChangeText={setTheirName}
                placeholder="Opponent team name"
                placeholderTextColor={C.muted}
              />
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.setupTitle}>Opponent Jersey Numbers</Text>
            <Text style={{color:C.dim, fontSize:12, fontFamily:'Barlow_400Regular', marginBottom:10}}>
              Optional — enter numbers for each position
            </Text>
            <View style={{flexDirection:'row', flexWrap:'wrap', gap:8}}>
              {OPP_ROLES_ORDER.map(role => (
                <View key={role} style={{alignItems:'center', gap:4}}>
                  <Text style={{fontSize:10, color:C.muted, fontFamily:'Barlow_500Medium'}}>{role}</Text>
                  <TextInput
                    style={[s.input, {width:56, textAlign:'center', fontFamily:'Barlow_700Bold', fontSize:16}]}
                    value={oppNums[role]}
                    onChangeText={v => setOppNums(p => ({...p, [role]: v.replace(/[^0-9]/g,'')}))}
                    placeholder="—"
                    placeholderTextColor={C.muted}
                    keyboardType="numeric"
                    maxLength={3}
                  />
                </View>
              ))}
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.setupTitle}>Starting Rotation</Text>
            <Text style={{color:C.dim, fontSize:12, fontFamily:'Barlow_400Regular', marginBottom:10}}>
              Which rotation does your team start in?
            </Text>
            <View style={{flexDirection:'row', flexWrap:'wrap', gap:8}}>
              {[0,1,2,3,4,5].map(i => (
                <TouchableOpacity
                  key={i}
                  style={[s.rotBtn, rotation===i && s.rotBtnSel, {minWidth:60}]}
                  onPress={() => setRotation(i)}
                >
                  <Text style={[s.rotBtnText, rotation===i && {color:C.accent, fontFamily:'Barlow_600SemiBold'}]}>
                    ROT {i+1}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.setupTitle}>First Serve</Text>
            <View style={{flexDirection:'row', gap:8}}>
              <TouchableOpacity
                style={[s.serveOpt, servingUs && s.serveOptSel, {flex:1}]}
                onPress={() => setServingUs(true)}
              >
                <Text style={[s.serveOptText, servingUs && {color:C.accent, fontFamily:'Barlow_600SemiBold'}]}>
                  We Serve
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.serveOpt, !servingUs && s.serveOptSelOpp, {flex:1}]}
                onPress={() => setServingUs(false)}
              >
                <Text style={[s.serveOptText, !servingUs && {color:C.oppTeam, fontFamily:'Barlow_600SemiBold'}]}>
                  They Serve
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{flexDirection:'row', gap:8}}>
            <TouchableOpacity
              style={[s.bigBtn, {flex:1, backgroundColor:C.surface, borderWidth:1, borderColor:C.border}]}
              onPress={() => setStep(2)}
            >
              <Text style={[s.bigBtnText, {color:C.dim}]}>← Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.bigBtn, {flex:2, backgroundColor:C.accent}]}
              onPress={handleStartMatch}
            >
              <Text style={s.bigBtnText}>Start Match →</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      </KeyboardAvoidingView>

      {/* ── Player edit modal ── */}
      <Modal visible={!!editPlayer} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{flex:1, justifyContent:'center'}}
        >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={[s.modalTitle, {marginBottom:14}]}>
              {editPlayer?.id ? 'Edit Player' : 'Add Player'}
            </Text>

            <Text style={s.popupSectionLabel}>Jersey Number</Text>
            <TextInput
              style={[s.input, {marginBottom:12, fontFamily:'Barlow_400Regular'}]}
              value={editNum}
              onChangeText={setEditNum}
              placeholder="e.g. 7"
              placeholderTextColor={C.muted}
              keyboardType="numeric"
            />

            <Text style={s.popupSectionLabel}>Name</Text>
            <TextInput
              style={[s.input, {marginBottom:12, fontFamily:'Barlow_400Regular'}]}
              value={editName}
              onChangeText={setEditName}
              placeholder="Player name"
              placeholderTextColor={C.muted}
            />

            <View style={s.modalBtnRow}>
              <TouchableOpacity
                style={[s.modalBtn, {borderColor:C.muted}]}
                onPress={() => setEditPlayer(null)}
              >
                <Text style={[s.modalBtnText, {color:C.dim}]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, {backgroundColor:C.accent, borderColor:C.accent}]}
                onPress={savePlayer}
              >
                <Text style={[s.modalBtnText, {color:'#fff'}]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV ICONS — custom SVG icons for the bottom nav bar
// ─────────────────────────────────────────────────────────────────────────────
import Svg, { Path, Rect, Circle, Line, G, Text as SvgText } from 'react-native-svg';

function MatchIcon({ color = '#7A84A0', size = 24 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M13 3L7 13h5l-1 8 7-10h-5l1-8z"
        fill={color}
      />
    </Svg>
  );
}

function StatsIcon({ color = '#7A84A0', size = 24 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3"  y="12" width="4" height="9" rx="1" fill={color} />
      <Rect x="10" y="7"  width="4" height="14" rx="1" fill={color} />
      <Rect x="17" y="3"  width="4" height="18" rx="1" fill={color} />
    </Svg>
  );
}

function HistoryIcon({ color = '#7A84A0', size = 24 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="6" y="3" width="12" height="18" rx="2" stroke={color} strokeWidth="1.5" />
      <Rect x="9" y="1.5" width="6" height="4" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
      <Line x1="9" y1="10" x2="15" y2="10" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="9" y1="14" x2="15" y2="14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="9" y1="18" x2="12" y2="18" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

function SetupIcon({ color = '#7A84A0', size = 24 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Gear/cog icon */}
      <Path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <Path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [fontsLoaded] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
  });

  // ── SCREEN: 'home' | 'setup' | 'match'
  const [screen, setScreen] = useState('home');
  const [isDark, setIsDark] = useState(true);
  // Update C whenever theme changes — triggers re-render via state
  C = isDark ? DARK : LIGHT;
  // eslint-disable-next-line no-use-before-define
  Object.assign(s, makeStyles(C));

  // ── SQUAD — full squad of up to 14, loaded from storage
  const [squad, setSquad] = useState(DEFAULT_OUR_ROSTER);
  const [squadLoaded, setSquadLoaded] = useState(false);
  const [hasLastMatch, setHasLastMatch] = useState(false);
  const [matchHistory, setMatchHistory] = useState([]);

  // ── MATCH PAGE
  const [page, setPage] = useState('match');
  const [gameState, setGameState] = useState({
    ourName:'', theirName:'',
    ourScore:0, theirScore:0,
    ourSets:0, theirSets:0,
    currentSet:1,
    setHistory:[],
    matchOver:false,
  });
  const [setResultModal, setSetResultModal] = useState(null);
  const [switchSides, setSwitchSides] = useState(false); // tracks court sides
  const [matchSummary,   setMatchSummary]   = useState(null);

  const [ourRoster, setOurRoster] = useState(DEFAULT_OUR_ROSTER);
  const [oppRoster, setOppRoster] = useState(DEFAULT_OPP_ROSTER);

  // ── LOAD saved squad on startup
  useEffect(() => {
    async function loadData() {
      try {
        // Version check — clear old saved data when app schema changes
        const version = await AsyncStorage.getItem('@vb_version');
        if (version !== '2') {
          await AsyncStorage.removeItem(STORAGE_SQUAD);
          await AsyncStorage.removeItem(STORAGE_MATCH);
          await AsyncStorage.setItem('@vb_version', '2');
        } else {
          const savedSquad = await AsyncStorage.getItem(STORAGE_SQUAD);
          if (savedSquad) setSquad(JSON.parse(savedSquad));
          const savedMatch = await AsyncStorage.getItem(STORAGE_MATCH);
          if (savedMatch) {
            setHasLastMatch(true);
          }
          const historyRaw = await AsyncStorage.getItem(STORAGE_HISTORY);
          if (historyRaw) setMatchHistory(JSON.parse(historyRaw));
        }
      } catch(e) { console.log('Load error', e); }
      setSquadLoaded(true);
    }
    loadData();
  }, []);

  async function saveSquad(sq) {
    setSquad(sq);
    try { await AsyncStorage.setItem(STORAGE_SQUAD, JSON.stringify(sq)); }
    catch(e) { console.log('Save error', e); }
  }

  async function saveMatchState(state) {
    try { await AsyncStorage.setItem(STORAGE_MATCH, JSON.stringify(state)); }
    catch(e) { console.log('Save match error', e); }
  }

  function exportToPDF(ralliesData, statsData, rosterData, gsData) {
    try {
      const mvp = calcMVP(statsData.ps, rosterData);
      const sets = [...new Set(ralliesData.map(r => r.setNum).filter(Boolean))].sort();
      const ourWon  = ralliesData.filter(r => r.outcome==='our').length;
      const themWon = ralliesData.filter(r => r.outcome==='them').length;
      const sideoutPct = statsData.sideoutTotal > 0
        ? Math.round(statsData.sideoutWon/statsData.sideoutTotal*100) : 0;

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Match Report - ${gsData.ourName} vs ${gsData.theirName}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a2e; padding: 24px; }
  h1 { font-size: 22px; color: #6B3FBF; margin-bottom: 4px; }
  h2 { font-size: 15px; color: #4a4a6a; margin: 16px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h3 { font-size: 13px; color: #6B3FBF; margin: 10px 0 6px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; }
  .score { font-size: 36px; font-weight: 700; color: #1a1a2e; }
  .sets { font-size: 13px; color: #666; margin-top: 4px; }
  .meta { text-align: right; color: #666; font-size: 11px; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .card { background: #f5f3ff; border-radius: 8px; padding: 10px; text-align: center; border: 1px solid #e0d8ff; }
  .card-val { font-size: 22px; font-weight: 700; color: #6B3FBF; }
  .card-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  .mvp { background: #f5f3ff; border: 2px solid #6B3FBF; border-radius: 10px; padding: 12px; margin-bottom: 12px; display:flex; align-items:center; gap:12px; }
  .mvp-badge { width:44px; height:44px; border-radius:22px; background:#6B3FBF; color:white; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; }
  .mvp-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
  .chip { background:#e8e0ff; padding:2px 8px; border-radius:10px; font-size:10px; color:#6B3FBF; }
  table { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:12px; }
  th { background:#6B3FBF; color:white; padding:6px 8px; text-align:left; }
  td { padding:5px 8px; border-bottom:1px solid #eee; }
  tr:nth-child(even) td { background:#f9f7ff; }
  .set-row { display:grid; grid-template-columns: repeat(3,1fr); gap:8px; margin-bottom:8px; }
  .set-card { border:1px solid #ddd; border-radius:8px; padding:10px; }
  .set-score { font-size:18px; font-weight:700; color:#6B3FBF; }
  .bar { height:6px; border-radius:3px; background:#eee; margin:6px 0; overflow:hidden; display:flex; }
  .bar-our { background:#6B3FBF; height:100%; }
  .bar-them { background:#CC3344; height:100%; }
  .notes { background:#fffbf0; border:1px solid #ffe08a; border-radius:8px; padding:12px; white-space:pre-wrap; }
  .footer { margin-top:20px; font-size:10px; color:#aaa; text-align:center; border-top:1px solid #eee; padding-top:10px; }
  @media print { body { padding: 12px; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>${gsData.ourName || 'Our Team'} vs ${gsData.theirName || 'Opponent'}</h1>
    <div class="sets">
      ${(gsData.setHistory||[]).map(s => `${s.ourScore}–${s.theirScore}`).join('  ·  ') || ''}
    </div>
  </div>
  <div class="meta">
    Match Report<br>
    ${new Date().toLocaleDateString()}<br>
    ${ralliesData.length} rallies logged
  </div>
</div>

<div class="score">
  ${gsData.ourSets || 0} – ${gsData.theirSets || 0}
  <span style="font-size:14px; color:#888; margin-left:8px;">sets</span>
</div>

${mvp ? `
<h2>⭐ MVP — ${mvp.player.name} (#${mvp.player.num}, ${mvp.player.role})</h2>
<div class="mvp">
  <div class="mvp-badge">#${mvp.player.num}</div>
  <div>
    <div style="font-weight:700; font-size:14px;">${mvp.player.name}</div>
    <div style="color:#888; font-size:11px;">${mvp.player.role}</div>
    <div class="mvp-chips">
      ${mvp.highlights.map(h => `<span class="chip">${h}</span>`).join('')}
    </div>
  </div>
</div>` : ''}

<h2>Team Stats</h2>
<div class="cards">
  <div class="card"><div class="card-val">${statsData.teamKills||0}</div><div class="card-label">Kills</div></div>
  <div class="card"><div class="card-val">${statsData.teamAces||0}</div><div class="card-label">Aces</div></div>
  <div class="card"><div class="card-val">${statsData.teamBlocks||0}</div><div class="card-label">Blocks</div></div>
  <div class="card"><div class="card-val">${sideoutPct}%</div><div class="card-label">Sideout</div></div>
  <div class="card"><div class="card-val">${ourWon}</div><div class="card-label">Points Won</div></div>
  <div class="card"><div class="card-val">${themWon}</div><div class="card-label">Points Lost</div></div>
  <div class="card"><div class="card-val">${ourWon+themWon > 0 ? Math.round(ourWon/(ourWon+themWon)*100) : 0}%</div><div class="card-label">Win Rate</div></div>
  <div class="card"><div class="card-val">${statsData.recvTotal > 0 ? Math.round(statsData.recvPerf/statsData.recvTotal*100) : 0}%</div><div class="card-label">Perfect Pass</div></div>
</div>

<h2>Player Stats</h2>
<table>
  <tr><th>#</th><th>Name</th><th>Role</th><th>K</th><th>ATT</th><th>EFF%</th><th>AE</th><th>Aces</th><th>SE</th><th>Blocks</th><th>Digs</th><th>RCV</th><th>RCV%</th></tr>
  ${rosterData.map(p => {
    const ps = statsData.ps[p.id] || {};
    const eff = ps.attackAtt > 0 ? Math.round(((ps.kills||0)-(ps.attackErr||0))/ps.attackAtt*100) : 0;
    const recvPct = ps.recvTotal > 0 ? Math.round((ps.recvQual||0)/ps.recvTotal/3*100) : 0;
    return `<tr>
      <td>#${p.num}</td><td>${p.name}</td><td>${p.role||p.pos}</td>
      <td>${ps.kills||0}</td><td>${ps.attackAtt||0}</td><td>${eff}%</td><td>${ps.attackErr||0}</td>
      <td>${ps.aces||0}</td><td>${ps.serveErr||0}</td><td>${ps.blocks||0}</td><td>${ps.digs||0}</td>
      <td>${ps.recvTotal||0}</td><td>${ps.recvTotal>0?recvPct+'%':'—'}</td>
    </tr>`;
  }).join('')}
</table>

${sets.length > 1 ? `
<h2>Set by Set</h2>
<div class="set-row">
  ${sets.map(setNum => {
    const setRallies = ralliesData.filter(r => r.setNum === setNum);
    const w = setRallies.filter(r => r.outcome==='our').length;
    const l = setRallies.filter(r => r.outcome==='them').length;
    const last = setRallies[setRallies.length-1];
    const score = last ? `${last.scoreBefore.us+(last.outcome==='our'?1:0)}–${last.scoreBefore.them+(last.outcome==='them'?1:0)}` : '—';
    const ss = calcStats(setRallies, rosterData);
    return `<div class="set-card">
      <div style="font-weight:700">Set ${setNum} <span style="color:#888; font-weight:400">${score}</span></div>
      <div class="bar"><div class="bar-our" style="flex:${w||0.01}"></div><div class="bar-them" style="flex:${l||0.01}"></div></div>
      <div style="font-size:10px; color:#666">${w}W ${l}L · ${ss.teamKills}K · ${ss.teamAces}A · ${ss.sideoutTotal>0?Math.round(ss.sideoutWon/ss.sideoutTotal*100)+'% SO':'—'}</div>
    </div>`;
  }).join('')}
</div>` : ''}

${gsData.matchNotes ? `
<h2>Match Notes</h2>
<div class="notes">${gsData.matchNotes}</div>` : ''}

<div class="footer">Generated by VolleyStats · ${new Date().toLocaleString()}</div>
</body>
</html>`;

      // Open in new tab for print-to-PDF
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (win) {
        win.onload = () => {
          setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 500);
        };
      }
    } catch(e) { console.log('PDF export error', e); }
  }

  function exportToExcel(ralliesData, statsData, rosterData, gsData, notes='') {
    try {
      // Build CSV strings for each sheet then combine into a downloadable file
      // Sheet 1: Match Summary
      const summaryRows = [
        ['Match Summary'],
        ['Our Team', gsData.ourName],
        ['Opponent', gsData.theirName],
        ['Sets Won', gsData.ourSets, gsData.theirSets],
        [''],
        ['Set', 'Our Score', 'Their Score', 'Winner'],
        ...gsData.setHistory.map(s => [s.setNum, s.ourScore, s.theirScore, s.winner === 'our' ? gsData.ourName : gsData.theirName]),
      ];

      // Match Notes
      const notesRows = gsData.matchNotes ? [
        ['Match Notes'],
        [gsData.matchNotes],
        [],
      ] : [];

      // MVP
      const mvp = calcMVP(statsData.ps, rosterData);
      const mvpRows = mvp ? [
        ['MVP'],
        ['Player', '#', 'Role', 'Key Stats'],
        [mvp.player.name, mvp.player.num, mvp.player.role, mvp.highlights.join(', ')],
        [],
      ] : [];

      // Sheet 2: Player Stats
      const statRows = [
        ['Player Stats'],
        ['#', 'Name', 'Role', 'Kills', 'Att', 'Att Err', 'Eff%', 'Aces', 'Serve Err', 'Blocks', 'Block Err', 'RCV', 'RCV%', 'Digs'],
        ...rosterData.map(p => {
          const ps = statsData.ps[p.id] || {};
          const eff = ps.attackAtt > 0 ? Math.round(((ps.kills||0) - (ps.attackErr||0)) / ps.attackAtt * 100) : 0;
          const recvPct = ps.recvTotal > 0 ? Math.round((ps.recvQual||0) / ps.recvTotal / 3 * 100) : 0;
          return [p.num, p.name, p.role, ps.kills||0, ps.attackAtt||0, ps.attackErr||0, eff+'%',
            ps.aces||0, ps.serveErr||0, ps.blocks||0, ps.blockErr||0, ps.recvTotal||0, recvPct+'%', ps.digs||0];
        }),
      ];

      // Sheet 3: Rally Log
      const rallyRows = [
        ['Rally Log'],
        ['Rally #', 'Outcome', 'End Reason', 'Touch #', 'Team', 'Player #', 'Player Name', 'Action', 'Quality'],
        ...ralliesData.flatMap(r =>
          r.touches.map((t, i) => [
            r.rallyNum, r.outcome === 'our' ? gsData.ourName + ' point' : gsData.theirName + ' point',
            r.endReason, i+1, t.team, t.playerNum, t.playerName,
            t.action, t.quality !== null ? t.quality : '',
          ])
        ),
      ];

      // Convert to CSV
      const NL = '\n';
      const toCSV = rows => rows.map(r => r.map(c => '"' + String(c||'').replace(/"/g, '""') + '"').join(',')).join(NL);

      const csv = ['=== MATCH SUMMARY ===', toCSV(summaryRows),
        ...(notesRows.length ? ['', '=== MATCH NOTES ===', toCSV(notesRows)] : []),
        '', '=== MVP ===', toCSV(mvpRows),
        '', '=== PLAYER STATS ===', toCSV(statRows),
        '', '=== RALLY LOG ===', toCSV(rallyRows)].join(NL);

      // Trigger download via browser
      const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href  = url;
      link.download = (gsData.ourName||'Match') + '_vs_' + (gsData.theirName||'Opponent') + '_' + new Date().toISOString().slice(0,10) + '.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch(e) {
      console.log('Export error', e);
    }
  }

  // Rotation index 0-5; 0 = setter back-right (first serve)
  const [ourRotation,  setOurRotation]  = useState(0);
  const [oppRotation,  setOppRotation]  = useState(0);

  const [servingUs,  setServingUs]  = useState(true);
  const [rallies,    setRallies]    = useState([]);

  // Rally state
  const [rallyActive,   setRallyActive]   = useState(false);
  const [touches,       setTouches]       = useState([]);
  const touchesRef = useRef([]);
  const [pendingFrom,   setPendingFrom]   = useState(null);
  const [arrows,        setArrows]        = useState([]);
  const [popup,         setPopup]         = useState(null);
  const [rallyEndModal, setRallyEndModal] = useState(null);
  const [netModal,      setNetModal]      = useState(false);
  // receivedFirst: true once the first touch of a receive rally is confirmed
  const [receivedFirst,    setReceivedFirst]    = useState(false);
  // oppReceivedFirst: true once opp receives our serve (first touch when we serve)
  const [oppReceivedFirst, setOppReceivedFirst] = useState(false);
  // oppServed: true once the opponent server has been tapped (when they serve)
  // triggers switch from highlighting their server to highlighting our receivers
  const [oppServed, setOppServed] = useState(false);
  // afterTouchBlock: true when last touch was a touch block (quality 1/2)
  // signals that next touch should be opponent receiving the deflected ball
  const [afterTouchBlock, setAfterTouchBlock] = useState(false);
  const afterTouchBlockRef = useRef(false);
  const [rallySummary, setRallySummary] = useState(null); // shown briefly after each rally
  const [scoreCorrectModal, setScoreCorrectModal] = useState(false);
  const [matchNotes, setMatchNotes] = useState(''); // coaching notes for the match

  // ── SUBSTITUTIONS ────────────────────────────────────────────────────────────
  const [subModal, setSubModal]       = useState(false);
  const [subsUsed, setSubsUsed]       = useState(0);    // resets each set
  const [subLog,   setSubLog]         = useState([]);   // [{outId, inId, score, set}]
  const [subOutPlayer, setSubOutPlayer] = useState(null); // player being subbed out
  // Opponent subs
  const [oppSubModal, setOppSubModal]     = useState(false);
  const [oppSubOut,   setOppSubOut]       = useState(null); // player going off
  const [oppSubInNum, setOppSubInNum]     = useState('');   // jersey number coming on

  // Keep touchesRef in sync with touches state
  useEffect(() => { touchesRef.current = touches; }, [touches]);
  // Keep afterTouchBlockRef in sync
  useEffect(() => { afterTouchBlockRef.current = afterTouchBlock; }, [afterTouchBlock]);

  // Determine which formation to show for our team
  // Our formation:
  //   serving → base (before and during rally)
  //   receiving → receive (before first touch), receiveBase (after first touch)
  const ourFormation = servingUs
    ? 'base'
    : receivedFirst ? 'receiveBase' : 'receive';

  // Opp formation:
  //   receiving (we serve) → receive (before first opp touch), receiveBase (after)
  //   serving (they serve) → base
  const oppFormation = servingUs
    ? oppReceivedFirst ? 'receiveBase' : 'receive'
    : 'base';

  const ourLineupRaw = buildLineup(ourRoster, ourRotation, ourFormation, true);
  const oppLineupRaw = buildLineup(oppRoster, oppRotation, oppFormation, false);

  // Helper: apply setter run to a lineup when conditions are met
  // isOur: determines threshold y and target position (mirrored for opp)
  function applySetterRun(lineupRaw, lastTouch, nextAction, isOur) {
    if (nextAction !== 'set') return lineupRaw;
    if (!lastTouch) return lineupRaw;

    // Last touch must be by this team
    if (lastTouch.team !== (isOur ? 'our' : 'opp')) return lineupRaw;

    // Last touch must NOT be by the setter
    const lastWasSetter = lineupRaw.find(p => p.id === lastTouch.playerId)?.roleLabel === 'S';
    if (lastWasSetter) return lineupRaw;

    const setter = lineupRaw.find(p => p.roleLabel === 'S');
    if (!setter) return lineupRaw;

    if (isOur) {
      // Our setter: already in front row (y <= 0.70) → no move needed
      // Front row y=0.625, back row y=0.875, threshold between them
      if (setter.xy.y <= 0.70) return lineupRaw;
      // Target: between front-middle and front-right, near net
      return lineupRaw.map(p =>
        p.roleLabel === 'S'
          ? { ...p, xy: { x: 4/6, y: 0.63 }, runningToSet: true }
          : p
      );
    } else {
      // Opp setter: already in front row (y >= 0.30) → no move needed
      if (setter.xy.y >= 0.30) return lineupRaw;
      return lineupRaw.map(p =>
        p.roleLabel === 'S'
          ? { ...p, xy: { x: 2/6, y: 0.37 }, runningToSet: true }
          : p
      );
    }
  }

  const lastTouch   = touches[touches.length - 1] || null;
  const nextAction  = inferNextAction(countNonBlockTouches(touches), servingUs);

  const ourLineup = (() => {
    if (!rallyActive) return ourLineupRaw;
    return applySetterRun(ourLineupRaw, lastTouch, nextAction, true);
  })();

  const oppLineup = (() => {
    if (!rallyActive) return oppLineupRaw;
    return applySetterRun(oppLineupRaw, lastTouch, nextAction, false);
  })();

  // Use non-block touch count for sequence logic (blocks don't consume touches)
  const nonBlockCount = rallyActive ? countNonBlockTouches(touches) : 0;

  // Our team highlight IDs (green = receivers/setter/attacker)
  // Use ref for synchronous afterTouchBlock state
  const atb = afterTouchBlockRef.current;

  const highlightIds = atb
    ? BACK_ROW_RECEIVE[ourRotation].map(r => ourLineup.find(p => p.roleLabel === r)?.id).filter(Boolean)
    : getHighlightIds(rallyActive ? nonBlockCount : 0, servingUs, ourRotation, ourLineup, touches, oppServed, ourFormation);

  // Our team blocker IDs (amber = front row should block)
  const blockerIds = atb
    ? []
    : getBlockerIds(rallyActive ? nonBlockCount : 0, servingUs, ourRotation, ourLineup, touches);

  // Opponent highlight IDs — after touch block highlight their back row too
  const oppHighlightIds = atb
    ? OPP_BACK_ROW_RECEIVE[oppRotation].map(r => oppLineup.find(p => p.roleLabel === r)?.id).filter(Boolean)
    : getOppHighlightIds(rallyActive ? nonBlockCount : 0, servingUs, oppRotation, oppLineup, touches, oppServed);

  // Opponent blocker IDs (amber) when our team attacks
  const oppBlockerIds = getOppBlockerIds(
    rallyActive ? nonBlockCount : 0,
    servingUs, oppRotation, oppLineup, touches
  );

  const stats = calcStats(rallies, ourRoster);

  // ── RALLY LOGIC ─────────────────────────────────────────────────────────────
  function startRally() {
    setTouches([]); setArrows([]); setPendingFrom(null); setPopup(null);
    setReceivedFirst(false);
    setOppReceivedFirst(false);
    setRallyActive(true);
  }

  function onPlayerTap(player, team, px, py, touchesOverride) {
    haptic('light');
    // Auto-start rally on first player tap
    if (!rallyActive) {
      setTouches([]); setArrows([]); setPendingFrom(null); setPopup(null);
      setReceivedFirst(false); setOppReceivedFirst(false); setOppServed(false); setAfterTouchBlock(false);
      setRallyActive(true);
    }

    // Use touchesOverride if provided (e.g. after logging opp touch synchronously)
    const currentTouches = touchesOverride || touches;

    // Draw arrow from previous player if pendingFrom is set
    if (pendingFrom) {
      setArrows(prev => [...prev, { fromId: pendingFrom.id, toId: player.id, toType:'player' }]);
      setPendingFrom(null);
    }

    if (team === 'opp') {
      // Special case: when they serve and server hasn't been tapped yet,
      // mark serve as started — next tap determines outcome:
      // player tap = in play, court tap = ace (our side) or fault (their side)
      if (!servingUs && !oppServed) {
        setOppServed(true);
        setPendingFrom(player); // set pendingFrom so court tap can draw arrow from server
        return;
      }

      // Clear touch block flag — opponent is now playing the ball
      if (afterTouchBlockRef.current) {
        setAfterTouchBlock(false);
        afterTouchBlockRef.current = false; // synchronous clear
      }

      // Opponent front row after our attack → show Receive/Block choice
      const nonBlockCount = countNonBlockTouches(touchesRef.current);
      const action = inferNextAction(nonBlockCount, servingUs);
      const isFrontRow = player.xy ? player.xy.y >= 0.25 && player.xy.y <= 0.45 : false;
      const ourJustAttacked = (() => {
        const last = lastNonBlockTouch(touchesRef.current);
        return last && last.team === 'our' && last.action === 'attack';
      })();

      if (action === 'receive' && isFrontRow && ourJustAttacked) {
        // Show popup for Receive/Block choice — same as our team front row
        setPopup({
          player, team: 'opp', px, py,
          touchIndex: touches.length,
          action: 'receive',
          quality: null,
          isOur: false,
          servingUs,
          needsReceiveBlockChoice: true,
        });
        return;
      }

      // All other opp touches: log instantly
      const touchIndex = touches.length;
      const touch = {
        playerId:   player.id,
        playerNum:  player.num,
        playerName: player.name,
        team:       'opp',
        action,
        quality:    null,
        touchIndex,
        xy:         player.xy || null,
      };
      const newTouches = [...touches, touch];
      setTouches(newTouches);
      touchesRef.current = newTouches; // update synchronously so showPopup sees it
      setPendingFrom(player);

      // Switch opp formation after first receive of our serve
      if (servingUs && !oppReceivedFirst) {
        setOppReceivedFirst(true);
      }

      // Check 4-touch violation (blocks don't count)
      let consecutive = 0;
      for (let i = newTouches.length - 1; i >= 0; i--) {
        if (newTouches[i].team !== 'opp') break;
        if (newTouches[i].action !== 'block') consecutive++;
      }
      if (consecutive >= 4) {
        setRallyEndModal({
          outcome: 'our',
          reason: 'Opponent touched the ball 4 times — 4-touch violation',
          endReason: 'four_touch',
        });
        setPendingFrom(null);
      }
    } else {
      // Our team: show popup for quality selection
      // Clear touch block flag if set — our player is playing the deflected ball
      if (afterTouchBlockRef.current) {
        setAfterTouchBlock(false);
        afterTouchBlockRef.current = false;
      }
      showPopup(player, team, px, py, currentTouches);
    }
  }

  function showPopup(player, team, px, py, touchesSnapshot) {
    const isOur = team === 'our';
    // Use ref for most up-to-date touches (avoids React state batching lag)
    const t = touchesSnapshot || touchesRef.current || touches;
    const nonBlockCount = countNonBlockTouches(t);
    const action = inferNextAction(nonBlockCount, servingUs);

    // Front row players when opp attacks can receive or block
    // Front row y = 0.625, back row y = 0.875 — threshold set between them
    const isFrontRow = player.xy ? player.xy.y <= 0.75 : false;
    const oppJustAttacked = lastTouchWasOppAttack(t);
    const needsReceiveBlockChoice = action === 'receive' && isFrontRow && isOur && oppJustAttacked;

    // Popup only for: serve (spin/float choice) and serve receive (quality)
    const isServeReceive = action === 'receive' && !servingUs && countNonBlockTouches(t) === 0;
    const isServe = action === 'spin' || action === 'float';
    const needsQuality = isServeReceive;
    const needsPopup = isServe || needsQuality || needsReceiveBlockChoice;

    if (!needsPopup) {
      // Log instantly — no popup
      confirmPopup({
        player, team, px, py,
        touchIndex: touches.length,
        action, quality: null,
        isOur, servingUs,
        needsReceiveBlockChoice: false,
      });
      return;
    }

    setPopup({
      player, team, px, py,
      touchIndex: touches.length,
      action,
      quality: null,
      isOur, servingUs,
      needsReceiveBlockChoice,
    });
  }

  function confirmPopup(overridePopup) {
    const p = overridePopup || popup;
    if (!p) return;
    haptic('medium');
    const touch = {
      playerId:   p.player.id,
      playerNum:  p.player.num,
      playerName: p.player.name,
      team:       p.team,
      action:     p.action,
      quality:    p.isOur ? p.quality : null,
      touchIndex: p.touchIndex,
      xy:         p.player.xy || null,
    };

    const newTouches = [...touches, touch];
    setTouches(newTouches);
    touchesRef.current = newTouches; // update synchronously
    setPopup(null);

    // First touch confirmed when receiving → switch to receiveBase formation
    if (!servingUs && !receivedFirst && touch.action !== 'block') {
      setReceivedFirst(true);
    }
    // Opp receives our serve → switch their formation to receiveBase
    if (servingUs && touch.team === 'opp' && !oppReceivedFirst) {
      setOppReceivedFirst(true);
    }

    // ── SERVE RECEIVE ERROR (quality 0) → their point immediately ──────────
    // Only applies to our team's serve receive, not opponent
    if (touch.action === 'receive' && touch.quality === 0 && touch.team === 'our' && !p.servingUs && p.touchIndex === 0) {
      setPendingFrom(null);
      setRallyEndModal({
        outcome: 'them',
        reason: 'Serve ace — receive error',
        endReason: 'ace',
      });
      return;
    }

    // ── OPP BLOCK — handle same as our block
    if (touch.action === 'block' && touch.team === 'opp') {
      setAfterTouchBlock(true);
      setPendingFrom(p.player);
      return;
    }

    // ── BLOCK OUTCOMES ──────────────────────────────────────────────────────
    // After a block, outcome is determined by where the ball goes next:
    // - Tap opponent floor/court (their side) → stuff block, our point
    // - Tap our floor/court (our side) → block error, their point
    // - Tap a player (either team) → ball still in play, continue rally
    // Set pendingFrom so the court tap or next player tap handles it
    if (touch.action === 'block') {
      setAfterTouchBlock(true);
      setPendingFrom(p.player);
      return;
    }

    setPendingFrom(p.player);

    // Check if this team has now touched the ball 4 times consecutively
    // Blocks don't count toward the 3-touch limit
    const team = touch.team;
    let consecutive = 0;
    for (let i = newTouches.length - 1; i >= 0; i--) {
      if (newTouches[i].team !== team) break;
      if (newTouches[i].action !== 'block') consecutive++;
    }
    if (consecutive >= 4) {
      const outcome  = team === 'our' ? 'them' : 'our';
      const teamName = team === 'our' ? 'Our team' : 'Opponent';
      setRallyEndModal({
        outcome,
        reason: `${teamName} touched the ball ${consecutive} times — 4-touch violation`,
        endReason: 'four_touch',
      });
      setPendingFrom(null);
    }
  }

  // Tap on the court surface (not on a player)
  function onCourtTap(x, y, cw, ch) {
    if (!rallyActive || !pendingFrom) return;

    // Dead zone — if tap is within 60px of any player, ignore the court tap
    const DEAD_ZONE = 60;
    const allPlayers = [...ourLineup, ...oppLineup];
    const nearPlayer = allPlayers.some(p => {
      if (!p?.xy) return false;
      // Convert player xy to screen coords matching the flip used in rendering
      const px = switchSides ? (1 - p.xy.x) * cw : p.xy.x * cw;
      const py = switchSides ? (1 - p.xy.y) * ch : p.xy.y * ch;
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      return dist < DEAD_ZONE;
    });
    if (nearPlayer) return;

    const NET = ch * 0.5;
    // When sides switched, opponent is at bottom (y > NET), our side is top (y < NET)
    const oppSide = switchSides ? y > NET : y < NET;
    const lastTouch = touches[touches.length - 1];

    // Special case: opponent just served (oppServed=true, no touches logged yet)
    // Court tap determines serve outcome
    if (!servingUs && oppServed && touches.length === 0) {
      const storeX2 = switchSides ? cw - x : x;
      const storeY2 = switchSides ? ch - y : y;
      setArrows(prev => [...prev, { fromId: pendingFrom.id, toType:'floor', toX:storeX2, toY:storeY2 }]);
      setPendingFrom(null);
      // oppSide already computed above with switchSides correction
      if (oppSide) {
        setRallyEndModal({ outcome: 'our', reason: 'Opponent serve fault', endReason: 'serve_fault' });
      } else {
        setRallyEndModal({ outcome: 'them', reason: 'Opponent serve ace', endReason: 'ace' });
      }
      return;
    }

    // Store un-flipped coords so switchSides rendering works correctly
    const storeX = switchSides ? cw - x : x;
    const storeY = switchSides ? ch - y : y;
    setArrows(prev => [...prev, { fromId: pendingFrom.id, toType:'floor', toX:storeX, toY:storeY }]);
    setPendingFrom(null);

    const lastTouchTeam = lastTouch?.team || 'our';
    const result = determineOutcomeFromTap(x, y, cw, ch, lastTouchTeam, switchSides);

    // Block outcome
    if (lastTouch?.action === 'block') {
      setAfterTouchBlock(false);
      if (oppSide) {
        setRallyEndModal({ outcome: 'our', reason: 'Stuff block — ball landed in opponent court', endReason: 'block_stuff' });
      } else {
        setRallyEndModal({ outcome: 'them', reason: 'Block error — ball landed on our side', endReason: 'block_error' });
      }
    } else {
      setRallyEndModal({ ...result, endReason: 'floor' });
    }
  }

  // Net button pressed
  function onNetPress() {
    if (!rallyActive) return;
    haptic('medium');
    setNetModal(true);
  }

  function confirmNet(faultTeam) {
    const outcome = faultTeam === 'our' ? 'them' : 'our';
    const reason  = faultTeam === 'our' ? 'Our player touched the net' : 'Their player touched the net';
    setNetModal(false);
    setPendingFrom(null); // clear any pending arrow
    endRally({ outcome, reason, endReason: 'net' });
  }

  // ── SET / MATCH LOGIC ──────────────────────────────────────────────────────
  function getSetTarget(setNum) {
    return setNum === 5 ? 15 : 25;
  }

  function checkSetWon(ourScore, theirScore, setNum) {
    const target = getSetTarget(setNum);
    const minLead = 2;
    if (ourScore >= target && ourScore - theirScore >= minLead) return 'our';
    if (theirScore >= target && theirScore - ourScore >= minLead) return 'them';
    return null;
  }

  function endRally(modal) {
    haptic(modal.outcome === 'our' ? 'medium' : 'light');
    const weWon = modal.outcome === 'our';

    const newRally = {
      id: Date.now(), rallyNum: rallies.length+1,
      touches, arrows,
      outcome:   modal.outcome,
      endReason: modal.endReason || 'floor',
      scoreBefore: { us: gameState.ourScore, them: gameState.theirScore },
      ourRotation,
      setNum: gameState.currentSet, // track which set this rally belongs to
      ourLineupSnap: ourLineup.map(p => ({ ...p })),
      oppLineupSnap: oppLineup.map(p => ({ ...p })),
    };
    setRallies(prev => [...prev, newRally]);

    // Calculate new scores
    const newOurScore   = weWon ? gameState.ourScore + 1 : gameState.ourScore;
    const newTheirScore = !weWon ? gameState.theirScore + 1 : gameState.theirScore;

    // Rotation logic
    if (weWon && !servingUs) {
      setOurRotation(r => (r + 1) % 6);
      setServingUs(true);
    } else if (!weWon && servingUs) {
      setOppRotation(r => (r + 1) % 6);
      setServingUs(false);
    }

    // Check if set is won
    const setWinner = checkSetWon(newOurScore, newTheirScore, gameState.currentSet);

    if (setWinner) {
      const newOurSets   = setWinner === 'our'  ? gameState.ourSets + 1 : gameState.ourSets;
      const newTheirSets = setWinner === 'them' ? gameState.theirSets + 1 : gameState.theirSets;
      const newSetHistory = [
        ...gameState.setHistory,
        { ourScore: newOurScore, theirScore: newTheirScore, winner: setWinner, setNum: gameState.currentSet },
      ];

      // Check if match is won (first to 3 sets)
      if (newOurSets === 3 || newTheirSets === 3) {
        // Save to match history when match ends
        (async () => {
          try {
            const historyRaw = await AsyncStorage.getItem(STORAGE_HISTORY);
            const history = historyRaw ? JSON.parse(historyRaw) : [];
            const matchRecord = {
              id: Date.now(),
              date: new Date().toLocaleDateString(),
              ourName: gameState.ourName,
              theirName: gameState.theirName,
              ourSets: newOurSets,
              theirSets: newTheirSets,
              setHistory: newSetHistory,
              ralliesCount: rallies.length + 1,
            };
            history.unshift(matchRecord);
            const trimmed = history.slice(0, 20);
            await AsyncStorage.setItem(STORAGE_HISTORY, JSON.stringify(trimmed));
            setMatchHistory(trimmed);
          } catch(e) { console.log('History save error', e); }
        })();

        setGameState(prev => ({
          ...prev,
          ourScore: newOurScore, theirScore: newTheirScore,
          ourSets: newOurSets, theirSets: newTheirSets,
          setHistory: newSetHistory, matchOver: true,
        }));
        setMatchSummary({
          winner: setWinner === 'our' ? gameState.ourName : gameState.theirName,
          ourSets: newOurSets, theirSets: newTheirSets,
          setHistory: newSetHistory,
          ourName: gameState.ourName, theirName: gameState.theirName,
          _pendingSwitch: false,
        });
      } else {
        // Set won but match continues — show set result modal
        setGameState(prev => ({
          ...prev,
          ourScore: 0, theirScore: 0,
          ourSets: newOurSets, theirSets: newTheirSets,
          currentSet: prev.currentSet + 1,
          setHistory: newSetHistory,
        }));
        // Don't reset switchSides — keep current court orientation as default
        // _pendingSwitch tracks whether user wants to switch this set (defaults No)
        setSetResultModal({
          setNum: gameState.currentSet,
          ourScore: newOurScore, theirScore: newTheirScore,
          winner: setWinner,
          ourSets: newOurSets, theirSets: newTheirSets,
          ourName: gameState.ourName, theirName: gameState.theirName,
          _pendingSwitch: false,
        });
        setRallies([]);
        setSubsUsed(0); setSubLog([]);
      }
    } else {
      // No set won — just update scores
      setGameState(prev => ({
        ...prev,
        ourScore: newOurScore,
        theirScore: newTheirScore,
      }));
    }

    setRallyActive(false);
    setTouches([]); setArrows([]); setPendingFrom(null);
    touchesRef.current = [];
    setReceivedFirst(false);
    setOppReceivedFirst(false);
    setOppServed(false);
    setAfterTouchBlock(false);
    setRallyEndModal(null);

    // Show rally summary flash for 3 seconds
    setRallySummary({
      outcome: modal.outcome,
      reason: modal.reason,
      touches: newRally.touches,
      ourScore: newOurScore,
      theirScore: newTheirScore,
    });
    setTimeout(() => setRallySummary(null), 3000);

    // ── AUTO-SAVE after every rally ────────────────────────────────────────
    try {
      const snapshot = {
        gameState: {
          ...gameState,
          ourScore: newOurScore,
          theirScore: newTheirScore,
        },
        rallies: [...rallies, newRally],
        ourRoster,
        oppRoster,
        ourRotation,
        oppRotation,
        servingUs: weWon ? true : false,
        switchSides,
        subsUsed,
        subLog,
        matchNotes,
        savedAt: Date.now(),
      };
      AsyncStorage.setItem(STORAGE_MATCH, JSON.stringify(snapshot));
    } catch(e) { console.log('Auto-save error', e); }
  }

  function confirmRallyEnd() {
    if (!rallyEndModal) return;
    endRally(rallyEndModal);
  }

  function undoLastTouch() {
    // If no touches logged but oppServed is true — undo the server tap
    if (touches.length === 0) {
      if (oppServed) {
        setOppServed(false);
        setPendingFrom(null);
      }
      return;
    }

    const undoneTouch = touches[touches.length - 1];
    const newTouches  = touches.slice(0, -1);
    // Remove last arrow only if it corresponds to the undone touch
    const newArrows   = arrows.length > 0 ? arrows.slice(0, -1) : [];

    setTouches(newTouches);
    touchesRef.current = newTouches;
    setArrows(newArrows);
    setPopup(null);
    setRallyEndModal(null);

    // Restore pendingFrom — null if no previous touches, else previous player
    if (newTouches.length > 0) {
      const prevTouch = newTouches[newTouches.length - 1];
      setPendingFrom({ id: prevTouch.playerId });
    } else {
      setPendingFrom(null);
      // If undid first opp touch after our serve, reset oppReceivedFirst
      if (servingUs) setOppReceivedFirst(false);
    }

    // Reset afterTouchBlock if the undone touch was a block
    if (undoneTouch.action === 'block') setAfterTouchBlock(false);

    // Revert receive formation if we undid the first receive touch
    if (!servingUs && newTouches.filter(t => t.team === 'our').length === 0) {
      setReceivedFirst(false);
    }
    if (servingUs && newTouches.filter(t => t.team === 'opp').length === 0) {
      setOppReceivedFirst(false);
    }
  }

  // ── SWIPE BETWEEN TABS ──────────────────────────────────────────────────────
  const PAGES = ['match', 'stats', 'history', 'setup'];
  const swipeRef = useRef(null);
  const swipePanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 20 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) < 50) return;
        setPage(prev => {
          const idx = PAGES.indexOf(prev);
          if (gs.dx < 0 && idx < PAGES.length - 1) return PAGES[idx + 1]; // swipe left → next
          if (gs.dx > 0 && idx > 0) return PAGES[idx - 1]; // swipe right → prev
          return prev;
        });
      },
    })
  ).current;

  // ── RENDER ──────────────────────────────────────────────────────────────────
  // Show home or setup screen if not in match
  if (screen === 'home') {
    return (
      <HomeScreen
        onNewMatch={() => setScreen('setup')}
        matchHistory={matchHistory}
        onContinue={async () => {
          try {
            const saved = await AsyncStorage.getItem(STORAGE_MATCH);
            if (saved) {
              const snap = JSON.parse(saved);
              if (snap.gameState)               setGameState(snap.gameState);
              if (snap.rallies)                 setRallies(snap.rallies);
              if (snap.ourRoster)               setOurRoster(snap.ourRoster);
              if (snap.oppRoster)               setOppRoster(snap.oppRoster);
              if (snap.ourRotation !== undefined) setOurRotation(snap.ourRotation);
              if (snap.oppRotation !== undefined) setOppRotation(snap.oppRotation);
              if (snap.servingUs   !== undefined) setServingUs(snap.servingUs);
              if (snap.switchSides !== undefined) setSwitchSides(snap.switchSides);
              if (snap.subsUsed    !== undefined) setSubsUsed(snap.subsUsed);
              if (snap.subLog)                  setSubLog(snap.subLog);
              if (snap.matchNotes !== undefined) setMatchNotes(snap.matchNotes);
            }
          } catch(e) { console.log('Restore error', e); }
          setScreen('match');
          setPage('match');
        }}
        hasLastMatch={hasLastMatch}
      />
    );
  }

  if (screen === 'setup') {
    return (
      <SetupScreen
        squad={squad}
        onSaveSquad={saveSquad}
        onStartMatch={({ roster, ourName, theirName, rotation, servingUs: sv, oppNums }) => {
          setOurRoster(roster);
          // Apply opponent jersey numbers to opp roster
          if (oppNums) {
            setOppRoster(prev => prev.map(p => {
              const num = oppNums[p.role];
              return num ? { ...p, num: parseInt(num) } : p;
            }));
          }
          setGameState(g => ({ ...g, ourName, theirName, ourScore:0, theirScore:0, ourSets:0, theirSets:0, currentSet:1, setHistory:[], matchOver:false }));
          setOurRotation(rotation);
          if (sv) {
            setOppRotation((rotation - 1 + 6) % 6);
          } else {
            setOppRotation(0);
            setOurRotation((0 - 1 + 6) % 6);
          }
          setServingUs(sv);
          setScreen('match');
          setPage('match');
        }}
      />
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.root}>

        <View style={s.mainPanel} {...swipePanResponder.panHandlers}>
          <ScoreBar gameState={gameState} servingUs={servingUs} ourRotation={ourRotation}
            onScorePress={() => setScoreCorrectModal(true)} />

          {page==='match' && (
            <CourtView
              ourLineup={ourLineup} oppLineup={oppLineup}
              touches={touches} arrows={arrows}
              pendingFrom={pendingFrom} highlightIds={highlightIds}
              blockerIds={blockerIds}
              oppHighlightIds={oppHighlightIds}
              oppBlockerIds={oppBlockerIds}
              rallyActive={rallyActive} servingUs={servingUs}
              receivedFirst={receivedFirst}
              afterTouchBlock={afterTouchBlock}
              onPlayerTap={onPlayerTap} onCourtTap={onCourtTap}
              onNetPress={onNetPress}
              popup={popup} setPopup={setPopup} confirmPopup={confirmPopup}
              startRally={startRally} undoLastTouch={undoLastTouch}
              setServingUs={setServingUs}
              rallyEndModal={rallyEndModal}
              confirmRallyEnd={confirmRallyEnd}
              setRallyEndModal={setRallyEndModal}
              onBackRallyEnd={() => {
                setArrows(prev => {
                  const last = prev[prev.length - 1];
                  return last?.toType === 'floor' ? prev.slice(0, -1) : prev;
                });
                const lastT = touches[touches.length - 1];
                if (lastT) setPendingFrom({ id: lastT.playerId });
                setRallyEndModal(null);
              }}
              switchSides={switchSides}
              ourRotation={ourRotation}
              isDark={isDark}
            />
          )}
          {page==='stats'   && <StatsPanel   stats={stats} roster={ourRoster} rallies={rallies} switchSides={switchSides} oppRoster={oppRoster} />}
          {page==='history' && <HistoryPanel rallies={rallies} switchSides={switchSides} />}
          {page==='setup'   && <SetupPanel   gameState={gameState} setGameState={setGameState} ourRotation={ourRotation} setOurRotation={setOurRotation}
            onExport={() => exportToExcel(rallies, stats, ourRoster, gameState)}
            onPDFExport={() => exportToPDF(rallies, stats, ourRoster, {...gameState, matchNotes})}
            onGoToSetup={() => setScreen('setup')}
            onToggleTheme={() => setIsDark(d => !d)}
            isDark={isDark}
            matchNotes={matchNotes}
            setMatchNotes={setMatchNotes} />}
        </View>

        {IS_TABLET && (
          <View style={s.sidePanel}>
            <SideStats
              gameState={gameState} stats={stats}
              roster={ourRoster} touches={touches}
              rallies={rallies} rallyActive={rallyActive}
              undoLastTouch={undoLastTouch}
              ourRotation={ourRotation}
              subsUsed={subsUsed}
              onSubPress={() => { setSubOutPlayer(null); setSubModal(true); }}
              onOppSubPress={() => { setOppSubOut(null); setOppSubInNum(''); setOppSubModal(true); }}
              onToggleTheme={() => setIsDark(d => !d)}
              isDark={isDark}
              switchSides={switchSides}
            />
          </View>
        )}
      </View>

      {/* BOTTOM NAV */}
      <View style={s.navBar}>
        {[
          { id:'match',   label:'Match',   icon:<MatchIcon /> },
          { id:'stats',   label:'Stats',   icon:<StatsIcon /> },
          { id:'history', label:'History', icon:<HistoryIcon /> },
          { id:'setup',   label:'Setup',   icon:<SetupIcon /> },
        ].map(({id, label, icon}) => {
          const active = page === id;
          return (
            <TouchableOpacity key={id} style={s.navBtn} onPress={() => setPage(id)}>
              {/* Active indicator line at top */}
              <View style={[s.navActiveLine, active && {backgroundColor: C.accent}]} />
              <View style={{opacity: active ? 1 : 0.35, marginTop: 8}}>
                {React.cloneElement(icon, {color: active ? C.accent : C.dim})}
              </View>
              <Text style={[s.navLabel, {color: active ? C.accent : C.muted}]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* RALLY SUMMARY FLASH */}
      {rallySummary && (
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setRallySummary(null)}
          style={{
            position:'absolute', bottom:80, left:16, right:IS_TABLET ? 296 : 16,
            backgroundColor: rallySummary.outcome === 'our' ? 'rgba(181,123,238,0.95)' : 'rgba(232,114,122,0.95)',
            borderRadius:12, padding:14, zIndex:999,
            shadowColor:'#000', shadowOpacity:0.4, shadowRadius:12,
          }}
        >
          <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
            <Text style={{color:'#fff', fontSize:fs(15), fontFamily:'Barlow_700Bold'}}>
              {rallySummary.outcome === 'our' ? '✓ Our Point' : '✗ Their Point'}
            </Text>
            <Text style={{color:'rgba(255,255,255,0.7)', fontSize:fs(11), fontFamily:'Barlow_400Regular'}}>
              {rallySummary.ourScore} – {rallySummary.theirScore}
            </Text>
          </View>
          <Text style={{color:'rgba(255,255,255,0.8)', fontSize:fs(11), fontFamily:'Barlow_400Regular', marginBottom:8}}>
            {rallySummary.reason}
          </Text>
          <View style={{flexDirection:'row', flexWrap:'wrap', gap:4}}>
            {rallySummary.touches.map((t, i) => (
              <View key={i} style={{
                paddingHorizontal:8, paddingVertical:3, borderRadius:6,
                backgroundColor:'rgba(0,0,0,0.25)',
              }}>
                <Text style={{color:'#fff', fontSize:fs(11), fontFamily:'Barlow_500Medium'}}>
                  #{t.playerNum} {ACTIONS[t.action]?.label}
                </Text>
              </View>
            ))}
          </View>
          <Text style={{color:'rgba(255,255,255,0.5)', fontSize:fs(10), marginTop:6, textAlign:'center'}}>
            Tap to dismiss
          </Text>
        </TouchableOpacity>
      )}

      {/* ACTION POPUP */}
      <ActionPopup popup={popup} setPopup={setPopup} confirmPopup={confirmPopup} />

      {/* SET RESULT MODAL */}
      <Modal visible={!!setResultModal} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Set {setResultModal?.setNum} Over</Text>
            <View style={{flexDirection:'row', justifyContent:'center', alignItems:'center', gap:16, marginVertical:14}}>
              <View style={{alignItems:'center'}}>
                <Text style={{fontSize:11, color:C.dim, marginBottom:4}}>{setResultModal?.ourName}</Text>
                <Text style={{fontSize:36, fontWeight:'700', color: setResultModal?.winner==='our' ? C.accent : C.text}}>
                  {setResultModal?.ourScore}
                </Text>
              </View>
              <Text style={{fontSize:20, color:C.muted}}>–</Text>
              <View style={{alignItems:'center'}}>
                <Text style={{fontSize:11, color:C.dim, marginBottom:4}}>{setResultModal?.theirName}</Text>
                <Text style={{fontSize:36, fontWeight:'700', color: setResultModal?.winner==='them' ? C.oppTeam : C.text}}>
                  {setResultModal?.theirScore}
                </Text>
              </View>
            </View>
            <Text style={{textAlign:'center', color: setResultModal?.winner==='our' ? C.accent : C.oppTeam, fontWeight:'700', fontSize:15, marginBottom:14}}>
              {setResultModal?.winner==='our' ? `${setResultModal?.ourName} win the set!` : `${setResultModal?.theirName} win the set!`}
            </Text>
            <Text style={{textAlign:'center', color:C.dim, fontSize:12, marginBottom:6}}>Sets: {setResultModal?.ourSets} – {setResultModal?.theirSets}</Text>
            {/* Switch sides */}
            <View style={{padding:12, backgroundColor:C.surface, borderRadius:10,
              marginBottom:14, marginTop:8, borderWidth:1, borderColor:C.border}}>
              <Text style={{color:C.text, fontSize:14, fontFamily:'Barlow_600SemiBold', marginBottom:2}}>
                Switch Sides?
              </Text>
              <Text style={{color:C.dim, fontSize:11, fontFamily:'Barlow_400Regular', marginBottom:10}}>
                Teams switch ends after each set
              </Text>
              {/* Track pending switch within this modal only */}
              {(() => {
                // Use a local variable to track if user wants to switch this set
                // switchSides reflects the CURRENT state — button toggles a pending change
                return null;
              })()}
              <View style={{flexDirection:'row', gap:8}}>
                <TouchableOpacity
                  style={[s.rotBtn, {flex:1}, !setResultModal?._pendingSwitch && {borderColor:C.accent, backgroundColor:C.accent+'22'}]}
                  onPress={() => setSetResultModal(p => ({...p, _pendingSwitch: false}))}
                >
                  <Text style={[s.rotBtnText, !setResultModal?._pendingSwitch && {color:C.accent}]}>No</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.rotBtn, {flex:1}, setResultModal?._pendingSwitch && {borderColor:C.green, backgroundColor:C.green+'22'}]}
                  onPress={() => setSetResultModal(p => ({...p, _pendingSwitch: true}))}
                >
                  <Text style={[s.rotBtnText, setResultModal?._pendingSwitch && {color:C.green}]}>Yes ⇄</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={[s.popupSectionLabel, {textAlign:'center', marginBottom:10}]}>Choose starting rotation for next set</Text>
            <View style={{flexDirection:'row', flexWrap:'wrap', gap:8, justifyContent:'center', marginBottom:14}}>
              {[0,1,2,3,4,5].map(i => (
                <TouchableOpacity
                  key={i}
                  style={[s.rotBtn, {minWidth:60}]}
                  onPress={() => {
                    const nextServingUs = setResultModal?.winner === 'them';
                    if (nextServingUs) {
                      setOurRotation(i);
                      setOppRotation((i - 1 + 6) % 6);
                    } else {
                      setOppRotation(i);
                      setOurRotation((i - 1 + 6) % 6);
                    }
                    setServingUs(nextServingUs);
                    // Apply pending switch if user selected Yes
                    if (setResultModal?._pendingSwitch) setSwitchSides(s => !s);
                    setSetResultModal(null);
                  }}
                >
                  <Text style={s.rotBtnText}>ROT {i+1}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* MATCH SUMMARY MODAL */}
      <Modal visible={!!matchSummary} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Match Over</Text>
            <Text style={{textAlign:'center', color: matchSummary?.winner===matchSummary?.ourName ? C.accent : C.oppTeam, fontWeight:'700', fontSize:18, marginVertical:10}}>
              🏆 {matchSummary?.winner} wins!
            </Text>
            {/* Set score */}
            <View style={{flexDirection:'row', justifyContent:'center', alignItems:'center', gap:16, marginBottom:14}}>
              <View style={{alignItems:'center'}}>
                <Text style={{fontSize:11, color:C.dim}}>{matchSummary?.ourName}</Text>
                <Text style={{fontSize:40, fontWeight:'700', color: matchSummary?.ourSets > matchSummary?.theirSets ? C.accent : C.text}}>{matchSummary?.ourSets}</Text>
              </View>
              <Text style={{fontSize:24, color:C.muted}}>–</Text>
              <View style={{alignItems:'center'}}>
                <Text style={{fontSize:11, color:C.dim}}>{matchSummary?.theirName}</Text>
                <Text style={{fontSize:40, fontWeight:'700', color: matchSummary?.theirSets > matchSummary?.ourSets ? C.oppTeam : C.text}}>{matchSummary?.theirSets}</Text>
              </View>
            </View>
            {/* Per-set breakdown */}
            <Text style={[s.popupSectionLabel, {textAlign:'center', marginBottom:8}]}>Set by set</Text>
            {matchSummary?.setHistory?.map((sh, i) => (
              <View key={i} style={{flexDirection:'row', justifyContent:'space-between', paddingVertical:6, borderBottomWidth:1, borderBottomColor:C.border}}>
                <Text style={{color:C.dim, fontSize:12}}>Set {sh.setNum}</Text>
                <Text style={{color: sh.winner==='our' ? C.accent : C.text, fontSize:13, fontWeight:'600'}}>{sh.ourScore}</Text>
                <Text style={{color:C.muted, fontSize:12}}>–</Text>
                <Text style={{color: sh.winner==='them' ? C.oppTeam : C.text, fontSize:13, fontWeight:'600'}}>{sh.theirScore}</Text>
                <Text style={{color: sh.winner==='our' ? C.accent : C.oppTeam, fontSize:11}}>
                  {sh.winner==='our' ? matchSummary?.ourName : matchSummary?.theirName}
                </Text>
              </View>
            ))}

            {/* MVP */}
            {(() => {
              const mvp = calcMVP(stats.ps, ourRoster);
              if (!mvp) return null;
              return (
                <View style={{
                  marginTop:16, padding:14, borderRadius:12,
                  backgroundColor: C.accent+'22', borderWidth:1.5, borderColor:C.accent,
                }}>
                  <Text style={{color:C.accent, fontSize:fs(11), fontFamily:'Barlow_600SemiBold',
                    letterSpacing:1, marginBottom:6}}>⭐ MATCH MVP</Text>
                  <View style={{flexDirection:'row', alignItems:'center', gap:12}}>
                    <View style={{width:48, height:48, borderRadius:24,
                      backgroundColor:C.accent+'33', borderWidth:2, borderColor:C.accent,
                      alignItems:'center', justifyContent:'center'}}>
                      <Text style={{color:C.accent, fontSize:fs(16), fontFamily:'Barlow_700Bold'}}>
                        #{mvp.player.num}
                      </Text>
                    </View>
                    <View style={{flex:1}}>
                      <Text style={{color:C.text, fontSize:fs(16), fontFamily:'Barlow_700Bold'}}>
                        {mvp.player.name}
                      </Text>
                      <Text style={{color:C.dim, fontSize:fs(11), fontFamily:'Barlow_400Regular'}}>
                        {mvp.player.role}
                      </Text>
                    </View>
                  </View>
                  <View style={{flexDirection:'row', flexWrap:'wrap', gap:6, marginTop:10}}>
                    {mvp.highlights.map((h, i) => (
                      <View key={i} style={{
                        paddingHorizontal:8, paddingVertical:3, borderRadius:6,
                        backgroundColor:C.accent+'33',
                      }}>
                        <Text style={{color:C.accent, fontSize:fs(11), fontFamily:'Barlow_600SemiBold'}}>
                          {h}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })()}

            <TouchableOpacity
              style={[s.bigBtn, {backgroundColor: C.green, marginTop:16}]}
              onPress={() => exportToExcel(rallies, stats, ourRoster, gameState)}
            >
              <Text style={s.bigBtnText}>📥 Export to CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.bigBtn, {backgroundColor: C.surface, borderWidth:1, borderColor:C.green, marginTop:8}]}
              onPress={() => exportToPDF(rallies, stats, ourRoster, {...gameState, matchNotes})}
            >
              <Text style={[s.bigBtnText, {color:C.green}]}>📄 Match Report (PDF)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.bigBtn, {backgroundColor: C.accent, marginTop:8}]}
              onPress={() => {
                setMatchSummary(null);
                setGameState(prev => ({
                  ...prev,
                  ourScore:0, theirScore:0,
                  ourSets:0, theirSets:0,
                  currentSet:1, setHistory:[], matchOver:false,
                }));
                // Save to match history before resetting
                (async () => {
                  try {
                    const historyRaw = await AsyncStorage.getItem(STORAGE_HISTORY);
                    const history = historyRaw ? JSON.parse(historyRaw) : [];
                    const lastRally = rallies[rallies.length-1];
                    const matchRecord = {
                      id: Date.now(),
                      date: new Date().toLocaleDateString(),
                      ourName: gameState.ourName,
                      theirName: gameState.theirName,
                      ourSets: gameState.ourSets,
                      theirSets: gameState.theirSets,
                      setHistory: gameState.setHistory,
                      ralliesCount: rallies.length,
                    };
                    history.unshift(matchRecord);
                    await AsyncStorage.setItem(STORAGE_HISTORY, JSON.stringify(history.slice(0,20)));
                    setMatchHistory(history.slice(0,20));
                  } catch(e) { console.log('History save error', e); }
                })();
                setRallies([]);
                setOurRotation(0);
                setOppRotation(0);
                setServingUs(true);
                setSwitchSides(false);
                setScreen('setup');
              }}
            >
              <Text style={s.bigBtnText}>New Match</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SUBSTITUTION MODAL */}
      <Modal visible={subModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, {maxHeight:'85%', width:'95%', maxWidth:500}]}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:14}}>
              <Text style={s.modalTitle}>Substitution</Text>
              <Text style={{color:C.amber, fontSize:12, fontFamily:'Barlow_500Medium'}}>
                {SUB_LIMIT - subsUsed} of {SUB_LIMIT} remaining
              </Text>
            </View>

            {!subOutPlayer ? (
              <>
                <Text style={[s.popupSectionLabel, {marginBottom:10}]}>
                  {subOutPlayer ? 'SELECT PLAYER COMING ON' : 'SELECT PLAYER COMING OFF'}
                </Text>
                <ScrollView style={{maxHeight:300}}>
                  {ourRoster.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={{flexDirection:'row', alignItems:'center', gap:12, padding:12,
                        borderBottomWidth:1, borderBottomColor:C.border}}
                      onPress={() => setSubOutPlayer(p)}
                    >
                      <View style={{width:40, height:40, borderRadius:20,
                        backgroundColor: p.libero ? C.amber+'22' : C.accent+'22',
                        borderWidth:1.5, borderColor: p.libero ? C.amber : C.accent,
                        alignItems:'center', justifyContent:'center'}}>
                        <Text style={{fontSize:13, fontWeight:'700',
                          color: p.libero ? C.amber : C.accent, fontFamily:'Barlow_700Bold'}}>
                          #{p.num}
                        </Text>
                      </View>
                      <View style={{flex:1}}>
                        <Text style={{color:C.text, fontSize:14, fontFamily:'Barlow_500Medium'}}>{p.name}</Text>
                        <Text style={{color:C.muted, fontSize:11, fontFamily:'Barlow_400Regular'}}>{p.role} — on court</Text>
                      </View>
                      <Text style={{color:C.red, fontSize:12, fontFamily:'Barlow_500Medium'}}>Sub off →</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : (
              <>
                <View style={{flexDirection:'row', alignItems:'center', gap:10, padding:10,
                  backgroundColor:C.red+'11', borderRadius:8, marginBottom:12, borderWidth:1, borderColor:C.red+'44'}}>
                  <Text style={{color:C.red, fontSize:13, fontFamily:'Barlow_500Medium'}}>
                    #{subOutPlayer.num} {subOutPlayer.name} coming OFF
                  </Text>
                </View>
                <Text style={[s.popupSectionLabel, {marginBottom:10}]}>SELECT PLAYER COMING ON</Text>
                <ScrollView style={{maxHeight:250}}>
                  {squad
                    .filter(p => !ourRoster.find(r => r.id === p.id)) // bench players only
                    .map(p => (
                      <TouchableOpacity
                        key={p.id}
                        style={{flexDirection:'row', alignItems:'center', gap:12, padding:12,
                          borderBottomWidth:1, borderBottomColor:C.border}}
                        onPress={() => {
                          // Perform substitution
                          const newRoster = ourRoster.map(r =>
                            r.id === subOutPlayer.id
                              ? { ...p, role: subOutPlayer.role, pos: subOutPlayer.pos,
                                  setter: subOutPlayer.setter, libero: subOutPlayer.libero }
                              : r
                          );
                          setOurRoster(newRoster);
                          setSubsUsed(n => n + 1);
                          setSubLog(prev => [...prev, {
                            outId: subOutPlayer.id, outNum: subOutPlayer.num, outName: subOutPlayer.name,
                            inId: p.id, inNum: p.num, inName: p.name,
                            role: subOutPlayer.role,
                            score: `${gameState.ourScore}-${gameState.theirScore}`,
                            set: gameState.currentSet,
                          }]);
                          setSubOutPlayer(null);
                          setSubModal(false);
                        }}
                      >
                        <View style={{width:40, height:40, borderRadius:20,
                          backgroundColor:C.green+'22', borderWidth:1.5, borderColor:C.green,
                          alignItems:'center', justifyContent:'center'}}>
                          <Text style={{fontSize:13, fontWeight:'700', color:C.green, fontFamily:'Barlow_700Bold'}}>
                            #{p.num}
                          </Text>
                        </View>
                        <View style={{flex:1}}>
                          <Text style={{color:C.text, fontSize:14, fontFamily:'Barlow_500Medium'}}>{p.name}</Text>
                          <Text style={{color:C.muted, fontSize:11, fontFamily:'Barlow_400Regular'}}>bench</Text>
                        </View>
                        <Text style={{color:C.green, fontSize:12, fontFamily:'Barlow_500Medium'}}>→ Sub on</Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
                <TouchableOpacity
                  style={{marginTop:10, alignItems:'center'}}
                  onPress={() => setSubOutPlayer(null)}
                >
                  <Text style={{color:C.dim, fontSize:12, fontFamily:'Barlow_400Regular'}}>← Back</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Sub log */}
            {subLog.length > 0 && (
              <View style={{marginTop:12, borderTopWidth:1, borderTopColor:C.border, paddingTop:10}}>
                <Text style={[s.popupSectionLabel, {marginBottom:6}]}>SUBS THIS SET</Text>
                {subLog.filter(sub => sub.set === gameState.currentSet).map((sub, i) => (
                  <Text key={i} style={{color:C.dim, fontSize:11, fontFamily:'Barlow_400Regular', marginBottom:3}}>
                    #{sub.outNum} {sub.outName} → #{sub.inNum} {sub.inName} ({sub.role}) at {sub.score}
                  </Text>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={{marginTop:12, alignItems:'center'}}
              onPress={() => { setSubModal(false); setSubOutPlayer(null); }}
            >
              <Text style={{color:C.muted, fontSize:12, fontFamily:'Barlow_400Regular'}}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* OPPONENT SUBSTITUTION MODAL */}
      <Modal visible={oppSubModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, {maxHeight:'80%', width:'95%', maxWidth:420}]}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:14}}>
              <Text style={s.modalTitle}>Opponent Substitution</Text>
              <TouchableOpacity onPress={() => setOppSubModal(false)}>
                <Text style={{color:C.muted, fontSize:18}}>✕</Text>
              </TouchableOpacity>
            </View>

            {!oppSubOut ? (
              <>
                <Text style={[s.popupSectionLabel, {marginBottom:10}]}>WHO IS COMING OFF?</Text>
                <ScrollView style={{maxHeight:300}}>
                  {oppRoster.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={{flexDirection:'row', alignItems:'center', gap:12, padding:12,
                        borderBottomWidth:1, borderBottomColor:C.border}}
                      onPress={() => setOppSubOut(p)}
                    >
                      <View style={{width:40, height:40, borderRadius:20,
                        backgroundColor:C.oppTeam+'22', borderWidth:1.5, borderColor:C.oppTeam,
                        alignItems:'center', justifyContent:'center'}}>
                        <Text style={{fontSize:13, fontWeight:'700', color:C.oppTeam, fontFamily:'Barlow_700Bold'}}>
                          #{p.num}
                        </Text>
                      </View>
                      <Text style={{color:C.text, fontSize:14, fontFamily:'Barlow_500Medium'}}>{p.role}</Text>
                      <Text style={{color:C.red, fontSize:12, fontFamily:'Barlow_500Medium', marginLeft:'auto'}}>Sub off →</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : (
              <>
                <View style={{flexDirection:'row', alignItems:'center', gap:10, padding:10,
                  backgroundColor:C.red+'11', borderRadius:8, marginBottom:14,
                  borderWidth:1, borderColor:C.red+'44'}}>
                  <Text style={{color:C.red, fontSize:13, fontFamily:'Barlow_500Medium'}}>
                    #{oppSubOut.num} ({oppSubOut.role}) coming OFF
                  </Text>
                </View>
                <Text style={[s.popupSectionLabel, {marginBottom:10}]}>JERSEY NUMBER COMING ON</Text>
                <TextInput
                  style={[s.input, {fontSize:24, textAlign:'center', fontFamily:'Barlow_700Bold', marginBottom:16}]}
                  value={oppSubInNum}
                  onChangeText={v => setOppSubInNum(v.replace(/[^0-9]/g,''))}
                  placeholder="e.g. 14"
                  placeholderTextColor={C.muted}
                  keyboardType="numeric"
                  maxLength={3}
                  autoFocus
                />
                <View style={{flexDirection:'row', gap:8}}>
                  <TouchableOpacity
                    style={[s.modalBtn, {borderColor:C.muted}]}
                    onPress={() => setOppSubOut(null)}
                  >
                    <Text style={[s.modalBtnText, {color:C.dim}]}>← Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.modalBtn, {flex:1, backgroundColor:C.oppTeam, borderColor:C.oppTeam,
                      opacity: oppSubInNum ? 1 : 0.4}]}
                    disabled={!oppSubInNum}
                    onPress={() => {
                      const newNum = parseInt(oppSubInNum);
                      setOppRoster(prev => prev.map(p =>
                        p.id === oppSubOut.id ? { ...p, num: newNum } : p
                      ));
                      setOppSubModal(false);
                      setOppSubOut(null);
                      setOppSubInNum('');
                    }}
                  >
                    <Text style={[s.modalBtnText, {color:'#fff'}]}>Confirm Sub →</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* SCORE CORRECTION MODAL */}
      <Modal visible={scoreCorrectModal} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Correct Score</Text>
            <Text style={{color:C.dim, fontSize:fs(12), marginBottom:16, fontFamily:'Barlow_400Regular'}}>
              Adjust the current set score
            </Text>
            {/* Our score */}
            {[
              { label: gameState.ourName || 'Us', color: C.accent,
                score: gameState.ourScore,
                onMinus: () => setGameState(g => ({...g, ourScore: Math.max(0, g.ourScore-1)})),
                onPlus:  () => setGameState(g => ({...g, ourScore: g.ourScore+1})) },
              { label: gameState.theirName || 'Them', color: C.oppTeam,
                score: gameState.theirScore,
                onMinus: () => setGameState(g => ({...g, theirScore: Math.max(0, g.theirScore-1)})),
                onPlus:  () => setGameState(g => ({...g, theirScore: g.theirScore+1})) },
            ].map((team, i) => (
              <View key={i} style={{flexDirection:'row', alignItems:'center',
                justifyContent:'space-between', marginBottom:16,
                paddingVertical:12, paddingHorizontal:8,
                backgroundColor:C.surface, borderRadius:10, borderWidth:1, borderColor:C.border}}>
                <Text style={{color:team.color, fontSize:fs(13), fontFamily:'Barlow_600SemiBold', flex:1}}>
                  {team.label}
                </Text>
                <View style={{flexDirection:'row', alignItems:'center', gap:16}}>
                  <TouchableOpacity
                    style={{width:40, height:40, borderRadius:20, backgroundColor:C.card,
                      borderWidth:1.5, borderColor:C.red, alignItems:'center', justifyContent:'center'}}
                    onPress={team.onMinus}
                  >
                    <Text style={{color:C.red, fontSize:22, fontFamily:'Barlow_700Bold', lineHeight:26}}>−</Text>
                  </TouchableOpacity>
                  <Text style={{color:C.text, fontSize:fs(36), fontFamily:'Barlow_700Bold', minWidth:44, textAlign:'center'}}>
                    {team.score}
                  </Text>
                  <TouchableOpacity
                    style={{width:40, height:40, borderRadius:20, backgroundColor:C.card,
                      borderWidth:1.5, borderColor:C.green, alignItems:'center', justifyContent:'center'}}
                    onPress={team.onPlus}
                  >
                    <Text style={{color:C.green, fontSize:22, fontFamily:'Barlow_700Bold', lineHeight:26}}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <TouchableOpacity
              style={[s.bigBtn, {backgroundColor:C.accent}]}
              onPress={() => setScoreCorrectModal(false)}
            >
              <Text style={s.bigBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* NET FAULT MODAL */}
      <Modal visible={netModal} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Net Touch</Text>
            <Text style={s.modalSub}>Which team caused the net fault?</Text>
            <View style={s.modalBtnRow}>
              <TouchableOpacity
                style={[s.modalBtn, {borderColor:C.accent, backgroundColor:'rgba(181,123,238,0.15)'}]}
                onPress={() => confirmNet('our')}
              >
                <Text style={[s.modalBtnText, {color:C.accent}]}>Our fault</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, {borderColor:C.oppTeam, backgroundColor:'rgba(232,114,122,0.15)'}]}
                onPress={() => confirmNet('them')}
              >
                <Text style={[s.modalBtnText, {color:C.oppTeam}]}>Their fault</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={{marginTop:10, alignItems:'center'}} onPress={() => setNetModal(false)}>
              <Text style={{color:C.dim, fontSize:12}}>← Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE BAR
// ─────────────────────────────────────────────────────────────────────────────
function ScoreBar({ gameState, servingUs, ourRotation, onScorePress }) {
  const { ourSets, theirSets, currentSet, setHistory } = gameState;
  return (
    <View style={s.scoreBar}>
      <View style={s.scoreSide}>
        <Text style={s.teamName}>{gameState.ourName}</Text>
        <TouchableOpacity onPress={() => onScorePress?.()}
          style={{flexDirection:'row', alignItems:'center', gap:6}}>
          <Text style={[s.scoreNum, {color: gameState.ourScore > gameState.theirScore ? C.accent : C.text}]}>
            {gameState.ourScore}
          </Text>
          {servingUs && <View style={s.servingDot} />}
        </TouchableOpacity>
        <Text style={s.rotLabel}>ROT {ourRotation + 1}</Text>
      </View>

      <View style={s.scoreCenter}>
        {/* Set score */}
        <View style={s.setScorebadge}>
          <Text style={[s.setScoreNum, {color: ourSets > theirSets ? C.accent : C.text}]}>{ourSets}</Text>
          <Text style={s.setScoreSep}>–</Text>
          <Text style={[s.setScoreNum, {color: theirSets > ourSets ? C.oppTeam : C.text}]}>{theirSets}</Text>
        </View>
        <Text style={s.setLabel}>SET {currentSet}</Text>
        {/* Previous set scores */}
        {setHistory.length > 0 && (
          <View style={{flexDirection:'row', gap:8, marginTop:4}}>
            {setHistory.map((sh, i) => (
              <Text key={i} style={{fontSize:fs(13), fontFamily:'Barlow_600SemiBold',
                color: sh.winner==='our' ? C.accent : C.oppTeam}}>
                {sh.ourScore}–{sh.theirScore}
              </Text>
            ))}
          </View>
        )}
      </View>

      <TouchableOpacity onPress={() => onScorePress?.()} style={[s.scoreSide, {alignItems:'flex-end'}]}>
        <Text style={s.teamName}>{gameState.theirName}</Text>
        <View style={{flexDirection:'row', alignItems:'center', gap:6}}>
          {!servingUs && <View style={[s.servingDot, {backgroundColor:C.oppTeam}]} />}
          <Text style={[s.scoreNum, {color: gameState.theirScore > gameState.ourScore ? C.oppTeam : C.text}]}>
            {gameState.theirScore}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RALLY BAR
// ─────────────────────────────────────────────────────────────────────────────
function RallyBar({ touches, servingUs, pendingFrom, receivedFirst, undoLastTouch, afterTouchBlock }) {
  const nextAction = inferNextAction(countNonBlockTouches(touches), servingUs);
  const nextInfo   = ACTIONS[nextAction] || {};
  return (
    <View style={s.rallyBar}>
      <View style={s.liveDot} />
      {afterTouchBlock ? (
        <View style={{flexDirection:'row', alignItems:'center', gap:6, flex:1}}>
          <View style={[s.actionTag, {backgroundColor: C.amber+'22', borderColor: C.amber+'88'}]}>
            <Text style={[s.actionTagText, {color: C.amber}]}>Touch Block</Text>
          </View>
          <Text style={s.rallyHint}>Tap whoever plays the deflected ball</Text>
        </View>
      ) : pendingFrom ? (
        <Text style={s.rallyHint} numberOfLines={1}>
          Tap player, court or NET for destination
        </Text>
      ) : (
        <View style={{flexDirection:'row', alignItems:'center', gap:6, flex:1}}>
          <Text style={s.rallyHint}>Next:</Text>
          <View style={[s.actionTag, {backgroundColor: nextInfo.color+'22', borderColor: nextInfo.color+'88'}]}>
            <Text style={[s.actionTagText, {color: nextInfo.color}]}>{nextInfo.label}</Text>
          </View>
          <Text style={[s.rallyHint, {opacity:0.5}]}>touch #{touches.length + 1}</Text>
        </View>
      )}
      {!servingUs && (
        <View style={[s.formationTag, receivedFirst && {backgroundColor:'rgba(46,194,126,0.15)', borderColor:C.green}]}>
          <Text style={[s.formationTagText, receivedFirst && {color:C.green}]}>
            {receivedFirst ? 'BASE' : 'RECV'}
          </Text>
        </View>
      )}
      <TouchableOpacity onPress={undoLastTouch} style={s.undoBtn}>
        <Text style={s.undoBtnText}>↩ Undo</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COURT VIEW
// ─────────────────────────────────────────────────────────────────────────────
function CourtView({
  ourLineup, oppLineup, touches, arrows, pendingFrom, highlightIds, blockerIds, oppHighlightIds, oppBlockerIds,
  rallyActive, onPlayerTap, onCourtTap, onNetPress,
  popup, setPopup, confirmPopup,
  startRally, undoLastTouch, servingUs, setServingUs,
  receivedFirst, afterTouchBlock,
  rallyEndModal, confirmRallyEnd, setRallyEndModal, onBackRallyEnd,
  switchSides, ourRotation, isDark,
}) {
  const [courtLayout, setCourtLayout] = useState({x:0, y:0, width:0, height:0});
  const courtRef = useRef(null);
  const [pendingServe, setPendingServe] = useState(null); // null | 'us' | 'them'

  function handleCourtLayout(e) {
    const {width, height} = e.nativeEvent.layout;
    if (courtRef.current?.measure) {
      courtRef.current.measure((fx, fy, w, h, pageX, pageY) => {
        setCourtLayout({x: pageX, y: pageY, width: w, height: h});
      });
    } else {
      setCourtLayout(prev => ({...prev, width, height}));
    }
  }

  function handleCourtPress(e) {
    if (!rallyActive || !pendingFrom) return;
    const native = e.nativeEvent;
    // locationX/locationY works on native; on Expo web fall back to pageX - court offset
    const x = native.locationX != null
      ? native.locationX
      : (native.pageX != null ? native.pageX - courtLayout.x : null);
    const y = native.locationY != null
      ? native.locationY
      : (native.pageY != null ? native.pageY - courtLayout.y : null);
    if (x == null || y == null) return;
    onCourtTap(x, y, courtLayout.width, courtLayout.height);
  }

  const CW = courtLayout.width  || 300;
  const CH = courtLayout.height || 400;

  // Convert normalised {x,y} (0-1) to pixel position on court
  // Our team occupies bottom half (y: 0.5-1.0 normalised → CH*0.5 to CH)
  // Opp team occupies top half  (y: 0.0-0.5 normalised → 0 to CH*0.5)
  // xy.x is already full-width normalised (0-1)
  // xy.y for our team: 0.5=net, 1.0=baseline → pixel = xy.y * CH
  // xy.y for opp team: 0.0=baseline, 0.5=net → pixel = xy.y * CH
  function xyToPixel(xy, flip = false) {
    if (flip) return { x: (1 - xy.x) * CW, y: (1 - xy.y) * CH };
    return { x: xy.x * CW, y: xy.y * CH };
  }

  function getPlayerCenter(playerId) {
    const ourP = ourLineup.find(p => p.id === playerId);
    if (ourP?.xy) return xyToPixel(ourP.xy, switchSides);
    const oppP = oppLineup.find(p => p.id === playerId);
    if (oppP?.xy) return xyToPixel(oppP.xy, switchSides);
    return null;
  }

  const NET_Y_PCT = 50; // net is at 50% height

  return (
    <View style={s.courtContainer}>
      {/* SERVE TOGGLE — always visible when rally not active */}
      {!rallyActive && (
        <View style={s.preRallyBar}>
            <TouchableOpacity
              style={[s.serveOpt, servingUs && s.serveOptSel,
                pendingServe === 'us' && {borderColor:C.accent, backgroundColor:C.accent+'33'}]}
              onPress={() => {
                if (servingUs) return; // already selected
                if (pendingServe === 'us') { setServingUs(true); setPendingServe(null); }
                else { setPendingServe('us'); setTimeout(() => setPendingServe(null), 2000); }
              }}
            >
              <Text style={[s.serveOptText, servingUs && {color:C.accent},
                pendingServe === 'us' && {color:C.accent}]}>
                {pendingServe === 'us' ? 'Tap again ✓' : 'We Serve'}
              </Text>
            </TouchableOpacity>
            <View style={[s.bigBtn, {flex:2, backgroundColor: C.surface, borderWidth:1, borderColor:C.border}]}>
              <Text style={[s.bigBtnText, {color:C.dim}]}>Tap a player to start</Text>
            </View>
            <TouchableOpacity
              style={[s.serveOpt, !servingUs && s.serveOptSelOpp,
                pendingServe === 'them' && {borderColor:C.oppTeam, backgroundColor:C.oppTeam+'33'}]}
              onPress={() => {
                if (!servingUs) return; // already selected
                if (pendingServe === 'them') { setServingUs(false); setPendingServe(null); }
                else { setPendingServe('them'); setTimeout(() => setPendingServe(null), 2000); }
              }}
            >
              <Text style={[s.serveOptText, !servingUs && {color:C.oppTeam},
                pendingServe === 'them' && {color:C.oppTeam}]}>
                {pendingServe === 'them' ? 'Tap again ✓' : 'They Serve'}
              </Text>
            </TouchableOpacity>
          </View>
      )}

      {/* LIVE RALLY BAR */}
      {rallyActive && <RallyBar
        touches={touches} servingUs={servingUs} pendingFrom={pendingFrom}
        receivedFirst={receivedFirst} undoLastTouch={undoLastTouch}
        afterTouchBlock={afterTouchBlock}
      />}

      {/* THE COURT */}
      <TouchableOpacity
        ref={courtRef}
        activeOpacity={1}
        style={s.court}
        onLayout={handleCourtLayout}
        onPress={handleCourtPress}
      >
        {/* Static court markings */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* Court half tints */}
          <View style={{
            position:'absolute', left:0, right:0, top:0, height:'50%',
            backgroundColor: switchSides ? 'rgba(181,123,238,0.04)' : 'rgba(232,114,122,0.04)',
          }} pointerEvents="none" />
          <View style={{
            position:'absolute', left:0, right:0, bottom:0, height:'50%',
            backgroundColor: switchSides ? 'rgba(232,114,122,0.04)' : 'rgba(181,123,238,0.04)',
          }} pointerEvents="none" />
          {/* Boundary */}
          <View style={s.courtBoundary} />
          {/* Attack lines */}
          <View style={[s.attackLine, {top:'33%'}]} />
          <View style={[s.attackLine, {top:'67%'}]} />
          {/* Court labels */}
          <Text style={[s.courtLabel, {top:6}]}>{switchSides ? 'OUR TEAM' : 'OPPONENT'}</Text>
          <Text style={[s.courtLabel, {bottom:6, top:undefined}]}>{switchSides ? 'OPPONENT' : 'OUR TEAM'}</Text>

          {/* Rotation badge — bottom right of court */}
          <View style={{
            position:'absolute', bottom:10, right:14,
            paddingHorizontal:10, paddingVertical:4,
            borderRadius:8, borderWidth:1.5, borderColor:C.accent,
            backgroundColor:'rgba(181,123,238,0.04)',
          }}>
            <Text style={{fontSize:fs(11), fontWeight:'700', color:C.accent, fontFamily:'Barlow_700Bold', letterSpacing:1}}>
              ROT {ourRotation + 1}
            </Text>
          </View>

          {/* Arrows */}
          {courtLayout.width > 0 && arrows.map((arr, i) => {
            const from = getPlayerCenter(arr.fromId);
            if (!from) return null;
            const to = arr.toType==='player'
              ? getPlayerCenter(arr.toId)
              : switchSides
                ? {x: courtLayout.width - arr.toX, y: courtLayout.height - arr.toY}
                : {x: arr.toX, y: arr.toY};
            if (!to) return null;
            const dx = to.x-from.x, dy = to.y-from.y;
            const len = Math.sqrt(dx*dx+dy*dy);
            const angle = Math.atan2(dy,dx)*180/Math.PI;
            // Shorten line by circle radius from each end so it touches edge not center
            const R = fs(38);
            const trim = arr.toType === 'floor' ? R : R * 2;
            const shortenedLen = Math.max(len - trim, 0);
            const unitX = len > 0 ? dx/len : 0;
            const unitY = len > 0 ? dy/len : 0;
            const startX = from.x + unitX * R;
            const startY = from.y + unitY * R;
            return (
              <View key={i} style={[s.arrowLine, {
                left:startX, top:startY, width:shortenedLen,
                transform:[{translateY:-1},{rotate:`${angle}deg`}],
                transformOrigin:'left center',
                backgroundColor: arr.toType==='floor' ? C.red : C.accent,
              }]} />
            );
          })}

          {/* Floor landing dots */}
          {arrows.filter(a=>a.toType==='floor').map((arr,i) => {
            const dotX = switchSides ? courtLayout.width  - arr.toX : arr.toX;
            const dotY = switchSides ? courtLayout.height - arr.toY : arr.toY;
            return <View key={`dot${i}`} style={[s.floorDot, {left:dotX-7, top:dotY-7}]} />;
          })}
        </View>

        {/* NET — thicker, only as wide as court (8%–92%) */}
        <TouchableOpacity
          style={s.netTouchArea}
          onPress={(e) => { e.stopPropagation(); if (rallyActive) onNetPress(); }}
          activeOpacity={0.7}
        >
          <View style={s.netBar}>
            <Text style={s.netText}>NET</Text>
          </View>
        </TouchableOpacity>

        {/* OPPONENT PLAYERS */}
        {oppLineup.map((player) => {
          if (!player?.xy) return null;
          const pos    = xyToPixel(player.xy, switchSides);
          const isLast = touches.length>0 && touches[touches.length-1]?.playerId===player.id;
          // MBs show as M/L to indicate they could be libero swapped
          const isOppLib      = player.pos === 'L';
          const isOppRunning  = player.runningToSet;
          const isOppHighlight= oppHighlightIds.includes(player.id);
          const isOppBlocker  = oppBlockerIds.includes(player.id);
          const isOppServer   = !rallyActive && !servingUs && oppHighlightIds.includes(player.id);
          const isOppDimmed   = rallyActive
            ? (!isOppHighlight && !isOppBlocker && !isLast && !isOppRunning)
            : (!isOppServer);  // dim all opp pre-rally unless they are the server
          const dispRole      = player.roleLabel || player.pos;
          return (
            <TouchableOpacity
              key={player.id}
              hitSlop={{top:16, bottom:16, left:16, right:16}}
              style={[s.playerCircle, isOppLib ? s.oppLiberoCircle : s.oppCircle, {
                left:pos.x-fs(38), top:pos.y-fs(38),
                opacity: isOppDimmed ? 0.4 : 1,
                borderColor: isLast ? C.oppTeam
                  : isOppHighlight ? (isDark ? '#FFFFFF' : '#000000')
                  : isOppBlocker ? C.amber
                  : isOppRunning ? C.amber
                  : '#000000',
                borderWidth: isOppHighlight || isOppBlocker || isOppRunning ? 2.5 : 1.5,
              }]}
              onPress={(e) => { e.stopPropagation(); onPlayerTap(player,'opp',pos.x,pos.y); }}
            >
              {isOppRunning && <View style={[s.rolePip, {backgroundColor:C.amber, top:undefined, bottom:2, left:2, right:undefined}]} />}
              <Text style={[s.playerNum, {color:'rgba(255,255,255,0.75)'}]}>#{player.num}</Text>
              <Text style={[s.playerPos, {color:'rgba(255,255,255,0.5)', fontSize:9}]}>{dispRole}</Text>
            </TouchableOpacity>
          );
        })}

        {/* OUR PLAYERS */}
        {ourLineup.map((player) => {
          if (!player?.xy) return null;
          const pos         = xyToPixel(player.xy, switchSides);
          const isLast      = touches.length>0 && touches[touches.length-1]?.playerId===player.id;
          const isPending   = pendingFrom?.id === player.id;
          const isHighlight = highlightIds.includes(player.id);
          const isBlocker   = blockerIds.includes(player.id);
          // Dim non-highlighted, non-blocker players during a rally
          // Dim during rally if not highlighted, or before rally if not the server
          const isServer    = !rallyActive && servingUs && highlightIds.includes(player.id);
          const isDimmed    = rallyActive
            ? (!isHighlight && !isBlocker && !isLast && !isPending)
            : !isServer;  // pre-rally: dim everyone except our server (when we serve)
          return (
            <TouchableOpacity
              key={player.id}
              hitSlop={{top:16, bottom:16, left:16, right:16}}
              style={[s.playerCircle,
                player.libero ? s.liberoCircle : s.ourCircle,
              {
                left:pos.x-fs(38), top:pos.y-fs(38),
                borderColor: isPending ? C.amber
                  : isHighlight ? (isDark ? '#FFFFFF' : '#000000')
                  : isBlocker ? C.amber
                  : isLast ? C.accent
                  : '#000000',
                borderWidth: isPending || isHighlight || isBlocker || isLast ? 2.5 : 1.5,
                opacity: isDimmed ? 0.4 : 1,
              }]}
              onPress={(e) => { e.stopPropagation(); onPlayerTap(player,'our',pos.x,pos.y); }}
            >
              {player.setter && !player.runningToSet && <View style={[s.rolePip, {backgroundColor:C.accent}]} />}
              {player.libero && <View style={[s.rolePip, {backgroundColor:C.amber}]} />}
              {player.runningToSet && (
                <View style={[s.rolePip, {backgroundColor:C.amber, top:undefined, bottom:2, left:2, right:undefined}]} />
              )}
              <Text style={[s.playerNum, {color:'rgba(255,255,255,0.75)'}]}>#{player.num}</Text>
              <Text style={[s.playerName, {color:'rgba(255,255,255,0.5)'}]}>{player.name}</Text>
              <Text style={[s.playerPos, {color:'rgba(255,255,255,0.5)'}]}>{player.roleLabel || player.pos}</Text>
            </TouchableOpacity>
          );
        })}

      </TouchableOpacity>

      {/* RALLY END MODAL */}
      <Modal visible={!!rallyEndModal} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Rally Over</Text>
            <Text style={s.modalSub}>{rallyEndModal?.reason}</Text>
            <View style={s.modalOutcomeRow}>
              <View style={[s.modalOutcome, {
                backgroundColor: rallyEndModal?.outcome==='our'
                  ? 'rgba(181,123,238,0.2)' : 'rgba(232,114,122,0.2)',
                borderColor: rallyEndModal?.outcome==='our' ? C.accent : C.oppTeam,
              }]}>
                <Text style={[s.modalOutcomeText, {
                  color: rallyEndModal?.outcome==='our' ? C.accent : C.oppTeam,
                }]}>
                  {rallyEndModal?.outcome==='our' ? '✓ Our Point' : '✗ Their Point'}
                </Text>
              </View>
            </View>
            {/* Override outcome */}
            <View style={[s.modalBtnRow, {marginBottom:10}]}>
              <TouchableOpacity
                style={[s.modalBtn, {borderColor:C.accent, opacity: rallyEndModal?.outcome==='our'?1:0.4}]}
                onPress={() => setRallyEndModal(p => ({...p, outcome:'our'}))}
              >
                <Text style={[s.modalBtnText, {color:C.accent}]}>Our point</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, {borderColor:C.oppTeam, opacity: rallyEndModal?.outcome==='them'?1:0.4}]}
                onPress={() => setRallyEndModal(p => ({...p, outcome:'them'}))}
              >
                <Text style={[s.modalBtnText, {color:C.oppTeam}]}>Their point</Text>
              </TouchableOpacity>
            </View>
            <View style={s.modalBtnRow}>
              <TouchableOpacity
                style={[s.modalBtn, {borderColor:C.muted}]}
                onPress={() => {
                  onBackRallyEnd();
                }}
              >
                <Text style={[s.modalBtnText, {color:C.dim}]}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, {backgroundColor:C.accent, borderColor:C.accent}]}
                onPress={confirmRallyEnd}
              >
                <Text style={[s.modalBtnText, {color:'#fff'}]}>Confirm →</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION POPUP — two completely separate layouts for our team vs opponent
// ─────────────────────────────────────────────────────────────────────────────
function ActionPopup({ popup, setPopup, confirmPopup }) {
  if (!popup) return null;
  return <OurPopup popup={popup} setPopup={setPopup} confirmPopup={confirmPopup} />;
}

// ── OUR TEAM POPUP ────────────────────────────────────────────────────────────
function OurPopup({ popup, setPopup, confirmPopup }) {
  const isServe              = popup.action === 'spin' || popup.action === 'float';
  const isReceiveBlockChoice = popup.needsReceiveBlockChoice;
  const actionMeta           = ACTIONS[popup.action] || {};
  const actionColor          = actionMeta.color || C.accent;

  function selectAction(a) {
    const updated = { ...popup, action: a, needsReceiveBlockChoice: false };
    // Opponent receive/block — no quality needed, confirm instantly
    if (!popup.isOur) {
      confirmPopup({ ...updated, quality: null });
      return;
    }
    // Serve (spin/float) and block confirm instantly — no quality needed
    if (a === 'spin' || a === 'float' || a === 'block') {
      confirmPopup({ ...updated, quality: null });
    } else {
      setPopup(updated);
    }
  }

  // Quality only for serve receive (first touch when opp serves)
  const isServeReceive = popup.action === 'receive' && !popup.servingUs && popup.touchIndex === 0;
  const needsQuality = isServeReceive;

  function selectQuality(q) {
    confirmPopup({ ...popup, quality: q });
  }

  return (
    <Modal visible transparent animationType="fade">
      <View style={s.popupOverlay}>
        <View style={s.popupCard}>

          {/* Header */}
          <View style={s.popupHeader}>
            <View style={[s.popupNumBadge, {borderColor: actionColor}]}>
              <Text style={[s.popupNumBadgeText, {color: actionColor}]}>#{popup.player.num}</Text>
            </View>
            <View style={{flex:1}}>
              <Text style={s.popupPlayerName}>{popup.player.name}</Text>
              <Text style={s.popupPlayerRole}>{popup.player.roleLabel || popup.player.pos} · Touch #{popup.touchIndex + 1}</Text>
            </View>
            <TouchableOpacity onPress={() => setPopup(null)} style={s.popupClose}>
              <Text style={s.popupCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Action */}
          <Text style={s.popupSectionLabel}>Action</Text>

          {/* Serve: Spin / Float choice */}
          {isServe && (
            <View style={[s.popupActionRow, {marginBottom:16}]}>
              {['spin','float'].map(a => {
                const meta = ACTIONS[a] || {};
                const sel  = popup.action === a;
                return (
                  <TouchableOpacity
                    key={a}
                    style={[s.popupActionBigBtn, sel && {backgroundColor:meta.color+'33', borderColor:meta.color}]}
                    onPress={() => selectAction(a)}
                  >
                    <Text style={[s.popupActionBigText, {color: sel ? meta.color : C.dim}]}>{meta.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Front row first touch: Receive / Block choice */}
          {!isServe && isReceiveBlockChoice && (
            <View style={[s.popupActionRow, {marginBottom:16}]}>
              {['receive','block'].map(a => {
                const meta = ACTIONS[a] || {};
                const sel  = popup.action === a;
                return (
                  <TouchableOpacity
                    key={a}
                    style={[s.popupActionBigBtn, sel && {backgroundColor:meta.color+'33', borderColor:meta.color}]}
                    onPress={() => selectAction(a)}
                  >
                    <Text style={[s.popupActionBigText, {color: sel ? meta.color : C.dim}]}>{meta.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* All other touches: auto action label — tap it to confirm immediately */}
          {!isServe && !isReceiveBlockChoice && !needsQuality && (
            <TouchableOpacity
              style={[s.popupActionBigBtn, {
                backgroundColor: actionColor+'22',
                borderColor: actionColor,
                marginBottom: 16,
              }]}
              onPress={() => confirmPopup({ ...popup, quality: null })}
              activeOpacity={0.6}
            >
              <Text style={[s.popupActionBigText, {color: actionColor}]}>
                {actionMeta.label}  →  Tap to log
              </Text>
            </TouchableOpacity>
          )}

          {/* Quality — only for serve receive */}
          {!isReceiveBlockChoice && needsQuality && (
            <>
              <View style={[s.popupActionBigBtn, {
                backgroundColor: actionColor+'22',
                borderColor: actionColor,
                marginBottom: 12,
              }]}>
                <Text style={[s.popupActionBigText, {color: actionColor}]}>Receive</Text>
              </View>
              <Text style={s.popupSectionLabel}>Reception Quality</Text>
              <View style={s.popupQualRow}>
                {[0,1,2,3].map(q => {
                  const qColor = q===0 ? C.red : q===3 ? C.accent : '#4F7FFF';
                  return (
                    <TouchableOpacity
                      key={q}
                      style={s.popupQualBtn}
                      onPress={() => selectQuality(q)}
                    >
                      <Text style={[s.popupQualNum, {color: qColor}]}>{q}</Text>
                      <Text style={[s.popupQualSub, {color: qColor+'99'}]}>{QUALITY_LABELS[q]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

        </View>
      </View>
    </Modal>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// SIDE STATS
// ─────────────────────────────────────────────────────────────────────────────
function SideStats({ gameState, stats, roster, touches, rallies, rallyActive, undoLastTouch, ourRotation, subsUsed, onSubPress, onOppSubPress, switchSides, onToggleTheme, isDark }) {
  const [tab, setTab] = useState('stats');
  const our   = rallies.filter(r=>r.outcome==='our').length;
  const them  = rallies.filter(r=>r.outcome==='them').length;
  const total = our+them||1;

  return (
    <View style={{flex:1}}>
      <View style={[s.sideTabRow, {alignItems:'center'}]}>
        {['stats','log'].map(t => (
          <TouchableOpacity key={t} style={[s.sideTab, tab===t&&s.sideTabActive]} onPress={()=>setTab(t)}>
            <Text style={[s.sideTabText, tab===t&&{color:C.text}]}>{t==='stats'?'Stats':'Log'}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          onPress={onToggleTheme}
          style={{paddingHorizontal:10, paddingVertical:8}}
        >
          <Text style={{fontSize:fs(16)}}>{isDark ? '☀️' : '🌙'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{flex:1}} contentContainerStyle={{padding:12, gap:8}}>
        {tab==='stats' && (
          <>
            {/* Team name */}
            <Text style={[s.sideTeamLabel, {marginBottom:4}]}>{gameState.ourName}</Text>

            {/* Attack stats — non-libero players */}
            <View style={s.sidePlayerHeader}>
              <Text style={[s.sidePlayerCell,{flex:1}]}>PLAYER</Text>
              {['K','AE','EFF'].map(h=>(
                <Text key={h} style={s.sidePlayerCell}>{h}</Text>
              ))}
            </View>
            {roster.filter(p => p.pos !== 'L').map(p => {
              const ps  = stats.ps[p.id]||{};
              const eff = ps.attackAtt>0 ? Math.round(((ps.kills-ps.attackErr)/ps.attackAtt)*100) : 0;
              return (
                <View key={p.id} style={s.sidePlayerRow}>
                  <Text style={[s.sidePlayerCell,{flex:1,color:C.text,fontSize:13}]}>#{p.num} {p.name}</Text>
                  <Text style={[s.sidePlayerCell,{color:(ps.kills||0)>0?C.green:C.text}]}>{ps.kills||0}</Text>
                  <Text style={[s.sidePlayerCell,{color:(ps.attackErr||0)>0?C.red:C.text}]}>{ps.attackErr||0}</Text>
                  <Text style={[s.sidePlayerCell,{color:eff>30?C.green:eff<0?C.red:C.text}]}>
                    {eff>0?'+':''}{eff}%
                  </Text>
                </View>
              );
            })}

            {/* Libero row with separate headers */}
            {roster.filter(p => p.pos === 'L').map(p => {
              const ps = stats.ps[p.id]||{};
              const recvPct = ps.recvTotal>0 ? Math.round((ps.recvQual||0)/ps.recvTotal/3*100) : 0;
              return (
                <View key={p.id}>
                  {/* Libero column headers */}
                  <View style={[s.sidePlayerHeader, {marginTop:8, paddingTop:6, borderTopWidth:1, borderTopColor:C.border}]}>
                    <Text style={[s.sidePlayerCell,{flex:1,color:C.amber}]}>LIBERO</Text>
                    {['RCV','RCV%'].map(h=>(
                      <Text key={h} style={[s.sidePlayerCell,{color:C.amber}]}>{h}</Text>
                    ))}
                  </View>
                  <View style={s.sidePlayerRow}>
                    <Text style={[s.sidePlayerCell,{flex:1,color:C.amber,fontSize:13}]}>#{p.num} {p.name}</Text>
                    <Text style={[s.sidePlayerCell,{color:C.amber}]}>{ps.recvTotal||0}</Text>
                    <Text style={[s.sidePlayerCell,{color:recvPct>=60?C.green:recvPct>0&&recvPct<30?C.red:C.amber}]}>
                      {ps.recvTotal>0?`${recvPct}%`:'—'}
                    </Text>
                  </View>
                </View>
              );
            })}
            {/* Per Rotation — compact */}
            {stats.rotStats?.some(r => r.won+r.lost > 0) && (
              <View style={{marginTop:8}}>
                <Text style={[s.sideTeamLabel, {marginBottom:6}]}>Per Rotation</Text>
                <View style={{flexDirection:'row', flexWrap:'wrap', gap:4}}>
                  {stats.rotStats.map(r => {
                    const total = r.won + r.lost;
                    if (total === 0) return null;
                    const pct = Math.round(r.won / total * 100);
                    const col = pct >= 60 ? C.green : pct >= 40 ? C.amber : C.red;
                    return (
                      <View key={r.rot} style={{
                        alignItems:'center', paddingHorizontal:6, paddingVertical:3,
                        borderRadius:6, backgroundColor:col+'22',
                        borderWidth:1, borderColor:col+'66', minWidth:44,
                      }}>
                        <Text style={{color:col, fontSize:fs(8), fontFamily:'Barlow_600SemiBold'}}>R{r.rot}</Text>
                        <Text style={{color:C.text, fontSize:fs(12), fontFamily:'Barlow_700Bold'}}>{pct}%</Text>
                        <Text style={{color:C.dim, fontSize:fs(8)}}>{r.won}W {r.lost}L</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

          </>
        )}

        {tab==='log' && (
          <>
            {rallyActive && touches.length>0 && (
              <>
                <Text style={s.sideTeamLabel}>Current Rally</Text>
                {touches.map((t,i) => (
                  <View key={i} style={s.logEntry}>
                    <Text style={[s.logNum,{color:t.team==='our'?C.accent:C.oppTeam}]}>#{t.playerNum}</Text>
                    <Text style={[s.logAction,{flex:1}]}>{t.playerName}</Text>
                    <Text style={[s.logQual,{color:C.dim}]}>{ACTIONS[t.action]?.label||t.action}</Text>
                  </View>
                ))}
                <TouchableOpacity style={[s.undoBtn,{marginTop:4}]} onPress={undoLastTouch}>
                  <Text style={s.undoBtnText}>↩ Undo Last</Text>
                </TouchableOpacity>
              </>
            )}
            {[...rallies].reverse().map(r => (
              <View key={r.id} style={s.historyItem}>
                <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:4}}>
                  <Text style={{color:C.dim,fontSize:10}}>Rally #{r.rallyNum}</Text>
                  <Text style={{color:r.outcome==='our'?C.accent:C.oppTeam,fontSize:11,fontWeight:'600'}}>
                    {r.outcome==='our'?'+1':'−1'}
                  </Text>
                </View>
                {r.touches.map((t,i) => (
                  <Text key={i} style={{color:C.dim,fontSize:10}}>
                    #{t.playerNum} {t.playerName} — {ACTIONS[t.action]?.label}
                  </Text>
                ))}
              </View>
            ))}
            {!rallyActive && rallies.length===0 && <Text style={s.emptyText}>No rallies yet.</Text>}
          </>
        )}
      </ScrollView>

      {/* Sub buttons at bottom of side panel */}
      {!rallyActive && (
        <View style={{gap:6, margin:10}}>
          {/* Our team sub */}
          <TouchableOpacity
            style={{
              padding:12, borderRadius:10, borderWidth:1.5,
              borderColor: subsUsed >= SUB_LIMIT ? C.muted : C.amber,
              backgroundColor: subsUsed >= SUB_LIMIT ? C.surface : C.amber+'11',
              flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8,
              opacity: subsUsed >= SUB_LIMIT ? 0.5 : 1,
            }}
            onPress={() => { if (subsUsed < SUB_LIMIT) onSubPress(); }}
            disabled={subsUsed >= SUB_LIMIT}
          >
            <Text style={{fontSize:13, fontWeight:'600', color: subsUsed >= SUB_LIMIT ? C.muted : C.amber, fontFamily:'Barlow_600SemiBold'}}>
              ⇄  Our Sub
            </Text>
            <View style={{paddingHorizontal:7, paddingVertical:2, borderRadius:8,
              backgroundColor: subsUsed >= SUB_LIMIT ? C.muted+'22' : C.amber+'33'}}>
              <Text style={{fontSize:11, color: subsUsed >= SUB_LIMIT ? C.muted : C.amber, fontFamily:'Barlow_600SemiBold'}}>
                {SUB_LIMIT - subsUsed} left
              </Text>
            </View>
          </TouchableOpacity>
          {/* Opponent sub */}
          <TouchableOpacity
            style={{
              padding:12, borderRadius:10, borderWidth:1.5,
              borderColor: C.oppTeam,
              backgroundColor: C.oppTeam+'11',
              flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8,
            }}
            onPress={onOppSubPress}
          >
            <Text style={{fontSize:13, fontWeight:'600', color: C.oppTeam, fontFamily:'Barlow_600SemiBold'}}>
              ⇄  Opp Sub
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={s.undoBarBtn} onPress={undoLastTouch}>
        <Text style={s.undoBarText}>↩ Undo Last Action</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS PANEL
// ─────────────────────────────────────────────────────────────────────────────
function HeatmapView({ rallies, switchSides }) {
  const [filter, setFilter] = useState('all');

  // SVG court dimensions — horizontal layout
  const W = 900, H = 400;
  // Court boundary (with margin for out-of-bounds)
  const MARGIN = 40;
  const CW = W - MARGIN * 2; // court width
  const CH = H - MARGIN * 2; // court height
  const CX = MARGIN, CY = MARGIN; // court top-left

  // Grid: 10 cols x 6 rows for horizontal court
  const GCOLS = 10, GROWS = 6;
  const CW_FRAC = CW / W; // fraction of width that is court
  const CH_FRAC = CH / H;

  const FILTERS = [
    { id:'all',     label:'All' },
    { id:'attack',  label:'Attacks' },
    { id:'serve',   label:'Serves' },
    { id:'receive', label:'Reception' },
    { id:'dig',     label:'Digs' },
    { id:'block',   label:'Blocks' },
  ];

  // Build counts — map xy (0-1, 0=opp top, 1=our bottom) to SVG grid cells
  const counts = {};
  FILTERS.forEach(f => {
    counts[f.id] = Array(GROWS).fill(null).map(() => Array(GCOLS).fill(0));
  });
  const totals = {};
  FILTERS.forEach(f => { totals[f.id] = 0; });

  rallies.forEach(r => {
    r.touches.forEach((t, idx) => {
      if (!t.xy) return;
      let x = t.xy.x, y = t.xy.y;
      if (switchSides) { x = 1-x; y = 1-y; }

      // Horizontal court: y (opp→our) → col (left→right), x (left→right) → row (top→bottom)
      const svgCol = CX + y * CW; // y maps to horizontal position
      const svgRow = CY + x * CH; // x maps to vertical position
      const col = Math.min(GCOLS-1, Math.floor(svgCol / W * GCOLS));
      const row = Math.min(GROWS-1, Math.floor(svgRow / H * GROWS));

      const isServeReceive = t.action==='receive' && t.team==='our' &&
        r.touches.slice(0,idx).every(p => p.team==='opp');
      const isDig = t.action==='receive' && !isServeReceive;
      const isOur = t.team==='our';

      const cats = ['all'];
      if (t.action==='attack' && isOur)                    cats.push('attack');
      if ((t.action==='spin'||t.action==='float') && isOur) cats.push('serve');
      if (isServeReceive)                                   cats.push('receive');
      if (isDig && isOur)                                   cats.push('dig');
      if (t.action==='block' && isOur)                     cats.push('block');

      cats.forEach(c => { counts[c][row][col]++; totals[c]++; });
    });
  });

  const availableFilters = FILTERS.filter(f => totals[f.id] > 0);
  const activeFilter = totals[filter] > 0 ? filter : 'all';
  const grid = counts[activeFilter];
  const total = totals[activeFilter];
  const posMax = Math.max(1, ...grid.flat());

  const heatColor = (count) => {
    if (count === 0) return null;
    const i = count / posMax;
    if (i <= 0.20) return 'rgba(30,100,255,0.4)';
    if (i <= 0.40) return 'rgba(0,180,80,0.5)';
    if (i <= 0.65) return 'rgba(220,180,0,0.6)';
    if (i <= 0.85) return 'rgba(255,110,0,0.65)';
    return 'rgba(255,30,30,0.75)';
  };

  const cellW = W / GCOLS;
  const cellH = H / GROWS;

  if (posMax <= 1 && total === 0) {
    return <Text style={[s.emptyText,{padding:20}]}>No touch data yet — play some rallies first.</Text>;
  }

  return (
    <View style={{padding:8}}>
      {/* Filter tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{marginBottom:10}} contentContainerStyle={{gap:6}}>
        {availableFilters.map(f => (
          <TouchableOpacity key={f.id}
            style={{paddingHorizontal:12, paddingVertical:6, borderRadius:16,
              backgroundColor: activeFilter===f.id ? C.accent+'33' : C.surface,
              borderWidth:1, borderColor: activeFilter===f.id ? C.accent : C.border}}
            onPress={() => setFilter(f.id)}>
            <Text style={{color: activeFilter===f.id ? C.accent : C.dim,
              fontSize:fs(12), fontFamily:'Barlow_500Medium'}}>
              {f.label} ({totals[f.id]})
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* SVG Court + Heatmap — fixed height to fit on screen */}
      <Svg width="100%" height={260} viewBox={`0 0 ${W} ${H}`}
        style={{borderRadius:8}} preserveAspectRatio="xMidYMid meet">

        {/* Background */}
        <Rect x={0} y={0} width={W} height={H} fill="#090B11" rx={8} />

        {/* Out of bounds area hint */}
        <Rect x={0} y={0} width={W} height={H} fill="rgba(0,0,0,0)" />

        {/* Court half tints — left=opponent (unless switched), right=our team */}
        <Rect x={CX} y={CY} width={CW/2} height={CH}
          fill={switchSides ? "rgba(181,123,238,0.06)" : "rgba(232,114,122,0.06)"} />
        <Rect x={CX+CW/2} y={CY} width={CW/2} height={CH}
          fill={switchSides ? "rgba(232,114,122,0.06)" : "rgba(181,123,238,0.06)"} />

        {/* Heatmap cells */}
        {grid.map((row, ri) =>
          row.map((count, ci) => {
            const color = heatColor(count);
            if (!color) return null;
            const pct = total > 0 ? Math.round(count/total*100) : 0;
            const x = ci * cellW;
            const y = ri * cellH;
            const isOut = x < CX || x+cellW > CX+CW || y < CY || y+cellH > CY+CH;
            return (
              <G key={`${ri}-${ci}`}>
                <Rect x={x} y={y} width={cellW} height={cellH}
                  fill={color} rx={isOut ? 4 : 0} />
                <SvgText x={x+cellW/2} y={y+cellH/2-5}
                  fill="white" fontSize={isOut?14:18}
                  fontWeight="700" textAnchor="middle">{count}</SvgText>
                <SvgText x={x+cellW/2} y={y+cellH/2+12}
                  fill="rgba(255,255,255,0.7)" fontSize={12}
                  textAnchor="middle">{pct}%</SvgText>
              </G>
            );
          })
        )}

        {/* Attack lines — vertical at 3m from net */}
        <Line x1={CX+CW/3} y1={CY} x2={CX+CW/3} y2={CY+CH}
          stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeDasharray="8,6" />
        <Line x1={CX+CW*2/3} y1={CY} x2={CX+CW*2/3} y2={CY+CH}
          stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeDasharray="8,6" />

        {/* Court boundary */}
        <Rect x={CX} y={CY} width={CW} height={CH}
          fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={3} />

        {/* Net — vertical line in middle of horizontal court */}
        <Rect x={CX+CW/2-4} y={CY-8} width={8} height={CH+16}
          fill="#B57BEE" rx={4} />

        {/* Labels */}
        <SvgText x={CX+CW/4} y={CY+CH/2+5}
          fill={switchSides ? "rgba(181,123,238,0.7)" : "rgba(232,114,122,0.7)"}
          fontSize={16} textAnchor="middle" letterSpacing={3}>
          {switchSides ? 'OUR TEAM' : 'OPPONENT'}
        </SvgText>
        <SvgText x={CX+CW*3/4} y={CY+CH/2+5}
          fill={switchSides ? "rgba(232,114,122,0.7)" : "rgba(181,123,238,0.7)"}
          fontSize={16} textAnchor="middle" letterSpacing={3}>
          {switchSides ? 'OPPONENT' : 'OUR TEAM'}
        </SvgText>
        <SvgText x={5} y={14} fill="rgba(255,255,255,0.25)"
          fontSize={11} textAnchor="start">OUT</SvgText>
        <SvgText x={W-5} y={H-4} fill="rgba(255,255,255,0.25)"
          fontSize={11} textAnchor="end">OUT</SvgText>
        <SvgText x={CX+CW/2} y={CY-8} fill="white"
          fontSize={13} textAnchor="middle" fontWeight="700">NET</SvgText>
      </Svg>

      {/* Legend */}
      <View style={{flexDirection:'row', gap:4, justifyContent:'center',
        marginTop:8, alignItems:'center'}}>
        {['rgba(30,100,255,0.6)','rgba(0,180,80,0.65)','rgba(220,180,0,0.7)',
          'rgba(255,110,0,0.75)','rgba(255,30,30,0.85)'].map((c,i) => (
          <View key={i} style={{width:28, height:12, borderRadius:2, backgroundColor:c}} />
        ))}
        <Text style={{color:C.dim, fontSize:fs(9), marginLeft:4}}>Low → Hot</Text>
      </View>
      <Text style={{color:C.muted, fontSize:fs(10), textAlign:'center', marginTop:4}}>
        {total} touches · {activeFilter}
      </Text>
    </View>
  );
}


function StatsPanel({ stats, roster, rallies, switchSides, oppRoster = [] }) {
  const [statTab, setStatTab] = useState('attack');
  const pct = (n,d) => d>0?Math.round(n/d*100):0;
  const eff = (k,e,a) => a>0?Math.round(((k-e)/a)*100):0;

  // Tab definitions: { id, label, headers, cols(ps, isLibero) }
  const TABS = [
    {
      id: 'attack',
      label: 'Attack',
      headers: ['K', 'ATT', 'EFF', 'AE'],
      cols: (ps, isLib) => isLib
        ? ['—', '—', '—', '—']
        : [ps.kills||0, ps.attackAtt||0, `${eff(ps.kills||0,ps.attackErr||0,ps.attackAtt||0)}%`, ps.attackErr||0],
      colColor: (v, i, ps, isLib) => {
        if (isLib) return C.muted;
        if (i===2) { const e=eff(ps.kills||0,ps.attackErr||0,ps.attackAtt||0); return e>30?C.green:e<0?C.red:C.text; }
        if (i===3) return (ps.attackErr||0)>0 ? C.red : C.text;
        return C.text;
      },
    },
    {
      id: 'serve',
      label: 'Serve',
      headers: ['ACE', 'ATT', 'ACE%', 'SE'],
      cols: (ps, isLib) => isLib
        ? ['—', '—', '—', '—']
        : [ps.aces||0, ps.serveAtt||0, `${pct(ps.aces||0, ps.serveAtt||0)}%`, ps.serveErr||0],
      colColor: (v, i, ps, isLib) => {
        if (isLib) return C.muted;
        if (i===0) return (ps.aces||0)>0 ? C.green : C.text;
        if (i===3) return (ps.serveErr||0)>0 ? C.red : C.text;
        return C.text;
      },
    },
    {
      id: 'defence',
      label: 'Defence',
      headers: ['RCV', 'RCV%', 'DIG', 'BLK', 'BE'],
      cols: (ps, isLib) => {
        const recvPct = ps.recvTotal>0 ? `${Math.round((ps.recvQual||0)/ps.recvTotal/3*100)}%` : '—';
        // Libero: BLK and BE shown as — (cannot block)
        return [ps.recvTotal||0, recvPct, ps.digs||0, isLib ? '—' : (ps.blocks||0), isLib ? '—' : (ps.blockErr||0)];
      },
      colColor: (v, i, ps, isLib) => {
        if (i===1 && ps.recvTotal>0) {
          const r = Math.round((ps.recvQual||0)/ps.recvTotal/3*100);
          return r>=60?C.green:r<30?C.red:C.text;
        }
        if (i===4 && !isLib) return (ps.blockErr||0)>0 ? C.red : C.text;
        if (i===3 && !isLib) return (ps.blocks||0)>0 ? C.green : C.text;
        return C.text;
      },
    },
  ];

  const activeTab = TABS.find(t => t.id === statTab);
  const colW = statTab === 'defence' ? 34 : 38;

  return (
    <ScrollView contentContainerStyle={{padding:14, gap:10}}>

      {/* Overall match stats — always visible */}
      <>

      {/* Team summary cards */}
      <View style={s.statGrid}>
        <StatCard label="Kills"  value={stats.teamKills}  sub="total attacks" />
        <StatCard label="Aces"   value={stats.teamAces}   sub={`${pct(stats.teamAces,stats.teamServes)}% of serves`} />
        <StatCard label="Blocks" value={stats.teamBlocks} sub="stuff blocks" />
        <StatCard label="Recv"   value={`${pct(stats.recvPerf,stats.recvTotal)}%`} sub="perfect pass" />
      </View>

      {/* Rally outcomes bar — only show if rallies have happened */}
      {rallies.length > 0 && (() => {
        const our   = rallies.filter(r=>r.outcome==='our').length;
        const them  = rallies.filter(r=>r.outcome==='them').length;
        const total = our + them || 1;
        return (
          <View style={s.card}>
            <Text style={s.sectionLabel}>Rally outcomes</Text>
            <View style={{height:8,borderRadius:4,flexDirection:'row',overflow:'hidden',marginTop:8}}>
              <View style={{flex:our||0.01, backgroundColor:C.accent}} />
              <View style={{flex:them||0.01, backgroundColor:C.oppTeam}} />
            </View>
            <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:6}}>
              <Text style={{color:C.accent,fontSize:12}}>{our} won ({Math.round(our/total*100)}%)</Text>
              <Text style={{color:C.oppTeam,fontSize:12}}>{them} lost</Text>
            </View>
          </View>
        );
      })()}

      {/* Sideout % */}
      {stats.sideoutTotal > 0 && (
        <View style={s.card}>
          <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
            <Text style={s.sectionLabel}>Sideout %</Text>
            <Text style={{color:C.accent, fontSize:fs(20), fontFamily:'Barlow_700Bold'}}>
              {Math.round(stats.sideoutWon/stats.sideoutTotal*100)}%
            </Text>
          </View>
          <View style={{height:8, borderRadius:4, backgroundColor:C.border, overflow:'hidden'}}>
            <View style={{width:`${Math.round(stats.sideoutWon/stats.sideoutTotal*100)}%`,
              height:8, backgroundColor:C.accent, borderRadius:4}} />
          </View>
          <Text style={{color:C.dim, fontSize:fs(11), marginTop:4}}>
            {stats.sideoutWon} of {stats.sideoutTotal} receiving rallies won
          </Text>
        </View>
      )}

      {/* Per Rotation */}
      {stats.rotStats?.some(r => r.won+r.lost > 0) && (
        <View style={s.card}>
          <Text style={[s.sectionLabel, {marginBottom:8}]}>Per Rotation</Text>
          <View style={{flexDirection:'row', flexWrap:'wrap', gap:6}}>
            {stats.rotStats.map(r => {
              const total = r.won + r.lost;
              if (total === 0) return null;
              const pct = Math.round(r.won / total * 100);
              const col = pct >= 60 ? C.green : pct >= 40 ? C.amber : C.red;
              return (
                <View key={r.rot} style={{
                  alignItems:'center', paddingHorizontal:12, paddingVertical:6,
                  borderRadius:10, backgroundColor:col+'22',
                  borderWidth:1.5, borderColor:col+'66', minWidth:60,
                }}>
                  <Text style={{color:col, fontSize:fs(10), fontFamily:'Barlow_600SemiBold', letterSpacing:1}}>ROT {r.rot}</Text>
                  <Text style={{color:C.text, fontSize:fs(18), fontFamily:'Barlow_700Bold'}}>{pct}%</Text>
                  <Text style={{color:C.dim, fontSize:fs(10), fontFamily:'Barlow_400Regular'}}>{r.won}W {r.lost}L</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      </>

      {/* Player stat tabs + Heatmap */}
      <View style={[s.tab3Row, {flexWrap:'wrap'}]}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[s.tab3Btn, statTab===t.id && {borderColor:C.accent, backgroundColor:'rgba(79,127,255,0.1)'}]}
            onPress={() => setStatTab(t.id)}
          >
            <Text style={[s.tab3Text, statTab===t.id && {color:C.accent}]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[s.tab3Btn, statTab==='heatmap' && {borderColor:C.accent, backgroundColor:'rgba(79,127,255,0.1)'}]}
          onPress={() => setStatTab('heatmap')}
        >
          <Text style={[s.tab3Text, statTab==='heatmap' && {color:C.accent}]}>Heatmap</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab3Btn, statTab==='sets' && {borderColor:C.accent, backgroundColor:'rgba(79,127,255,0.1)'}]}
          onPress={() => setStatTab('sets')}
        >
          <Text style={[s.tab3Text, statTab==='sets' && {color:C.accent}]}>By Set</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab3Btn, statTab==='scout' && {borderColor:C.oppTeam, backgroundColor:C.oppTeam+'22'}]}
          onPress={() => setStatTab('scout')}
        >
          <Text style={[s.tab3Text, statTab==='scout' && {color:C.oppTeam}]}>Scouting</Text>
        </TouchableOpacity>
      </View>

      {/* By Set reminder if multiple sets played */}
      {statTab !== 'sets' && [...new Set(rallies.map(r => r.setNum||1))].length > 1 && (
        <TouchableOpacity
          onPress={() => setStatTab('sets')}
          style={{flexDirection:'row', alignItems:'center', justifyContent:'center',
            padding:8, backgroundColor:C.accent+'11', borderRadius:8,
            borderWidth:1, borderColor:C.accent+'44', marginBottom:4}}>
          <Text style={{color:C.accent, fontSize:fs(12), fontFamily:'Barlow_500Medium'}}>
            📊 Tap to see Set-by-Set breakdown
          </Text>
        </TouchableOpacity>
      )}

      {/* Scouting tab — opponent stats */}
      {statTab === 'scout' && (() => {
        const oppStats = calcOppStats(rallies, oppRoster);
        const oppWon = rallies.filter(r => r.outcome==='them').length;
        const oppTotal = rallies.length || 1;
        const eff = (k,e,a) => a>0 ? Math.round(((k-e)/a)*100) : 0;
        const pctFn = (n,d) => d>0 ? Math.round(n/d*100) : 0;

        return (
          <View style={{gap:10}}>
            {/* Opponent team summary */}
            <View style={s.statGrid}>
              <StatCard label="Opp Kills"  value={oppStats.teamKills}  sub="attacks" />
              <StatCard label="Opp Aces"   value={oppStats.teamAces}   sub="serving" />
              <StatCard label="Opp Blocks" value={oppStats.teamBlocks} sub="stuff blocks" />
              <StatCard label="Win Rate"   value={`${pctFn(oppWon,oppTotal)}%`} sub={`${oppWon}/${oppTotal} pts`} />
            </View>

            {/* Opponent player table */}
            <View style={s.card}>
              <Text style={[s.sectionLabel, {marginBottom:8, color:C.oppTeam}]}>Opponent Players</Text>

              {/* Headers */}
              <View style={[s.playerStatRow, {paddingBottom:4, borderBottomWidth:1, borderBottomColor:C.border}]}>
                <View style={{width:36}} />
                <View style={{flex:1}} />
                {['K','ATT','EFF','AE','ACE','SE','BLK','DIG'].map(h => (
                  <Text key={h} style={{width:32, textAlign:'center', fontSize:fs(9),
                    color:C.muted, letterSpacing:0.5}}>{h}</Text>
                ))}
              </View>

              {/* Player rows */}
              {oppRoster.map(p => {
                const ps = oppStats.ps[p.id] || {};
                const efficiency = eff(ps.kills||0, ps.attackErr||0, ps.attackAtt||0);
                return (
                  <View key={p.id} style={[s.playerStatRow, {paddingVertical:6,
                    borderBottomWidth:1, borderBottomColor:C.border+'55'}]}>
                    <View style={{width:36, height:36, borderRadius:18,
                      backgroundColor:C.oppTeam+'22', borderWidth:1.5, borderColor:C.oppTeam+'66',
                      alignItems:'center', justifyContent:'center'}}>
                      <Text style={{color:C.oppTeam, fontSize:fs(11), fontFamily:'Barlow_700Bold'}}>
                        #{p.num}
                      </Text>
                    </View>
                    <View style={{flex:1, paddingLeft:8}}>
                      <Text style={{color:C.text, fontSize:fs(12), fontFamily:'Barlow_500Medium'}}>{p.role}</Text>
                    </View>
                    {[
                      {v: ps.kills||0,      color: (ps.kills||0)>0 ? C.green : C.text},
                      {v: ps.attackAtt||0,  color: C.text},
                      {v: `${efficiency}%`, color: efficiency>30?C.green:efficiency<0?C.red:C.text},
                      {v: ps.attackErr||0,  color: (ps.attackErr||0)>0?C.red:C.text},
                      {v: ps.aces||0,       color: (ps.aces||0)>0?C.green:C.text},
                      {v: ps.serveErr||0,   color: (ps.serveErr||0)>0?C.red:C.text},
                      {v: ps.blocks||0,     color: (ps.blocks||0)>0?C.amber:C.text},
                      {v: ps.digs||0,       color: C.text},
                    ].map((cell, i) => (
                      <Text key={i} style={{width:32, textAlign:'center',
                        fontSize:fs(12), color:cell.color, fontFamily:'Barlow_600SemiBold'}}>
                        {cell.v}
                      </Text>
                    ))}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })()}

      {/* Heatmap tab content */}
      {statTab === 'heatmap' && (
        <HeatmapView rallies={rallies} switchSides={switchSides} />
      )}

      {/* Set-by-set breakdown */}
      {statTab === 'sets' && (() => {
        // Include rallies with no setNum as set 1 (older rallies)
        const sets = [...new Set(rallies.map(r => r.setNum || 1))].sort();
        if (sets.length === 0 || rallies.length === 0) return (
          <Text style={[s.emptyText, {padding:20}]}>No set data yet.</Text>
        );
        return (
          <View style={{gap:10}}>
            {sets.map(setNum => {
              const setRallies = rallies.filter(r => (r.setNum || 1) === setNum);
              const setStats = calcStats(setRallies, roster);
              const ourWon  = setRallies.filter(r => r.outcome==='our').length;
              const themWon = setRallies.filter(r => r.outcome==='them').length;
              const lastRally = setRallies[setRallies.length-1];
              const score = lastRally
                ? `${lastRally.scoreBefore.us + (lastRally.outcome==='our'?1:0)} – ${lastRally.scoreBefore.them + (lastRally.outcome==='them'?1:0)}`
                : '—';

              return (
                <View key={setNum} style={s.card}>
                  <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                    <Text style={{color:C.text, fontSize:fs(15), fontFamily:'Barlow_700Bold'}}>Set {setNum}</Text>
                    <Text style={{color:C.dim, fontSize:fs(13), fontFamily:'Barlow_500Medium'}}>{score}</Text>
                  </View>

                  {/* Rally outcomes */}
                  <View style={{flexDirection:'row', height:6, borderRadius:3, overflow:'hidden', marginBottom:4}}>
                    <View style={{flex:ourWon||0.01, backgroundColor:C.accent}} />
                    <View style={{flex:themWon||0.01, backgroundColor:C.oppTeam}} />
                  </View>
                  <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}>
                    <Text style={{color:C.accent, fontSize:fs(11)}}>{ourWon} won ({Math.round(ourWon/(ourWon+themWon||1)*100)}%)</Text>
                    <Text style={{color:C.oppTeam, fontSize:fs(11)}}>{themWon} lost</Text>
                  </View>

                  {/* Key stats grid */}
                  <View style={{flexDirection:'row', flexWrap:'wrap', gap:6}}>
                    {[
                      {label:'Kills',  value: setStats.teamKills},
                      {label:'Aces',   value: setStats.teamAces},
                      {label:'Blocks', value: setStats.teamBlocks},
                      {label:'Recv%',  value: setStats.recvTotal > 0 ? `${Math.round(setStats.recvPerf/setStats.recvTotal*100)}%` : '—'},
                      {label:'Sideout', value: setStats.sideoutTotal > 0 ? `${Math.round(setStats.sideoutWon/setStats.sideoutTotal*100)}%` : '—'},
                      {label:'Rallies', value: setRallies.length},
                    ].map(item => (
                      <View key={item.label} style={{
                        flex:1, minWidth:70, alignItems:'center', padding:8,
                        backgroundColor:C.surface, borderRadius:8,
                        borderWidth:1, borderColor:C.border,
                      }}>
                        <Text style={{color:C.muted, fontSize:fs(9), fontFamily:'Barlow_500Medium', letterSpacing:1}}>{item.label.toUpperCase()}</Text>
                        <Text style={{color:C.text, fontSize:fs(18), fontFamily:'Barlow_700Bold', marginTop:2}}>{item.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        );
      })()}

      {/* Column headers — only for non-heatmap tabs */}
      {statTab !== 'heatmap' && statTab !== 'sets' && activeTab && (
        <View style={[s.playerStatRow, {paddingBottom:2}]}>
          <View style={{width:36}} />
          <View style={{flex:1}} />
          {activeTab.headers.map(h => (
            <Text key={h} style={{width:colW, textAlign:'center', fontSize:9, color:C.muted, letterSpacing:0.5}}>{h}</Text>
          ))}
        </View>
      )}

      {/* Player rows — only for non-heatmap and non-sets tabs */}
      {statTab !== 'heatmap' && statTab !== 'sets' && activeTab && roster.map((p) => {
        const ps       = stats.ps[p.id] || {};
        const isLibero = p.pos === 'L';
        const cols     = activeTab.cols(ps, isLibero);

        return (
          <View key={p.id} style={s.playerStatRow}>
            <View style={[s.psnNum, isLibero && {borderColor:C.amber}]}>
              <Text style={[s.psnNumText, isLibero && {color:C.amber}]}>#{p.num}</Text>
            </View>
            <View style={{flex:1}}>
              <Text style={{color:C.text, fontSize:13}}>{p.name}</Text>
              <Text style={{color: isLibero?C.amber:C.muted, fontSize:10}}>
                {isLibero ? 'Libero' : p.pos}
              </Text>
            </View>
            {cols.map((v, i) => (
              <Text key={i} style={{
                width: colW, textAlign:'center', fontSize:13,
                fontWeight:'600', color: activeTab.colColor(v, i, ps, isLibero),
              }}>{v}</Text>
            ))}
          </View>
        );
      })}

    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY PANEL
// ─────────────────────────────────────────────────────────────────────────────
function RallyPlayback({ rally, onClose, switchSides }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef(null);
  const [courtSize, setCourtSize] = useState({ width: 0, height: 0 });

  const touches = rally.touches || [];
  const arrows  = rally.arrows  || [];
  const ourLineup = rally.ourLineupSnap || [];
  const oppLineup = rally.oppLineupSnap || [];
  const hasLineup = ourLineup.length > 0;

  // Arrows visible up to current step
  const visibleArrows = arrows.slice(0, step + 1);
  // Current touch
  const currentTouch = touches[step];

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setStep(prev => {
          if (prev >= touches.length - 1) {
            setPlaying(false);
            clearInterval(intervalRef.current);
            return prev;
          }
          return prev + 1;
        });
      }, 900);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing]);

  function getPos(xy) {
    if (!xy || !courtSize.width) return null;
    const x = switchSides ? (1 - xy.x) * courtSize.width  : xy.x * courtSize.width;
    const y = switchSides ? (1 - xy.y) * courtSize.height : xy.y * courtSize.height;
    return { x, y };
  }

  function getPlayerCenter(playerId) {
    const all = [...ourLineup, ...oppLineup];
    const p = all.find(pl => pl.id === playerId);
    if (!p?.xy) return null;
    return getPos(p.xy);
  }

  const R = 26; // circle radius

  return (
    <Modal visible transparent animationType="slide">
      <View style={[s.modalOverlay, {justifyContent:'flex-end'}]}>
        <View style={{
          backgroundColor:C.card, borderTopLeftRadius:20, borderTopRightRadius:20,
          borderWidth:1, borderColor:C.border,
          maxHeight:'92%', flex:1,
        }}>
          {/* Header */}
          <View style={{flexDirection:'row', justifyContent:'space-between',
            alignItems:'center', padding:16, borderBottomWidth:1, borderBottomColor:C.border}}>
            <View>
              <Text style={{color:C.text, fontSize:fs(16), fontFamily:'Barlow_700Bold'}}>
                Rally #{rally.rallyNum}
              </Text>
              <Text style={{color: rally.outcome==='our' ? C.accent : C.oppTeam,
                fontSize:fs(12), fontFamily:'Barlow_500Medium', marginTop:2}}>
                {rally.outcome==='our' ? '✓ Our Point' : '✗ Their Point'} — {rally.endReason}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{padding:8}}>
              <Text style={{color:C.muted, fontSize:20}}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Court */}
          {hasLineup ? (
            <View
              style={{flex:1, backgroundColor:'#090B11', position:'relative', margin:12, borderRadius:8}}
              onLayout={e => setCourtSize({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })}
            >
              {/* Court tints */}
              <View style={{position:'absolute', top:0, left:0, right:0, height:'50%',
                backgroundColor: switchSides ? 'rgba(181,123,238,0.04)' : 'rgba(232,114,122,0.04)'}} pointerEvents="none" />
              <View style={{position:'absolute', bottom:0, left:0, right:0, height:'50%',
                backgroundColor: switchSides ? 'rgba(232,114,122,0.04)' : 'rgba(181,123,238,0.04)'}} pointerEvents="none" />

              {/* Net */}
              <View style={{position:'absolute', top:'50%', left:0, right:0,
                height:3, backgroundColor:C.net}} pointerEvents="none" />

              {/* Labels */}
              <Text style={{position:'absolute', top:4, alignSelf:'center',
                color:C.muted, fontSize:fs(9), letterSpacing:2}}>
                {switchSides ? 'OUR TEAM' : 'OPPONENT'}
              </Text>
              <Text style={{position:'absolute', bottom:4, alignSelf:'center',
                color:C.muted, fontSize:fs(9), letterSpacing:2}}>
                {switchSides ? 'OPPONENT' : 'OUR TEAM'}
              </Text>

              {/* SVG arrows */}
              {courtSize.width > 0 && (
                <Svg style={{position:'absolute', top:0, left:0,
                  width:courtSize.width, height:courtSize.height}} pointerEvents="none">
                  {visibleArrows.map((arr, i) => {
                    const from = getPlayerCenter(arr.fromId);
                    if (!from) return null;
                    const to = arr.toType === 'player'
                      ? getPlayerCenter(arr.toId)
                      : arr.toType === 'floor'
                        ? { x: switchSides ? courtSize.width-arr.toX : arr.toX,
                            y: switchSides ? courtSize.height-arr.toY : arr.toY }
                        : null;
                    if (!to) return null;
                    const dx = to.x - from.x, dy = to.y - from.y;
                    const len = Math.sqrt(dx*dx+dy*dy);
                    const ux = dx/len, uy = dy/len;
                    const isCurrent = i === visibleArrows.length - 1;
                    return (
                      <Line key={i}
                        x1={from.x + ux*R} y1={from.y + uy*R}
                        x2={to.x - ux*R}   y2={to.y - uy*R}
                        stroke={isCurrent ? C.accent : C.accent+'55'}
                        strokeWidth={isCurrent ? 2.5 : 1.5}
                      />
                    );
                  })}
                </Svg>
              )}

              {/* Players */}
              {courtSize.width > 0 && [...ourLineup, ...oppLineup].map(player => {
                const pos = getPos(player.xy);
                if (!pos) return null;
                const isOur = ourLineup.some(p => p.id === player.id);
                const isActive = currentTouch?.playerId === player.id;
                const isLib = player.pos === 'L' || player.libero;
                const bgColor = isLib
                  ? (isOur ? '#7A5C10' : '#5C4510')
                  : (isOur ? '#4A2D7A' : '#7A2830');

                return (
                  <View key={player.id} style={{
                    position:'absolute',
                    left: pos.x - R, top: pos.y - R,
                    width: R*2, height: R*2, borderRadius: R,
                    backgroundColor: bgColor,
                    borderWidth: isActive ? 2.5 : 1.5,
                    borderColor: isActive ? '#FFFFFF' : '#00000080',
                    alignItems:'center', justifyContent:'center',
                    opacity: isActive ? 1 : 0.7,
                    zIndex: isActive ? 10 : 1,
                  }}>
                    <Text style={{color:'rgba(255,255,255,0.85)',
                      fontSize:fs(11), fontFamily:'Barlow_700Bold'}}>
                      #{player.num}
                    </Text>
                  </View>
                );
              })}

              {/* Floor dot for current arrow endpoint */}
              {courtSize.width > 0 && visibleArrows.length > 0 && (() => {
                const last = visibleArrows[visibleArrows.length-1];
                if (last?.toType !== 'floor') return null;
                const x = switchSides ? courtSize.width-last.toX : last.toX;
                const y = switchSides ? courtSize.height-last.toY : last.toY;
                return (
                  <View style={{position:'absolute', left:x-6, top:y-6,
                    width:12, height:12, borderRadius:6,
                    backgroundColor:C.red, zIndex:20}} />
                );
              })()}
            </View>
          ) : (
            <View style={{flex:1, alignItems:'center', justifyContent:'center', padding:20}}>
              <Text style={{color:C.dim, fontSize:fs(13), textAlign:'center'}}>
                Court playback not available for this rally.
              </Text>
              <Text style={{color:C.dim, fontSize:fs(13), textAlign:'center', marginTop:4}}>
                Play a new rally to enable full playback.
              </Text>
            </View>
          )}

          {/* Touch list */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={{maxHeight:60, borderTopWidth:1, borderTopColor:C.border}}
            contentContainerStyle={{padding:8, gap:6, alignItems:'center'}}>
            {touches.map((t, i) => {
              const actionMeta = ACTIONS[t.action] || {};
              const isActive = i === step;
              const isPast = i < step;
              return (
                <TouchableOpacity key={i} onPress={() => setStep(i)}
                  style={{
                    paddingHorizontal:10, paddingVertical:4, borderRadius:16,
                    backgroundColor: isActive ? C.accent+'33' : isPast ? C.surface : 'transparent',
                    borderWidth:1, borderColor: isActive ? C.accent : C.border,
                    opacity: i > step ? 0.4 : 1,
                    flexDirection:'row', gap:4, alignItems:'center',
                  }}>
                  <Text style={{color: t.team==='our' ? C.accent : C.oppTeam,
                    fontSize:fs(11), fontFamily:'Barlow_700Bold'}}>#{t.playerNum}</Text>
                  <Text style={{color:actionMeta.color||C.dim,
                    fontSize:fs(11), fontFamily:'Barlow_500Medium'}}>{actionMeta.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Controls */}
          <View style={{flexDirection:'row', gap:8, padding:12,
            borderTopWidth:1, borderTopColor:C.border}}>
            <TouchableOpacity
              style={[s.modalBtn, {flex:1, borderColor:C.muted}]}
              onPress={() => { clearInterval(intervalRef.current); setPlaying(false); setStep(s => Math.max(0, s-1)); }}>
              <Text style={[s.modalBtnText, {color:C.dim}]}>← Prev</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, {flex:1,
                backgroundColor: playing ? C.red+'22' : C.accent+'22',
                borderColor: playing ? C.red : C.accent}]}
              onPress={() => {
                if (playing) { clearInterval(intervalRef.current); setPlaying(false); }
                else { setStep(0); setPlaying(true); }
              }}>
              <Text style={[s.modalBtnText, {color: playing ? C.red : C.accent}]}>
                {playing ? '⏹ Stop' : '▶ Play'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, {flex:1, borderColor:C.muted}]}
              onPress={() => { clearInterval(intervalRef.current); setPlaying(false); setStep(s => Math.min(touches.length-1, s+1)); }}>
              <Text style={[s.modalBtnText, {color:C.dim}]}>Next →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}


function HistoryPanel({ rallies, switchSides }) {
  const [playbackRally, setPlaybackRally] = useState(null);

  if (rallies.length===0) return <Text style={[s.emptyText,{padding:40}]}>No history yet.</Text>;
  return (
    <>
      <ScrollView contentContainerStyle={{padding:14,gap:8}}>
        {[...rallies].reverse().map(r => (
          <TouchableOpacity key={r.id} onPress={() => setPlaybackRally(r)}>
            <View style={s.historyItem}>
              <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:6}}>
                <Text style={{color:C.dim,fontSize:fs(11)}}>Rally #{r.rallyNum}</Text>
                <View style={{flexDirection:'row', gap:8, alignItems:'center'}}>
                  <Text style={{color:C.muted, fontSize:fs(10)}}>▶ Tap to replay</Text>
                  <Text style={{color:r.outcome==='our'?C.accent:C.oppTeam,fontWeight:'600'}}>
                    {r.outcome==='our'?'Our point':'Their point'}
                  </Text>
                </View>
              </View>
              {r.touches.map((t,i) => {
                const actionMeta = ACTIONS[t.action] || {};
                const actionColor = actionMeta.color || C.dim;
                return (
                  <View key={i} style={{flexDirection:'row',gap:8,marginBottom:2,alignItems:'center'}}>
                    <Text style={{color:t.team==='our'?C.accent:C.oppTeam,fontSize:fs(12),fontWeight:'700',fontFamily:'Barlow_700Bold',minWidth:30}}>
                      #{t.playerNum}
                    </Text>
                    <Text style={{color:t.team==='our'?C.text:C.oppTeam,fontSize:fs(12),fontFamily:'Barlow_400Regular',flex:1}}>
                      {t.playerName}
                    </Text>
                    <Text style={{color:actionColor,fontSize:fs(11),fontFamily:'Barlow_600SemiBold'}}>
                      {actionMeta.label}
                    </Text>
                  </View>
                );
              })}
              {r.endReason==='net' && <Text style={{color:C.amber,fontSize:fs(10),marginTop:4}}>⚡ Net fault</Text>}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {playbackRally && (
        <RallyPlayback rally={playbackRally} onClose={() => setPlaybackRally(null)} switchSides={switchSides} />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP PANEL
// ─────────────────────────────────────────────────────────────────────────────
function SetupPanel({ gameState, setGameState, ourRotation, setOurRotation, onExport, onPDFExport, onGoToSetup, onToggleTheme, isDark, matchNotes, setMatchNotes }) {
  return (
    <ScrollView contentContainerStyle={{padding:14,gap:12}}>
      <TouchableOpacity
        style={[s.bigBtn, {backgroundColor:C.green}]}
        onPress={onExport}
      >
        <Text style={s.bigBtnText}>📥 Export Match to CSV</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.bigBtn, {backgroundColor:C.surface, borderWidth:1, borderColor:C.green}]}
        onPress={onPDFExport}
      >
        <Text style={[s.bigBtnText, {color:C.green}]}>📄 Match Report (PDF)</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.bigBtn, {backgroundColor:C.surface, borderWidth:1, borderColor:C.accent}]}
        onPress={onGoToSetup}
      >
        <Text style={[s.bigBtnText, {color:C.accent}]}>⚙️  Back to Setup</Text>
      </TouchableOpacity>

      {/* Match Notes */}
      <View style={{marginTop:4}}>
        <Text style={[s.sideTeamLabel, {marginBottom:6}]}>Match Notes</Text>
        <TextInput
          style={[s.input, {height:120, textAlignVertical:'top', fontSize:fs(13),
            fontFamily:'Barlow_400Regular', padding:10}]}
          multiline
          value={matchNotes}
          onChangeText={setMatchNotes}
          placeholder="Add coaching notes here..."
          placeholderTextColor={C.muted}
        />
      </View>
      <TouchableOpacity
        style={[s.bigBtn, {backgroundColor:C.surface, borderWidth:1, borderColor:C.border,
          flexDirection:'row', gap:8, justifyContent:'center'}]}
        onPress={onToggleTheme}
      >
        <Text style={[s.bigBtnText, {color:C.dim}]}>{isDark ? '☀️  Light Mode' : '🌙  Dark Mode'}</Text>
      </TouchableOpacity>
      <View style={s.card}>
        <Text style={s.setupTitle}>Team Names</Text>
        <View style={{flexDirection:'row',gap:8}}>
          <TextInput
            style={[s.input,{flex:1}]}
            value={gameState.ourName}
            onChangeText={v=>setGameState(g=>({...g,ourName:v}))}
            placeholder="Your team" placeholderTextColor={C.muted}
          />
          <TextInput
            style={[s.input,{flex:1}]}
            value={gameState.theirName}
            onChangeText={v=>setGameState(g=>({...g,theirName:v}))}
            placeholder="Opponents" placeholderTextColor={C.muted}
          />
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.setupTitle}>Starting Rotation</Text>
        <Text style={{color:C.dim,fontSize:12,marginBottom:10}}>
          Select which rotation your team starts in (1 = setter serves first).
        </Text>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
          {[0,1,2,3,4,5].map(i => (
            <TouchableOpacity
              key={i}
              style={[s.rotBtn, ourRotation===i && s.rotBtnSel]}
              onPress={() => setOurRotation(i)}
            >
              <Text style={[s.rotBtnText, ourRotation===i && {color:C.accent}]}>ROT {i+1}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.setupTitle}>Roster</Text>
        {DEFAULT_OUR_ROSTER.map(p => (
          <View key={p.id} style={{flexDirection:'row',gap:8,paddingVertical:7,borderBottomWidth:1,borderBottomColor:C.border,alignItems:'center'}}>
            <Text style={{color:C.accent,fontWeight:'600',minWidth:30}}>#{p.num}</Text>
            <Text style={{flex:1,color:C.text}}>{p.name}</Text>
            <Text style={[s.posBadge, {
              color:p.pos==='S'?C.accent:p.pos==='OPP'?C.oppTeam:p.pos==='L'?C.amber:C.green,
              borderColor:p.pos==='S'?C.accent:p.pos==='OPP'?C.oppTeam:p.pos==='L'?C.amber:C.green,
            }]}>{p.pos}</Text>
          </View>
        ))}
        <Text style={{color:C.muted,fontSize:12,marginTop:10}}>Roster editing coming in next version.</Text>
      </View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statSub}>{sub}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
// s is a mutable style object — updated when theme changes via Object.assign
const makeStyles = (C) => StyleSheet.create({
  safe:      {flex:1, backgroundColor:C.bg},
  root:      {flex:1, flexDirection:'row'},
  mainPanel: {flex:1, flexDirection:'column'},
  sidePanel: {width:Math.min(280, SW * 0.22), backgroundColor:C.surface, borderLeftWidth:1, borderLeftColor:C.border},

  // Score bar
  scoreBar:   {flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:C.surface,paddingHorizontal:20,paddingVertical:8,borderBottomWidth:1,borderBottomColor:C.border},
  scoreSide:  {minWidth:120},
  teamName:   {fontSize:fs(13),color:C.text,letterSpacing:0.5,fontFamily:'Barlow_600SemiBold'},
  scoreNum:   {fontSize:fs(46),fontWeight:'700',lineHeight:52,color:C.text,fontFamily:'Barlow_700Bold'},
  scoreCenter:{alignItems:'center'},
  setLabel:   {fontSize:fs(14),fontWeight:'600',color:C.text,letterSpacing:1,fontFamily:'Barlow_600SemiBold'},
  servingDot:    {width:8,height:8,borderRadius:4,backgroundColor:C.accent},
  rotLabel:      {fontSize:fs(11),color:C.muted,letterSpacing:1,fontFamily:'Barlow_500Medium'},
  setScorebadge: {flexDirection:'row',alignItems:'center',gap:4},
  setScoreNum:   {fontSize:fs(26),fontWeight:'700',color:C.text,fontFamily:'Barlow_700Bold'},
  setScoreSep:   {fontSize:fs(14),color:C.muted},

  // Court container
  courtContainer:{flex:1,flexDirection:'column'},
  preRallyBar:{flexDirection:'row',gap:8,padding:10,backgroundColor:C.surface,borderBottomWidth:1,borderBottomColor:C.border},
  rallyBar:   {flexDirection:'row',alignItems:'center',gap:8,padding:10,backgroundColor:C.card,borderBottomWidth:1,borderBottomColor:C.border},
  liveDot:    {width:8,height:8,borderRadius:4,backgroundColor:C.red},
  rallyHint:  {flex:1,fontSize:fs(12),color:C.dim,fontFamily:'Barlow_400Regular'},

  // Court surface
  court:         {flex:1,backgroundColor: C.bg,position:'relative',overflow:'hidden'},
  courtBoundary: {position:'absolute',left:'8%',right:'8%',top:'5%',bottom:'5%',borderWidth:1.5,borderColor:'#FFFFFF35',borderRadius:1},
  attackLine:    {position:'absolute',left:'8%',right:'8%',height:1,backgroundColor:'#FFFFFF18'},
  courtLabel:    {position:'absolute',alignSelf:'center',fontSize:fs(9),color:C.muted,letterSpacing:2},

  // NET — confined to court width, thicker and tappable
  netTouchArea:  {position:'absolute',top:'47%',left:'8%',right:'8%',height:'6%',zIndex:10,justifyContent:'center',alignItems:'center'},
  netBar:        {width:'100%',height:12,backgroundColor:C.net,borderRadius:4,alignItems:'center',justifyContent:'center'},
  netText:       {fontSize:fs(8),color:C.bg,fontWeight:'700',letterSpacing:2},

  // Arrows
  arrowLine:  {position:'absolute',height:2},
  floorDot:   {position:'absolute',width:14,height:14,borderRadius:7,backgroundColor:C.red,borderWidth:2,borderColor:'#fff'},

  // Players
  playerCircle:{position:'absolute',width:fs(76),height:fs(76),borderRadius:fs(38),alignItems:'center',justifyContent:'center',borderWidth:2},
  ourCircle:    {backgroundColor:'#4A2D7A'},
  liberoCircle: {backgroundColor:'#7A5C10'},
  oppCircle:       {backgroundColor:'#7A2830'},
  oppLiberoCircle: {backgroundColor:'#5C4510'},
  rolePip:     {position:'absolute',top:3,right:3,width:8,height:8,borderRadius:4},
  playerNum:   {fontSize:fs(19),fontWeight:'700',lineHeight:22,fontFamily:'Barlow_700Bold'},
  playerName:  {fontSize:fs(8),color:C.dim,fontFamily:'Barlow_400Regular'},
  playerPos:   {fontSize:fs(8),fontWeight:'600',fontFamily:'Barlow_600SemiBold'},

  // Action tag (in rally bar)
  actionTag:     {paddingHorizontal:7, paddingVertical:2, borderRadius:4, borderWidth:1},
  actionTagText: {fontSize:fs(11), fontWeight:'700', letterSpacing:0.3},

  // Formation tag
  formationTag:     {paddingHorizontal:6,paddingVertical:2,borderRadius:4,borderWidth:1,borderColor:C.amber,backgroundColor:'rgba(232,168,56,0.15)'},
  formationTagText: {fontSize:fs(9),fontWeight:'700',color:C.amber,letterSpacing:1},

  // Pre-rally controls
  serveOpt:      {flex:1,padding:8,borderRadius:8,borderWidth:1,borderColor:C.border,backgroundColor:C.card,alignItems:'center'},
  serveOptSel:   {borderColor:C.accent,backgroundColor:'rgba(181,123,238,0.1)'},
  serveOptSelOpp:{borderColor:C.oppTeam,backgroundColor:'#7A2830'},
  serveOptText:  {fontSize:fs(12),fontWeight:'500',color:C.dim},
  bigBtn:        {padding:10,borderRadius:8,backgroundColor:C.accent,alignItems:'center',justifyContent:'center'},
  bigBtnText:    {color:'#fff',fontSize:fs(14),fontWeight:'600'},
  undoBtn:       {paddingHorizontal:16,paddingVertical:10,borderRadius:8,borderWidth:1.5,borderColor:C.dim,backgroundColor:C.card},
  undoBtnText:   {fontSize:fs(13),color:C.text,fontFamily:'Barlow_600SemiBold'},
  undoBarBtn:    {padding:14,borderTopWidth:1,borderTopColor:C.border,alignItems:'center'},
  undoBarText:   {fontSize:fs(14),color:C.dim,fontFamily:'Barlow_500Medium'},

  // Action popup — centred modal
  popupOverlay:      {flex:1,backgroundColor:'rgba(0,0,0,0.75)',alignItems:'center',justifyContent:'center',padding:20},
  popupCard:         {backgroundColor:C.card,borderRadius:16,borderWidth:1,borderColor:C.border,padding:20,width:'100%',maxWidth:480,shadowColor:'#000',shadowOpacity:0.6,shadowRadius:20,elevation:20},
  popupHeader:       {flexDirection:'row',alignItems:'center',gap:12,marginBottom:18},
  popupNumBadge:     {width:52,height:52,borderRadius:26,borderWidth:2,alignItems:'center',justifyContent:'center',backgroundColor:C.surface},
  popupNumBadgeText: {fontSize:fs(18),fontWeight:'700'},
  popupPlayerName:   {fontSize:fs(18),fontWeight:'700',color:C.text,fontFamily:'Barlow_700Bold'},
  popupPlayerRole:   {fontSize:fs(12),color:C.dim,marginTop:2,fontFamily:'Barlow_400Regular'},
  popupClose:        {padding:8},
  popupCloseText:    {fontSize:fs(16),color:C.muted},
  popupSectionLabel: {fontSize:fs(10),color:C.muted,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10,fontFamily:'Barlow_500Medium'},
  popupActionGrid:   {flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:18},
  popupActionBtn:    {paddingHorizontal:14,paddingVertical:10,borderRadius:8,borderWidth:1.5,borderColor:C.border,backgroundColor:C.surface,minWidth:'30%',alignItems:'center'},
  popupActionText:   {fontSize:fs(13),fontWeight:'600',color:C.dim},
  // Big action buttons for our popup (2-3 options side by side)
  popupActionRow:    {flexDirection:'row',gap:10},
  popupActionBigBtn: {flex:1,paddingVertical:20,borderRadius:12,borderWidth:2,borderColor:C.border,backgroundColor:C.surface,alignItems:'center',justifyContent:'center'},
  popupActionBigText:{fontSize:fs(18),fontWeight:'700',fontFamily:'Barlow_700Bold'},
  // Opponent popup buttons
  oppBtnRow:         {flexDirection:'row',gap:10,marginTop:4},
  oppBtn:            {flex:1,paddingVertical:22,borderRadius:12,borderWidth:2,borderColor:C.border,backgroundColor:C.surface,alignItems:'center',justifyContent:'center'},
  oppBtnText:        {fontSize:fs(17),fontWeight:'700'},
  popupQualRow:      {flexDirection:'row',gap:8,marginBottom:20},
  popupQualBtn:      {flex:1,paddingVertical:14,borderRadius:10,borderWidth:1.5,borderColor:C.border,backgroundColor:C.surface,alignItems:'center'},
  popupQualNum:      {fontSize:fs(22),fontWeight:'700',marginBottom:3,fontFamily:'Barlow_700Bold'},
  popupQualSub:      {fontSize:fs(10),fontWeight:'500',fontFamily:'Barlow_500Medium'},
  popupConfirm:      {borderRadius:12,padding:16,alignItems:'center'},
  popupConfirmText:  {color:'#fff',fontSize:fs(16),fontWeight:'700',letterSpacing:0.3},

  // Modals
  modalOverlay:    {flex:1,backgroundColor:'rgba(0,0,0,0.75)',alignItems:'center',justifyContent:'center'},
  modalCard:       {backgroundColor:C.card,borderRadius:14,padding:20,width:300,borderWidth:1,borderColor:C.border},
  modalTitle:      {fontSize:fs(18),fontWeight:'700',color:C.text,marginBottom:4,fontFamily:'Barlow_700Bold'},
  modalSub:        {fontSize:fs(13),color:C.dim,marginBottom:14,fontFamily:'Barlow_400Regular'},
  modalOutcomeRow: {marginBottom:12},
  modalOutcome:    {padding:12,borderRadius:10,borderWidth:1.5,alignItems:'center'},
  modalOutcomeText:{fontSize:fs(15),fontWeight:'700'},
  modalBtnRow:     {flexDirection:'row',gap:8},
  modalBtn:        {flex:1,padding:12,borderRadius:8,borderWidth:1,alignItems:'center'},
  modalBtnText:    {fontSize:fs(13),fontWeight:'600'},

  // Side panel
  sideTabRow:      {flexDirection:'row',borderBottomWidth:1,borderBottomColor:C.border},
  sideTab:         {flex:1,padding:10,alignItems:'center'},
  sideTabActive:   {borderBottomWidth:2,borderBottomColor:C.accent},
  sideTabText:     {fontSize:fs(12),color:C.muted,fontWeight:'500'},
  sideTeamLabel:   {fontSize:fs(12),color:C.accent,letterSpacing:1.5,textTransform:'uppercase',fontWeight:'600',marginBottom:6},
  sidePlayerHeader:{flexDirection:'row',marginBottom:4},
  sidePlayerCell:  {width:44,fontSize:fs(12),color:C.muted,textAlign:'center'},
  sidePlayerRow:   {flexDirection:'row',paddingVertical:5,borderBottomWidth:1,borderBottomColor:C.border},
  logEntry:        {flexDirection:'row',gap:8,paddingVertical:5,borderBottomWidth:1,borderBottomColor:C.border},
  logNum:          {fontSize:fs(13),fontWeight:'700',minWidth:32},
  logAction:       {flex:1,fontSize:fs(13),color:C.text},
  logQual:         {fontSize:fs(10)},
  historyItem:     {backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:8,padding:10},

  // Stats tabs
  tab3Row:  {flexDirection:'row', gap:8, marginBottom:2},
  tab3Btn:  {flex:1, paddingVertical:9, borderRadius:8, borderWidth:1, borderColor:C.border, backgroundColor:C.card, alignItems:'center'},
  tab3Text: {fontSize:fs(12), fontWeight:'600', color:C.dim},

  // Stats page
  statGrid:      {flexDirection:'row',flexWrap:'wrap',gap:8},
  sectionLabel:  {fontSize:fs(13),color:C.text,letterSpacing:1,textTransform:'uppercase',fontFamily:'Barlow_600SemiBold',marginBottom:6},
  statCard:      {width:'48%',backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:10,padding:12},
  statLabel:     {fontSize:fs(10),color:C.muted,textTransform:'uppercase',letterSpacing:1,fontFamily:'Barlow_500Medium'},
  statValue:     {fontSize:fs(26),fontWeight:'600',color:C.text,marginTop:2,fontFamily:'Barlow_600SemiBold'},
  statSub:       {fontSize:fs(11),color:C.dim,marginTop:2},
  playerStatRow: {flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.border},
  psnNum:        {width:32,height:32,borderRadius:16,backgroundColor:C.card,borderWidth:1,borderColor:C.border,alignItems:'center',justifyContent:'center'},
  psnNumText:    {fontSize:fs(12),fontWeight:'600',color:C.text},

  // Setup
  card:       {backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:10,padding:12},
  setupTitle: {fontSize:fs(13),fontWeight:'600',color:C.text,marginBottom:10},
  input:      {backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:8,color:C.text,fontSize:fs(14),padding:9,fontFamily:'Barlow_400Regular'},
  rotBtn:     {paddingHorizontal:14,paddingVertical:8,borderRadius:8,borderWidth:1,borderColor:C.border,backgroundColor:C.surface},
  rotBtnSel:  {borderColor:C.accent,backgroundColor:'rgba(181,123,238,0.1)'},
  rotBtnText: {fontSize:fs(12),fontWeight:'500',color:C.dim},
  posBadge:   {fontSize:fs(10),fontWeight:'600',borderWidth:1,borderRadius:4,paddingHorizontal:5,paddingVertical:1},

  // Misc
  emptyText:    {textAlign:'center',color:C.muted,fontSize:fs(13)},
  navBar:       {flexDirection:'row',backgroundColor:C.surface,borderTopWidth:1,borderTopColor:C.border},
  navBtn:       {flex:1,alignItems:'center',paddingBottom:10,gap:4},
  navActiveLine:{height:2,width:'60%',borderRadius:1,backgroundColor:'transparent',marginBottom:0},
  navLabel:     {fontSize:fs(10),fontWeight:'500',fontFamily:'Barlow_500Medium'},
});

// Initialize s after makeStyles is defined
let s = makeStyles(DARK);