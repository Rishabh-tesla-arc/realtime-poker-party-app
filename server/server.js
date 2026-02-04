import http from "http";
import crypto from "crypto";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT ? Number(process.env.PORT) : 5174;
const MAX_SEATS = 10;
const HOST_PASSWORD = process.env.HOST_PASSWORD || "host123";
const BLINDS = { small: 5, big: 10 };

const SUITS = ["spades", "hearts", "clubs", "diamonds"];
const RANKS = [
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5" },
  { value: 6, label: "6" },
  { value: 7, label: "7" },
  { value: 8, label: "8" },
  { value: 9, label: "9" },
  { value: 10, label: "10" },
  { value: 11, label: "J" },
  { value: 12, label: "Q" },
  { value: 13, label: "K" },
  { value: 14, label: "A" },
];

const avatarGradients = [
  "linear-gradient(135deg, #f4c35a, #ec6b67)",
  "linear-gradient(135deg, #63d6ff, #4b79ff)",
  "linear-gradient(135deg, #a7ff83, #3aa158)",
  "linear-gradient(135deg, #ff96f3, #9f4bf0)",
  "linear-gradient(135deg, #ffd27d, #ff8d4f)",
  "linear-gradient(135deg, #b4c8ff, #5353ff)",
];

const rooms = new Map();
const connections = new Map();

const server = http.createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Poker server running.");
});

const wss = new WebSocketServer({ server });

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank: rank.value, label: rank.label });
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      players: [],
      deck: [],
      community: [],
      pot: 0,
      sidePots: [],
      dealerIndex: 0,
      currentPlayerIndex: 0,
      currentBet: 0,
      minRaise: BLINDS.big,
      stage: "idle",
      handActive: false,
      revealHands: false,
      hostId: null,
      maxPlayers: MAX_SEATS,
      speedMs: 700,
      advanceTimer: null,
      initialStack: 1000,
      carryOverBalances: true,
    });
  }
  return rooms.get(roomId);
}

function availableSeat(room) {
  const taken = new Set(room.players.map((player) => player.seatIndex));
  for (let i = 0; i < MAX_SEATS; i += 1) {
    if (!taken.has(i)) return i;
  }
  return -1;
}

function send(ws, message) {
  ws.send(JSON.stringify(message));
}

function broadcast(room, message) {
  for (const [socket, meta] of connections.entries()) {
    if (meta.roomId === room.id && socket.readyState === 1) {
      send(socket, message);
    }
  }
}

function buildStateForPlayer(room, playerId) {
  const players = room.players.map((player) => ({
    ...player,
    hand:
      player.id === playerId || room.revealHands || !room.handActive
        ? player.hand
        : [],
  }));
  return {
    id: room.id,
    players,
    community: room.community,
    pot: room.pot,
    sidePots: calculateSidePots(room).map((pot) => ({
      amount: pot.amount,
      eligibleCount: pot.eligible.length,
    })),
    speedMs: room.speedMs,
    maxPlayers: room.maxPlayers,
    initialStack: room.initialStack,
    carryOverBalances: room.carryOverBalances,
    dealerIndex: room.dealerIndex,
    currentPlayerIndex: room.currentPlayerIndex,
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    stage: room.stage,
    handActive: room.handActive,
    revealHands: room.revealHands,
    hostId: room.hostId,
  };
}

function syncRoom(room) {
  for (const [socket, meta] of connections.entries()) {
    if (meta.roomId !== room.id || socket.readyState !== 1) continue;
    send(socket, { type: "STATE", payload: buildStateForPlayer(room, meta.playerId) });
  }
}

function resetHandState(room) {
  room.deck = createDeck();
  room.community = [];
  room.pot = 0;
  room.sidePots = [];
  if (room.advanceTimer) {
    clearTimeout(room.advanceTimer);
    room.advanceTimer = null;
  }
  room.currentBet = 0;
  room.minRaise = BLINDS.big;
  room.stage = "preflop";
  room.handActive = true;
  room.revealHands = false;
  room.players.forEach((player) => {
    player.bet = 0;
    player.totalBet = 0;
    player.hand = [];
    player.folded = false;
    player.allIn = false;
    player.status = "";
    player.bestHand = null;
  });
}

function dealCard(room) {
  return room.deck.pop();
}

