// backend/src/gameEngine.js
const Riichi = require('riichi');

class GameEngine {
  constructor() {
    this.players = [];    
    this.spectators = []; 
    this.status = 'WAITING';
    
    this.scores = { 0: 25000, 1: 25000, 2: 25000, 3: 25000 }; 
    this.winds = { 0: '東', 1: '南', 2: '西', 3: '北' };      
    this.bakaze = '東';  
    this.kyoku = 1;      
    this.honba = 0;      
    this.kyoutaku = 0;   
    this.oya = 0;        
    
    this.wall = [];
    this.rinshanWall = []; 
    this.doraWall = [];
    this.uraDoraWall = [];
    
    this.hands = { 0: [], 1: [], 2: [], 3: [] };
    this.melds = { 0: [], 1: [], 2: [], 3: [] }; 
    this.discards = { 0: [], 1: [], 2: [], 3: [] }; 
    this.currentTurn = 0; 
    this.doraIndicators = [];
    this.doraPointers = 1; 
    
    this.pendingActions = []; 
    this.lastDiscard = null;
    this.riichiDeclared = { 0: false, 1: false, 2: false, 3: false };
    this.pendingRiichi = { 0: false, 1: false, 2: false, 3: false };
    this.endResult = null; 
    this.nextRenchanFlag = false; 
    this.turnExpiryTime = 0;

    // 💡 必須変数の追加
    this.hostUserId = null; 
    this.enabledLocalYaku = []; 
    this.globalCallCount = 0; 
    this.lastDiscardWasRiichi = false;
    this.lastActionWasKan = false;
  }

  buildWall() {
    const suits = ['m', 'p', 's'];
    const wall = [];
    suits.forEach(suit => {
      for (let i = 1; i <= 9; i++) { 
        for (let j = 0; j < 4; j++) {
          if (i === 5 && j === 0) wall.push(`${suit}5r`);
          else wall.push(`${suit}${i}`);
        }
      }
    });
    for (let i = 1; i <= 7; i++) { for (let j = 0; j < 4; j++) wall.push(`z${i}`); }
    this.wall = wall.sort(() => Math.random() - 0.5);

    this.rinshanWall = this.wall.splice(0, 4); 
    this.doraWall = this.wall.splice(0, 5);    
    this.uraDoraWall = this.wall.splice(0, 5); 

    this.doraPointers = 1; 
    this.doraIndicators = [this.doraWall[0]]; 
  }

  dealTiles() {
    for (let i = 0; i < 4; i++) { 
      this.hands[i] = this.wall.splice(0, 13).sort((a, b) => a.replace('r','') > b.replace('r','') ? 1 : -1); 
    }
  }

  getTileScore(tile, hand) {
    if (!tile) return 0;
    const clean = tile.replace('r','');
    const suit = clean[0];
    const num = parseInt(clean[1]);
    const sameCount = hand.filter(t => t.replace('r','') === clean).length;
    
    if (suit === 'z') {
      if (sameCount === 1) return 10;
      if (sameCount === 2) return 55;
      return 85;
    }
    
    const handClean = hand.map(t => t.replace('r',''));
    let hasNeighbor = false;
    if (handClean.includes(`${suit}${num - 1}`) || handClean.includes(`${suit}${num + 1}`)) hasNeighbor = true;
    if (handClean.includes(`${suit}${num - 2}`) || handClean.includes(`${suit}${num + 2}`)) hasNeighbor = true;
    
    let baseScore = 40; 
    if (num === 1 || num === 9) baseScore = 20; 
    if (num === 2 || num === 8) baseScore = 30; 
    
    if (hasNeighbor) baseScore += 35; 
    if (sameCount >= 2) baseScore += 20; 
    
    return baseScore;
  }

