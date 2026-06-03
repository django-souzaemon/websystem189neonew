const GameEngine = require('./gameEngine');
const activeTimers = {};

module.exports = (io, socket, rooms) => {
  
  // 💡 【大修正】通信時の引数を正確に受け取り、gameEngineに渡す！
  socket.on('join_room', ({ roomId, userName, requestedRole, userId, aiLevel }) => {
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = new GameEngine();
    const game = rooms[roomId];

    const { role, seat } = game.joinRoom(socket.id, userName, requestedRole || 'player', userId, aiLevel);
    console.log(`[${role}] ${userName} が部屋 ${roomId} に入室しました。`);

    if (game.players.length === 4 && game.status === 'WAITING') {
      game.startGame();
      startServerTurnTimer(io, rooms, roomId, game);
    }
    broadcastState(io, roomId, game);
  });

  socket.on('add_npc', ({ roomId, level }) => {
    const game = rooms[roomId];
    if (!game || game.status !== 'WAITING') return;

    if (game.players.length < 4) {
      game.fillWithCPU(1, level);
      if (game.players.length === 4) {
        game.startGame();
        startServerTurnTimer(io, rooms, roomId, game);
      }
      broadcastState(io, roomId, game);
    }
  });

  socket.on('update_room_settings', ({ roomId, userId, enabledLocalYaku }) => {
    const game = rooms[roomId];
    if (!game || game.status !== 'WAITING') return;
    game.updateLocalYaku(userId, enabledLocalYaku);
    broadcastState(io, roomId, game);
  });

  socket.on('toggle_auto_pass', ({ roomId, userId, isChecked }) => {
    const game = rooms[roomId];
    if (!game) return;
    game.updateAutoPassConfig(userId, isChecked);
    if (game.status === 'PENDING_ACTION') {
      const myPending = game.pendingActions.find(a => a.seat === game.players.find(p=>p.userId===userId)?.seat);
      if (myPending && (myPending.type === 'PON' || myPending.type === 'CHI')) {
        game.handleActionResponse(myPending.seat, 'PASS');
      }
    }
    broadcastState(io, roomId, game);
  });

  socket.on('discard_tile', ({ roomId, tileIndex }) => {
    const game = rooms[roomId];
    if (!game) return;
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;

    if (game.status !== 'PLAYING' || game.currentTurn !== player.seat) {
      broadcastState(io, roomId, game); 
      return;
    }

    game.processDiscard(game.currentTurn, tileIndex);
    checkAndEnforceAutoNextRound(io, rooms, roomId, game);
  });

  socket.on('take_action', ({ roomId, action }) => {
    const game = rooms[roomId];
    if (!game || game.status !== 'PENDING_ACTION') return;

    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;

    const exactActionType = typeof action === 'object' ? action.type : action;
    if (exactActionType && exactActionType !== 'SKIP' && exactActionType !== 'PASS') {
      io.to(roomId).emit('action_effect', { seat: player.seat, actionType: exactActionType, playerName: player.name });
    }

    game.handleActionResponse(player.seat, action);
    checkAndEnforceAutoNextRound(io, rooms, roomId, game);
  });

  socket.on('next_round', ({ roomId }) => {
    const game = rooms[roomId];
    if (!game || game.status !== 'FINISHED') return;
    game.advanceToNextKyoku();
    startServerTurnTimer(io, rooms, roomId, game);
    broadcastState(io, roomId, game);
  });

  socket.on('reset_game', ({ roomId }) => {
    if (rooms[roomId]) delete rooms[roomId];
    if (activeTimers[roomId]) { clearInterval(activeTimers[roomId]); delete activeTimers[roomId]; }
    io.to(roomId).emit('room_reset_enforced');
  });

  socket.on('cheat_exhaustive_draw', ({ roomId }) => {
    const game = rooms[roomId];
    if (!game) return;
    game.forceExhaustiveDraw();
    checkAndEnforceAutoNextRound(io, rooms, roomId, game);
  });

  socket.on('cheat_win_hand', ({ roomId }) => {
    const game = rooms[roomId];
    if (!game) return;
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;
    game.forceSetupCheatHand(player.seat);
    checkAndEnforceAutoNextRound(io, rooms, roomId, game);
  });
};

function checkAndEnforceAutoNextRound(io, rooms, roomId, game) {
  if (game.status === 'FINISHED') {
    if (activeTimers[roomId]) clearInterval(activeTimers[roomId]);
    if (game.nextRoundTimeout) clearTimeout(game.nextRoundTimeout);

    broadcastState(io, roomId, game);

    game.nextRoundTimeout = setTimeout(() => {
      if (rooms && rooms[roomId] && rooms[roomId].status === 'FINISHED') {
        rooms[roomId].advanceToNextKyoku();
        startServerTurnTimer(io, rooms, roomId, rooms[roomId]);
        broadcastState(io, roomId, rooms[roomId]);
      }
    }, 8000); 
  } else {
    startServerTurnTimer(io, rooms, roomId, game);
    broadcastState(io, roomId, game);
  }
}

function startServerTurnTimer(io, rooms, roomId, game) {
  if (activeTimers[roomId]) clearInterval(activeTimers[roomId]);
  if (typeof game.cpuWait === 'undefined') game.cpuWait = 0;

  activeTimers[roomId] = setInterval(() => {
    if (game.status === 'FINISHED' || game.status === 'GAME_OVER' || game.status === 'WAITING') {
      clearInterval(activeTimers[roomId]);
      return;
    }

    let isNpcTurn = false;
    if (game.status === 'PLAYING') {
      const p = game.players.find(pl => pl.seat === game.currentTurn);
      if (p && p.isNpc) isNpcTurn = true;
    } else if (game.status === 'PENDING_ACTION') {
      const npcAction = game.pendingActions.find(a => {
        const p = game.players.find(pl => pl.seat === a.seat);
        return p && p.isNpc && a.choice === null;
      });
      if (npcAction) isNpcTurn = true;
    }

    if (isNpcTurn) {
      game.cpuWait++;
      if (game.cpuWait >= 2) { 
        game.cpuWait = 0;
        const acted = game.runNpcBehavior();
        if (acted) {
          checkAndEnforceAutoNextRound(io, rooms, roomId, game);
          return;
        }
      } else {
        return; 
      }
    } else {
      game.cpuWait = 0; 
    }

    if (Date.now() >= game.turnExpiryTime) {
      if (game.status === 'PENDING_ACTION') {
        game.pendingActions.forEach(a => {
          if (a.choice === null) game.handleActionResponse(a.seat, 'PASS');
        });
      } else if (game.status === 'PLAYING') {
        const seat = game.currentTurn;
        const lastIndex = game.hands[seat].length - 1;
        game.processDiscard(seat, lastIndex);
      }
      checkAndEnforceAutoNextRound(io, rooms, roomId, game);
    }
  }, 1000);
}

function broadcastState(io, roomId, game) {
  game.players.forEach(p => { 
    if (!p.isNpc) {
      io.to(p.id).emit('game_state', game.getStateForClient(p.id)); 
    }
  });
  game.spectators.forEach(s => { 
    io.to(s.id).emit('game_state', game.getStateForClient(s.id)); 
  });
}