function dealHoleCards(room) {
  for (let i = 0; i < 2; i += 1) {
    room.players.forEach((player) => {
      if (player.stack > 0) {
        player.hand.push(dealCard(room));
      }
    });
  }
}

function applyForcedBet(room, player, amount, label) {
  const betAmount = Math.min(amount, player.stack);
  player.stack -= betAmount;
  player.bet += betAmount;
  player.totalBet += betAmount;
  player.status = label;
  if (player.stack === 0) {
    player.allIn = true;
  }
  room.pot += betAmount;
}

function postBlinds(room) {
  const count = room.players.length;
  const dealer = room.dealerIndex % count;
  const smallBlind = (dealer + 1) % count;
  const bigBlind = (dealer + 2) % count;
  applyForcedBet(room, room.players[smallBlind], BLINDS.small, "Small Blind");
  applyForcedBet(room, room.players[bigBlind], BLINDS.big, "Big Blind");
  room.currentBet = BLINDS.big;
  room.minRaise = BLINDS.big;
  room.currentPlayerIndex = (bigBlind + 1) % count;
}

function activePlayers(room) {
  return room.players.filter((p) => !p.folded && p.stack + p.bet > 0);
}

function nextActivePlayer(room, fromIndex) {
  const count = room.players.length;
  let idx = fromIndex;
  for (let i = 0; i < count; i += 1) {
    idx = (idx + 1) % count;
    const player = room.players[idx];
    if (!player.folded && player.stack + player.bet > 0 && !player.allIn) {
      return idx;
    }
  }
  return -1;
}

function commitBet(room, player, amount) {
  const betAmount = Math.min(amount, player.stack);
  player.stack -= betAmount;
  player.bet += betAmount;
  player.totalBet += betAmount;
  room.pot += betAmount;
  if (player.stack === 0) {
    player.allIn = true;
  }
}

function isBettingRoundComplete(room) {
  const active = activePlayers(room);
  if (active.length <= 1) return true;
  return active.every((player) => player.allIn || player.bet === room.currentBet);
}

function clearBets(room) {
  room.players.forEach((player) => {
    player.bet = 0;
    player.status = "";
  });
  room.currentBet = 0;
  room.minRaise = BLINDS.big;
}

function allActiveAllIn(room) {
  const remaining = activePlayers(room).filter((p) => !p.folded);
  return remaining.length > 1 && remaining.every((p) => p.allIn);
}

function checkForHandEnd(room) {
  const remaining = activePlayers(room).filter((p) => !p.folded);
  if (remaining.length === 1) {
    const winner = remaining[0];
    winner.stack += room.pot;
    winner.status = "Wins pot";
    room.pot = 0;
    room.handActive = false;
    room.revealHands = true;
    return true;
  }
  return false;
}

function calculateSidePots(room) {
  const contributions = room.players
    .filter((player) => player.totalBet > 0)
    .map((player) => ({
      id: player.id,
      totalBet: player.totalBet,
      folded: player.folded,
      seatIndex: player.seatIndex,
    }));
  if (contributions.length === 0) return [];

  const levels = [...new Set(contributions.map((c) => c.totalBet))].sort(
    (a, b) => a - b
  );
  const pots = [];
  let prevLevel = 0;

  levels.forEach((level) => {
    const eligible = contributions.filter((c) => c.totalBet >= level);
    const potAmount = (level - prevLevel) * eligible.length;
    if (potAmount > 0) {
      pots.push({
        amount: potAmount,
        eligible: eligible
          .filter((c) => !c.folded)
          .map((c) => c.id),
        seatOrder: eligible.map((c) => c.seatIndex),
      });
    }
    prevLevel = level;
  });

  return pots;
}

