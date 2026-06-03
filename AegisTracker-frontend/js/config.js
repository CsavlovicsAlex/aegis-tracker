// old API base for labs
//const SERVER_IP = "172.30.241.204";

//const CONFIG = {
  //API_BASE: `https://${SERVER_IP}:8000`,
  //WS_BASE: `wss://${SERVER_IP}:8000/ws`
//};

// new API base for deployment

// 1. HTTP API Routing
// By leaving this blank, the browser automatically prepends the current domain.
// (e.g., if you are on https://aegis.railway.app, it fetches https://aegis.railway.app/login)
const API_BASE = "";

// 2. WebSocket Routing
// We dynamically check if the site is loaded over secure HTTPS or local HTTP
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = window.location.host; // This grabs "127.0.0.1:8000" OR "aegis.railway.app"

const WS_BASE = `${wsProtocol}//${host}/ws`;

const CONFIG = {
  API_BASE: API_BASE,
  WS_BASE: WS_BASE
};
