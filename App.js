// ─────────────────────────────────────────────────────────────────────────────
// VOLLEYBALL STAT TRACKER — 5-1 Rotation + Full Court
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useState } from 'react';
import {
  Dimensions, Modal,
  SafeAreaView, ScrollView, StatusBar,
  StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';

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
const DEFAULT_OUR_ROSTER = [
  { id: 'o1', num: 1,  name: 'Martin', pos: 'S',   role: 'S',   setter: true },
  { id: 'o2', num: 3,  name: 'Smith',  pos: 'OH',  role: 'O1' },
  { id: 'o3', num: 5,  name: 'Jones',  pos: 'MB',  role: 'M1' },
  { id: 'o4', num: 7,  name: 'Adams',  pos: 'OPP', role: 'OPP' },
  { id: 'o5', num: 9,  name: 'Patel',  pos: 'OH',  role: 'O2' },
  { id: 'o6', num: 11, name: 'Okafor', pos: 'MB',  role: 'M2' },
  { id: 'o7', num: 2,  name: 'Chen',   pos: 'L',   role: 'L',   libero: true },
];

const DEFAULT_OPP_ROSTER = [
  { id: 'p1', num: 4,  name: '', pos: 'S',   role: 'S',   setter: true },
  { id: 'p2', num: 9,  name: '', pos: 'OH',  role: 'O1' },
  { id: 'p3', num: 2,  name: '', pos: 'MB',  role: 'M1' },
  { id: 'p4', num: 6,  name: '', pos: 'OPP', role: 'OPP' },
  { id: 'p5', num: 8,  name: '', pos: 'OH',  role: 'O2' },
  { id: 'p6', num: 5,  name: '', pos: 'MB',  role: 'M2' },
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

// ── OPP BASE SLOTS ───────────────────────────────────────────────────────────
// Opponent always uses standard 6-player rotation, no libero tracking
const OPP_BASE_SLOTS = [
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, M1:{r:1,c:0}, M2:{r:0,c:1} },
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:1,c:0}, M2:{r:0,c:1} },
  { S:{r:1,c:2}, OPP:{r:0,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:0,c:1}, M2:{r:1,c:0} },
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:1,c:1}, O2:{r:0,c:0}, M1:{r:0,c:1}, M2:{r:1,c:0} },
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, M1:{r:0,c:1}, M2:{r:1,c:0} },
  { S:{r:0,c:2}, OPP:{r:1,c:2}, O1:{r:0,c:0}, O2:{r:1,c:1}, M1:{r:1,c:0}, M2:{r:0,c:1} },
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
  const x = (slot.c * 2 + 1) / 6;
  if (isOur) {
    // Our half: y 0.5 (net) → 1.0 (baseline)
    // front row (r=0) at ~0.625, back row (r=1) at ~0.875
    const y = 0.5 + (slot.r === 0 ? 0.25 : 0.75) * 0.5;
    return { x, y };
  } else {
    // Opp half: y 0.0 (baseline) → 0.5 (net)
    // front row (r=0) = closer to net = higher y value
    // back row (r=1) = further from net = lower y value
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

  if (formation === 'receive') {
    // Receive slots only used for our team
    const slots = RECEIVE_SLOTS[rotIdx];
    return Object.entries(slots).map(([role, xy]) => {
      const player = byRole[role];
      if (!player) return null;
      return { ...player, xy, roleLabel: role };
    }).filter(Boolean);
  }

  // Opponent always uses OPP_BASE_SLOTS (no libero)
  // Our team uses BASE_SLOTS (with libero) or RECEIVE_BASE_SLOTS
  const slots = !isOur
    ? OPP_BASE_SLOTS[rotIdx]
    : formation === 'receiveBase'
      ? RECEIVE_BASE_SLOTS[rotIdx]
      : BASE_SLOTS[rotIdx];

  return Object.entries(slots).map(([role, slot]) => {
    const player = byRole[role];
    if (!player) return null;
    return { ...player, xy: baseSlotToXY(slot, isOur), roleLabel: role };
  }).filter(Boolean);
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
function inferNextAction(touchCount, servingUs) {
  if (servingUs) {
    // We serve: touch 0=serve, touch 1=receive, then cycle set→attack→receive
    if (touchCount === 0) return 'spin'; // default serve type; popup lets user pick spin/float
    if (touchCount === 1) return 'receive';
    const cyclePos = (touchCount - 2) % 3;
    if (cyclePos === 0) return 'set';
    if (cyclePos === 1) return 'attack';
    return 'receive';
  } else {
    // They serve: we start at receive, then cycle set→attack→receive
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
  ['O2', 'M1', 'OPP'], // Rot 4 (S in front but OPP highlighted instead)
  ['O1', 'M1', 'OPP'], // Rot 5
  ['O1', 'M2', 'OPP'], // Rot 6
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
function getHighlightIds(touchCount, servingUs, rotIdx, lineup) {
  // Don't highlight our players when it's the other team's touch
  if (!isOurTouch(touchCount, servingUs)) return [];

  const action = inferNextAction(touchCount, servingUs);
  const byRole = {};
  lineup.forEach(p => { byRole[p.roleLabel] = p.id; });

  let roles = [];

  if (action === 'spin' || action === 'float') {
    roles = [SERVERS[rotIdx]];
  } else if (action === 'receive') {
    // First receive of the rally (serve receive) → O1, O2 + libero
    // Mid-rally receives → full back row
    if (!servingUs && touchCount === 0) {
      roles = ['O1', 'O2', 'L'];
    } else {
      roles = BACK_ROW[rotIdx];
    }
  } else if (action === 'set') {
    roles = ['S'];
  } else if (action === 'attack') {
    roles = ATTACKERS[rotIdx];
  }

  return roles.map(r => byRole[r]).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('match');
  const [gameState, setGameState] = useState({
    ourName:'Loughborough A', theirName:'Nottingham A',
    ourScore:0, theirScore:0, ourSets:0, theirSets:0, currentSet:1,
  });

  const [ourRoster] = useState(DEFAULT_OUR_ROSTER);
  const [oppRoster] = useState(DEFAULT_OPP_ROSTER);

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
  // controls switching from receive formation → receiveBase formation
  const [receivedFirst, setReceivedFirst] = useState(false);

  // Determine which formation to show for our team
  const ourFormation = !rallyActive || servingUs
    ? 'base'
    : receivedFirst ? 'receiveBase' : 'receive';

  const ourLineup = buildLineup(ourRoster, ourRotation, ourFormation);
  const oppLineup = buildLineup(oppRoster, oppRotation, 'base', false);

  // Highlight IDs — only highlight our players for now
  const highlightIds = rallyActive
    ? getHighlightIds(touches.length, servingUs, ourRotation, ourLineup)
    : [];

  const stats = calcStats(rallies, ourRoster);

  // ── RALLY LOGIC ─────────────────────────────────────────────────────────────
  function startRally() {
    setTouches([]); setArrows([]); setPendingFrom(null); setPopup(null);
    setReceivedFirst(false);
    setRallyActive(true);
  }

  function onPlayerTap(player, team, px, py) {
    if (!rallyActive) return;
    if (pendingFrom) {
      setArrows(prev => [...prev, { fromId: pendingFrom.id, toId: player.id, toType:'player' }]);
      setPendingFrom(null);
      showPopup(player, team, px, py);
    } else {
      showPopup(player, team, px, py);
    }
  }

  function showPopup(player, team, px, py) {
    const touchIndex = touches.length;
    const isOur = team === 'our';
    let action;
    if (isOur) {
      const opts = getOurActions(touchIndex, servingUs) || ['receive', 'block'];
      action = opts[0];
    } else {
      // Default opp action based on sequence
      const inferred = inferNextAction(touchIndex, servingUs);
      action = OPP_ACTIONS.includes(inferred) ? inferred : 'receive';
    }
    setPopup({ player, team, px, py, touchIndex, action, quality: 2, isOur, servingUs });
  }

  function confirmPopup() {
    if (!popup) return;
    const touch = {
      playerId:   popup.player.id,
      playerNum:  popup.player.num,
      playerName: popup.player.name,
      team:       popup.team,
      action:     popup.action,
      quality:    popup.isOur ? popup.quality : null,
      touchIndex: popup.touchIndex,
    };

    const newTouches = [...touches, touch];
    setTouches(newTouches);
    setPendingFrom(popup.player);
    setPopup(null);

    // First touch confirmed when receiving → switch to receiveBase formation
    if (!servingUs && !receivedFirst) {
      setReceivedFirst(true);
    }

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

  function confirmRallyEnd() {
    if (!rallyEndModal) return;
    const newRally = {
      id: Date.now(), rallyNum: rallies.length+1,
      touches, arrows,
      outcome:   rallyEndModal.outcome,
      endReason: rallyEndModal.endReason || 'floor',
      scoreBefore: { us: gameState.ourScore, them: gameState.theirScore },
    };
    setRallies(prev => [...prev, newRally]);
    setGameState(prev => ({
      ...prev,
      ourScore:   rallyEndModal.outcome==='our'  ? prev.ourScore+1  : prev.ourScore,
      theirScore: rallyEndModal.outcome==='them' ? prev.theirScore+1 : prev.theirScore,
    }));

    // Rotation logic: if WE won the rally AND they were serving → we rotate (gain serve)
    // If THEY won the rally AND we were serving → they rotate (gain serve)
    const weWon = rallyEndModal.outcome === 'our';
    if (weWon && !servingUs) {
      // We gain serve: rotate our team clockwise
      setOurRotation(r => (r + 1) % 6);
      setServingUs(true);
    } else if (!weWon && servingUs) {
      // They gain serve: rotate their team
      setOppRotation(r => (r + 1) % 6);
      setServingUs(false);
    }
    // If serving team wins: no rotation, they keep serving

    setRallyActive(false);
    setTouches([]); setArrows([]); setPendingFrom(null);
    setReceivedFirst(false);
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
          {id:'match', label:'Match', icon:'⚡'},
          {id:'stats', label:'Stats', icon:'📊'},
          {id:'history', label:'History', icon:'📋'},
          {id:'setup', label:'Setup', icon:'⚙️'},
        ].map(({id, label, icon}) => (
          <TouchableOpacity key={id} style={s.navBtn} onPress={() => setPage(id)}>
            <Text style={s.navIcon}>{icon}</Text>
            <Text style={[s.navLabel, page===id && {color:C.accent}]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ACTION POPUP */}
      <ActionPopup popup={popup} setPopup={setPopup} confirmPopup={confirmPopup} />

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
        <Text style={s.setLabel}>SET {gameState.currentSet}</Text>
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
  const nextAction = inferNextAction(touches.length, servingUs);
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
  ourLineup, oppLineup, touches, arrows, pendingFrom, highlightIds,
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
      {/* PRE-RALLY BAR */}
      {!rallyActive && (
        <View style={s.preRallyBar}>
          <TouchableOpacity
            style={[s.serveOpt, servingUs && s.serveOptSel]}
            onPress={() => setServingUs(true)}
          >
            <Text style={[s.serveOptText, servingUs && {color:C.accent}]}>We Serve</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.bigBtn, {flex:2}]} onPress={startRally}>
            <Text style={s.bigBtnText}>▶  Start Rally</Text>
          </TouchableOpacity>
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
          const isMB   = player.pos === 'MB';
          const dispRole = isMB ? 'M/L' : (player.roleLabel || player.pos);
          return (
            <TouchableOpacity
              key={player.id}
              style={[s.playerCircle, s.oppCircle, {
                left:pos.x-33, top:pos.y-33,
                opacity: isLast ? 1 : 0.75,
                borderColor: isLast ? C.oppTeam : C.muted,
              }]}
              onPress={(e) => { e.stopPropagation(); onPlayerTap(player,'opp',pos.x,pos.y); }}
            >
              <Text style={[s.playerNum, {color:C.oppTeam}]}>#{player.num}</Text>
              <Text style={[s.playerPos, {color:C.oppTeam+'99', fontSize:9}]}>{dispRole}</Text>
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
              {player.setter && <View style={[s.rolePip, {backgroundColor:C.accent}]} />}
              {player.libero && <View style={[s.rolePip, {backgroundColor:C.amber}]} />}
              {isHighlight && !isPending && (
                <View style={[s.rolePip, {backgroundColor:C.green, top:undefined, bottom:2, right:2}]} />
              )}
              <Text style={[s.playerNum, {color: isHighlight ? C.green : player.libero ? C.amber : C.ourTeam}]}>#{player.num}</Text>
              <Text style={s.playerName}>{player.name}</Text>
              <Text style={[s.playerPos, {color: isHighlight ? C.green+'BB' : player.libero ? C.amber+'BB' : C.ourTeam+'99'}]}>{player.roleLabel || player.pos}</Text>
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
  return popup.isOur
    ? <OurPopup  popup={popup} setPopup={setPopup} confirmPopup={confirmPopup} />
    : <OppPopup  popup={popup} setPopup={setPopup} confirmPopup={confirmPopup} />;
}

// ── OUR TEAM POPUP ────────────────────────────────────────────────────────────
function OurPopup({ popup, setPopup, confirmPopup }) {
  const actions     = getOurActions(popup.touchIndex, popup.servingUs) || ['receive', 'block'];
  const actionMeta  = ACTIONS[popup.action] || {};
  const actionColor = actionMeta.color || C.accent;

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

          {/* Action buttons — only the relevant ones */}
          <Text style={s.popupSectionLabel}>Action</Text>
          <View style={s.popupActionRow}>
            {actions.map(a => {
              const meta = ACTIONS[a] || {};
              const sel  = popup.action === a;
              return (
                <TouchableOpacity
                  key={a}
                  style={[s.popupActionBigBtn, sel && {
                    backgroundColor: meta.color+'33',
                    borderColor: meta.color,
                  }]}
                  onPress={() => setPopup(p => ({...p, action: a}))}
                >
                  <Text style={[s.popupActionBigText, {color: sel ? meta.color : C.dim}]}>
                    {meta.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Quality */}
          <Text style={[s.popupSectionLabel, {marginTop: 16}]}>Quality</Text>
          <View style={s.popupQualRow}>
            {[0,1,2,3].map(q => {
              const qColor = q===0 ? C.red : q===3 ? C.accent : '#4F7FFF';
              const sel    = popup.quality === q;
              return (
                <TouchableOpacity
                  key={q}
                  style={[s.popupQualBtn, sel && {backgroundColor: qColor+'33', borderColor: qColor}]}
                  onPress={() => setPopup(p => ({...p, quality: q}))}
                >
                  <Text style={[s.popupQualNum, {color: sel ? qColor : C.dim}]}>{q}</Text>
                  <Text style={[s.popupQualSub, {color: sel ? qColor : C.muted}]}>{QUALITY_LABELS[q]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Confirm */}
          <TouchableOpacity
            style={[s.popupConfirm, {backgroundColor: actionColor, marginTop: 16}]}
            onPress={confirmPopup}
          >
            <Text style={s.popupConfirmText}>Confirm {actionMeta.label} →</Text>
          </TouchableOpacity>

        </View>
      </View>
    </Modal>
  );
}

// ── OPPONENT POPUP ────────────────────────────────────────────────────────────
function OppPopup({ popup, setPopup, confirmPopup }) {
  const actionMeta  = ACTIONS[popup.action] || {};
  const actionColor = actionMeta.color || C.oppTeam;

  return (
    <Modal visible transparent animationType="fade">
      <View style={s.popupOverlay}>
        <View style={[s.popupCard, {borderColor: C.oppTeam+'44'}]}>

          {/* Header */}
          <View style={s.popupHeader}>
            <View style={[s.popupNumBadge, {borderColor: C.oppTeam}]}>
              <Text style={[s.popupNumBadgeText, {color: C.oppTeam}]}>#{popup.player.num}</Text>
            </View>
            <View style={{flex:1}}>
              <Text style={s.popupPlayerName}>{popup.player.name}</Text>
              <Text style={[s.popupPlayerRole, {color: C.oppTeam+'99'}]}>Opponent · Touch #{popup.touchIndex + 1}</Text>
            </View>
            <TouchableOpacity onPress={() => setPopup(null)} style={s.popupClose}>
              <Text style={s.popupCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* 3 big buttons — receive / set / attack */}
          <View style={s.oppBtnRow}>
            {OPP_ACTIONS.map(a => {
              const meta = ACTIONS[a] || {};
              const sel  = popup.action === a;
              return (
                <TouchableOpacity
                  key={a}
                  style={[s.oppBtn, sel && {backgroundColor: meta.color+'33', borderColor: meta.color}]}
                  onPress={() => setPopup(p => ({...p, action: a}))}
                >
                  <Text style={[s.oppBtnText, {color: sel ? meta.color : C.dim}]}>{meta.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Confirm */}
          <TouchableOpacity
            style={[s.popupConfirm, {backgroundColor: actionColor, marginTop: 8}]}
            onPress={confirmPopup}
          >
            <Text style={s.popupConfirmText}>Log {actionMeta.label} →</Text>
          </TouchableOpacity>

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
  teamName:   {fontSize:11,color:C.dim,letterSpacing:0.5},
  scoreNum:   {fontSize:42,fontWeight:'700',lineHeight:48,color:C.text},
  scoreCenter:{alignItems:'center'},
  setLabel:   {fontSize:12,fontWeight:'600',color:C.dim,letterSpacing:1},
  servingDot: {width:8,height:8,borderRadius:4,backgroundColor:C.accent},
  rotLabel:   {fontSize:9,color:C.muted,letterSpacing:1},

  // Court container
  courtContainer:{flex:1,flexDirection:'column'},
  preRallyBar:{flexDirection:'row',gap:8,padding:10,backgroundColor:C.surface,borderBottomWidth:1,borderBottomColor:C.border},
  rallyBar:   {flexDirection:'row',alignItems:'center',gap:8,padding:10,backgroundColor:C.card,borderBottomWidth:1,borderBottomColor:C.border},
  liveDot:    {width:8,height:8,borderRadius:4,backgroundColor:C.red},
  rallyHint:  {flex:1,fontSize:12,color:C.dim},

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
  oppCircle:    {backgroundColor:'rgba(232,114,122,0.1)'},
  rolePip:     {position:'absolute',top:3,right:3,width:8,height:8,borderRadius:4},
  playerNum:   {fontSize:17,fontWeight:'700',lineHeight:19},
  playerName:  {fontSize:8,color:C.dim},
  playerPos:   {fontSize:8,fontWeight:'600'},

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
  popupPlayerName:   {fontSize:18,fontWeight:'700',color:C.text},
  popupPlayerRole:   {fontSize:12,color:C.dim,marginTop:2},
  popupClose:        {padding:8},
  popupCloseText:    {fontSize:16,color:C.muted},
  popupSectionLabel: {fontSize:10,color:C.muted,letterSpacing:1.5,textTransform:'uppercase',marginBottom:10},
  popupActionGrid:   {flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:18},
  popupActionBtn:    {paddingHorizontal:14,paddingVertical:10,borderRadius:8,borderWidth:1.5,borderColor:C.border,backgroundColor:C.surface,minWidth:'30%',alignItems:'center'},
  popupActionText:   {fontSize:13,fontWeight:'600',color:C.dim},
  // Big action buttons for our popup (2-3 options side by side)
  popupActionRow:    {flexDirection:'row',gap:10},
  popupActionBigBtn: {flex:1,paddingVertical:20,borderRadius:12,borderWidth:2,borderColor:C.border,backgroundColor:C.surface,alignItems:'center',justifyContent:'center'},
  popupActionBigText:{fontSize:18,fontWeight:'700'},
  // Opponent popup buttons
  oppBtnRow:         {flexDirection:'row',gap:10,marginTop:4},
  oppBtn:            {flex:1,paddingVertical:22,borderRadius:12,borderWidth:2,borderColor:C.border,backgroundColor:C.surface,alignItems:'center',justifyContent:'center'},
  oppBtnText:        {fontSize:17,fontWeight:'700'},
  popupQualRow:      {flexDirection:'row',gap:8,marginBottom:20},
  popupQualBtn:      {flex:1,paddingVertical:14,borderRadius:10,borderWidth:1.5,borderColor:C.border,backgroundColor:C.surface,alignItems:'center'},
  popupQualNum:      {fontSize:22,fontWeight:'700',marginBottom:3},
  popupQualSub:      {fontSize:10,fontWeight:'500'},
  popupConfirm:      {borderRadius:12,padding:16,alignItems:'center'},
  popupConfirmText:  {color:'#fff',fontSize:16,fontWeight:'700',letterSpacing:0.3},

  // Modals
  modalOverlay:    {flex:1,backgroundColor:'rgba(0,0,0,0.75)',alignItems:'center',justifyContent:'center'},
  modalCard:       {backgroundColor:C.card,borderRadius:14,padding:20,width:300,borderWidth:1,borderColor:C.border},
  modalTitle:      {fontSize:18,fontWeight:'700',color:C.text,marginBottom:4},
  modalSub:        {fontSize:13,color:C.dim,marginBottom:14},
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
  statLabel:     {fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:1},
  statValue:     {fontSize:26,fontWeight:'600',color:C.text,marginTop:2},
  statSub:       {fontSize:11,color:C.dim,marginTop:2},
  playerStatRow: {flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.border},
  psnNum:        {width:32,height:32,borderRadius:16,backgroundColor:C.card,borderWidth:1,borderColor:C.border,alignItems:'center',justifyContent:'center'},
  psnNumText:    {fontSize:12,fontWeight:'600',color:C.text},

  // Setup
  card:       {backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:10,padding:12},
  setupTitle: {fontSize:13,fontWeight:'600',color:C.text,marginBottom:10},
  input:      {backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:8,color:C.text,fontSize:14,padding:9},
  rotBtn:     {paddingHorizontal:14,paddingVertical:8,borderRadius:8,borderWidth:1,borderColor:C.border,backgroundColor:C.surface},
  rotBtnSel:  {borderColor:C.accent,backgroundColor:'rgba(181,123,238,0.1)'},
  rotBtnText: {fontSize:12,fontWeight:'500',color:C.dim},
  posBadge:   {fontSize:10,fontWeight:'600',borderWidth:1,borderRadius:4,paddingHorizontal:5,paddingVertical:1},

  // Misc
  emptyText: {textAlign:'center',color:C.muted,fontSize:13},
  navBar:    {flexDirection:'row',backgroundColor:C.surface,borderTopWidth:1,borderTopColor:C.border},
  navBtn:    {flex:1,paddingVertical:10,alignItems:'center',gap:2},
  navIcon:   {fontSize:18},
  navLabel:  {fontSize:10,color:C.muted,fontWeight:'500'},
});