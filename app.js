const seatNodes = Array.from(document.querySelectorAll(".seat"));
const playerCountSelect = document.getElementById("playerCount");
const newGameBtn = document.getElementById("newGameBtn");
const nextHandBtn = document.getElementById("nextHandBtn");
const communityCardsEl = document.getElementById("communityCards");
const potValueEl = document.getElementById("potValue");
const roundLabelEl = document.getElementById("roundLabel");
const turnIndicatorEl = document.getElementById("turnIndicator");
const foldBtn = document.getElementById("foldBtn");
const checkBtn = document.getElementById("checkBtn");
const callBtn = document.getElementById("callBtn");
const raiseBtn = document.getElementById("raiseBtn");
const raiseAmountInput = document.getElementById("raiseAmount");
const raiseValueEl = document.getElementById("raiseValue");

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

const HAND_NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
];

const BLINDS = { small: 5, big: 10 };

const state = {
  players: [],
  deck: [],
  community: [],
  pot: 0,
  dealerIndex: 0,
  currentPlayerIndex: 0,
  currentBet: 0,
  minRaise: BLINDS.big,
  stage: "idle",
  handActive: false,
  revealHands: false,
};

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

function setupPlayers(count) {
  const avatarGradients = [
    "linear-gradient(135deg, #f4c35a, #ec6b67)",
    "linear-gradient(135deg, #63d6ff, #4b79ff)",
    "linear-gradient(135deg, #a7ff83, #3aa158)",
    "linear-gradient(135deg, #ff96f3, #9f4bf0)",
    "linear-gradient(135deg, #ffd27d, #ff8d4f)",
    "linear-gradient(135deg, #b4c8ff, #5353ff)",
  ];

  state.players = Array.from({ length: count }, (_, index) => ({
    id: index,
    name: index === 0 ? "You" : `Player ${index + 1}`,
    stack: 1000,
    bet: 0,
    hand: [],
    folded: false,
    allIn: false,
    status: "",
    isHero: index === 0,
    avatar: avatarGradients[index % avatarGradients.length],
    bestHand: null,
  }));

  seatNodes.forEach((seat, index) => {
    seat.style.display = index < count ? "block" : "none";
  });
}

function resetHandState() {
  state.deck = createDeck();
  state.community = [];
  state.pot = 0;
  state.currentBet = 0;
  state.minRaise = BLINDS.big;
  state.stage = "preflop";
  state.handActive = true;
  state.revealHands = false;
  state.players.forEach((player) => {
    player.bet = 0;
    player.hand = [];
    player.folded = false;
    player.allIn = false;
    player.status = "";
    player.bestHand = null;
  });
}

function dealCard() {
  return state.deck.pop();
}

function dealHoleCards() {
  for (let i = 0; i < 2; i += 1) {
    state.players.forEach((player) => {
      if (player.stack > 0) {
        player.hand.push(dealCard());
      }
    });
  }
}

function postBlinds() {
  const count = state.players.length;
  const dealer = state.dealerIndex % count;
  const smallBlind = (dealer + 1) % count;
  const bigBlind = (dealer + 2) % count;

  applyForcedBet(state.players[smallBlind], BLINDS.small, "Small Blind");
  applyForcedBet(state.players[bigBlind], BLINDS.big, "Big Blind");

  state.currentBet = BLINDS.big;
  state.minRaise = BLINDS.big;
  state.currentPlayerIndex = (bigBlind + 1) % count;
}

function applyForcedBet(player, amount, label) {
  const betAmount = Math.min(amount, player.stack);
  player.stack -= betAmount;
  player.bet += betAmount;
  player.status = label;
  if (player.stack === 0) {
    player.allIn = true;
  }
  state.pot += betAmount;
}

function nextActivePlayer(fromIndex) {
  const count = state.players.length;
  let idx = fromIndex;
  for (let i = 0; i < count; i += 1) {
    idx = (idx + 1) % count;
    const player = state.players[idx];
    if (!player.folded && player.stack + player.bet > 0 && !player.allIn) {
      return idx;
    }
  }
  return -1;
}

function activePlayers() {
  return state.players.filter((p) => !p.folded && (p.stack + p.bet > 0));
}

function commitBet(player, amount) {
  const betAmount = Math.min(amount, player.stack);
  player.stack -= betAmount;
  player.bet += betAmount;
  state.pot += betAmount;
  if (player.stack === 0) {
    player.allIn = true;
  }
}

