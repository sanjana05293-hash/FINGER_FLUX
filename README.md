# AETHER — Your Hands. Your Magic. ✦

AETHER is a browser-based, real-time hand-tracking art studio. Switch on your webcam, point your index finger, and watch hearts, flowers, butterflies, stars, galaxies, fire, bubbles, magic dust, neon ribbons, confetti, lightning, or persistent air-drawn lines follow your fingertip.

It uses real hand tracking (MediaPipe Hand Landmarker, landmark 8 = index fingertip). There is no mouse fallback and no prerecorded video.

## Technologies
HTML5, CSS3, vanilla JavaScript (ES modules), Canvas 2D, `getUserMedia()`, and MediaPipe Tasks Vision. No frameworks, build tools, backend, API keys or accounts.

## Folder structure
```
AETHER/
├── index.html
├── README.md
├── css/style.css
└── js/app.js
```

## Run it (complete beginner guide)
1. Install **VS Code** from https://code.visualstudio.com.
2. In VS Code open **Extensions** (square icon, left bar), search **Live Server** (by Ritwick Dey), click **Install**.
3. Choose **File → Open Folder…** and select the `AETHER` folder.
4. Right-click `index.html` → **Open with Live Server**. Chrome or Edge opens at `http://127.0.0.1:5500`.
5. Click **Enable camera** and press **Allow** when the browser asks.

> Webcams only work on **HTTPS or localhost**. Double-clicking `index.html` (a `file://` address) will not work reliably. Always use Live Server or another localhost server (for example `python -m http.server` in the folder, then open `http://localhost:8000`).

## Using the 12 effects
Click an effect card on the right. It switches instantly without restarting the camera. Raise one hand with the index finger pointing up and move it.

| Effect | What you'll see |
|---|---|
| 💗 Hearts | Glowing hearts drift outward and fade |
| 🌸 Flowers | Rotating six-petal blossoms float along your path |
| 🦋 Butterflies | Fluttering four-wing butterflies drift away |
| ⭐ Stars | Glowing five-pointed stars float and fade |
| 🌌 Galaxy | Tiny orbiting particles form a swirling trail |
| 🔥 Fire | Embers rise, shifting yellow → orange → red |
| 🫧 Bubbles | Translucent bubbles with highlights rise and wobble |
| ✨ Magic Dust | Flickering dots and four-point sparkles |
| 〰️ Neon Ribbon | A glowing ribbon that fades from the tail |
| 🎊 Confetti | Spinning, falling coloured pieces |
| ⚡ Lightning | Short zigzag arcs while the fingertip moves |
| ✍️ Air Drawing | Continuous line that stays until **Clear canvas** |

## Using AETHER on your phone
Phones only allow the camera on **HTTPS** pages. A Live Server address such as `http://192.168.1.5:5500` will load the page but **the camera will be refused**. Use one of these:

1. **Netlify Drop (easiest, free, no account needed for a quick test):** open https://app.netlify.com/drop, drag the whole `AETHER` folder onto the page, then open the `https://…` link it gives you on your phone.
2. **GitHub Pages:** upload the folder to a GitHub repository → Settings → Pages → deploy from the main branch → open the `https://` link.
3. **Android + USB cable (for testing):** enable USB debugging, open `chrome://inspect/#devices` on your laptop's Chrome, add port `5500` under *Port forwarding*, then open `http://localhost:5500` in Chrome on the phone. `localhost` counts as secure.

On the phone: tap **Enable camera** and allow access. Use **Flip camera** for the back camera, and **Fullscreen** for a full-screen stage (on iPhone this is an in-page full-window mode). Works in portrait and landscape. Prop the phone up or hold it steady, with your hand well lit and fully in frame. iPhone needs iOS 15.4+ (Safari or Chrome).

## Settings
- **Effect size** 50–170%: size of new particles and line width.
- **Trail length** 20–100%: how long particles and ribbon history last. Drawings are never affected.
- **Magic intensity** 20–100%: emission density and brightness.
- **Glow color**: five swatches. Fire keeps its flame palette and uses your color for accents.
- **Reset**: restores defaults. **Pause effects** freezes the simulation. **Clear canvas** removes particles, ribbon and drawings. **Fullscreen** expands the camera stage.

## Troubleshooting
**Page loads but buttons do nothing**
- Almost always the page was opened by double-clicking (`file://`). Open it with Live Server (right-click `index.html` → Open with Live Server) and hard-refresh (Ctrl+Shift+R).
- A red banner at the top of the page now shows the script error if AETHER fails to start. Press F12 → Console for details.

**Camera errors**
- *Permission blocked*: click the camera/lock icon in the address bar → allow camera → press **Try again**.
- *No camera found*: plug in a webcam and check the OS privacy settings.
- *Camera busy*: close Zoom, Teams, other tabs, etc.
- *Insecure context*: use Live Server / localhost.

**MediaPipe won't load**
- You need internet on first load. Check you can open `https://cdn.jsdelivr.net` and `https://storage.googleapis.com`.
- Disable ad/privacy blockers for localhost, or any VPN/firewall blocking those hosts.
- If the GPU is unavailable AETHER automatically retries on the CPU (slower).
- Open DevTools (F12) → Console for details.

**Tracking drops out or lags**: AETHER keeps the last position for a fraction of a second during a brief dropout and glides smoothly when the hand returns. If it still struggles, improve the lighting, keep the whole hand in frame, and avoid very fast flicks. On phones detection is limited to ~30 fps to save battery, and the app switches to a CPU mode automatically if the GPU fails.

**Tracking is poor**: use good front lighting, keep your hand 30–80 cm away and fully in frame, and show one hand.

## Requirements
Current Chrome or Edge, a webcam, and internet for: Google Fonts, MediaPipe JS + WASM (jsDelivr, version 0.10.14), and the hand-landmark model (Google storage).

## Privacy
Camera access is requested only after you click. No microphone is used. Frames are analysed in the browser and are never recorded, saved or uploaded. AETHER collects no personal data. Turning the camera off stops every media track and closes the tracker. (Your browser still downloads the CDN files above.)

## Known limitations
- Only the index fingertip of one hand is tracked. There are no gestures and **no letter or word recognition**. Air Drawing is drawing only.
- Resizing or entering fullscreen scales an existing drawing; it is not re-drawn at the new aspect ratio.
- Tested only by code review and a JavaScript syntax check. **Webcam behaviour has not been run in a real browser** by the author of this build; please test it (checklist below).
- Particles are capped at 800 and extra ones are dropped. Very old laptops may drop frames.
- Mobile layout is responsive, but the demo is optimised for laptop webcams.

## Test checklist
Enable camera → status reads **SHOW ONE HAND**, then **HAND TRACKED** → move finger and confirm each of the 12 effects follows the fingertip (including mirrored left/right) → change size/trail/intensity/colour → Pause/Resume → Clear → camera off/on several times → fullscreen → resize window → deny permission once to see the error message.

## Future upgrades
Self-host MediaPipe files and the model for offline use · pinch-to-draw and open-palm burst (only once genuinely detected) · real handwriting recognition with a trained model · multi-hand support · save drawing as PNG · 3D version with Three.js.
