let socket;
let currentUser = null;
let userCoords = null; 

// 🔥 AUTOMATIC ENVIRONMENT DETECTOR: Live par relative path chalega, local testing par localhost.
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3040' 
    : '';

const today = new Date();
const todayKey = today.toISOString().split('T')[0];
let checkedPrayers = {};
let authMode = 'LOGIN'; 

const PRAYERS_DEF = [
  { key: 'fajr',    name: 'Fajr',    arabic: 'الفجر',  note: '2 Sunnah + 2 Fard (Valid till Sunrise)' },
  { key: 'dhuhr',   name: 'Dhuhr',   arabic: 'الظهر',  note: '4 Sunnah + 4 Fard + 2 Sunnah' },
  { key: 'asr',     name: 'Asr',     arabic: 'العصر',  note: '4 Fard (Hanafi Time Frame)' },
  { key: 'maghrib', name: 'Maghrib', arabic: 'المغرب', note: '3 Fard + 2 Sunnah + 2 Nafl' },
  { key: 'isha',    name: 'Isha',    arabic: 'العشاء', note: '4 Fard + 2 Sunnah + 3 Witr' }
];

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initRealtimeLocation();
    loadHadith();
    setHijriDate();
});

// ── REVERSE GEOCODING ENGINE ──
function initRealtimeLocation() {
    const statusDisplay = document.getElementById('dateLocDisplay');
    
    if (navigator.geolocation) {
        statusDisplay.textContent = "📍 Fetching secure satellite location coordinates...";
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userCoords = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                
                fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userCoords.lat}&lon=${userCoords.lng}&zoom=10&addressdetails=1`)
                .then(res => res.json())
                .then(geoData => {
                    const city = geoData.address.city || geoData.address.town || geoData.address.village || geoData.address.state || "Your City";
                    const country = geoData.address.country || "";
                    
                    statusDisplay.textContent = `📍 Live Location: ${city}, ${country} • ${today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}`;
                    fetchAccurateTimings();
                })
                .catch(() => {
                    statusDisplay.textContent = `📍 Live Location: (${userCoords.lat.toFixed(2)}, ${userCoords.lng.toFixed(2)}) • ${today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}`;
                    fetchAccurateTimings();
                });
            },
            (error) => {
                console.warn("Location permission blocked.");
                statusDisplay.textContent = `📍 Default Location: India (Permission Blocked) • ${today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}`;
                fetchAccurateTimings();
            }
        );
    } else {
        statusDisplay.textContent = `📍 Default Location Active • ${today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}`;
        fetchAccurateTimings();
    }
}

// ── SESSION MANAGEMENT ──
function checkSession() {
    const savedUser = localStorage.getItem('salah_user');
    if (savedUser) {
        currentUser = savedUser;
        document.getElementById('authModal').style.display = 'none';
        document.getElementById('userGreeting').textContent = currentUser.startsWith('Guest_') ? 'Guest Seeker' : currentUser;
        document.getElementById('myAlias').textContent = currentUser;
        setupSocketChat();
    } else {
        document.getElementById('authModal').style.display = 'flex';
    }
}

function toggleAuthMode() {
    const title = document.getElementById('authSubTitle');
    const btn = document.getElementById('btnAuthAction');
    const promptLabel = document.getElementById('authToggleText');
    const toggleLink = document.getElementById('authLinkToggle');
    const errBox = document.getElementById('authError');
    errBox.style.display = 'none';
    
    if (authMode === 'LOGIN') {
        authMode = 'REGISTER';
        title.textContent = 'Create a new account to unlock permanent records tracking';
        btn.textContent = 'Create Account';
        promptLabel.textContent = 'Already have an account?';
        toggleLink.textContent = 'Sign In';
    } else {
        authMode = 'LOGIN';
        title.textContent = 'Sign in to sync your lifetime spiritual records';
        btn.textContent = 'Sign In';
        promptLabel.textContent = 'New to Bilal Reminder?';
        toggleLink.textContent = 'Create an Account';
    }
}

function handleAuthSubmit() {
    const uInput = document.getElementById('authUsername').value.trim();
    const pInput = document.getElementById('authPassword').value;
    const errBox = document.getElementById('authError');

    if(!uInput || !pInput) {
        errBox.textContent = "Fields cannot be blank.";
        errBox.style.display = 'block';
        return;
    }

    const endpoint = authMode === 'LOGIN' ? '/api/auth/login' : '/api/auth/register';

    fetch(BACKEND_URL + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uInput, password: pInput })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            errBox.textContent = data.error;
            errBox.style.display = 'block';
        } else {
            if (authMode === 'REGISTER') {
                authMode = 'LOGIN';
                handleAuthSubmit();
            } else {
                localStorage.setItem('salah_user', data.username);
                document.getElementById('authUsername').value = '';
                document.getElementById('authPassword').value = '';
                checkSession();
                initRealtimeLocation();
            }
        }
    })
    .catch(() => {
        errBox.textContent = "Server communication failure.";
        errBox.style.display = 'block';
    });
}

function handleGuestSkip() {
    const randomSeed = Math.floor(1000 + Math.random() * 9000);
    const guestAccount = `Guest_${randomSeed}`;
    localStorage.setItem('salah_user', guestAccount);
    checkSession();
    initRealtimeLocation();
}

function handleLogout() {
    localStorage.removeItem('salah_user');
    currentUser = null;
    if (socket) socket.disconnect();
    location.reload();
}

// ── TIMINGS LOADER ──
let globalTimes = {}; 
function fetchAccurateTimings() {
    let url = `${BACKEND_URL}/api/timings`;
    if(userCoords) url += `?lat=${userCoords.lat}&lng=${userCoords.lng}`;

    fetch(url)
        .then(res => res.json())
        .then(times => {
            globalTimes = times;
            document.getElementById('time-sunrise').textContent = times.sunrise || '--:--';
            document.getElementById('time-dhuhr').textContent = times.dhuhr || '--:--';
            document.getElementById('time-maghrib').textContent = times.maghrib || '--:--';
            document.getElementById('time-midnight').textContent = times.midnight || '--:--';
            document.getElementById('time-lastThird').textContent = times.lastThird || '--:--';
            
            setupCountdownClock(times);
            
            if (currentUser) {
                syncUserHistory(true); 
            } else {
                renderPrayers(globalTimes);
            }
        })
        .catch(err => console.error("Timings pipeline error:", err));
}

// ── SYNC HISTORY & COUNTERS ──
function syncUserHistory(shouldRenderPrayers = false) {
    if (!currentUser) return;
    
    fetch(`${BACKEND_URL}/api/history/analytics?username=${encodeURIComponent(currentUser)}`)
        .then(res => res.json())
        .then(analytics => {
            const totalPrayers = analytics.totalPrayersOffered || 0;
            const daysTracked = analytics.daysTracked || 0;
            const maxPossible = daysTracked * 5;
            const efficiency = maxPossible > 0 ? Math.round((totalPrayers / maxPossible) * 100) : 0;

            document.getElementById('analytics-total-prayers').textContent = `${totalPrayers} Prayers`;
            document.getElementById('analytics-total-days').textContent = `${daysTracked} Days`;
            document.getElementById('analytics-efficiency').textContent = `${efficiency}%`;

            const todayRecord = analytics.rawHistory ? analytics.rawHistory.find(r => r.dateKey === todayKey) : null;
            checkedPrayers = todayRecord && todayRecord.prayers ? todayRecord.prayers : {};
            
            if (shouldRenderPrayers) {
                renderPrayers(globalTimes);
            } else {
                updateProgressBarUI();
            }
        })
        .catch((err) => {
            console.error("Error syncing user history:", err);
            if (shouldRenderPrayers) {
                checkedPrayers = {};
                renderPrayers(globalTimes);
            }
        });
}

function renderPrayers(times) {
    const grid = document.getElementById('prayerGrid');
    if (!grid) return; 
    grid.innerHTML = ''; 
    
    PRAYERS_DEF.forEach((p) => {
        const isDone = !!checkedPrayers[p.key];
        const card = document.createElement('div');
        card.className = `prayer-card${isDone ? ' done' : ''}`;
        card.id = `card-${p.key}`;
        
        card.innerHTML = `
            <h3><span>${p.name}</span><span class="ar-name">${p.arabic}</span></h3>
            <div class="time">${times[p.key] || '--:-- --'}</div>
            <p class="sub-text">${p.note}</p>
            <div class="check-container">
                <label class="checkbox-label">
                    <input type="checkbox" ${isDone ? 'checked' : ''} onchange="togglePrayer('${p.key}')" />
                    <span>Mark as Completed</span>
                </label>
            </div>
        `;
        grid.appendChild(card);
    });
    updateProgressBarUI();
}

// ── BULLETPROOF MARK AS COMPLETED LOGIC ──
function togglePrayer(key) {
    checkedPrayers[key] = !checkedPrayers[key];
    const isChecked = checkedPrayers[key];
    
    const card = document.getElementById('card-' + key);
    if (card) {
        if (isChecked) { 
            card.classList.add('done'); 
            card.classList.remove('upcoming'); 
        } else { 
            card.classList.remove('done'); 
        }
    }
    updateProgressBarUI();

    fetch(`${BACKEND_URL}/api/history/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, dateKey: todayKey, prayerKey: key, isChecked: isChecked })
    })
    .then(() => {
        syncUserHistory(false); 
    });
}