function handleAction(player, action, raiseTo = 0) {
  if (!state.handActive) return;

  const callAmount = Math.max(0, state.currentBet - player.bet);
  player.status = "";

  if (action === "fold") {
    player.folded = true;
    player.status = "Folded";
  } else if (action === "check") {
    if (callAmount === 0) {
      player.status = "Check";
    } else {
      return;
    }
  } else if (action === "call") {
    commitBet(player, callAmount);
    player.status = callAmount > 0 ? "Call" : "Check";
  } else if (action === "raise") {
    const minRaiseTo = state.currentBet + state.minRaise;
    const desiredRaiseTo = Math.max(raiseTo, minRaiseTo, player.bet + callAmount);
    const raiseAmount = desiredRaiseTo - player.bet;
    commitBet(player, raiseAmount);
    state.currentBet = player.bet;
    state.minRaise = Math.max(state.minRaise, raiseAmount - callAmount);
    player.status = "Raise";
  }

  render();
  if (checkForHandEnd()) return;

  if (isBettingRoundComplete()) {
    advanceStage();
    return;
  }

  moveToNextTurn();
}

function isBettingRoundComplete() {
  const active = activePlayers();
  if (active.length <= 1) return true;
  return active.every((player) => player.allIn || player.bet === state.currentBet);
}

function clearBets() {
  state.players.forEach((player) => {
    player.bet = 0;
    player.status = "";
  });
  state.currentBet = 0;
  state.minRaise = BLINDS.big;
}

function advanceStage() {
  if (state.stage === "preflop") {
    state.community.push(dealCard(), dealCard(), dealCard());
    state.stage = "flop";
  } else if (state.stage === "flop") {
    state.community.push(dealCard());
    state.stage = "turn";
  } else if (state.stage === "turn") {
    state.community.push(dealCard());
    state.stage = "river";
  } else if (state.stage === "river") {
    showdown();
    return;
  }

  clearBets();
  const dealer = state.dealerIndex % state.players.length;
  state.currentPlayerIndex = nextActivePlayer(dealer);
  render();
  if (allActiveAllIn()) {
    window.setTimeout(() => advanceStage(), 700);
    return;
  }
  moveToNextTurn();
}

function checkForHandEnd() {
  const remaining = activePlayers().filter((p) => !p.folded);
  if (remaining.length === 1) {
    const winner = remaining[0];
    winner.stack += state.pot;
    winner.status = "Wins pot";
    state.pot = 0;
    state.handActive = false;
    state.revealHands = true;
    turnIndicatorEl.textContent = `${winner.name} wins uncontested.`;
    render();
    return true;
  }
  return false;
}

function showdown() {
  state.revealHands = true;
  const contenders = activePlayers().filter((p) => !p.folded);
  contenders.forEach((player) => {
    player.bestHand = bestHand([...player.hand, ...state.community]);
  });

  const bestRank = contenders.reduce((best, player) => {
    if (!best) return player.bestHand;
    return compareHands(player.bestHand, best) > 0 ? player.bestHand : best;
  }, null);

  const winners = contenders.filter(
    (player) => compareHands(player.bestHand, bestRank) === 0
  );

  const share = Math.floor(state.pot / winners.length);
  winners.forEach((player) => {
    player.stack += share;
    player.status = `Wins ${HAND_NAMES[player.bestHand.rank]}`;
  });
  state.pot = 0;
  state.handActive = false;
  turnIndicatorEl.textContent =
    winners.length === 1
      ? `${winners[0].name} wins with ${HAND_NAMES[winners[0].bestHand.rank]}.`
      : `Split pot: ${winners.map((w) => w.name).join(", ")}.`;
  render();
}

function moveToNextTurn() {
  const nextIndex = nextActivePlayer(state.currentPlayerIndex);
  if (nextIndex === -1) {
    advanceStage();
    return;
  }
  state.currentPlayerIndex = nextIndex;
  render();

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer.isHero) {
    window.setTimeout(() => aiAct(currentPlayer), 700);
  }
}

function aiAct(player) {
  if (!state.handActive) return;
  const callAmount = Math.max(0, state.currentBet - player.bet);
  const aggression = Math.random();

  if (callAmount === 0) {
    if (aggression > 0.82 && player.stack > state.minRaise * 2) {
      const raiseTo = state.currentBet + state.minRaise * 2;
      handleAction(player, "raise", raiseTo);
    } else {
      handleAction(player, "check");
    }
    return;
  }

  const scaryBet = callAmount > player.stack * 0.6;
  if (scaryBet && aggression > 0.4) {
    handleAction(player, "fold");
    return;
  }

  if (aggression > 0.9 && player.stack > state.minRaise * 2) {
    const raiseTo = state.currentBet + state.minRaise * 2;
    handleAction(player, "raise", raiseTo);
  } else {
    handleAction(player, "call");
  }
}

function updateRaiseSlider() {
  const hero = state.players[0];
  if (!hero) return;
  const maxRaise = hero.stack + hero.bet;
  raiseAmountInput.max = Math.max(maxRaise, BLINDS.big * 2);
  raiseAmountInput.min = state.minRaise;
  if (parseInt(raiseAmountInput.value, 10) < state.minRaise) {
    raiseAmountInput.value = state.minRaise;
  }
  raiseValueEl.textContent = `$${raiseAmountInput.value}`;
}

