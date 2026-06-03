// backend/src/server.js （完璧に整理されたサーバー起動ファイル）
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const socketHandlers = require('./socketHandlers'); // 💡 ファイルの読み込み

const app = express();
const server = http.createServer(app);

// 💡 1. 上部：CORSを「すべて許可 (*)」にする（Vercelからの通信を無条件で通す）
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const rooms = {}; // 部屋のデータを保持

// 💡 2. 真ん中：通信が来たときの処理
io.on('connection', (socket) => {
  console.log('ユーザーが接続しました:', socket.id);
  // socketHandlersに io, socket, rooms の3つを渡して処理を任せる
  socketHandlers(io, socket, rooms); 
});

// 🚨 3. 一番下：Renderから指定されたPORT番号で待ち受ける！（超重要）
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 麻雀バックエンドサーバーがポート ${PORT} で起動しました！`);
});