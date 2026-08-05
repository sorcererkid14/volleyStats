// ─────────────────────────────────────────────────────────────────────────────
// VOLLEYBALL STAT TRACKER — 5-1 Rotation + Full Court
// ─────────────────────────────────────────────────────────────────────────────
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Dimensions, Modal,
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

const { width: SW } = Dimensions.get('window');
const IS_TABLET = SW > 700;

// ── COLOURS ───────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0D0D12', surface: '#16181F', card: '#1C1F2A',
  border:  '#252836', muted: '#3A3F55',  dim: '#7A84A0',
  text:    '#E8ECF4', accent: '#B57BEE', accentD: '#6B3FA0',
  green:   '#2EC27E', red: '#E05252',    amber: '#E8A838',
  ourTeam: '#B57BEE', oppTeam: '#E8727A', net: '#B57BEE',
};

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
const DEFAULT_OUR_ROSTER = [
  { id: 'o1', num: 1,  name: 'Martin', pos: 'S',   role: 'S',   setter: true },
  { id: 'o2', num: 3,  name: 'Smith',  pos: 'OH',  role: 'O1' },
  { id: 'o3', num: 5,  name: 'Jones',  pos: 'MB',  role: 'M1' },
  { id: 'o4', num: 7,  name: 'Adams',  pos: 'OPP', role: 'OPP' },
  { id: 'o5', num: 9,  name: 'Patel',  pos: 'OH',  role: 'O2' },
  { id: 'o6', num: 11, name: 'Okafor', pos: 'MB',  role: 'M2' },
  { id: 'o7', num: 2,  name: 'Chen',   pos: 'L',   role: 'L',   libero: true },
];

// Storage keys
const STORAGE_SQUAD  = '@vb_squad';
const STORAGE_MATCH  = '@vb_last_match';

const DEFAULT_OPP_ROSTER = [
  { id: 'p1', num: 4,  name: '', pos: 'S',   role: 'S',   setter: true },
  { id: 'p2', num: 9,  name: '', pos: 'OH',  role: 'O1' },
  { id: 'p3', num: 2,  name: '', pos: 'MB',  role: 'M1' },
  { id: 'p4', num: 6,  name: '', pos: 'OPP', role: 'OPP' },
  { id: 'p5', num: 8,  name: '', pos: 'OH',  role: 'O2' },
  { id: 'p6', num: 5,  name: '', pos: 'MB',  role: 'M2' },
  { id: 'p7', num: 3,  name: '', pos: 'L',   role: 'L',   libero: true },
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
  // Rot 1: Front: O1(right) M2(mid) OPP(left) | Back: L(right) O2(mid) S(left)
  { S:{x:1/6,y:0.125}, OPP:{x:1/6,y:0.375}, O1:{x:5/6,y:0.375}, O2:{x:3/6,y:0.125}, L:{x:5/6,y:0.125}, M2:{x:3/6,y:0.375} },
  // Rot 2: Front: O2(right) M2(mid) OPP(left) | Back: L(right) O1(mid) S(left)
  { S:{x:1/6,y:0.125}, OPP:{x:1/6,y:0.375}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, L:{x:5/6,y:0.125}, M2:{x:3/6,y:0.375} },
  // Rot 3: Front: O2(right) M1(mid) OPP(left) | Back: M2(right) O1(mid) S(left) — no libero
  { S:{x:1/6,y:0.125}, OPP:{x:1/6,y:0.375}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, M1:{x:3/6,y:0.375}, M2:{x:5/6,y:0.125} },
  // Rot 4: Front: O2(right) M1(mid) S(left)   | Back: L(right) O1(mid) OPP(left)
  { S:{x:5/6,y:0.375}, OPP:{x:5/6,y:0.125}, O1:{x:3/6,y:0.125}, O2:{x:1/6,y:0.375}, M1:{x:3/6,y:0.375}, L:{x:1/6,y:0.125} },
  // Rot 5: Front: O1(right) M1(mid) S(left)   | Back: L(right) O2(mid) OPP(left)
  { S:{x:5/6,y:0.375}, OPP:{x:5/6,y:0.125}, O1:{x:1/6,y:0.375}, O2:{x:3/6,y:0.125}, M1:{x:3/6,y:0.375}, L:{x:1/6,y:0.125} },
  // Rot 6: Front: O1(right) M2(mid) S(left)   | Back: M1(right) O2(mid) OPP(left) — no libero
  { S:{x:5/6,y:0.375}, OPP:{x:5/6,y:0.125}, O1:{x:1/6,y:0.375}, O2:{x:3/6,y:0.125}, M1:{x:1/6,y:0.125}, M2:{x:3/6,y:0.375} },
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
  // Rot 1: Front: OPP M2 O1 | Back: L O2 S (OPP/O1 swapped vs base)
  { OPP:{x:5/6,y:0.375}, M2:{x:3/6,y:0.375}, O1:{x:1/6,y:0.375}, L:{x:5/6,y:0.125}, O2:{x:3/6,y:0.125}, S:{x:1/6,y:0.125} },
  // Rot 2: Front: O2 M2 OPP | Back: L O1 S
  { S:{x:1/6,y:0.125}, OPP:{x:5/6,y:0.375}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, L:{x:5/6,y:0.125}, M2:{x:3/6,y:0.375} },
  // Rot 3: Front: O2 M1 OPP | Back: L O1 S
  { S:{x:1/6,y:0.125}, OPP:{x:5/6,y:0.375}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, M1:{x:3/6,y:0.375}, L:{x:5/6,y:0.125} },
  // Rot 4: Front: O2 M1 S | Back: L O1 OPP
  { S:{x:1/6,y:0.375}, OPP:{x:1/6,y:0.125}, O1:{x:3/6,y:0.125}, O2:{x:5/6,y:0.375}, M1:{x:3/6,y:0.375}, L:{x:5/6,y:0.125} },
  // Rot 5: Front: O1 M1 S | Back: L O2 OPP
  { S:{x:1/6,y:0.375}, OPP:{x:1/6,y:0.125}, O1:{x:5/6,y:0.375}, O2:{x:3/6,y:0.125}, M1:{x:3/6,y:0.375}, L:{x:5/6,y:0.125} },
  // Rot 6: Front: O1 M2 S | Back: L O2 OPP
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
  // Rot 3: Front: O2 M1 OPP | Back: M2 O1 S   (no libero swap)
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:0,c:1}, M2:{r:1,c:0} },
  // Rot 4: Front: O2 M1 S   | Back: L  O1 OPP (L replaces M2)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:0,c:1}, L:{r:1,c:0}  },
  // Rot 5: Front: O1 M1 S   | Back: L  O2 OPP (L replaces M2)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, M1:{r:0,c:1}, L:{r:1,c:0}  },
  // Rot 6: Front: O1 M2 S   | Back: M1 O2 OPP (no libero swap)
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
  // Rot 1: Front: OPP M2 O1 | Back: L  O2 S  (L replaces M1, OPP/O1 swapped)
  { OPP:{r:0,c:0}, M2:{r:0,c:1}, O1:{r:0,c:2}, L:{r:1,c:0},  O2:{r:1,c:1}, S:{r:1,c:2} },
  // Rot 2: Front: O2 M2 OPP | Back: L  O1 S  (L replaces M1)
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, L:{r:1,c:0},  M2:{r:0,c:1} },
  // Rot 3: Front: O2 M1 OPP | Back: L  O1 S  (L replaces M2)
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:0,c:1}, L:{r:1,c:0}  },
  // Rot 4: Front: O2 M1 S   | Back: L  O1 OPP (L replaces M2)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:0,c:1}, L:{r:1,c:0}  },
  // Rot 5: Front: O1 M1 S   | Back: L  O2 OPP (L replaces M2)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, M1:{r:0,c:1}, L:{r:1,c:0}  },
  // Rot 6: Front: O1 M2 S   | Back: L  O2 OPP (L replaces M1)
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, L:{r:1,c:0},  M2:{r:0,c:1} },
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
      // Attack
      kills:0, attackErr:0, attackAtt:0,
      // Serve
      aces:0, serveErr:0, serveAtt:0,
      // Block
      blocks:0, blockErr:0,
      // Defence
      digs:0, recvTotal:0, recvQual:0,
      // Meta
      netErrors:0,
      isLibero: p.pos === 'L',
    };
  });
  let teamKills=0, teamAces=0, teamBlocks=0, teamServes=0, recvTotal=0, recvPerf=0;

  rallies.forEach(r => {
    r.touches.forEach(t => {
      if (!t.playerId || t.team !== 'our') return;
      const p = ps[t.playerId]; if (!p) return;

      // Attack — libero cannot attack
      if (t.action==='attack' && !p.isLibero) {
        p.attackAtt++;
        if (t.quality===3) { p.kills++; teamKills++; }
        if (t.quality===0) p.attackErr++;
      }
      // Serve — libero cannot serve
      if ((t.action==='spin' || t.action==='float') && !p.isLibero) {
        p.serveAtt++; teamServes++;
        if (t.quality===3) { p.aces++; teamAces++; }
        if (t.quality===0) p.serveErr++;
      }
      // Block — libero cannot block
      if (t.action==='block' && !p.isLibero) {
        if (t.quality===3) { p.blocks++; teamBlocks++; }
        if (t.quality===0) p.blockErr++;
      }
      // Dig
      if (t.action==='dig' && t.quality > 0) p.digs++;
      // Receive
      if (t.action==='receive') {
        p.recvTotal++; recvTotal++;
        p.recvQual += (t.quality || 0);
        if (t.quality===3) recvPerf++;
      }
    });
    if (r.endReason==='net') {
      const last = r.touches[r.touches.length-1];
      if (last?.team==='our' && ps[last.playerId]) ps[last.playerId].netErrors++;
    }
  });

  return { ps, teamKills, teamAces, teamBlocks, teamServes, recvTotal, recvPerf };
}