  selectNpcDiscardIndex(seat, level) {
    try {
      const hand = this.hands[seat];
      if (!hand || hand.length === 0) return 0;
      const targetLevel = level || 1;

      if (targetLevel === 1) return hand.length - 1;
      if (targetLevel === 2 && Math.random() > 0.5) return hand.length - 1;

      let minScore = Infinity;
      let bestIndex = hand.length - 1;
      
      for (let i = 0; i < hand.length; i++) {
        if (!hand[i]) continue;
        const score = this.getTileScore(hand[i], hand);
        const finalScore = hand[i].includes('r') ? score + 15 : score; 
        if (finalScore < minScore) {
          minScore = finalScore;
          bestIndex = i;
        }
      }
      return bestIndex;
    } catch (e) {
      return this.hands[seat].length - 1 || 0; 
    }
  }

  runNpcBehavior() {
    if (this.status === 'PENDING_ACTION') {
      const npcAction = this.pendingActions.find(a => {
        const p = this.players.find(pl => pl.seat === a.seat);
        return p && p.isNpc && a.choice === null;
      });
      if (npcAction) {
        if (npcAction.type === 'TSUMO' || npcAction.type === 'RON') this.handleActionResponse(npcAction.seat, npcAction.type);
        else this.handleActionResponse(npcAction.seat, 'PASS');
        return true;
      }
    }
    if (this.status === 'PLAYING') {
      const currentCpu = this.players.find(p => p.seat === this.currentTurn);
      if (currentCpu && currentCpu.isNpc) {
        const discardIdx = this.selectNpcDiscardIndex(this.currentTurn, currentCpu.npcLevel);
        this.processDiscard(this.currentTurn, discardIdx);
        return true;
      }
    }
    return false;
  }

  getTenpaiWaits13(baseHand, melds) {
    const waits = new Set();
    const allTiles = ['m1','m2','m3','m4','m5','m6','m7','m8','m9','p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4','s5','s6','s7','s8','s9','z1','z2','z3','z4','z5','z6','z7'];
    
    for (let waitTile of allTiles) {
      const testHand = [...baseHand, waitTile];
      const handTilesObj = { m: [], p: [], s: [], z: [] };
      testHand.forEach(t => { if(t) { let c = t.replace('r',''); handTilesObj[c[0]].push(c[1]); } });
      
      let riichiStr = '';
      ['m', 'p', 's', 'z'].forEach(suit => {
        if (handTilesObj[suit].length > 0) riichiStr += handTilesObj[suit].sort().join('') + suit;
      });
      
      melds.forEach(meld => {
        let mStr = meld.map(t => t.replace('r','')[1]).sort().join('') + meld[0].replace('r','')[0];
        riichiStr += '+' + mStr;
      });
      
      try {
        const calc = new Riichi(riichiStr).calc();
        if (calc && calc.isAgari) {
          waits.add(waitTile); 
        }
      } catch(e) {}
    }
    return Array.from(waits);
  }

  getAnyDiscardEnableTenpai(hand, melds) {
    const cleanHand = hand.map(t => t.replace('r',''));
    const uniqueHandTiles = [...new Set(cleanHand)];
    
    for (let discardTile of uniqueHandTiles) {
      const testHand = [...hand];
      const idx = testHand.findIndex(t => t.replace('r','') === discardTile);
      if (idx !== -1) testHand.splice(idx, 1); 
      
      const waits = this.getTenpaiWaits13(testHand, melds);
      if (waits.length > 0) return true; 
    }
    return false;
  }

  isWinningHand(seat, extraTile = '') {
    const handStr = this.convertToRiichiStr(seat, extraTile);
    try {
      const calc = new Riichi(handStr).calc();
      return calc && calc.isAgari;
    } catch(e) {
      return false;
    }
  }

  getSuitCounts(seat, extraTile = '') {
    const combined = [...this.hands[seat]].map(t => t.replace('r',''));
    if (extraTile) combined.push(extraTile.replace('r',''));
    this.melds[seat].forEach(meld => combined.push(...meld));
    const counts = { m: 0, p: 0, s: 0, z: 0 };
    combined.forEach(t => { if (t && t[0] && counts[t[0]] !== undefined) counts[t[0]]++; });
    return counts;
  }

