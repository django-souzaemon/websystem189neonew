// frontend/src/socket.js
import { io } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://websystem189-1.onrender.com';

// 💡 修正：ポーリングの呪いを回避するため、直接WebSocketのトンネルを掘る！
export const socket = io(BACKEND_URL, {
  transports: ['websocket'], // ← これを復活させます！！！
  autoConnect: true,
});