// ── OUTCOME LOGIC ─────────────────────────────────────────────────────────────
function determineOutcomeFromTap(x, y, cw, ch, lastTouchTeam) {
  const LEFT=cw*0.08, RIGHT=cw*0.92, TOP=ch*0.05, BOTTOM=ch*0.95, NET=ch*0.5;
  const inBounds = x>LEFT && x<RIGHT && y>TOP && y<BOTTOM;
  const oppSide  = y < NET;

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
  if (servingUs) {
    if (touchCount === 0) return 'spin';
    if (touchCount === 1) return 'receive';
    const cyclePos = (touchCount - 2) % 3;
    if (cyclePos === 0) return 'set';
    if (cyclePos === 1) return 'attack';
    return 'receive';
  } else {
    const cyclePos = touchCount % 3;
    if (cyclePos === 0) return 'receive';
    if (cyclePos === 1) return 'set';
    return 'attack';
  }
}

// ── HIGHLIGHT RULES ──────────────────────────────────────────────────────────
// Server for each rotation (role that just crossed from front to back-right)
const SERVERS = ['S', 'O1', 'M2', 'OPP', 'O2', 'M1'];

// Back row roles per rotation (highlighted for mid-rally receives)
// L replaces the back-row MB in rot 1,2,4,5
const BACK_ROW = [
  ['L',  'O2', 'S'],   // Rot 1 (L replaces M1)
  ['L',  'O1', 'S'],   // Rot 2 (L replaces M1)
  ['M2', 'O1', 'S'],   // Rot 3 (M2 stays, no libero)
  ['L',  'O1', 'OPP'], // Rot 4 (L replaces M2)
  ['L',  'O2', 'OPP'], // Rot 5 (L replaces M2)
  ['M1', 'O2', 'OPP'], // Rot 6 (M1 stays, no libero)
];

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
    // We serve:
    // touch 0 = us (serve)
    // touch 1 = them (receive)
    // touch 2 = them (set)
    // touch 3 = them (attack)
    // touch 4 = us (receive) ← cycle of 3 restarts for us
    // touch 5 = us (set)
    // touch 6 = us (attack)
    // touch 7 = them (receive) ← cycle of 3 restarts for them
    // Pattern after touch 0: groups of 3 alternate between them and us
    if (touchCount === 0) return true;
    const block = Math.floor((touchCount - 1) / 3); // 0=them, 1=us, 2=them, 3=us...
    return block % 2 === 1;
  } else {
    // They serve (not logged):
    // touch 0 = us (receive)
    // touch 1 = us (set)
    // touch 2 = us (attack)
    // touch 3 = them (receive)
    // touch 4 = them (set)
    // touch 5 = them (attack)
    // touch 6 = us (receive) ← loops
    const block = Math.floor(touchCount / 3); // 0=us, 1=them, 2=us, 3=them...
    return block % 2 === 0;
  }
}