function resolveSidePots(room, contenders) {
  const pots = calculateSidePots(room);
  if (pots.length === 0) {
    room.handActive = false;
    return;
  }

  const contenderMap = new Map(contenders.map((p) => [p.id, p]));
  room.players.forEach((player) => {
    if (!player.folded) {
      player.status = "";
    }
  });

  pots.forEach((pot, index) => {
    const eligiblePlayers = pot.eligible
      .map((id) => contenderMap.get(id))
      .filter(Boolean);
    if (eligiblePlayers.length === 0) {
      return;
    }

    const bestRank = eligiblePlayers.reduce((best, player) => {
      if (!best) return player.bestHand;
      return compareHands(player.bestHand, best) > 0 ? player.bestHand : best;
    }, null);

    const winners = eligiblePlayers.filter(
      (player) => compareHands(player.bestHand, bestRank) === 0
    );

    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;

    winners
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .forEach((player) => {
        player.stack += share;
        if (remainder > 0) {
          player.stack += 1;
          remainder -= 1;
        }
        player.status = index === 0 ? "Wins main pot" : "Wins side pot";
      });
  });

  room.pot = 0;
  room.handActive = false;
}

function scheduleAdvance(room) {
  if (!room.handActive) return;
  if (room.advanceTimer) return;
  room.advanceTimer = setTimeout(() => {
    room.advanceTimer = null;
    if (!room.handActive) return;
    advanceStage(room);
    syncRoom(room);
  }, room.speedMs);
}

function advanceStage(room) {
  if (room.stage === "preflop") {
    room.community.push(dealCard(room), dealCard(room), dealCard(room));
    room.stage = "flop";
  } else if (room.stage === "flop") {
    room.community.push(dealCard(room));
    room.stage = "turn";
  } else if (room.stage === "turn") {
    room.community.push(dealCard(room));
    room.stage = "river";
  } else if (room.stage === "river") {
    showdown(room);
    return;
  }

  clearBets(room);
  const dealer = room.dealerIndex % room.players.length;
  room.currentPlayerIndex = nextActivePlayer(room, dealer);
  if (room.currentPlayerIndex === -1) {
    scheduleAdvance(room);
    return;
  }
  if (allActiveAllIn(room)) {
    scheduleAdvance(room);
  }
}

function handleAction(room, player, action, raiseTo = 0) {
  if (!room.handActive || room.players[room.currentPlayerIndex]?.id !== player.id) {
    return;
  }
  const callAmount = Math.max(0, room.currentBet - player.bet);
  player.status = "";

  if (action === "fold") {
    player.folded = true;
    player.status = "Folded";
  } else if (action === "check") {
    if (callAmount !== 0) return;
    player.status = "Check";
  } else if (action === "call") {
    commitBet(room, player, callAmount);
    player.status = callAmount > 0 ? "Call" : "Check";
  } else if (action === "raise") {
    const minRaiseTo = room.currentBet + room.minRaise;
    const desiredRaiseTo = Math.max(raiseTo, minRaiseTo, player.bet + callAmount);
    const raiseAmount = desiredRaiseTo - player.bet;
    commitBet(room, player, raiseAmount);
    room.currentBet = player.bet;
    room.minRaise = Math.max(room.minRaise, raiseAmount - callAmount);
    player.status = "Raise";
  }

  if (checkForHandEnd(room)) return;
  if (isBettingRoundComplete(room)) {
    scheduleAdvance(room);
    return;
  }

  const nextIndex = nextActivePlayer(room, room.currentPlayerIndex);
  if (nextIndex === -1) {
    advanceStage(room);
    return;
  }
  room.currentPlayerIndex = nextIndex;
}

function combinations(cards, size) {
  const result = [];
  const combo = [];
  function helper(start) {
    if (combo.length === size) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < cards.length; i += 1) {
      combo.push(cards[i]);
      helper(i + 1);
      combo.pop();
    }
  }
  helper(0);
  return result;
}

function bestHand(cards) {
  const allCombos = combinations(cards, 5);
  return allCombos.reduce((best, combo) => {
    const evaluated = evaluateFiveCard(combo);
    if (!best) return evaluated;
    return compareHands(evaluated, best) > 0 ? evaluated : best;
  }, null);
}

