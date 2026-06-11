# 🕌 Salah Tracker — Stream-Based Time-Series Engine

A premium, full-stack, mobile-responsive dashboard designed to log daily prayers, compute real-time consistency metrics, and provide a synchronized multi-user environment. Built using modern dark-aesthetic UI principles with a highly optimized asynchronous backend.

---

## 🚀 Core Features

- **Geospatial Time-Series Pipeline:** Integrates browser Geolocation and OpenStreetMap API to feed dynamic coordinates into the `Adhan-JS` engine for native solar timetable calculations.
- **Asynchronous Analytics:** Features a non-blocking data pipeline that calculates live consistency scores, streaks, and engagement metrics instantly.
- **Rolling Hot-Data Filter:** Implements a logical database query layer creating a rolling 24-hour retention window for active chat rooms.
- **Full-Duplex Sync:** Deploys a real-time event-driven communication mesh using Socket.io, secured via Bcrypt.js authentication.
- **Mobile Optimized UI:** Premium Apple-style dark layout fully responsive for all mobile breakpoints and touch targets.

---

## 🛠️ Tech Stack & APIs

- **Frontend:** HTML5, CSS3 (Modern Dark Aesthetics), JavaScript (ES6+)
- **Backend:** Node.js, Express.js
- **Real-Time Mesh:** Socket.io
- **Database:** NeDB (Lightweight Persistent Storage)
- **APIs Used:** Adhan-JS Engine, HTML5 Geolocation API, OpenStreetMap Nominatim API
- **Security:** Bcrypt.js (Password Hashing)

---

## 💻 Installation & Local Setup

Follow these quick steps to get the project running locally on your machine:

**Clone the Repository:**
   ```bash
   git clone [https://github.com/your-username/salah-tracker.git](https://github.com/your-username/salah-tracker.git)
   cd salah-tracker

   Install Dependencies:

Bash
npm install
Configure Environment Port (Optional):
The application runs on port 3040 by default or dynamically scales on cloud deployment providers via process.env.PORT.

Start the Local Server:

Bash
node server.js
Access the App:
Open your browser and navigate to http://localhost:3040

📦 Project Structure
Plaintext
├── public/
│   ├── css/
│   │   └── style.css      
│   ├── js/
│   │   └── app.js         # Frontend architecture & WebSocket triggers
│   └── index.html         # Main dashboard markup
├── data/
│   └── (users/chats).db   # NeDB persistent stores 
├── server.js              # Node.js + Express + Socket.io core pipeline
├── package.json           # Project metadata & dependencies
└── .gitignore             # Git exclusion mapping
🔒 Security & Optimization Focus
Non-Blocking Architecture: Aggregations and file logging are handled asynchronously to keep the single-threaded Node.js event loop completely responsive.

Data Preprocessing: Implements local data isolation filters to ensure client-side states update with minimal network payload overhead