// Returns array of player IDs to highlight given current touch and rotation
// Only highlights OUR players — returns empty array when it's the opponent's turn
function getHighlightIds(touchCount, servingUs, rotIdx, lineup, touches = [], oppServed = false) {
  const byRole = {};
  lineup.forEach(p => { byRole[p.roleLabel] = p.id; });

  // When they serve and server NOT yet tapped → no highlights for our team
  if (!servingUs && !oppServed) return [];

  // When they serve and server HAS been tapped but we haven't received yet
  // (touchCount === 0 means no touches logged yet) → highlight our receivers
  if (!servingUs && oppServed && touchCount === 0) {
    const backMB = [0,1,5].includes(rotIdx) ? 'M1' : 'M2';
    return ['O1', 'O2', 'L'].map(r => byRole[r]).filter(Boolean);
  }

  // Don't highlight our players when it's the other team's touch
  if (!isOurTouch(touchCount, servingUs)) return [];

  const action = inferNextAction(touchCount, servingUs);
  let roles = [];

  // If last non-block touch was an opponent attack → highlight our blockers
  if (action === 'receive' && lastTouchWasOppAttack(touches)) {
    return BLOCKERS[rotIdx].map(r => byRole[r]).filter(Boolean);
  }

  if (action === 'spin' || action === 'float') {
    // We serve — highlight our server
    roles = [SERVERS[rotIdx]];
  } else if (action === 'receive') {
    // First receive when they serve → O1, O2, Libero
    // Mid-rally receive → full back row
    if (!servingUs && touchCount === 0) {
      roles = ['O1', 'O2', 'L'];
    } else {
      roles = BACK_ROW[rotIdx];
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

// ── OPP HIGHLIGHT TABLES ─────────────────────────────────────────────────────
// Same structure as our team — mirrored rotation logic

// Opp back row per rotation (for mid-rally receives/digs)
const OPP_BACK_ROW = [
  ['L',  'O2', 'S'],   // Rot 1 (L replaces M1)
  ['L',  'O1', 'S'],   // Rot 2 (L replaces M1)
  ['M2', 'O1', 'S'],   // Rot 3 (no libero)
  ['L',  'O1', 'OPP'], // Rot 4 (L replaces M2)
  ['L',  'O2', 'OPP'], // Rot 5 (L replaces M2)
  ['M1', 'O2', 'OPP'], // Rot 6 (no libero)
];

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
      roles = OPP_BACK_ROW[rotIdx];
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

// ─────────────────────────────────────────────────────────────────────────────
// HOME SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function HomeScreen({ onNewMatch, onContinue, hasLastMatch }) {
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={{flex:1, alignItems:'center', justifyContent:'center', padding:32}}>

        {/* Logo / title */}
        <View style={{marginBottom:48, alignItems:'center'}}>
          <Text style={{fontSize:32, fontWeight:'700', color:C.accent, fontFamily:'Barlow_700Bold', letterSpacing:2}}>
            VOLLEY
          </Text>
          <Text style={{fontSize:32, fontWeight:'700', color:C.text, fontFamily:'Barlow_700Bold', letterSpacing:2, marginTop:-8}}>
            STATS
          </Text>
          <Text style={{fontSize:13, color:C.dim, fontFamily:'Barlow_400Regular', marginTop:8, letterSpacing:1}}>
            Performance tracking for volleyball
          </Text>
        </View>

        {/* Buttons */}
        <View style={{width:'100%', maxWidth:360, gap:12}}>
          {hasLastMatch && (
            <TouchableOpacity
              style={[s.bigBtn, {backgroundColor:C.surface, borderWidth:1, borderColor:C.accent}]}
              onPress={onContinue}
            >
              <Text style={[s.bigBtnText, {color:C.accent}]}>▶  Continue Last Match</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.bigBtn, {backgroundColor:C.accent}]}
            onPress={onNewMatch}
          >
            <Text style={s.bigBtnText}>+ New Match</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  const [ourName, setOurName] = useState('Loughborough A');
  const [theirName, setTheirName] = useState('Nottingham A');
  const [rotation, setRotation] = useState(0);
  const [servingUs, setServingUs] = useState(true);

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
    onStartMatch({ roster, ourName, theirName, rotation, servingUs });
  }

  // ── Assigned player IDs (to grey out in squad list)
  const assignedIds = new Set(Object.values(assignments).filter(Boolean).map(p => p.id));

  const posColor = { S: C.accent, OH: C.green, MB: '#4F7FFF', OPP: C.oppTeam, L: C.amber };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

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
          <ScrollView contentContainerStyle={{padding:14, gap:8}}>
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
          <ScrollView style={{flex:1}} contentContainerStyle={{padding:14, gap:8}}>
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
        <ScrollView contentContainerStyle={{padding:14, gap:14}}>
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

      {/* ── Player edit modal ── */}
      <Modal visible={!!editPlayer} transparent animationType="fade">
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
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV ICONS — custom SVG icons for the bottom nav bar
// ─────────────────────────────────────────────────────────────────────────────
import Svg, { Path, Rect, Circle, Line, G } from 'react-native-svg';

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
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" />
      <Path
        d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        stroke={color} strokeWidth="1.5" strokeLinecap="round"
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

  // ── SQUAD — full squad of up to 14, loaded from storage
  const [squad, setSquad] = useState(DEFAULT_OUR_ROSTER);
  const [squadLoaded, setSquadLoaded] = useState(false);

  // ── MATCH PAGE
  const [page, setPage] = useState('match');
  const [gameState, setGameState] = useState({
    ourName:'Loughborough A', theirName:'Nottingham A',
    ourScore:0, theirScore:0,
    ourSets:0, theirSets:0,
    currentSet:1,
    setHistory:[],
    matchOver:false,
  });
  const [setResultModal, setSetResultModal] = useState(null);
  const [matchSummary,   setMatchSummary]   = useState(null);

  const [ourRoster, setOurRoster] = useState(DEFAULT_OUR_ROSTER);
  const [oppRoster] = useState(DEFAULT_OPP_ROSTER);

  // ── LOAD saved squad on startup
  useEffect(() => {
    async function loadData() {
      try {
        const savedSquad = await AsyncStorage.getItem(STORAGE_SQUAD);
        if (savedSquad) setSquad(JSON.parse(savedSquad));
        const savedMatch = await AsyncStorage.getItem(STORAGE_MATCH);
        if (savedMatch) {
          // Has a last match — show home screen with continue option
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

  // Rotation index 0-5; 0 = setter back-right (first serve)
  const [ourRotation,  setOurRotation]  = useState(0);
  const [oppRotation,  setOppRotation]  = useState(0);

  const [servingUs,  setServingUs]  = useState(true);
  const [rallies,    setRallies]    = useState([]);

  // Rally state
  const [rallyActive,   setRallyActive]   = useState(false);
  const [touches,       setTouches]       = useState([]);
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
      // Our setter: already in front row (y <= 0.55) → no move needed
      if (setter.xy.y <= 0.55) return lineupRaw;
      // Target: between front-middle and front-right, near net
      return lineupRaw.map(p =>
        p.roleLabel === 'S'
          ? { ...p, xy: { x: 4/6, y: 0.55 }, runningToSet: true }
          : p
      );
    } else {
      // Opp setter: already in front row (y >= 0.45) → no move needed
      // Opp front row y=0.375, back row y=0.125 — if y >= 0.30 they're near net
      if (setter.xy.y >= 0.30) return lineupRaw;
      // Target: between front-middle and front-right (mirrored: x=2/6), near net
      return lineupRaw.map(p =>
        p.roleLabel === 'S'
          ? { ...p, xy: { x: 2/6, y: 0.45 }, runningToSet: true }
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

  // Our team highlight IDs
  const highlightIds = getHighlightIds(
    rallyActive ? nonBlockCount : 0,
    servingUs, ourRotation, ourLineup, touches, oppServed
  );

  // Opponent highlight IDs
  const oppHighlightIds = getOppHighlightIds(
    rallyActive ? nonBlockCount : 0,
    servingUs, oppRotation, oppLineup, touches, oppServed
  );

  const stats = calcStats(rallies, ourRoster);

  // ── RALLY LOGIC ─────────────────────────────────────────────────────────────
  function startRally() {
    setTouches([]); setArrows([]); setPendingFrom(null); setPopup(null);
    setReceivedFirst(false);
    setOppReceivedFirst(false);
    setRallyActive(true);
  }

  function onPlayerTap(player, team, px, py) {
    // Auto-start rally on first player tap
    if (!rallyActive) {
      setTouches([]); setArrows([]); setPendingFrom(null); setPopup(null);
      setReceivedFirst(false); setOppReceivedFirst(false); setOppServed(false);
      setRallyActive(true);
    }

    // Draw arrow from previous player if pendingFrom is set
    if (pendingFrom) {
      setArrows(prev => [...prev, { fromId: pendingFrom.id, toId: player.id, toType:'player' }]);
      setPendingFrom(null);
    }

    if (team === 'opp') {
      // Special case: when they serve and server hasn't been tapped yet,
      // just mark oppServed=true to switch highlights — do NOT add to touches
      // so touch indices for our team stay correct (touch 0 = our receive)
      if (!servingUs && !oppServed) {
        setOppServed(true);
        setPendingFrom(null);
        return;
      }

      // Opponent: log instantly with no popup, action auto-inferred, no quality
      const touchIndex = touches.length;
      const action = inferNextAction(touchIndex, servingUs);
      const touch = {
        playerId:   player.id,
        playerNum:  player.num,
        playerName: player.name,
        team:       'opp',
        action,
        quality:    null,
        touchIndex,
      };
      const newTouches = [...touches, touch];
      setTouches(newTouches);
      setPendingFrom(player);

      // Switch opp formation after first receive of our serve
      if (servingUs && !oppReceivedFirst) {
        setOppReceivedFirst(true);
      }

      // Check 4-touch violation
      let consecutive = 0;
      for (let i = newTouches.length - 1; i >= 0; i--) {
        if (newTouches[i].team === 'opp') consecutive++;
        else break;
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
      showPopup(player, team, px, py);
    }
  }

  function showPopup(player, team, px, py) {
    const isOur = team === 'our';
    // Use non-block touch count so blocks don't shift the sequence
    const nonBlockCount = countNonBlockTouches(touches);
    const action = inferNextAction(nonBlockCount, servingUs);

    // Front row players on touch 1 can either receive or block
    const isFrontRow = player.xy && player.xy.y <= 0.60;
    const needsReceiveBlockChoice = action === 'receive' && isFrontRow && isOur;

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
    const touch = {
      playerId:   p.player.id,
      playerNum:  p.player.num,
      playerName: p.player.name,
      team:       p.team,
      action:     p.action,
      quality:    p.isOur ? p.quality : null,
      touchIndex: p.touchIndex,
    };

    const newTouches = [...touches, touch];
    setTouches(newTouches);
    setPopup(null);

    // First touch confirmed when receiving → switch to receiveBase formation
    if (!servingUs && !receivedFirst && touch.action !== 'block') {
      setReceivedFirst(true);
    }
    // Opp receives our serve → switch their formation to receiveBase
    if (servingUs && touch.team === 'opp' && !oppReceivedFirst) {
      setOppReceivedFirst(true);
    }

    // ── BLOCK OUTCOMES ──────────────────────────────────────────────────────
    if (touch.action === 'block') {
      if (touch.quality === 3) {
        // Stuff block — our point, end rally immediately
        setArrows(prev => [...prev, { fromId: p.player.id, toType:'floor', toX: 0.5, toY: 0.2 }]);
        setPendingFrom(null);
        setRallyEndModal({
          outcome: 'our',
          reason: 'Stuff block — ball returned to opponent court',
          endReason: 'block_stuff',
        });
      } else if (touch.quality === 0) {
        // Block error — their point
        setPendingFrom(null);
        setRallyEndModal({
          outcome: 'them',
          reason: 'Block error — ball went out or into net',
          endReason: 'block_error',
        });
      } else {
        // Touch block (quality 1 or 2) — ball deflected back to opponent
        // Don't set pendingFrom — next tap should be opponent's touch
        setPendingFrom(null);
      }
      return;
    }

    setPendingFrom(p.player);

    // Check if this team has now touched the ball 4 times consecutively
    // Count how many consecutive touches from this team at the end of the sequence
    const team = touch.team;
    let consecutive = 0;
    for (let i = newTouches.length - 1; i >= 0; i--) {
      if (newTouches[i].team === team) consecutive++;
      else break;
    }
    if (consecutive >= 4) {
      // 4 touches by same team = their fault, other team wins point
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
    // Draw arrow to exact tap point regardless of in/out
    setArrows(prev => [...prev, { fromId: pendingFrom.id, toType:'floor', toX:x, toY:y }]);
    setPendingFrom(null);
    const lastTouchTeam = touches.length > 0 ? touches[touches.length-1].team : 'our';
    const result = determineOutcomeFromTap(x, y, cw, ch, lastTouchTeam);
    setRallyEndModal({ ...result, endReason: 'floor' });
  }

  // Net button pressed
  function onNetPress() {
    if (!rallyActive) return;
    setNetModal(true);
  }

  function confirmNet(faultTeam) {
    // faultTeam = 'our' | 'them' — whoever caused the net touch
    const outcome = faultTeam === 'our' ? 'them' : 'our';
    setNetModal(false);
    setRallyEndModal({
      outcome,
      reason: faultTeam === 'our' ? 'Our player touched the net' : 'Their player touched the net',
      endReason: 'net',
    });
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

  function confirmRallyEnd() {
    if (!rallyEndModal) return;
    const weWon = rallyEndModal.outcome === 'our';

    const newRally = {
      id: Date.now(), rallyNum: rallies.length+1,
      touches, arrows,
      outcome:   rallyEndModal.outcome,
      endReason: rallyEndModal.endReason || 'floor',
      scoreBefore: { us: gameState.ourScore, them: gameState.theirScore },
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
        setSetResultModal({
          setNum: gameState.currentSet,
          ourScore: newOurScore, theirScore: newTheirScore,
          winner: setWinner,
          ourSets: newOurSets, theirSets: newTheirSets,
          ourName: gameState.ourName, theirName: gameState.theirName,
        });
        setRallies([]);
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
    setReceivedFirst(false);
    setOppReceivedFirst(false);
    setOppServed(false);
    setRallyEndModal(null);
  }

  function undoLastTouch() {
    if (touches.length === 0) return;
    const newTouches = touches.slice(0, -1);
    const newArrows  = arrows.slice(0, -1);
    setTouches(newTouches);
    setArrows(newArrows);
    setPopup(null);

    // Restore pendingFrom to the player from the touch before the undone one
    // so that when the next player is tapped, an arrow is drawn from the correct source
    // If we undid touch 0 (first touch), there's no previous player so pendingFrom = null
    if (newTouches.length > 0) {
      const prevTouch = newTouches[newTouches.length - 1];
      setPendingFrom({ id: prevTouch.playerId, ...prevTouch });
    } else {
      setPendingFrom(null);
    }

    // If we undid the first touch when receiving, revert formation back to receive
    if (!servingUs && newTouches.length === 0) {
      setReceivedFirst(false);
    }
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────
  // Show home or setup screen if not in match
  if (screen === 'home') {
    return (
      <HomeScreen
        onNewMatch={() => setScreen('setup')}
        onContinue={() => setScreen('match')}
        hasLastMatch={false}
      />
    );
  }

  if (screen === 'setup') {
    return (
      <SetupScreen
        squad={squad}
        onSaveSquad={saveSquad}
        onStartMatch={({ roster, ourName, theirName, rotation, servingUs: sv }) => {
          setOurRoster(roster);
          setGameState(g => ({ ...g, ourName, theirName, ourScore:0, theirScore:0, ourSets:0, theirSets:0, currentSet:1, setHistory:[], matchOver:false }));
          setOurRotation(rotation);
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

        <View style={s.mainPanel}>
          <ScoreBar gameState={gameState} servingUs={servingUs} ourRotation={ourRotation} />

          {page==='match' && (
            <CourtView
              ourLineup={ourLineup} oppLineup={oppLineup}
              touches={touches} arrows={arrows}
              pendingFrom={pendingFrom} highlightIds={highlightIds}
              oppHighlightIds={oppHighlightIds}
              rallyActive={rallyActive} servingUs={servingUs}
              receivedFirst={receivedFirst}
              onPlayerTap={onPlayerTap} onCourtTap={onCourtTap}
              onNetPress={onNetPress}
              popup={popup} setPopup={setPopup} confirmPopup={confirmPopup}
              startRally={startRally} undoLastTouch={undoLastTouch}
              setServingUs={setServingUs}
              rallyEndModal={rallyEndModal}
              confirmRallyEnd={confirmRallyEnd}
              setRallyEndModal={setRallyEndModal}
            />
          )}
          {page==='stats'   && <StatsPanel   stats={stats} roster={ourRoster} rallies={rallies} />}
          {page==='history' && <HistoryPanel rallies={rallies} />}
          {page==='setup'   && <SetupPanel   gameState={gameState} setGameState={setGameState} ourRotation={ourRotation} setOurRotation={setOurRotation} />}
        </View>

        {IS_TABLET && (
          <View style={s.sidePanel}>
            <SideStats
              gameState={gameState} stats={stats}
              roster={ourRoster} touches={touches}
              rallies={rallies} rallyActive={rallyActive}
              undoLastTouch={undoLastTouch}
              ourRotation={ourRotation}
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
            <Text style={[s.popupSectionLabel, {textAlign:'center', marginBottom:10, marginTop:8}]}>Choose starting rotation for next set</Text>
            <View style={{flexDirection:'row', flexWrap:'wrap', gap:8, justifyContent:'center', marginBottom:14}}>
              {[0,1,2,3,4,5].map(i => (
                <TouchableOpacity
                  key={i}
                  style={[s.rotBtn, {minWidth:60}]}
                  onPress={() => {
                    setOurRotation(i);
                    // Team that lost the set serves first in next set
                    setServingUs(setResultModal?.winner === 'them');
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
            <TouchableOpacity
              style={[s.bigBtn, {backgroundColor: C.accent, marginTop:16}]}
              onPress={() => {
                // Reset everything for a new match
                setMatchSummary(null);
                setGameState(prev => ({
                  ...prev,
                  ourScore:0, theirScore:0,
                  ourSets:0, theirSets:0,
                  currentSet:1, setHistory:[], matchOver:false,
                }));
                setRallies([]);
                setOurRotation(0);
                setOppRotation(0);
                setServingUs(true);
              }}
            >
              <Text style={s.bigBtnText}>New Match</Text>
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
function ScoreBar({ gameState, servingUs, ourRotation }) {
  const { ourSets, theirSets, currentSet, setHistory } = gameState;
  return (
    <View style={s.scoreBar}>
      <View style={s.scoreSide}>
        <Text style={s.teamName}>{gameState.ourName}</Text>
        <View style={{flexDirection:'row', alignItems:'center', gap:6}}>
          <Text style={[s.scoreNum, {color: gameState.ourScore > gameState.theirScore ? C.accent : C.text}]}>
            {gameState.ourScore}
          </Text>
          {servingUs && <View style={s.servingDot} />}
        </View>
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
          <View style={{flexDirection:'row', gap:6, marginTop:2}}>
            {setHistory.map((sh, i) => (
              <Text key={i} style={{fontSize:9, color:C.muted}}>
                {sh.ourScore}–{sh.theirScore}
              </Text>
            ))}
          </View>
        )}
      </View>

      <View style={[s.scoreSide, {alignItems:'flex-end'}]}>
        <Text style={s.teamName}>{gameState.theirName}</Text>
        <View style={{flexDirection:'row', alignItems:'center', gap:6}}>
          {!servingUs && <View style={[s.servingDot, {backgroundColor:C.oppTeam}]} />}
          <Text style={[s.scoreNum, {color: gameState.theirScore > gameState.ourScore ? C.oppTeam : C.text}]}>
            {gameState.theirScore}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RALLY BAR
// ─────────────────────────────────────────────────────────────────────────────
function RallyBar({ touches, servingUs, pendingFrom, receivedFirst, undoLastTouch }) {
  const nextAction = inferNextAction(countNonBlockTouches(touches), servingUs);
  const nextInfo   = ACTIONS[nextAction] || {};
  return (
    <View style={s.rallyBar}>
      <View style={s.liveDot} />
      {pendingFrom ? (
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
  ourLineup, oppLineup, touches, arrows, pendingFrom, highlightIds, oppHighlightIds,
  rallyActive, onPlayerTap, onCourtTap, onNetPress,
  popup, setPopup, confirmPopup,
  startRally, undoLastTouch, servingUs, setServingUs,
  receivedFirst,
  rallyEndModal, confirmRallyEnd, setRallyEndModal,
}) {
  const [courtLayout, setCourtLayout] = useState({x:0, y:0, width:0, height:0});
  const courtRef = useRef(null);

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
  function xyToPixel(xy) {
    return { x: xy.x * CW, y: xy.y * CH };
  }

  function getPlayerCenter(playerId) {
    const ourP = ourLineup.find(p => p.id === playerId);
    if (ourP?.xy) return xyToPixel(ourP.xy);
    const oppP = oppLineup.find(p => p.id === playerId);
    if (oppP?.xy) return xyToPixel(oppP.xy);
    return null;
  }

  const NET_Y_PCT = 50; // net is at 50% height

  return (
    <View style={s.courtContainer}>
      {/* SERVE TOGGLE — always visible when rally not active */}
      {!rallyActive && (
        <View style={s.preRallyBar}>
          <TouchableOpacity
            style={[s.serveOpt, servingUs && s.serveOptSel]}
            onPress={() => setServingUs(true)}
          >
            <Text style={[s.serveOptText, servingUs && {color:C.accent}]}>We Serve</Text>
          </TouchableOpacity>
          <View style={[s.bigBtn, {flex:2, backgroundColor: C.surface, borderWidth:1, borderColor:C.border}]}>
            <Text style={[s.bigBtnText, {color:C.dim}]}>Tap a player to start</Text>
          </View>
          <TouchableOpacity
            style={[s.serveOpt, !servingUs && s.serveOptSelOpp]}
            onPress={() => setServingUs(false)}
          >
            <Text style={[s.serveOptText, !servingUs && {color:C.oppTeam}]}>They Serve</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* LIVE RALLY BAR */}
      {rallyActive && <RallyBar
        touches={touches} servingUs={servingUs} pendingFrom={pendingFrom}
        receivedFirst={receivedFirst} undoLastTouch={undoLastTouch}
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
          {/* Boundary */}
          <View style={s.courtBoundary} />
          {/* Attack lines */}
          <View style={[s.attackLine, {top:'33%'}]} />
          <View style={[s.attackLine, {top:'67%'}]} />
          {/* Court labels */}
          <Text style={[s.courtLabel, {top:6}]}>OPPONENT</Text>
          <Text style={[s.courtLabel, {bottom:6, top:undefined}]}>OUR TEAM</Text>

          {/* Arrows */}
          {courtLayout.width > 0 && arrows.map((arr, i) => {
            const from = getPlayerCenter(arr.fromId);
            if (!from) return null;
            const to = arr.toType==='player'
              ? getPlayerCenter(arr.toId)
              : {x: arr.toX, y: arr.toY};
            if (!to) return null;
            const dx = to.x-from.x, dy = to.y-from.y;
            const len = Math.sqrt(dx*dx+dy*dy);
            const angle = Math.atan2(dy,dx)*180/Math.PI;
            return (
              <View key={i} style={[s.arrowLine, {
                left:from.x, top:from.y, width:len,
                transform:[{translateY:-1},{rotate:`${angle}deg`}],
                transformOrigin:'left center',
                backgroundColor: arr.toType==='floor' ? C.red : C.accent,
              }]} />
            );
          })}

          {/* Floor landing dots */}
          {arrows.filter(a=>a.toType==='floor').map((arr,i) => (
            <View key={`dot${i}`} style={[s.floorDot, {left:arr.toX-7, top:arr.toY-7}]} />
          ))}
        </View>

        {/* NET — thicker, only as wide as court (8%–92%) */}
        <TouchableOpacity
          style={s.netTouchArea}
          onPress={(e) => { e.stopPropagation(); if (rallyActive && pendingFrom) onNetPress(); }}
          activeOpacity={0.7}
        >
          <View style={s.netBar}>
            <Text style={s.netText}>NET</Text>
          </View>
        </TouchableOpacity>

        {/* OPPONENT PLAYERS */}
        {oppLineup.map((player) => {
          if (!player?.xy) return null;
          const pos    = xyToPixel(player.xy);
          const isLast = touches.length>0 && touches[touches.length-1]?.playerId===player.id;
          // MBs show as M/L to indicate they could be libero swapped
          const isOppLib      = player.pos === 'L';
          const isOppRunning  = player.runningToSet;
          const isOppHighlight= oppHighlightIds.includes(player.id);
          const isOppDimmed   = rallyActive && !isOppHighlight && !isLast && !isOppRunning;
          const dispRole      = player.roleLabel || player.pos;
          return (
            <TouchableOpacity
              key={player.id}
              style={[s.playerCircle, isOppLib ? s.oppLiberoCircle : s.oppCircle, {
                left:pos.x-33, top:pos.y-33,
                opacity: isOppDimmed ? 0.35 : isLast ? 1 : 0.85,
                borderColor: isLast ? C.oppTeam
                  : isOppHighlight ? C.green
                  : isOppRunning ? C.amber
                  : isOppLib ? C.amber
                  : C.muted,
                borderWidth: isOppHighlight || isOppRunning ? 2.5 : 1.5,
              }]}
              onPress={(e) => { e.stopPropagation(); onPlayerTap(player,'opp',pos.x,pos.y); }}
            >
              {isOppRunning && <View style={[s.rolePip, {backgroundColor:C.amber, top:undefined, bottom:2, left:2, right:undefined}]} />}
              <Text style={[s.playerNum, {color: isOppHighlight ? C.green : isOppLib ? C.amber : isOppRunning ? C.amber : C.oppTeam}]}>#{player.num}</Text>
              <Text style={[s.playerPos, {color: isOppHighlight ? C.green+'99' : isOppLib ? C.amber+'99' : isOppRunning ? C.amber+'99' : C.oppTeam+'99', fontSize:9}]}>{dispRole}</Text>
            </TouchableOpacity>
          );
        })}

        {/* OUR PLAYERS */}
        {ourLineup.map((player) => {
          if (!player?.xy) return null;
          const pos         = xyToPixel(player.xy);
          const isLast      = touches.length>0 && touches[touches.length-1]?.playerId===player.id;
          const isPending   = pendingFrom?.id === player.id;
          const isHighlight = highlightIds.includes(player.id);
          // Dim non-highlighted players during a rally (unless last touched or pending)
          const isDimmed    = rallyActive && !isHighlight && !isLast && !isPending;
          return (
            <TouchableOpacity
              key={player.id}
              style={[s.playerCircle,
                player.libero ? s.liberoCircle : s.ourCircle,
              {
                left:pos.x-33, top:pos.y-33,
                borderColor: isPending ? C.amber
                  : isHighlight ? C.green
                  : isLast ? C.accent
                  : player.libero ? C.amber
                  : C.muted,
                borderWidth: isPending || isHighlight || isLast ? 2.5 : 1,
                opacity: isDimmed ? 0.35 : 1,
              }]}
              onPress={(e) => { e.stopPropagation(); onPlayerTap(player,'our',pos.x,pos.y); }}
            >
              {player.setter && !player.runningToSet && <View style={[s.rolePip, {backgroundColor:C.accent}]} />}
              {player.libero && <View style={[s.rolePip, {backgroundColor:C.amber}]} />}
              {player.runningToSet && (
                <View style={[s.rolePip, {backgroundColor:C.amber, top:undefined, bottom:2, left:2, right:undefined}]} />
              )}
              <Text style={[s.playerNum, {color: isHighlight ? C.green : player.runningToSet ? C.amber : player.libero ? C.amber : C.ourTeam}]}>#{player.num}</Text>
              <Text style={s.playerName}>{player.name}</Text>
              <Text style={[s.playerPos, {color: isHighlight ? C.green+'BB' : player.runningToSet ? C.amber+'BB' : player.libero ? C.amber+'BB' : C.ourTeam+'99'}]}>{player.roleLabel || player.pos}</Text>
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
                onPress={() => setRallyEndModal(null)}
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
    // Picking receive vs block — close the choice, keep quality step
    setPopup(p => ({ ...p, action: a, needsReceiveBlockChoice: false }));
  }

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

          {/* All other touches: auto action label */}
          {!isServe && !isReceiveBlockChoice && (
            <View style={[s.popupActionBigBtn, {
              backgroundColor: actionColor+'22',
              borderColor: actionColor,
              marginBottom: 16,
            }]}>
              <Text style={[s.popupActionBigText, {color: actionColor}]}>{actionMeta.label}</Text>
            </View>
          )}

          {/* Quality — one tap confirms (hidden while choosing receive/block) */}
          {!isReceiveBlockChoice && (
            <>
              <Text style={s.popupSectionLabel}>Quality</Text>
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
function SideStats({ gameState, stats, roster, touches, rallies, rallyActive, undoLastTouch, ourRotation }) {
  const [tab, setTab] = useState('stats');
  const our   = rallies.filter(r=>r.outcome==='our').length;
  const them  = rallies.filter(r=>r.outcome==='them').length;
  const total = our+them||1;

  return (
    <View style={{flex:1}}>
      <View style={s.sideTabRow}>
        {['stats','log'].map(t => (
          <TouchableOpacity key={t} style={[s.sideTab, tab===t&&s.sideTabActive]} onPress={()=>setTab(t)}>
            <Text style={[s.sideTabText, tab===t&&{color:C.text}]}>{t==='stats'?'Stats':'Log'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={{flex:1}} contentContainerStyle={{padding:12, gap:8}}>
        {tab==='stats' && (
          <>
            {/* Team name + rotation */}
            <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:4}}>
              <Text style={s.sideTeamLabel}>{gameState.ourName}</Text>
              <View style={{paddingHorizontal:8, paddingVertical:3, borderRadius:6, borderWidth:1, borderColor:C.accent, backgroundColor:'rgba(181,123,238,0.1)'}}>
                <Text style={{fontSize:10, fontWeight:'700', color:C.accent, letterSpacing:1}}>ROT {ourRotation + 1}</Text>
              </View>
            </View>

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
                  <Text style={[s.sidePlayerCell,{flex:1,color:C.text}]}>#{p.num} {p.name}</Text>
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
                    <Text style={[s.sidePlayerCell,{flex:1,color:C.amber}]}>#{p.num} {p.name}</Text>
                    <Text style={[s.sidePlayerCell,{color:C.amber}]}>{ps.recvTotal||0}</Text>
                    <Text style={[s.sidePlayerCell,{color:recvPct>=60?C.green:recvPct>0&&recvPct<30?C.red:C.amber}]}>
                      {ps.recvTotal>0?`${recvPct}%`:'—'}
                    </Text>
                  </View>
                </View>
              );
            })}

            {/* Rally outcomes */}
            {rallies.length>0 && (
              <>
                <Text style={[s.sideTeamLabel,{marginTop:10}]}>Rally Outcomes</Text>
                <View style={{height:8,borderRadius:4,flexDirection:'row',overflow:'hidden',backgroundColor:C.card}}>
                  <View style={{flex:our||0.01, backgroundColor:C.accent}} />
                  <View style={{flex:them||0.01, backgroundColor:C.oppTeam}} />
                </View>
                <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:4}}>
                  <Text style={{color:C.accent,fontSize:11}}>{our} won ({Math.round(our/total*100)}%)</Text>
                  <Text style={{color:C.oppTeam,fontSize:11}}>{them} lost</Text>
                </View>
              </>
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
                    <Text style={s.logAction}>{ACTIONS[t.action]?.label||t.action}</Text>
                    <Text style={[s.logQual,{color:t.quality===3?C.green:t.quality===0?C.red:C.dim}]}>
                      {QUALITY_LABELS[t.quality]}
                    </Text>
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
                    #{t.playerNum} {ACTIONS[t.action]?.label} ({QUALITY_LABELS[t.quality]||'?'})
                  </Text>
                ))}
              </View>
            ))}
            {!rallyActive && rallies.length===0 && <Text style={s.emptyText}>No rallies yet.</Text>}
          </>
        )}
      </ScrollView>

      <TouchableOpacity style={s.undoBarBtn} onPress={undoLastTouch}>
        <Text style={s.undoBarText}>↩ Undo Last Action</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS PANEL
// ─────────────────────────────────────────────────────────────────────────────
function StatsPanel({ stats, roster, rallies }) {
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

      {/* Player stat tabs */}
      <View style={s.tab3Row}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[s.tab3Btn, statTab===t.id && {borderColor:C.accent, backgroundColor:'rgba(79,127,255,0.1)'}]}
            onPress={() => setStatTab(t.id)}
          >
            <Text style={[s.tab3Text, statTab===t.id && {color:C.accent}]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Column headers */}
      <View style={[s.playerStatRow, {paddingBottom:2}]}>
        <View style={{width:36}} />
        <View style={{flex:1}} />
        {activeTab.headers.map(h => (
          <Text key={h} style={{width:colW, textAlign:'center', fontSize:9, color:C.muted, letterSpacing:0.5}}>{h}</Text>
        ))}
      </View>

      {/* Player rows */}
      {roster.map((p) => {
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
function HistoryPanel({ rallies }) {
  if (rallies.length===0) return <Text style={[s.emptyText,{padding:40}]}>No history yet.</Text>;
  return (
    <ScrollView contentContainerStyle={{padding:14,gap:8}}>
      {[...rallies].reverse().map(r => (
        <View key={r.id} style={s.historyItem}>
          <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:6}}>
            <Text style={{color:C.dim,fontSize:11}}>Rally #{r.rallyNum}</Text>
            <Text style={{color:r.outcome==='our'?C.accent:C.oppTeam,fontWeight:'600'}}>
              {r.outcome==='our'?'Our point':'Their point'}
            </Text>
          </View>
          {r.touches.map((t,i) => (
            <View key={i} style={{flexDirection:'row',gap:8,marginBottom:2}}>
              <Text style={{color:t.team==='our'?C.accent:C.oppTeam,fontSize:12,fontWeight:'600'}}>#{t.playerNum}</Text>
              <Text style={{color:C.text,fontSize:12}}>{ACTIONS[t.action]?.label}</Text>
              <Text style={{color:C.dim,fontSize:11}}>{QUALITY_LABELS[t.quality]??'?'}</Text>
            </View>
          ))}
          {r.endReason==='net' && <Text style={{color:C.amber,fontSize:10,marginTop:4}}>⚡ Net fault</Text>}
        </View>
      ))}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP PANEL
// ─────────────────────────────────────────────────────────────────────────────
function SetupPanel({ gameState, setGameState, ourRotation, setOurRotation }) {
  return (
    <ScrollView contentContainerStyle={{padding:14,gap:12}}>
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
const s = StyleSheet.create({
  safe:      {flex:1, backgroundColor:C.bg},
  root:      {flex:1, flexDirection:'row'},
  mainPanel: {flex:1, flexDirection:'column'},
  sidePanel: {width:280, backgroundColor:C.surface, borderLeftWidth:1, borderLeftColor:C.border},

  // Score bar
  scoreBar:   {flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:C.surface,paddingHorizontal:16,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.border},
  scoreSide:  {minWidth:100},
  teamName:   {fontSize:11,color:C.dim,letterSpacing:0.5,fontFamily:'Barlow_500Medium'},
  scoreNum:   {fontSize:42,fontWeight:'700',lineHeight:48,color:C.text,fontFamily:'Barlow_700Bold'},
  scoreCenter:{alignItems:'center'},
  setLabel:   {fontSize:12,fontWeight:'600',color:C.dim,letterSpacing:1,fontFamily:'Barlow_600SemiBold'},
  servingDot:    {width:8,height:8,borderRadius:4,backgroundColor:C.accent},
  rotLabel:      {fontSize:9,color:C.muted,letterSpacing:1},
  setScorebadge: {flexDirection:'row',alignItems:'center',gap:4},
  setScoreNum:   {fontSize:20,fontWeight:'700',color:C.text,fontFamily:'Barlow_700Bold'},
  setScoreSep:   {fontSize:14,color:C.muted},

  // Court container
  courtContainer:{flex:1,flexDirection:'column'},
  preRallyBar:{flexDirection:'row',gap:8,padding:10,backgroundColor:C.surface,borderBottomWidth:1,borderBottomColor:C.border},
  rallyBar:   {flexDirection:'row',alignItems:'center',gap:8,padding:10,backgroundColor:C.card,borderBottomWidth:1,borderBottomColor:C.border},
  liveDot:    {width:8,height:8,borderRadius:4,backgroundColor:C.red},
  rallyHint:  {flex:1,fontSize:12,color:C.dim,fontFamily:'Barlow_400Regular'},

  // Court surface
  court:         {flex:1,backgroundColor:'#090B11',position:'relative',overflow:'hidden'},
  courtBoundary: {position:'absolute',left:'8%',right:'8%',top:'5%',bottom:'5%',borderWidth:1.5,borderColor:'#FFFFFF35',borderRadius:1},
  attackLine:    {position:'absolute',left:'8%',right:'8%',height:1,backgroundColor:'#FFFFFF18'},
  courtLabel:    {position:'absolute',alignSelf:'center',fontSize:9,color:C.muted,letterSpacing:2},

  // NET — confined to court width, thicker and tappable
  netTouchArea:  {position:'absolute',top:'47%',left:'8%',right:'8%',height:'6%',zIndex:10,justifyContent:'center',alignItems:'center'},
  netBar:        {width:'100%',height:12,backgroundColor:C.net,borderRadius:4,alignItems:'center',justifyContent:'center'},
  netText:       {fontSize:8,color:C.bg,fontWeight:'700',letterSpacing:2},

  // Arrows
  arrowLine:  {position:'absolute',height:2},
  floorDot:   {position:'absolute',width:14,height:14,borderRadius:7,backgroundColor:C.red,borderWidth:2,borderColor:'#fff'},

  // Players
  playerCircle:{position:'absolute',width:66,height:66,borderRadius:33,alignItems:'center',justifyContent:'center',borderWidth:2},
  ourCircle:    {backgroundColor:'rgba(181,123,238,0.12)'},
  liberoCircle: {backgroundColor:'rgba(232,168,56,0.12)'},
  oppCircle:       {backgroundColor:'rgba(232,114,122,0.1)'},
  oppLiberoCircle: {backgroundColor:'rgba(232,168,56,0.08)'},
  rolePip:     {position:'absolute',top:3,right:3,width:8,height:8,borderRadius:4},
  playerNum:   {fontSize:17,fontWeight:'700',lineHeight:19,fontFamily:'Barlow_700Bold'},
  playerName:  {fontSize:8,color:C.dim,fontFamily:'Barlow_400Regular'},
  playerPos:   {fontSize:8,fontWeight:'600',fontFamily:'Barlow_600SemiBold'},

  // Action tag (in rally bar)
  actionTag:     {paddingHorizontal:7, paddingVertical:2, borderRadius:4, borderWidth:1},
  actionTagText: {fontSize:11, fontWeight:'700', letterSpacing:0.3},

  // Formation tag
  formationTag:     {paddingHorizontal:6,paddingVertical:2,borderRadius:4,borderWidth:1,borderColor:C.amber,backgroundColor:'rgba(232,168,56,0.15)'},
  formationTagText: {fontSize:9,fontWeight:'700',color:C.amber,letterSpacing:1},

  // Pre-rally controls
  serveOpt:      {flex:1,padding:8,borderRadius:8,borderWidth:1,borderColor:C.border,backgroundColor:C.card,alignItems:'center'},
  serveOptSel:   {borderColor:C.accent,backgroundColor:'rgba(181,123,238,0.1)'},
  serveOptSelOpp:{borderColor:C.oppTeam,backgroundColor:'rgba(232,114,122,0.1)'},
  serveOptText:  {fontSize:12,fontWeight:'500',color:C.dim},
  bigBtn:        {padding:10,borderRadius:8,backgroundColor:C.accent,alignItems:'center',justifyContent:'center'},
  bigBtnText:    {color:'#fff',fontSize:14,fontWeight:'600'},
  undoBtn:       {paddingHorizontal:10,paddingVertical:5,borderRadius:6,borderWidth:1,borderColor:C.muted},
  undoBtnText:   {fontSize:11,color:C.dim},
  undoBarBtn:    {padding:12,borderTopWidth:1,borderTopColor:C.border,alignItems:'center'},
  undoBarText:   {fontSize:12,color:C.dim},

  // Action popup — centred modal
  popupOverlay:      {flex:1,backgroundColor:'rgba(0,0,0,0.75)',alignItems:'center',justifyContent:'center',padding:20},
  popupCard:         {backgroundColor:C.card,borderRadius:16,borderWidth:1,borderColor:C.border,padding:20,width:'100%',maxWidth:480,shadowColor:'#000',shadowOpacity:0.6,shadowRadius:20,elevation:20},
  popupHeader:       {flexDirection:'row',alignItems:'center',gap:12,marginBottom:18},
  popupNumBadge:     {width:52,height:52,borderRadius:26,borderWidth:2,alignItems:'center',justifyContent:'center',backgroundColor:C.surface},
  popupNumBadgeText: {fontSize:18,fontWeight:'700'},
  popupPlayerName:   {fontSize:18,fontWeight:'700',color:C.text,fontFamily:'Barlow_700Bold'},
  popupPlayerRole:   {fontSize:12,color:C.dim,marginTop:2,fontFamily:'Barlow_400Regular'},
  popupClose:        {padding:8},
  popupCloseText:    {fontSize:16,color:C.muted},
  popupSectionLabel: {fontSize:10,color:C.muted,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10,fontFamily:'Barlow_500Medium'},
  popupActionGrid:   {flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:18},
  popupActionBtn:    {paddingHorizontal:14,paddingVertical:10,borderRadius:8,borderWidth:1.5,borderColor:C.border,backgroundColor:C.surface,minWidth:'30%',alignItems:'center'},
  popupActionText:   {fontSize:13,fontWeight:'600',color:C.dim},
  // Big action buttons for our popup (2-3 options side by side)
  popupActionRow:    {flexDirection:'row',gap:10},
  popupActionBigBtn: {flex:1,paddingVertical:20,borderRadius:12,borderWidth:2,borderColor:C.border,backgroundColor:C.surface,alignItems:'center',justifyContent:'center'},
  popupActionBigText:{fontSize:18,fontWeight:'700',fontFamily:'Barlow_700Bold'},
  // Opponent popup buttons
  oppBtnRow:         {flexDirection:'row',gap:10,marginTop:4},
  oppBtn:            {flex:1,paddingVertical:22,borderRadius:12,borderWidth:2,borderColor:C.border,backgroundColor:C.surface,alignItems:'center',justifyContent:'center'},
  oppBtnText:        {fontSize:17,fontWeight:'700'},
  popupQualRow:      {flexDirection:'row',gap:8,marginBottom:20},
  popupQualBtn:      {flex:1,paddingVertical:14,borderRadius:10,borderWidth:1.5,borderColor:C.border,backgroundColor:C.surface,alignItems:'center'},
  popupQualNum:      {fontSize:22,fontWeight:'700',marginBottom:3,fontFamily:'Barlow_700Bold'},
  popupQualSub:      {fontSize:10,fontWeight:'500',fontFamily:'Barlow_500Medium'},
  popupConfirm:      {borderRadius:12,padding:16,alignItems:'center'},
  popupConfirmText:  {color:'#fff',fontSize:16,fontWeight:'700',letterSpacing:0.3},

  // Modals
  modalOverlay:    {flex:1,backgroundColor:'rgba(0,0,0,0.75)',alignItems:'center',justifyContent:'center'},
  modalCard:       {backgroundColor:C.card,borderRadius:14,padding:20,width:300,borderWidth:1,borderColor:C.border},
  modalTitle:      {fontSize:18,fontWeight:'700',color:C.text,marginBottom:4,fontFamily:'Barlow_700Bold'},
  modalSub:        {fontSize:13,color:C.dim,marginBottom:14,fontFamily:'Barlow_400Regular'},
  modalOutcomeRow: {marginBottom:12},
  modalOutcome:    {padding:12,borderRadius:10,borderWidth:1.5,alignItems:'center'},
  modalOutcomeText:{fontSize:15,fontWeight:'700'},
  modalBtnRow:     {flexDirection:'row',gap:8},
  modalBtn:        {flex:1,padding:12,borderRadius:8,borderWidth:1,alignItems:'center'},
  modalBtnText:    {fontSize:13,fontWeight:'600'},

  // Side panel
  sideTabRow:      {flexDirection:'row',borderBottomWidth:1,borderBottomColor:C.border},
  sideTab:         {flex:1,padding:10,alignItems:'center'},
  sideTabActive:   {borderBottomWidth:2,borderBottomColor:C.accent},
  sideTabText:     {fontSize:12,color:C.muted,fontWeight:'500'},
  sideTeamLabel:   {fontSize:10,color:C.accent,letterSpacing:1.5,textTransform:'uppercase',fontWeight:'600',marginBottom:4},
  sidePlayerHeader:{flexDirection:'row',marginBottom:4},
  sidePlayerCell:  {width:40,fontSize:9,color:C.muted,textAlign:'center'},
  sidePlayerRow:   {flexDirection:'row',paddingVertical:5,borderBottomWidth:1,borderBottomColor:C.border},
  logEntry:        {flexDirection:'row',gap:8,paddingVertical:5,borderBottomWidth:1,borderBottomColor:C.border},
  logNum:          {fontSize:11,fontWeight:'700',minWidth:28},
  logAction:       {flex:1,fontSize:11,color:C.text},
  logQual:         {fontSize:10},
  historyItem:     {backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:8,padding:10},

  // Stats tabs
  tab3Row:  {flexDirection:'row', gap:8, marginBottom:2},
  tab3Btn:  {flex:1, paddingVertical:9, borderRadius:8, borderWidth:1, borderColor:C.border, backgroundColor:C.card, alignItems:'center'},
  tab3Text: {fontSize:12, fontWeight:'600', color:C.dim},

  // Stats page
  statGrid:      {flexDirection:'row',flexWrap:'wrap',gap:8},
  statCard:      {width:'48%',backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:10,padding:12},
  statLabel:     {fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:1,fontFamily:'Barlow_500Medium'},
  statValue:     {fontSize:26,fontWeight:'600',color:C.text,marginTop:2,fontFamily:'Barlow_600SemiBold'},
  statSub:       {fontSize:11,color:C.dim,marginTop:2},
  playerStatRow: {flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.border},
  psnNum:        {width:32,height:32,borderRadius:16,backgroundColor:C.card,borderWidth:1,borderColor:C.border,alignItems:'center',justifyContent:'center'},
  psnNumText:    {fontSize:12,fontWeight:'600',color:C.text},

  // Setup
  card:       {backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:10,padding:12},
  setupTitle: {fontSize:13,fontWeight:'600',color:C.text,marginBottom:10},
  input:      {backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:8,color:C.text,fontSize:14,padding:9,fontFamily:'Barlow_400Regular'},
  rotBtn:     {paddingHorizontal:14,paddingVertical:8,borderRadius:8,borderWidth:1,borderColor:C.border,backgroundColor:C.surface},
  rotBtnSel:  {borderColor:C.accent,backgroundColor:'rgba(181,123,238,0.1)'},
  rotBtnText: {fontSize:12,fontWeight:'500',color:C.dim},
  posBadge:   {fontSize:10,fontWeight:'600',borderWidth:1,borderRadius:4,paddingHorizontal:5,paddingVertical:1},

  // Misc
  emptyText:    {textAlign:'center',color:C.muted,fontSize:13},
  navBar:       {flexDirection:'row',backgroundColor:C.surface,borderTopWidth:1,borderTopColor:C.border},
  navBtn:       {flex:1,alignItems:'center',paddingBottom:10,gap:4},
  navActiveLine:{height:2,width:'60%',borderRadius:1,backgroundColor:'transparent',marginBottom:0},
  navLabel:     {fontSize:10,fontWeight:'500',fontFamily:'Barlow_500Medium'},
});