# Multiplayer Poker (React + WebSocket)

This version supports real-time multiplayer across devices on the same network.

## Run the server
1. `cd server`
2. `npm install`
3. `npm start`

Server listens on `ws://<your-ip>:5174`.

## Run the client
1. `cd client`
2. `npm install`
3. `npm run dev`

Open `http://<your-ip>:5173` on each device.

## Connect from other devices
- On your phone or another PC, open the client URL using the **host machine IP**.
- Set the **Server** field to `ws://<host-ip>:5174` and connect.
- Use the same **Room** value to sit at the same table.

Notes:
- Max 6 seats per table.
- First player to join becomes the host (can start new hands).

## Hosting options (always-on)
- **Deploy the server**: run `server` on a VPS (Render, Railway, Fly.io, etc).
  - Expose port `5174` and use `ws://your-domain:5174`.
- **Deploy the client**: build with `npm run build` and host the `client/dist` folder
  on Netlify/Vercel or any static host, then point to your server URL.
- **Home always-on**: use a small device (Raspberry Pi) or always-on PC to run
  `server` and keep it online.

## Common connection fixes
- Ensure both devices are on the same Wi‑Fi network.
- Allow inbound firewall access to port `5174` on the host.
- Use the host IP shown by `ipconfig` (Windows) in the Server field.
