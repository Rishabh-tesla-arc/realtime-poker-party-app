import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_SERVER = "wss://poker-server-cenl.onrender.com";

const STAGE_LABELS = {
  idle: "Waiting",
  preflop: "Pre-Flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

const SUIT_MAP = {
  spades: "♠",
  hearts: "♥",
  clubs: "♣",
  diamonds: "♦",
};

const MAX_SEATS = 10;
const STORAGE_KEYS = {
  name: "poker.profile.name",
  color: "poker.profile.color",
  hostKey: "poker.host.key",
  maxPlayers: "poker.maxPlayers",
  role: "poker.role",
};
const colorOptions = [
  "#f4c35a",
  "#63d6ff",
  "#a7ff83",
  "#ff96f3",
  "#ffd27d",
  "#b4c8ff",
  "#ff8b8b",
  "#7ef5c5",
  "#8a1ff0",
  "#f06f2f",
];

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [roomId] = useState("lobby");
  const [playerName, setPlayerName] = useState(() => {
    if (typeof window === "undefined") return "Player";
    return window.localStorage.getItem(STORAGE_KEYS.name) || "Player";
  });
  const [hostKey, setHostKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return "";
  });
  const [socket, setSocket] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [clientId, setClientId] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [raiseAmount, setRaiseAmount] = useState(20);
  const [infoMessage, setInfoMessage] = useState("");
  const [localSpeed, setLocalSpeed] = useState(700);
  const [localMaxPlayers, setLocalMaxPlayers] = useState(() => {
    if (typeof window === "undefined") return 3;
    const stored = Number(window.localStorage.getItem(STORAGE_KEYS.maxPlayers));
    return Number.isFinite(stored) && stored >= 2 ? stored : 3;
  });
  const [compactControls, setCompactControls] = useState(false);
  const [localInitialStack, setLocalInitialStack] = useState(1000);
  const [carryOverBalances, setCarryOverBalances] = useState(true);
  const [showHandRankings, setShowHandRankings] = useState(false);
  const [roleChoice, setRoleChoice] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(STORAGE_KEYS.role) || "";
  });
  const [hostWaiting, setHostWaiting] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileColor, setProfileColor] = useState("");
  const [effects, setEffects] = useState([]);
  const reconnectTimer = useRef(null);
  const prevStateRef = useRef(null);
  const manualMaxPlayersRef = useRef(false);
  const autoConnectRef = useRef(false);

  const hero = useMemo(() => {
    if (!roomState || !clientId) return null;
    return roomState.players.find((player) => player.id === clientId) || null;
  }, [roomState, clientId]);

  const currentPlayer = useMemo(() => {
    if (!roomState) return null;
    return roomState.players[roomState.currentPlayerIndex] || null;
  }, [roomState]);

  useEffect(() => {
    if (!socket) return;
    socket.onopen = () => {
      setConnectionStatus("connected");
      socket.send(
        JSON.stringify({
          type: "JOIN",
          payload: {
            name: playerName || "Player",
            roomId,
            hostKey: hostKey || undefined,
          },
        })
      );
    };
    socket.onclose = () => {
      setConnectionStatus("disconnected");
      setRoomState(null);
      if (!reconnectTimer.current) {
        reconnectTimer.current = window.setTimeout(() => {
          reconnectTimer.current = null;
        }, 1000);
      }
    };
    socket.onerror = () => {
      setConnectionStatus("error");
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "WELCOME") {
        setClientId(message.payload.id);
      }
      if (message.type === "STATE") {
        setRoomState(message.payload);
        setHostWaiting(false);
        if (message.payload.minRaise) {
          setRaiseAmount((prev) => Math.max(prev, message.payload.minRaise));
        }
        if (message.payload.speedMs) {
          setLocalSpeed(message.payload.speedMs);
        }
        if (message.payload.maxPlayers && !manualMaxPlayersRef.current) {
          setLocalMaxPlayers(message.payload.maxPlayers);
        }
        if (message.payload.initialStack) {
          setLocalInitialStack(message.payload.initialStack);
        }
        if (typeof message.payload.carryOverBalances === "boolean") {
          setCarryOverBalances(message.payload.carryOverBalances);
        }
      }
      if (message.type === "INFO") {
        setInfoMessage(message.payload.text);
        if (message.payload.text === "Host not online.") {
          setHostWaiting(true);
        }
        window.setTimeout(() => setInfoMessage(""), 3000);
      }
    };
  }, [socket, playerName, roomId]);

  useEffect(() => {
    if (autoConnectRef.current) return;
    if (connectionStatus !== "disconnected") return;
    if (roomState) return;
    if (typeof window === "undefined") return;
    const storedRole = window.localStorage.getItem(STORAGE_KEYS.role) || "";
    const storedName = window.localStorage.getItem(STORAGE_KEYS.name) || "";
    const storedHostKey = window.localStorage.getItem(STORAGE_KEYS.hostKey) || "";
    if (!storedRole || !storedName) return;
    if (storedRole === "host" && !storedHostKey) return;
    autoConnectRef.current = true;
    setRoleChoice(storedRole);
    setPlayerName(storedName);
    if (storedRole === "host") {
      setHostKey(storedHostKey);
    }
    setTimeout(() => connect(), 0);
  }, [connectionStatus, roomState]);

  useEffect(() => {
    if (!roomState) return;
    const prev = prevStateRef.current;
    if (prev) {
      const nextEffects = [];
      roomState.players.forEach((player) => {
        const before = prev.players.find((p) => p.id === player.id);
        if (!before) return;
        const betDelta = player.bet - before.bet;
        if (betDelta > 0) {
          nextEffects.push({
            id: `${player.id}-bet-${Date.now()}`,
            seatIndex: player.seatIndex,
            amount: betDelta,
            type: "bet",
          });
        }
        const stackDelta = player.stack - before.stack;
        if (stackDelta > 0 && (player.status || "").toLowerCase().includes("win")) {
          nextEffects.push({
            id: `${player.id}-win-${Date.now()}`,
            seatIndex: player.seatIndex,
            amount: stackDelta,
            type: "win",
          });
        }
      });
      if (nextEffects.length) {
        setEffects((current) => [...current, ...nextEffects]);
        window.setTimeout(() => {
          setEffects((current) =>
            current.filter((item) => !nextEffects.some((e) => e.id === item.id))
          );
        }, 1400);
      }
    }
    prevStateRef.current = roomState;
  }, [roomState]);

  useEffect(() => {
    if (!hero) return;
    if (hero.needsProfile) {
      const storedName =
        typeof window === "undefined"
          ? ""
          : window.localStorage.getItem(STORAGE_KEYS.name) || "";
      const storedColor =
        typeof window === "undefined"
          ? ""
          : window.localStorage.getItem(STORAGE_KEYS.color) || "";
      if (storedName && storedColor) {
        sendAction("SET_PROFILE", { name: storedName, avatar: storedColor });
        setShowProfileModal(false);
        return;
      }
      setProfileName(hero.name || storedName || playerName);
      setProfileColor(hero.avatar || storedColor || "");
      setShowProfileModal(true);
    } else {
      setShowProfileModal(false);
    }
  }, [hero, playerName]);

  const connect = () => {
    if (socket) socket.close();
    setConnectionStatus("connecting");
    setSocket(new WebSocket(serverUrl));
  };

  const disconnect = () => {
    if (socket) socket.close();
    setConnectionStatus("disconnected");
    setRoomState(null);
    setHostWaiting(false);
    autoConnectRef.current = false;
    setRoleChoice("");
    setShowProfileModal(false);
    setShowHandRankings(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEYS.role);
    }
  };

  const sendAction = (type, payload = {}) => {
    if (!socket || connectionStatus !== "connected") return;
    socket.send(JSON.stringify({ type, payload }));
  };

  const callAmount = hero
    ? Math.max(0, roomState?.currentBet - hero.bet)
    : 0;

  const profileRequired = Boolean(hero?.needsProfile);
  const canAct =
    roomState?.handActive &&
    currentPlayer?.id === hero?.id &&
    !hero?.folded &&
    !profileRequired &&
    !roomState?.roundComplete;

  const raiseMax = hero ? hero.stack + hero.bet : 0;
  const minRaiseTo =
    roomState?.currentBet > 0
      ? roomState.currentBet + (roomState.minRaise || 0)
      : roomState?.minRaise || 10;

  useEffect(() => {
    if (!roomState) return;
    setRaiseAmount((prev) => {
      const clamped = Math.min(Math.max(prev, minRaiseTo), raiseMax || minRaiseTo);
      return Number.isFinite(clamped) ? clamped : minRaiseTo;
    });
  }, [roomState, minRaiseTo, raiseMax]);

  const isHost = roomState?.hostId === hero?.id;
  const canControlGame = isHost && !profileRequired;
  const maxPlayers = roomState?.maxPlayers ?? localMaxPlayers;
  const initialStack = roomState?.initialStack ?? localInitialStack;

  useEffect(() => {
    if (!roomState || !isHost || !manualMaxPlayersRef.current) return;
    if (roomState.maxPlayers !== localMaxPlayers) {
      sendAction("SET_MAX_PLAYERS", { maxPlayers: localMaxPlayers });
    }
  }, [roomState, isHost, localMaxPlayers]);

  const seats = useMemo(() => {
    const seatCount = Math.min(maxPlayers, MAX_SEATS);
    const filled = Array.from({ length: seatCount }, () => null);
    if (!roomState) return filled;
    roomState.players.forEach((player) => {
      if (player.seatIndex < seatCount) {
        filled[player.seatIndex] = player;
      }
    });
    return filled;
  }, [roomState, maxPlayers]);

  const seatPositions = useMemo(() => {
    const seatCount = seats.length || 1;
    const radiusX = 38;
    const radiusY = 42;
    return Array.from({ length: seatCount }, (_, index) => {
      const angle = Math.PI / 2 + (2 * Math.PI * index) / seatCount;
      const left = 50 + Math.cos(angle) * radiusX;
      const top = 50 + Math.sin(angle) * radiusY;
      return { left: `${left}%`, top: `${top}%` };
    });
  }, [seats.length]);

  return (
    <div className="app">
      {!roomState && !autoConnectRef.current && (
        <div className="role-screen">
          <div className="role-card">
            <div className="role-title">Royal Felt Poker</div>
            <div className="role-subtitle">Choose your role to join</div>
            <div className="role-toggle">
              <button
                className={`btn ${roleChoice === "host" ? "btn-primary" : ""}`}
                onClick={() => {
                  setRoleChoice("host");
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem(STORAGE_KEYS.role, "host");
                  }
                }}
              >
                Host
              </button>
              <button
                className={`btn ${roleChoice === "player" ? "btn-primary" : ""}`}
                onClick={() => {
                  setRoleChoice("player");
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem(STORAGE_KEYS.role, "player");
                  }
                }}
              >
                Player
              </button>
            </div>
            {roleChoice && (
              <div className="role-form">
                <label>
                  Name
                  <input
                    value={playerName}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPlayerName(value);
                      if (typeof window !== "undefined") {
                        window.localStorage.setItem(STORAGE_KEYS.name, value);
                      }
                    }}
                    placeholder="Enter name"
                  />
                </label>
                {roleChoice === "host" && (
                  <label>
                    Host Key
                    <input
                      value={hostKey}
                      onChange={(event) => {
                        const value = event.target.value;
                        setHostKey(value);
                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(STORAGE_KEYS.hostKey, value);
                        }
                      }}
                      placeholder="Enter host key"
                    />
                  </label>
                )}
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem(STORAGE_KEYS.role, roleChoice);
                      window.localStorage.setItem(STORAGE_KEYS.name, playerName);
                    }
                    connect();
                  }}
                  disabled={!playerName.trim() || (roleChoice === "host" && !hostKey)}
                >
                  Connect
                </button>
              </div>
            )}
            <div className="status-chip status-disconnected">
              <span className="status-dot" />
              {connectionStatus}
            </div>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">Royal Felt Poker</span>
          <span className="brand-subtitle">Multiplayer Texas Hold'em</span>
        </div>
        <div className="controls">
          {(!roomState || isHost) && false && (
            <>
              <label className="control">
                Name
                <input
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                />
              </label>
              <label className="control">
                Host Key
                <input
                  value={hostKey}
                  onChange={(event) => {
                    const value = event.target.value;
                    setHostKey(value);
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem(STORAGE_KEYS.hostKey, value);
                    }
                  }}
                  placeholder="Optional"
                />
              </label>
              <button className="btn btn-primary" onClick={connect}>
                {connectionStatus === "connected" ? "Reconnect" : "Connect"}
              </button>
            </>
          )}
          <div className={`status-chip status-${connectionStatus}`}>
            <span className="status-dot" />
            {connectionStatus}
          </div>
          {connectionStatus === "connected" && (
            <button className="btn btn-ghost" onClick={disconnect}>
              Disconnect
            </button>
          )}
        </div>
      </header>

      {hostWaiting && (
        <div className="host-wait">
          <div className="host-wait-card">
            <h2>Waiting for the host</h2>
            <p>The table will open once the host joins with the host key.</p>
            <p className="rotate-hint">Tip: Rotate to landscape for a better view.</p>
          </div>
        </div>
      )}

      <main className="table-layout">
        <section className="table-wrap">
          <div className="table">
            <div className="table-sheen" />
            <div className="board">
              <div className="pot">
                <span className="label">Pot</span>
                <span className="value">${roomState?.pot ?? 0}</span>
                {(roomState?.sidePots || []).map((pot, index) => (
                  <span key={index} className="side-pot">
                    Side pot {index + 1}: ${pot.amount}
                  </span>
                ))}
              </div>
              <div className="community-cards">
                {(roomState?.community || []).map((card) => (
                  <div
                    key={`${card.suit}-${card.rank}`}
                    className={`card ${
                      card.suit === "hearts" || card.suit === "diamonds" ? "red" : ""
                    }`}
                    data-rank={card.label}
                  >
                    <span className="suit">{SUIT_MAP[card.suit]}</span>
                  </div>
                ))}
              </div>
              <div className="betting-banner">
                {roomState ? STAGE_LABELS[roomState.stage] : "Waiting"}
              </div>
            </div>

            <div className="seats">
              {seats.map((player, index) => {
                if (!player) {
                  return (
                    <div
                      key={index}
                      className={`seat seat-${index}`}
                      style={seatPositions[index]}
                    >
                      <div className="player empty">
                        <div className="avatar muted" />
                        <div className="player-info">
                          <span className="player-name">Empty Seat</span>
                          <span className="player-stack">--</span>
                        </div>
                        <div className="player-status">Waiting...</div>
                      </div>
                    </div>
                  );
                }

                const reveal =
                  player.id === hero?.id ||
                  roomState?.revealHands ||
                  !roomState?.handActive;
                    const showBacks = !reveal && !player.folded;
                const isDealer = roomState?.dealerIndex === player.seatIndex;
                const isBetting =
                  roomState?.handActive && currentPlayer?.id === player.id;
                const seatEffects = effects.filter(
                  (item) => item.seatIndex === player.seatIndex
                );

                return (
                  <div
                    key={player.id}
                    className={`seat seat-${index}`}
                    style={seatPositions[index]}
                  >
                    <div
                      className={`player ${
                        roomState?.handActive && currentPlayer?.id === player.id
                          ? "active"
                          : ""
                      }`}
                    >
                      <div className="avatar" style={{ background: player.avatar }} />
                      <div className="player-info">
                        <span className={`player-name ${isBetting ? "betting" : ""}`}>
                          {player.name}
                          {isBetting && <span className="betting-dot" />}
                        </span>
                        <span className="player-stack">${player.stack}</span>
                      </div>
                      <div className="player-tags">
                        {player.id === hero?.id && (
                          <span className="player-tag">You</span>
                        )}
                        {isDealer && <span className="player-tag gold">Dealer</span>}
                        {player.allIn && <span className="player-tag red">All In</span>}
                      </div>
                      <div className="player-bet">
                        {player.bet > 0 ? `Bet: $${player.bet}` : ""}
                      </div>
                      <div className="player-cards">
                        {isBetting &&
                          player.hand.map((card, idx) =>
                            showBacks ? (
                              <div key={idx} className="card back" />
                            ) : (
                              <div
                                key={`${card.suit}-${card.rank}`}
                                className={`card ${
                                  card.suit === "hearts" ||
                                  card.suit === "diamonds"
                                    ? "red"
                                    : ""
                                }`}
                                data-rank={card.label}
                              >
                                <span className="suit">{SUIT_MAP[card.suit]}</span>
                              </div>
                            )
                          )}
                      </div>
                      <div className="player-status">{player.status}</div>
                      {seatEffects.map((effect) => (
                        <div key={effect.id} className={`float-amount ${effect.type}`}>
                          {effect.type === "bet"
                            ? `-$${effect.amount}`
                            : `+$${effect.amount}`}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="side-panel">
          {isHost ? (
            !roomState?.handActive && (
              <>
                <div className="panel-card">
                  <div className="panel-title">Table Info</div>
                  <div className="panel-row">
                    <span>Room</span>
                    <span>{roomId}</span>
                  </div>
                  <div className="panel-row">
                    <span>Players</span>
                    <span>{roomState?.players.length || 0}/{maxPlayers}</span>
                  </div>
                  <div className="panel-row">
                    <span>Blinds</span>
                    <span>$5 / $10</span>
                  </div>
                  <div className="panel-row">
                    <span>Buy-in</span>
                    <span>${initialStack}</span>
                  </div>
                  <div className="panel-row">
                    <span>Game Speed</span>
                    <span>{localSpeed} ms</span>
                  </div>
                  <div className="panel-row">
                    <span>Seats</span>
                    <span>{maxPlayers}</span>
                  </div>
                  <div className="speed-control">
                    <input
                      type="range"
                      min="2"
                      max="10"
                      step="1"
                      value={localMaxPlayers}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        manualMaxPlayersRef.current = true;
                        setLocalMaxPlayers(value);
                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(
                            STORAGE_KEYS.maxPlayers,
                            String(value)
                          );
                        }
                        if (isHost) {
                          sendAction("SET_MAX_PLAYERS", { maxPlayers: value });
                        }
                      }}
                      disabled={!canControlGame}
                    />
                    <span className="speed-hint">
                      {isHost ? "Host controls seats" : "Host controls seats"}
                    </span>
                  </div>
                  <div className="name-editor">
                    <input
                      type="number"
                      min="100"
                      max="10000"
                      step="100"
                      value={localInitialStack}
                      onChange={(event) =>
                        setLocalInitialStack(Number(event.target.value))
                      }
                      placeholder="Buy-in"
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() =>
                        sendAction("SET_INITIAL_STACK", { initialStack: localInitialStack })
                      }
                      disabled={!canControlGame}
                    >
                      Set Buy-in
                    </button>
                  </div>
                  <div className="speed-control">
                    <input
                      type="range"
                      min="300"
                      max="2000"
                      step="100"
                      value={localSpeed}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setLocalSpeed(value);
                        if (isHost) {
                          sendAction("SET_SPEED", { speedMs: value });
                        }
                      }}
                      disabled={!canControlGame}
                    />
                    <span className="speed-hint">
                      {isHost ? "Host controls speed" : "Host controls speed"}
                    </span>
                  </div>
                  <div className="panel-row">
                    <span>Your Name</span>
                    <span>{hero?.name || playerName}</span>
                  </div>
                  <div className="name-editor">
                    <input
                      value={playerName}
                      onChange={(event) => setPlayerName(event.target.value)}
                      placeholder="Enter name"
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() => sendAction("SET_NAME", { name: playerName })}
                      disabled={!hero || profileRequired}
                    >
                      Update
                    </button>
                  </div>
                </div>
                <div className="panel-card">
                  <div className="panel-title">Hand Rankings</div>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setShowHandRankings(true)}
                  >
                    View
                  </button>
                </div>
              </>
            )
          ) : (
            <div className="panel-card">
              <div className="panel-title">Hand Rankings</div>
              <button
                className="btn btn-ghost"
                onClick={() => setShowHandRankings(true)}
              >
                View
              </button>
            </div>
          )}
        </aside>
      </main>

      <section className={`action-panel ${compactControls ? "compact" : ""}`}>
        <div className="action-info">
          <div className="turn-indicator">
            {connectionStatus !== "connected"
              ? "Connect to join a table."
              : roomState?.handActive
              ? currentPlayer?.id === hero?.id
                ? "Your turn - make your move."
                : `${currentPlayer?.name || "Player"} is thinking...`
              : "Waiting to start next hand."}
          </div>
          <div className="chip-rail">
            <span className="chip chip-red" />
            <span className="chip chip-blue" />
            <span className="chip chip-gold" />
            <span className="chip chip-black" />
          </div>
          <div className="status-pill">
            {infoMessage || `Players: ${roomState?.players.length || 0}/${maxPlayers}`}
          </div>
        </div>
        <div className="actions">
          <button
            className="btn btn-ghost compact-toggle"
            onClick={() => setCompactControls((prev) => !prev)}
          >
            {compactControls ? "Expand Controls" : "Minimize Controls"}
          </button>
          {isHost && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={carryOverBalances}
                onChange={(event) => setCarryOverBalances(event.target.checked)}
                disabled={!canControlGame}
              />
              <span>Keep balances</span>
            </label>
          )}
          {isHost && roomState?.handActive && roomState?.roundComplete && (
            <button
              className="btn btn-primary"
              onClick={() => sendAction("ADVANCE_ROUND")}
              disabled={!canControlGame}
            >
              Continue Round
            </button>
          )}
          <div className={`control-group ${compactControls ? "compact" : ""}`}>
            <button
              className="btn btn-danger"
              disabled={!canAct}
              onClick={() => sendAction("PLAYER_ACTION", { action: "fold" })}
            >
              Fold
            </button>
            <button
              className="btn"
              disabled={!canAct || callAmount !== 0}
              onClick={() => sendAction("PLAYER_ACTION", { action: "check" })}
            >
              Check
            </button>
            <button
              className="btn btn-primary"
              disabled={!canAct || callAmount === 0}
              onClick={() => sendAction("PLAYER_ACTION", { action: "call" })}
            >
              Call {callAmount > 0 ? `$${callAmount}` : ""}
            </button>
            <div className="raise-group">
              <input
                type="range"
                min={minRaiseTo}
                max={Math.max(raiseMax, 20)}
                step="5"
                value={raiseAmount}
                onChange={(event) => setRaiseAmount(Number(event.target.value))}
                disabled={!canAct}
              />
              <button
                className="btn btn-accent"
                disabled={!canAct}
                onClick={() =>
                  sendAction("PLAYER_ACTION", {
                    action: "raise",
                    raiseTo: raiseAmount,
                  })
                }
              >
                Raise
              </button>
              <span className="raise-value">to ${raiseAmount}</span>
            </div>
          </div>
          {isHost && !roomState?.handActive && (
            <>
              <button
                className="btn"
                onClick={() => sendAction("NEW_GAME", { carryOver: carryOverBalances })}
                disabled={!canControlGame}
              >
                New Game
              </button>
            </>
          )}
        </div>
      </section>

      

      {showProfileModal && (
        <div className="rules-modal">
          <div className="rules-modal-card">
            <div className="rules-modal-header">
              <span>Choose Your Profile</span>
            </div>
            <div className="profile-form">
              <label>
                Name
                <input
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder="Enter your name"
                />
              </label>
              <div className="profile-colors">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    className={`color-swatch ${profileColor === color ? "active" : ""}`}
                    style={{ background: color }}
                    onClick={() => setProfileColor(color)}
                  />
                ))}
              </div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem(STORAGE_KEYS.name, profileName.trim());
                    window.localStorage.setItem(STORAGE_KEYS.color, profileColor);
                  }
                  sendAction("SET_PROFILE", { name: profileName, avatar: profileColor });
                }}
                disabled={!profileName.trim() || !profileColor}
              >
                Save & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {showHandRankings && (
        <div className="rules-modal" onClick={() => setShowHandRankings(false)}>
          <div className="rules-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="rules-modal-header">
              <span>Hand Rankings</span>
              <button className="btn btn-ghost" onClick={() => setShowHandRankings(false)}>
                Close
              </button>
            </div>
            <img
              src="/images.png"
              alt="Poker hand rankings reference"
              className="rules-image"
            />
          </div>
        </div>
      )}

      <footer className="footer">
        <span>
          {roomState?.hostId === hero?.id
            ? "You are the host. Start a new hand when everyone is ready."
            : "Join with friends on the same Wi-Fi to play together."}
        </span>
      </footer>

    </div>
  );
}