function renderCommunity() {
  communityCardsEl.innerHTML = "";
  state.community.forEach((card) => {
    communityCardsEl.appendChild(renderCard(card));
  });
}

function renderCard(card, hidden = false) {
  const cardEl = document.createElement("div");
  cardEl.className = "card";
  if (hidden) {
    cardEl.classList.add("back");
    return cardEl;
  }

  const suitChar = suitSymbol(card.suit);
  cardEl.dataset.rank = card.label;
  cardEl.innerHTML = `<span class="suit">${suitChar}</span>`;
  if (card.suit === "hearts" || card.suit === "diamonds") {
    cardEl.classList.add("red");
  }
  return cardEl;
}

function renderSeats() {
  seatNodes.forEach((seat, index) => {
    const player = state.players[index];
    if (!player) return;
    const playerEl = seat.querySelector(".player");
    const avatarEl = seat.querySelector(".avatar");
    const nameEl = seat.querySelector(".player-name");
    const stackEl = seat.querySelector(".player-stack");
    const betEl = seat.querySelector(".player-bet");
    const cardsEl = seat.querySelector(".player-cards");
    const statusEl = seat.querySelector(".player-status");

    avatarEl.style.background = player.avatar;
    nameEl.textContent = player.name;
    stackEl.textContent = `$${player.stack}`;
    betEl.textContent = player.bet > 0 ? `Bet: $${player.bet}` : "";
    statusEl.textContent = player.status || "";

    playerEl.classList.toggle(
      "active",
      state.handActive && index === state.currentPlayerIndex
    );

    cardsEl.innerHTML = "";
    const shouldReveal =
      player.isHero || state.revealHands || player.folded || !state.handActive;
    player.hand.forEach((card) => {
      cardsEl.appendChild(renderCard(card, !shouldReveal));
    });
  });
}

function renderPot() {
  potValueEl.textContent = `$${state.pot}`;
}

function renderButtons() {
  const hero = state.players[0];
  const heroTurn =
    state.handActive && state.players[state.currentPlayerIndex]?.isHero;
  const callAmount = hero ? Math.max(0, state.currentBet - hero.bet) : 0;

  foldBtn.disabled = !heroTurn;
  checkBtn.disabled = !heroTurn || callAmount !== 0;
  callBtn.disabled = !heroTurn || callAmount === 0;
  raiseBtn.disabled = !heroTurn || hero.stack === 0;

  callBtn.textContent = callAmount > 0 ? `Call $${callAmount}` : "Call";
  updateRaiseSlider();
}

function renderRound() {
  const label = state.stage.replace(/^\w/, (c) => c.toUpperCase());
  roundLabelEl.textContent = state.handActive ? label : "Hand Complete";
}

function renderTurnIndicator() {
  if (!state.handActive) return;
  const player = state.players[state.currentPlayerIndex];
  if (!player) return;
  turnIndicatorEl.textContent = player.isHero
    ? "Your turn - make your move."
    : `${player.name} is thinking...`;
}

function render() {
  renderCommunity();
  renderSeats();
  renderPot();
  renderButtons();
  renderRound();
  renderTurnIndicator();
}

function startHand() {
  resetHandState();
  state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
  postBlinds();
  dealHoleCards();
  render();
  moveToNextTurn();
}

function newGame() {
  const count = parseInt(playerCountSelect.value, 10);
  setupPlayers(count);
  state.dealerIndex = count - 1;
  startHand();
}

function suitSymbol(suit) {
  if (suit === "spades") return "♠";
  if (suit === "hearts") return "♥";
  if (suit === "clubs") return "♣";
  return "♦";
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

function allActiveAllIn() {
  const remaining = activePlayers().filter((p) => !p.folded);
  return remaining.length > 1 && remaining.every((p) => p.allIn);
}

newGameBtn.addEventListener("click", newGame);
nextHandBtn.addEventListener("click", startHand);

foldBtn.addEventListener("click", () => {
  handleAction(state.players[0], "fold");
});

checkBtn.addEventListener("click", () => {
  handleAction(state.players[0], "check");
});

callBtn.addEventListener("click", () => {
  handleAction(state.players[0], "call");
});

raiseBtn.addEventListener("click", () => {
  const raiseValue = parseInt(raiseAmountInput.value, 10);
  const raiseTo = state.currentBet === 0 ? raiseValue : state.currentBet + raiseValue;
  handleAction(state.players[0], "raise", raiseTo);
});

raiseAmountInput.addEventListener("input", () => {
  raiseValueEl.textContent = `$${raiseAmountInput.value}`;
});

newGame();