  safeCalcRiichi(handStr) {
    try { return new Riichi(handStr).calc(); } catch (e) { return null; }
  }

  convertToRiichiStr(seat, extraTile = '') {
    const myHandTiles = [...this.hands[seat]];
    if (extraTile) myHandTiles.push(extraTile);

    const handTilesObj = { m: [], p: [], s: [], z: [] };
    myHandTiles.forEach(t => { 
      if(t && t[0]) {
        let clean = t.replace('r','');
        handTilesObj[clean[0]].push(clean[1]); 
      }
    });
    
    let riichiStr = '';
    ['m', 'p', 's', 'z'].forEach(suit => {
      if (handTilesObj[suit].length > 0) riichiStr += handTilesObj[suit].sort().join('') + suit;
    });

    this.melds[seat].forEach(meld => {
      const meldTilesObj = { m: [], p: [], s: [], z: [] };
      meld.forEach(t => { if(t && t[0]) { let c = t.replace('r',''); meldTilesObj[c[0]].push(c[1]); } });
      let meldStr = '';
      ['m', 'p', 's', 'z'].forEach(suit => {
        if (meldTilesObj[suit].length > 0) meldStr += meldTilesObj[suit].sort().join('') + suit;
      });
      if (meldStr) riichiStr += '+' + meldStr;
    });

    return riichiStr;
  }

  cacheAllPlayersReadyState() {
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i];
      const hand = this.hands[player.seat];
      const melds = this.melds[player.seat];
      
      if (!hand || hand.length === 0) continue;

      if (hand.length === 14) {
        player.isReady = this.getAnyDiscardEnableTenpai(hand, melds);
        const testHand = hand.slice(0, 13);
        player.waitingTiles = this.getTenpaiWaits13(testHand, melds);
      } else {
        player.waitingTiles = this.getTenpaiWaits13(hand, melds);
        player.isReady = player.waitingTiles.length > 0;
      }
      