function updateProgressBarUI() {
    const done = Object.values(checkedPrayers).filter(Boolean).length;
    const progressLabel = document.getElementById('progressLabel');
    const progressFill = document.getElementById('progressFill');
    if(progressLabel) progressLabel.textContent = `${done} / 5 Completed Today`;
    if(progressFill) progressFill.style.width = `${(done / 5) * 100}%`;
}

function setupCountdownClock(times) {
    const nextLabel = document.getElementById('nextPrayerName');
    const timerText = document.getElementById('countdownTimer');
    
    const parseTimeStr = (str) => {
        if(!str || str === '--:--') return null;
        const [time, modifier] = str.split(' ');
        let [hours, minutes] = time.split(':');
        if (hours === '12') hours = '00';
        if (modifier === 'PM') hours = parseInt(hours, 10) + 12;
        const d = new Date(); d.setHours(parseInt(hours,10), parseInt(minutes,10), 0, 0);
        return d;
    };

    if(window.clockInterval) clearInterval(window.clockInterval);

    window.clockInterval = setInterval(() => {
        const now = new Date();
        let nextP = null, nextT = null;

        for (const p of PRAYERS_DEF) {
            const t = parseTimeStr(times[p.key]);
            if (t && t > now) { nextP = p; nextT = t; break; }
        }

        if (!nextP) {
            if(nextLabel) nextLabel.textContent = "Fajr (Tomorrow)";
            if(timerText) timerText.textContent = times.fajr || "05:00 AM";
            return;
        }

        document.querySelectorAll('.prayer-card').forEach(c => c.classList.remove('upcoming'));
        const upcomingCard = document.getElementById('card-' + nextP.key);
        if (upcomingCard && !checkedPrayers[nextP.key]) upcomingCard.classList.add('upcoming');

        const diff = nextT - now;
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        
        if(nextLabel) nextLabel.textContent = `Next Prayer: ${nextP.name}`;
        if(timerText) timerText.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }, 1000);
}

