# Aether Cloak 🫥
Live Link : https://pratishtha-210.github.io/invisibility-cloak/
An interactive, premium web application that combines camera input and real-time hand-tracking (via Google's MediaPipe Tasks-Vision) to simulate an "invisibility cloak" effect. 

Wherever your hands move (or the frame you make between your fingers), the camera feed is replaced with an empty-room background snapshot or a refractive active-camouflage shimmer, making you look invisible or cloaked.

---

## Features ✨

- **Dual Invisibility Modes**:
  - 👐 **Pose Frame Mode (Classic)**: Creates a four-point polygon connecting both thumb tips and both index finger tips when both hands are visible. Centroid-based polar sorting prevents the polygon from self-intersecting when hands are tilted.
  - 👋 **Hand Sweep Mode**: Uses the **Monotone Chain (Graham Scan)** algorithm to compute the **Convex Hull** of all 21 hand landmarks, dilated relative to its centroid to cover your wrists and arms.
- **Dual Visual Styles**:
  - 🫥 **True Invisible**: Replaces your body/hands with the saved background snapshot (clean room), making you disappear.
  - 🌀 **Predator Shimmer**: A sci-fi refractive active camouflage. It scales the camera feed by `1.08x` and offsets it to simulate light bending around your hands. Requires no background snapshot to work!
- **Anti-Flicker & Jitter Control**:
  - **Landmark Smoothing**: A sliding frame window averages coordinates over recent frames to stop edge jitter.
  - **Dropout Hysteresis**: A 6-frame tracking grace period retains coordinates on tracking dropouts, preventing the mask from blinking.
- **Invisibility Motion Trail**: A temporal mask buffer that leaves a trailing path of invisibility behind moving hands.
- **Edge Feathering**: Softens the mask borders using canvas blurring to blend the cloak naturally with the live video.
- **Web Audio Sound Effects**: Synthesizes custom countdown audio cues (beeps) and camera shutter sounds using the browser's native Web Audio API (no external file dependencies).
- **Premium Glassmorphic UI**: Floating control center with responsive sliders and neon status indicators.

---

## Tech Stack 🛠️

- **Core**: HTML5, Vanilla CSS3 (Custom variables, Keyframe animations, Glassmorphism).
- **Libraries**: Google MediaPipe Tasks-Vision (HandLandmarker) loaded via CDN ES modules.
- **Server Context**: Vite (development server).
- **Audio**: Web Audio API (real-time sound synthesis).

---

## Installation & Running Locally 🚀

Browsers require a secure context (HTTPS or `localhost`) for webcam access. The application cannot be run by double-clicking the `index.html` file (using the `file://` protocol).

### Prerequisites
- Node.js (v16+) and npm installed.

### Steps
1. Clone this repository (or copy the files into a directory).
2. Install the dev dependencies (Vite):
   ```bash
   npm install
   ```
3. Start the local server:
   ```bash
   npm run dev
   ```
4. Open the displayed local address in your browser:
   `http://localhost:8000/`

---

## How to Use 🪄

1. Open the page and allow webcam permissions.
2. Under **Invisibility Modes**, choose **Pose Frame**.
3. Under **Cloak Visual Style**, choose **True Invisible**.
4. Click **Capture Background** and **immediately step out of the frame** (or duck down).
5. After the 3 countdown beeps and the camera flash, step back in.
6. Make the frame gesture (thumbs touching at the bottom, index fingers pointing up). The area inside your hands will reveal the empty room behind you!
7. Use the sliders on the sidebar to adjust:
   - **Smoothing**: Increase to reduce edge flicker.
   - **Feathering**: Smooth the mask borders.
   - **Dilation**: Grow or shrink the sweep mask.
   - **Motion Trail**: Make the invisibility linger behind your moving hands.
8. Check **Debug Landmarks** to see the glowing skeleton wires and joint nodes.

---

## Author 🤖

Created with 🤖 Claude, based on the vibe-coded reel effect by [@kaylanrupa](https://github.com/kaylanrupa).