function evaluateFiveCard(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const rankCounts = {};
  ranks.forEach((rank) => {
    rankCounts[rank] = (rankCounts[rank] || 0) + 1;
  });
  const groups = Object.entries(rankCounts)
    .map(([rank, count]) => ({ rank: Number(rank), count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  const isFlush = suits.every((suit) => suit === suits[0]);
  const uniqueRanks = [...new Set(ranks)];
  let isStraight = false;
  let straightHigh = uniqueRanks[0];
  if (uniqueRanks.length === 5) {
    const high = uniqueRanks[0];
    const low = uniqueRanks[4];
    if (high - low === 4) {
      isStraight = true;
      straightHigh = high;
    } else if (
      uniqueRanks[0] === 14 &&
      uniqueRanks[1] === 5 &&
      uniqueRanks[4] === 2
    ) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  if (isFlush && isStraight) {
    return { rank: 8, kickers: [straightHigh] };
  }

  if (groups[0].count === 4) {
    const kicker = groups[1].rank;
    return { rank: 7, kickers: [groups[0].rank, kicker] };
  }

  if (groups[0].count === 3 && groups[1].count === 2) {
    return { rank: 6, kickers: [groups[0].rank, groups[1].rank] };
  }

  if (isFlush) {
    return { rank: 5, kickers: [...ranks] };
  }

  if (isStraight) {
    return { rank: 4, kickers: [straightHigh] };
  }

  if (groups[0].count === 3) {
    const kickers = groups
      .filter((g) => g.count === 1)
      .map((g) => g.rank)
      .sort((a, b) => b - a);
    return { rank: 3, kickers: [groups[0].rank, ...kickers] };
  }

  if (groups[0].count === 2 && groups[1].count === 2) {
    const highPair = Math.max(groups[0].rank, groups[1].rank);
    const lowPair = Math.min(groups[0].rank, groups[1].rank);
    const kicker = groups.find((g) => g.count === 1).rank;
    return { rank: 2, kickers: [highPair, lowPair, kicker] };
  }

  if (groups[0].count === 2) {
    const kickers = groups
      .filter((g) => g.count === 1)
      .map((g) => g.rank)
      .sort((a, b) => b - a);
    return { rank: 1, kickers: [groups[0].rank, ...kickers] };
  }

  return { rank: 0, kickers: [...ranks] };
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i += 1) {
    const diff = (a.kickers[i] || 0) - (b.kickers[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function showdown(room) {
  room.revealHands = true;
  const contenders = activePlayers(room).filter((p) => !p.folded);
  contenders.forEach((player) => {
    player.bestHand = bestHand([...player.hand, ...room.community]);
  });

  resolveSidePots(room, contenders);
}

function startHand(room) {
  const active = room.players.filter((player) => player.stack > 0);
  if (active.length < 2) {
    broadcast(room, { type: "INFO", payload: { text: "Need 2 players to start." } });
    room.handActive = false;
    room.stage = "idle";
    return;
  }
  resetHandState(room);
  room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
  postBlinds(room);
  dealHoleCards(room);
}

function newGame(room) {
  room.players.forEach((player) => {
    if (!room.carryOverBalances) {
      player.stack = room.initialStack;
    }
    player.bet = 0;
    player.totalBet = 0;
    player.folded = false;
    player.allIn = false;
    player.status = "";
    player.hand = [];
  });
  room.pot = 0;
  room.stage = "idle";
  room.handActive = false;
  room.revealHands = false;
}

wss.on("connection", (ws) => {
  const clientId = crypto.randomUUID();
  send(ws, { type: "WELCOME", payload: { id: clientId } });
  connections.set(ws, { playerId: clientId, roomId: null });

  ws.on("message", (raw) => {
    let message = null;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!message || !message.type) return;

    if (message.type === "JOIN") {
      const { name, roomId, hostKey } = message.payload || {};
      const room = getRoom(roomId || "lobby");
      if (room.players.length >= room.maxPlayers) {
        send(ws, { type: "INFO", payload: { text: "Table is full." } });
        return;
      }
      const seatIndex = availableSeat(room);
      if (seatIndex === -1) {
        send(ws, { type: "INFO", payload: { text: "Table is full." } });
        return;
      }

      const player = {
        id: clientId,
        name: (name || "Player").slice(0, 16),
        stack: room.initialStack,
        bet: 0,
        totalBet: 0,
        hand: [],
        folded: false,
        allIn: false,
        status: "",
        seatIndex,
        avatar: avatarGradients[seatIndex % avatarGradients.length],
        bestHand: null,
        needsProfile: true,
      };
      room.players.push(player);
      if (!room.hostId && hostKey && hostKey === HOST_PASSWORD) {
        room.hostId = clientId;
      }
      connections.set(ws, { playerId: clientId, roomId: room.id });
      broadcast(room, {
        type: "INFO",
        payload: { text: `${player.name} joined the table.` },
      });
      syncRoom(room);
      return;
    }

    const meta = connections.get(ws);
    if (!meta || !meta.roomId) return;
    const room = getRoom(meta.roomId);
    const player = room.players.find((p) => p.id === meta.playerId);
    if (!player) return;

    if (message.type === "START_HAND") {
      if (room.hostId !== player.id) {
        send(ws, { type: "INFO", payload: { text: "Only the host can start a hand." } });
        return;
      }
      if (!room.handActive) {
        startHand(room);
        syncRoom(room);
      }
      return;
    }

    if (message.type === "NEW_GAME") {
      if (room.hostId !== player.id) {
        send(ws, { type: "INFO", payload: { text: "Only the host can reset the game." } });
        return;
      }
      room.carryOverBalances = Boolean(message.payload?.carryOver);
      newGame(room);
      syncRoom(room);
      return;
    }

    if (message.type === "PLAYER_ACTION") {
      handleAction(room, player, message.payload?.action, message.payload?.raiseTo);
      syncRoom(room);
      return;
    }

    if (message.type === "SET_SPEED") {
      if (room.hostId !== player.id) {
        send(ws, { type: "INFO", payload: { text: "Only the host can set speed." } });
        return;
      }
      const requested = Number(message.payload?.speedMs);
      if (Number.isFinite(requested)) {
        room.speedMs = Math.min(Math.max(requested, 300), 2000);
        syncRoom(room);
      }
      return;
    }

    if (message.type === "SET_NAME") {
      const nextName = String(message.payload?.name || "").trim().slice(0, 16);
      if (nextName) {
        player.name = nextName;
        broadcast(room, {
          type: "INFO",
          payload: { text: `${player.name} updated their name.` },
        });
        syncRoom(room);
      }
      return;
    }

    if (message.type === "SET_PROFILE") {
      const nextName = String(message.payload?.name || "").trim().slice(0, 16);
      const nextAvatar = String(message.payload?.avatar || "").trim();
      if (nextName) {
        player.name = nextName;
      }
      if (nextAvatar) {
        player.avatar = nextAvatar;
      }
      player.needsProfile = false;
      syncRoom(room);
      return;
    }

    if (message.type === "SET_MAX_PLAYERS") {
      if (room.hostId !== player.id) {
        send(ws, { type: "INFO", payload: { text: "Only the host can change seats." } });
        return;
      }
      const requested = Number(message.payload?.maxPlayers);
      if (Number.isFinite(requested)) {
        room.maxPlayers = Math.min(Math.max(requested, 2), MAX_SEATS);
        syncRoom(room);
      }
      return;
    }

    if (message.type === "SET_INITIAL_STACK") {
      if (room.hostId !== player.id) {
        send(ws, { type: "INFO", payload: { text: "Only the host can set buy-in." } });
        return;
      }
      const requested = Number(message.payload?.initialStack);
      if (Number.isFinite(requested)) {
        room.initialStack = Math.min(Math.max(Math.floor(requested), 100), 10000);
        syncRoom(room);
      }
    }
  });

  ws.on("close", () => {
    const meta = connections.get(ws);
    connections.delete(ws);
    if (!meta || !meta.roomId) return;
    const room = getRoom(meta.roomId);
    const leaving = room.players.find((player) => player.id === meta.playerId);
    room.players = room.players.filter((player) => player.id !== meta.playerId);
    if (room.hostId === meta.playerId) {
      room.hostId = null;
    }
    if (room.players.length === 0) {
      rooms.delete(room.id);
      return;
    }
    if (leaving) {
      broadcast(room, {
        type: "INFO",
        payload: { text: `${leaving.name} left the table.` },
      });
    }
    if (room.handActive && room.players.length < 2) {
      room.handActive = false;
      room.stage = "idle";
    }
    if (room.handActive) {
      const current = room.players[room.currentPlayerIndex];
      if (!current || current.id === meta.playerId) {
        const nextIndex = nextActivePlayer(room, room.currentPlayerIndex ?? 0);
        room.currentPlayerIndex =
          nextIndex === -1 ? room.dealerIndex % room.players.length : nextIndex;
      }
    }
    syncRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Poker server running on http://localhost:${PORT}`);
});