function loadHadith() {
    fetch(`${BACKEND_URL}/api/hadith`).then(res => res.json()).then(data => {
        document.getElementById('hadithArabic').textContent = data.arabic;
        document.getElementById('hadithText').textContent = `"${data.text}"`;
        document.getElementById('hadithSource').textContent = `— ${data.source}`;
    });
}

function setHijriDate() {
    try {
        const formatter = new Intl.DateTimeFormat('en-TN-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' });
        document.getElementById('hijriDate').textContent = `🌙 ${formatter.format(today)} AH`;
    } catch(e) {
        document.getElementById('hijriDate').textContent = "Islamic Calendar Sync Active";
    }
}

function setupSocketChat() {
    if (typeof io === 'undefined' || !currentUser) return;
    if (socket) socket.disconnect(); 
    
    const chatWindow = document.getElementById('chatMessages');
    if (chatWindow) chatWindow.innerHTML = ''; 

    fetch(`${BACKEND_URL}/api/chat/history`)
        .then(res => res.json())
        .then(messages => {
            messages.forEach(msg => {
                const isMine = msg.alias === currentUser;
                const msgDiv = document.createElement('div');
                msgDiv.className = `msg ${isMine ? 'mine' : 'other'}`;
                msgDiv.innerHTML = `<div class="msg-bubble">${msg.text}</div><div class="msg-meta">${isMine ? 'You' : msg.alias} · ${msg.timestamp}</div>`;
                if(chatWindow) chatWindow.appendChild(msgDiv);
            });
            if(chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight; 
        })
        .catch(err => console.error("Error fetching chat logs:", err));

    // ⚡ Socket Cloud Configuration Fix: Pure relative path binding for automatic routing
    socket = BACKEND_URL === '' ? io() : io(BACKEND_URL);
    
    socket.on('incomingMessage', (msg) => {
        const isMine = msg.alias === currentUser;
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg ${isMine ? 'mine' : 'other'}`;
        msgDiv.innerHTML = `<div class="msg-bubble">${msg.text}</div><div class="msg-meta">${isMine ? 'You' : msg.alias} · ${msg.timestamp}</div>`;
        if(chatWindow) { 
            chatWindow.appendChild(msgDiv); 
            chatWindow.scrollTop = chatWindow.scrollHeight; 
        }
    });
}

function sendChat() {
    const input = document.getElementById('chatInput');
    if (!input || !input.value.trim() || !socket) return;
    socket.emit('sendMessage', { username: currentUser, text: input.value.trim() });
    input.value = '';
}