      const myPastDiscards = this.discards[player.seat].map(d => d.tile.replace('r',''));
      player.furiten = player.waitingTiles.some(wTile => myPastDiscards.includes(wTile));
    }
  }

  // 💡 【大修正】バグの元凶だった入室ロジックを完全修復
  joinRoom(id, name, requestedRole, userId, aiLevel = 2) {
    let player = null;
    if (userId) {
      player = this.players.find(p => p.userId === userId);
    }

    if (player) {
      player.id = id;
      player.name = name;
    } else {
      let spec = null;
      if (userId) spec = this.spectators.find(s => s.userId === userId);
      
      if (spec) {
        spec.id = id;
        spec.name = name;
        return { role: 'spectator', seat: null };
      }

      if (requestedRole === 'spectator') {
        this.spectators.push({ id, userId, name });
        return { role: 'spectator', seat: null };
      }

      if (this.players.length < 4 && this.status === 'WAITING') {
        const seat = this.players.length;
        if (this.players.length === 0) this.hostUserId = userId; 
        player = { id, userId, seat, name, furiten: false, isReady: false, waitingTiles: [], isNpc: false, autoPass: false };
        this.players.push(player);
      } else if (this.status !== 'WAITING') {
        this.spectators.push({ id, userId, name });
        return { role: 'spectator', seat: null };
      }
    }

    // 💡 確実にCPUが追加される
    if (player && requestedRole === 'ai_mode' && this.status === 'WAITING') {
      this.fillWithCPU(3, aiLevel);
    }

    return player ? { role: 'player', seat: player.seat } : { role: 'spectator', seat: null };
  }

  updateLocalYaku(userId, yakuList) { if (this.hostUserId === userId) this.enabledLocalYaku = yakuList; }
  updateAutoPassConfig(userId, isChecked) { const p = this.players.find(pl => pl.userId === userId); if (p) p.autoPass = isChecked; }

  // 💡 【大修正】欠落していたCPU生成機能を復活
  fillWithCPU(count = 3, level = 2) {
    let added = 0;
    while (this.players.length < 4 && added < count) {
      const seat = this.players.length;
      this.players.push({
        id: `cpu_${Date.now()}_${seat}`,
        userId: `cpu_user_${seat}`,
        seat: seat,
        name: `COM ${seat}`,
        furiten: false,
        isReady: false,
        waitingTiles: [],
        isNpc: true,
        npcLevel: level,
        autoPass: true
      });
      added++;
    }
  }

  startGame() {
    this.status = 'PLAYING';
    this.currentTurn = this.oya; 
    this.updateWinds();          
    this.buildWall();
    this.dealTiles();
    this.globalCallCount = 0; this.lastActionWasKan = false; this.lastDiscardWasRiichi = false;
    this.executeTurnStart();
  }

  updateWinds() {
    const windOrder = ['東', '南', '西', '北'];
    for (let i = 0; i < 4; i++) {
      const relativeSeat = (i - this.oya + 4) % 4;
      this.winds[i] = windOrder[relativeSeat];
    }
  }

  resetTimerTimestamp() {
    this.turnExpiryTime = Date.now() + 30000; 
  }

  executeTurnStart() {
    this.resetTimerTimestamp();
    if (this.wall.length === 0) { this.processExhaustiveDraw(); return; }

    const seat = this.currentTurn;
    const tile = this.wall.pop(); 
    this.hands[seat].push(tile); 
    this.lastDiscard = null;
    this.pendingActions = [];

    const isPhysicalWin = this.isWinningHand(seat);
    const counts = this.getSuitCounts(seat);
    let isLibraryWin = false;
    if (counts.m < 9 && counts.p < 9 && counts.s < 9) {
      const handStr = this.convertToRiichiStr(seat);
      const analysis = this.safeCalcRiichi(handStr);
      if (analysis && analysis.isAgari) isLibraryWin = true;
    }

    if (isPhysicalWin || isLibraryWin) { 
      this.pendingActions.push({ seat, type: 'TSUMO', tile, priority: 4, choice: null }); 
    }

    this.cacheAllPlayersReadyState();

    const isMenzen = this.melds[seat].length === 0;
    const playerObj = this.players.find(p => p.seat === seat);
    
    if (!this.riichiDeclared[seat] && isMenzen && this.scores[seat] >= 1000 && playerObj && !playerObj.furiten) {
      if (playerObj.isReady) { 
        this.pendingActions.push({ seat, type: 'RIICHI', tile: null, priority: 1, choice: null }); 
      }
    }
    
    if (!this.riichiDeclared[seat] && this.pendingActions.length === 0) {
      const tileCounts = {};
      this.hands[seat].forEach(t => { let c=t.replace('r',''); tileCounts[c] = (tileCounts[c] || 0) + 1; });
      Object.entries(tileCounts).forEach(([t, count]) => {
        if (count === 4) this.pendingActions.push({ seat, type: 'KAN', tile: t, priority: 2, choice: null });
      });
    }
    this.status = this.pendingActions.length > 0 ? 'PENDING_ACTION' : 'PLAYING';
  }

  processDiscard(seat, tileIndex) {
    if (tileIndex < 0 || tileIndex >= this.hands[seat].length) return;
    this.resetTimerTimestamp();

    const tile = this.hands[seat].splice(tileIndex, 1)[0];
    this.hands[seat].sort((a,b)=>a.replace('r','')>b.replace('r','')?1:-1);
    this.lastDiscard = tile;
    this.pendingActions = [];

    let isRotated = false;
    if (this.pendingRiichi[seat]) {
      isRotated = true; 
      this.pendingRiichi[seat] = false; 
      this.riichiDeclared[seat] = true;
      this.scores[seat] -= 1000; 
      this.kyoutaku += 1;
    }
    this.discards[seat].push({ tile, rotated: isRotated });

    this.cacheAllPlayersReadyState();

    this.players.forEach(p => {
      if (p.seat === seat) return; 
      const otherSeat = p.seat;
      const isOtherPhysicalWin = this.isWinningHand(otherSeat, tile);

      if ((p.isReady && !p.furiten && p.waitingTiles && p.waitingTiles.includes(tile.replace('r',''))) || isOtherPhysicalWin) {
        this.pendingActions.push({ seat: otherSeat, type: 'RON', tile, priority: 3, choice: null });
      }

      if (!this.riichiDeclared[otherSeat]) {
        const otherHand = this.hands[otherSeat].map(t=>t.replace('r',''));
        const cleanTile = tile.replace('r','');
        const sameTilesCount = otherHand.filter(t => t === cleanTile).length;
        if (sameTilesCount >= 2) { this.pendingActions.push({ seat: otherSeat, type: 'PON', tile, priority: 2, choice: null }); }
        
        const isUpperSeat = (seat + 1) % 4 === otherSeat; 
        if (isUpperSeat && cleanTile[0] !== 'z') {
          const suit = cleanTile[0]; const num = parseInt(cleanTile[1]); const hasTile = (n) => otherHand.includes(`${suit}${n}`);
          if (hasTile(num - 1) && hasTile(num + 1)) { this.pendingActions.push({ seat: otherSeat, type: 'CHI', tile, priority: 1, choice: null, combination: [`${suit}${num-1}`, `${suit}${num+1}`] }); }
          else if (hasTile(num - 2) && hasTile(num - 1)) { this.pendingActions.push({ seat: otherSeat, type: 'CHI', tile, priority: 1, choice: null, combination: [`${suit}${num-2}`, `${suit}${num-1}`] }); }
          else if (hasTile(num + 1) && hasTile(num + 2)) { this.pendingActions.push({ seat: otherSeat, type: 'CHI', tile, priority: 1, choice: null, combination: [`${suit}${num+1}`, `${suit}${num+2}`] }); }
        }
      }
    });

    if (this.pendingActions.length > 0) this.status = 'PENDING_ACTION'; 
    else { this.status = 'PLAYING'; this.nextTurn(); }
  }

  processKan(seat, tile) {
    const cleanTile = tile.replace('r','');
    let kanTiles = this.hands[seat].filter(t => t.replace('r','') === cleanTile);
    this.hands[seat] = this.hands[seat].filter(t => t.replace('r','') !== cleanTile);
    if (kanTiles.length < 4) kanTiles.push(tile); 
    this.melds[seat].push(kanTiles.slice(0, 4));

    if (this.rinshanWall.length > 0) { 
      this.hands[seat].push(this.rinshanWall.pop()); 
      if (this.wall.length > 0) this.wall.pop(); 
    }
    if (this.doraPointers < 5) {
      this.doraIndicators.push(this.doraWall[this.doraPointers]);
      this.doraPointers++;
    }
    this.hands[seat].sort((a,b)=>a.replace('r','')>b.replace('r','')?1:-1); 
    this.status = 'PLAYING'; 
    this.executeTurnStart(); 
  }

  nextTurn() { this.currentTurn = (this.currentTurn + 1) % 4; this.executeTurnStart(); }

  handleActionResponse(seat, actionParam) {
    if (this.status !== 'PENDING_ACTION') return;
    this.resetTimerTimestamp();

    let actionType = typeof actionParam === 'object' ? (actionParam.type === 'SKIP' ? 'PASS' : actionParam.type) : actionParam;

    if (this.lastDiscard === null && this.currentTurn === seat) {
      if (actionType === 'PASS') { this.status = 'PLAYING'; this.pendingActions = []; return; }
      if (actionType === 'RIICHI') { this.pendingRiichi[seat] = true; this.status = 'PLAYING'; this.pendingActions = []; return; }
      if (actionType === 'TSUMO') { this.processAgari(seat, null, true); this.pendingActions = []; return; }
      if (actionType === 'KAN') {
        const tileCounts = {}; this.hands[seat].forEach(t => { let c=t.replace('r',''); tileCounts[c] = (tileCounts[c] || 0) + 1; });
        const targetTile = Object.keys(tileCounts).find(t => tileCounts[t] === 4);
        if (targetTile) this.processKan(seat, targetTile);
        this.pendingActions = []; return;
      }
    } 

    const action = this.pendingActions.find(a => a.seat === seat);
    if (!action) return;

    if (actionType === 'PASS') {
      action.choice = 'PASS';
      const allPassed = this.pendingActions.every(a => a.choice === 'PASS');
      if (allPassed) { this.pendingActions = []; this.status = 'PLAYING'; this.nextTurn(); }
      return;
    }

    const tile = action.tile;
    this.pendingActions = []; 

    if (actionType === 'RON') { this.processAgari(seat, this.currentTurn, false); } 
    else if (actionType === 'PON') {
      let deletedCount = 0;
      this.hands[seat] = this.hands[seat].filter(t => { if (t.replace('r','') === tile.replace('r','') && deletedCount < 2) { deletedCount++; return false; } return true; });
      this.melds[seat].push([tile.replace('r',''), tile.replace('r',''), tile.replace('r','')]); 
      this.currentTurn = seat; this.status = 'PLAYING'; this.lastDiscard = null;
    } else if (actionType === 'CHI' && action.combination) {
      action.combination.forEach(cTile => { const idx = this.hands[seat].findIndex(t=>t.replace('r','')===cTile); if (idx !== -1) this.hands[seat].splice(idx, 1); });
      this.melds[seat].push([...action.combination, tile.replace('r','')].sort()); 
      this.currentTurn = seat; this.status = 'PLAYING'; this.lastDiscard = null;
    }
  }

  processExhaustiveDraw() {
    this.status = 'FINISHED';
    const tempaiPlayers = []; const notenPlayers = [];
    for (let i = 0; i < 4; i++) {
      const p = this.players.find(pl => pl.seat === i);
      if (p && p.isReady) tempaiPlayers.push(i); else notenPlayers.push(i);
    }
    if (tempaiPlayers.length === 1) { tempaiPlayers.forEach(p => this.scores[p] += 3000); notenPlayers.forEach(p => this.scores[p] -= 1000); }
    else if (tempaiPlayers.length === 2) { tempaiPlayers.forEach(p => 1500); notenPlayers.forEach(p => this.scores[p] -= 1500); }
    else if (tempaiPlayers.length === 3) { tempaiPlayers.forEach(p => this.scores[p] += 1000); notenPlayers.forEach(p => this.scores[p] -= 3000); }
    
    this.nextRenchanFlag = tempaiPlayers.includes(this.oya);
    this.endResult = { winnerName: "流局", winnerWind: "荒", loserName: null, isTsumo: false, points: 0, yakuList: ["ノーテン罰符精算"], rankName: this.nextRenchanFlag ? "親連荘" : "親移動", scores: { ...this.scores } };
  }

  getDoraTile(indicator) {
    const suit = indicator[0]; const num = parseInt(indicator[1]);
    if (suit === 'z') {
      if (num === 4) return 'z1'; 
      if (num === 7) return 'z5'; 
      return `${suit}${num + 1}`;
    }
    return num === 9 ? `${suit}1` : `${suit}${num + 1}`;
  }

  processAgari(winnerSeat, loserSeat, isTsumo) {
    this.status = 'FINISHED';
    const handStr = this.convertToRiichiStr(winnerSeat, isTsumo ? '' : this.lastDiscard);
    const calc = this.safeCalcRiichi(handStr);

    let baseHan = calc?.han || 1;
    let fu = calc?.fu || 30;
    let yakuList = calc?.yaku ? Object.keys(calc.yaku) : ["役あり"];

    let doraCount = 0; let uradoraCount = 0; let akadoraCount = 0;
    const allTiles = [...this.hands[winnerSeat]];
    if (!isTsumo) allTiles.push(this.lastDiscard);
    this.melds[winnerSeat].forEach(m => allTiles.push(...m));

    allTiles.forEach(t => { if (t && t.includes('r')) akadoraCount++; });

    const activeDoras = this.doraIndicators.map(d => this.getDoraTile(d.replace('r','')));
    allTiles.forEach(t => {
      if(!t) return;
      const clean = t.replace('r', '');
      activeDoras.forEach(d => { if (clean === d) doraCount++; });
    });

    if (this.riichiDeclared[winnerSeat] || this.pendingRiichi[winnerSeat]) {
      const activeUraDoras = this.uraDoraWall.slice(0, this.doraPointers).map(d => this.getDoraTile(d.replace('r','')));
      allTiles.forEach(t => {
        if(!t) return;
        const clean = t.replace('r', '');
        activeUraDoras.forEach(d => { if (clean === d) uradoraCount++; });
      });
    }

    const totalHan = baseHan + doraCount + uradoraCount + akadoraCount;
    if (doraCount > 0) yakuList.push(`dora`); 
    if (uradoraCount > 0) yakuList.push(`uradora`); 
    if (akadoraCount > 0) yakuList.push(`akadora`); 

    let totalPoints = 0; let rankName = "アガリ";
    if (totalHan >= 13) { totalPoints = (winnerSeat === this.oya) ? 48000 : 32000; rankName = "役満"; }
    else if (totalHan >= 11) { totalPoints = (winnerSeat === this.oya) ? 36000 : 24000; rankName = "三倍満"; }
    else if (totalHan >= 8) { totalPoints = (winnerSeat === this.oya) ? 24000 : 16000; rankName = "倍満"; }
    else if (totalHan >= 6) { totalPoints = (winnerSeat === this.oya) ? 18000 : 12000; rankName = "跳満"; }
    else if (totalHan >= 3 || (totalHan === 4 && fu >= 40)) { totalPoints = (winnerSeat === this.oya) ? 12000 : 8000; rankName = "満貫"; }
    else { 
      let basePoints = fu * Math.pow(2, totalHan + 2);
      totalPoints = (winnerSeat === this.oya) ? Math.ceil((basePoints * 6)/100)*100 : Math.ceil((basePoints * 4)/100)*100;
      rankName = `${totalHan}翻 ${fu}符`;
    }

    let honbaPoints = this.honba * 300; 
    if (isTsumo) {
      if (winnerSeat === this.oya) {
        let childPay = Math.ceil((totalPoints / 3) / 100) * 100; let perChildHonba = this.honba * 100;
        this.players.forEach(p => { if (p.seat === winnerSeat) return; this.scores[p.seat] -= (childPay + perChildHonba); this.scores[winnerSeat] += (childPay + perChildHonba); });
      } else {
        let oyaPay = Math.ceil((totalPoints / 2) / 100) * 100; let childPay = Math.ceil((totalPoints / 4) / 100) * 100; let perPersonHonba = this.honba * 100;
        this.players.forEach(p => { if (p.seat === winnerSeat) return; let pay = (p.seat === this.oya) ? oyaPay : childPay; this.scores[p.seat] -= (pay + perPersonHonba); this.scores[winnerSeat] += (pay + perPersonHonba); });
      }
    } else {
      this.scores[loserSeat] -= (totalPoints + honbaPoints); this.scores[winnerSeat] += (totalPoints + honbaPoints);
    }
    
    this.scores[winnerSeat] += this.kyoutaku * 1000; this.kyoutaku = 0; this.nextRenchanFlag = (winnerSeat === this.oya);
    this.endResult = { winnerName: this.players.find(p => p.seat === winnerSeat)?.name || "NPC", winnerWind: this.winds[winnerSeat], loserName: isTsumo ? null : this.players.find(p => p.seat === loserSeat)?.name || "NPC", isTsumo, points: totalPoints, yakuList, rankName, scores: { ...this.scores } };
  }

  advanceToNextKyoku() {
    this.status = 'PLAYING';
    this.oya = this.nextRenchanFlag ? this.oya : (this.oya + 1) % 4;
    this.honba = this.nextRenchanFlag ? this.honba + 1 : 0;
    if (!this.nextRenchanFlag) this.kyoku += 1;
    
    const hasTobi = Object.values(this.scores).some(s => s < 0);
    if (this.kyoku > 4 || hasTobi) { this.status = 'GAME_OVER'; return; }

    this.updateWinds(); 
    this.wall = []; this.rinshanWall = []; this.doraWall = []; this.uraDoraWall = [];
    this.hands = { 0: [], 1: [], 2: [], 3: [] }; this.melds = { 0: [], 1: [], 2: [], 3: [] }; this.discards = { 0: [], 1: [], 2: [], 3: [] };
    this.currentTurn = this.oya; this.doraIndicators = []; this.doraPointers = 1; this.pendingActions = []; this.lastDiscard = null;
    this.riichiDeclared = { 0: false, 1: false, 2: false, 3: false }; this.pendingRiichi = { 0: false, 1: false, 2: false, 3: false }; this.endResult = null;
    this.players.forEach(p => { p.isReady = false; p.waitingTiles = []; p.furiten = false; });
    this.buildWall(); this.dealTiles(); this.executeTurnStart();
  }

  getStateForClient(playerId) {
    const player = this.players.find(p => p.id === playerId);
    const isSpectator = !player || this.spectators.some(s => s.id === playerId);
    let myActions = [];
    if (player && this.status === 'PENDING_ACTION') {
      const playerActions = this.pendingActions.filter(a => a.seat === player.seat);
      myActions = playerActions.map(a => a.type);
      if (myActions.length > 0) myActions.push('PASS'); 
    }
    const seatNames = { 0: 'NPC', 1: 'NPC', 2: 'NPC', 3: 'NPC' };
    this.players.forEach(p => { seatNames[p.seat] = p.name; });

    return {
      status: this.status, bakaze: this.bakaze, kyoku: this.kyoku, honba: this.honba, kyoutaku: this.kyoutaku,
      doraIndicators: this.doraIndicators, wallCount: this.wall.length, 
      currentTurn: this.currentTurn, scores: this.scores, winds: this.winds,
      mySeat: player ? player.seat : -1, myActions: myActions, turnExpiryTime: this.turnExpiryTime, seatNames: seatNames,                
      hostUserId: this.hostUserId, enabledLocalYaku: this.enabledLocalYaku, 

      myHand: isSpectator ? null : (player ? this.hands[player.seat] : []),
      allHands: isSpectator ? this.players.map(p => ({ seat: p.seat, hand: this.hands[p.seat] })) : null,
      myMelds: isSpectator ? [] : (player ? this.melds[player.seat] : []), discards: this.discards,
      others: [0, 1, 2, 3].map(seat => {
        const p = this.players.find(pl => pl.seat === seat);
        return { seat: seat, name: seatNames[seat], handCount: this.hands[seat] ? this.hands[seat].length : 0, melds: this.melds[seat] || [], isRiichi: this.riichiDeclared[seat] || false, autoPass: p ? p.autoPass : false };
      }),
      role: isSpectator ? 'spectator' : 'player', playerCount: this.players.length, endResult: this.endResult 
    };
  }
}

module.exports = GameEngine;