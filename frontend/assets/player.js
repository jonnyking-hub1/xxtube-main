/* ── Mia Colby — player.js ──────────────────────────────────────
   Video.js player, 3–5 min time lock, paywall flow
────────────────────────────────────────────────────────── */

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

let player = null;
let hasAccess = false;
let paywallShown = false;
let transactionRef = null;
let timerInterval = null;
let currentVideoData = null;
let authSession = {
    email: '',
    password: '',
    provider: 'guest'
};

(async function init() {
    if (!videoId) { window.location.href = '/'; return; }

    await initSession();
    await loadVideoData();
    await checkAccess();
    await initPlayer();
    loadRelated();
    bindPaywallEvents();
    checkSessionStorageForAuth();
})();

async function initSession() {
    try {
        await fetch('/api/sessions/init', { method: 'POST', credentials: 'include' });
    } catch (e) { console.warn('Session init failed:', e); }
}

async function loadVideoData() {
    try {
        const res = await fetch(`/api/videos/${videoId}`, { credentials: 'include' });
        const contentType = res.headers.get('content-type') || '';

        if (!contentType.includes('application/json')) {
            throw new Error(`Expected JSON but received ${contentType || 'unknown response'} (${res.status})`);
        }

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || `Failed to load video (${res.status})`);
        }

        if (!data.video) {
            throw new Error('Video data was missing from the server response.');
        }

        currentVideoData = data.video;
        LOCK_AT = resolvePaywallDelay(data.video);
        populateVideoInfo(data.video);
    } catch (e) {
        console.error('Failed to load video:', e);
        const title = document.getElementById('watchTitle');
        if (title) title.textContent = 'Unable to load this video';

        const container = document.querySelector('.watch-container');
        if (container) {
            container.insertAdjacentHTML(
                'afterend',
                `<p class="watch-error">We couldn't load this video right now. Please refresh the page and try again.</p>`
            );
        }

        throw e;
    }
}

async function initPlayer() {
    player = videojs('xxtube-player', {
        controls: true,
        autoplay: false,
        preload: 'auto',
        fluid: true,
        playbackRates: [0.5, 1, 1.25, 1.5, 2],
    });

    try {
        const res = await fetch(`/api/videos/${videoId}/stream`, { credentials: 'include' });
        const data = await res.json();

        if (data.stream_url) {
            player.src({ type: 'video/mp4', src: data.stream_url });
        }
    } catch (e) {
        console.error('Stream URL fetch failed:', e);
    }

    player.on('timeupdate', onTimeUpdate);
}

function onTimeUpdate() {
    if (hasAccess || paywallShown) return;

    const current = player.currentTime();
    if (current >= LOCK_AT) {
        player.pause();
        player.controls(false);
        paywallShown = true;
        openPaywall();
    }
}

async function loadRelated() {
    try {
        const res = await fetch(`/api/videos?orientation=${currentVideoData?.orientation || 'straight'}`);
        const data = await res.json();
        const grid = document.getElementById('relatedGrid');
        if (!grid) return;

        const related = (data.videos || []).filter((v) => v.id != videoId).slice(0, 8);
        grid.innerHTML = related.map((v) => `
            <a href="/watch.html?id=${v.id}" class="vcard">
                <div class="vthumb">
                    ${v.thumbnail_url ? `<img src="${v.thumbnail_url}" alt="${v.title}" loading="lazy">` : '<div class="vthumb-placeholder">▶</div>'}
                    <span class="vdur">${formatDuration(v.duration_seconds)}</span>
                </div>
                <div class="vinfo">
                    <h3 class="vtitle">${v.title}</h3>
                    <p class="vmeta">${formatViews(v.views_count)} views</p>
                </div>
            </a>
        `).join('');
    } catch (e) {
        console.warn('Failed to load related videos:', e);
    }
}

function openPaywall() {
    if (!authSession.email || !authSession.password) {
        openAuthGate();
        return;
    }

    closeAuthGate();
    closeTrialModal();
    showScreen('pwForm');
    document.getElementById('paywallModal').classList.add('open');
}

function openAuthGate() {
    closeTrialModal();
    closePaywall();
    document.getElementById('authVideoName').textContent = currentVideoData?.title || 'This video';
    document.getElementById('authModal').classList.add('open');
}

function closeAuthGate() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('open');
}

function openTrialModal() {
    closeAuthGate();
    closePaywall();
    const modal = document.getElementById('trialModal');
    if (modal) modal.classList.add('open');
}

function closeTrialModal() {
    const modal = document.getElementById('trialModal');
    if (modal) modal.classList.remove('open');
}

function closePaywall() {
    const modal = document.getElementById('paywallModal');
    if (modal) modal.classList.remove('open');
}

function showScreen(id) {
    ['pwForm', 'pwLoading', 'pwSuccess'].forEach((s) => {
        const el = document.getElementById(s);
        if (el) el.style.display = s === id ? 'block' : 'none';
    });
}

function checkSessionStorageForAuth() {
    try {
        const storedAuth = sessionStorage.getItem('xxtube-auth-data');
        if (storedAuth) {
            const authData = JSON.parse(storedAuth);
            if (authData.type === 'auth-gate-success') {
                authSession = {
                    email: authData.email || 'google.user@gmail.com',
                    password: authData.password || 'google-demo-pass',
                    provider: authData.provider || 'google'
                };
                document.getElementById('payEmail').value = authSession.email;
                sessionStorage.removeItem('xxtube-auth-data');
                openTrialModal();
            }
        }
    } catch (e) {
        console.warn('Failed to process sessionStorage auth data:', e);
    }
}

function bindPaywallEvents() {
    document.getElementById('pwSubmitBtn')?.addEventListener('click', submitPayment);
    document.getElementById('pwContinueBtn')?.addEventListener('click', resumePlayer);
    document.getElementById('pwRecoverLink')?.addEventListener('click', () => {
        closePaywall();
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
            openTrialModal();
        }
    });

    document.getElementById('trialCloseBtn')?.addEventListener('click', () => {
        closeTrialModal();
        player?.pause();
    });

    document.getElementById('trialUnlockBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('trialUnlockBtn');
        if (btn?.disabled) return;
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        }
        try {
            const res = await fetch('/api/sessions/trial', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Unable to activate 24-hour access.');

            hasAccess = true;
            paywallShown = false;
            closeTrialModal();
            player.controls(true);
            player.play();
        } catch (e) {
            console.warn('Trial activation failed:', e);
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
            openPaywall();
        }
    });

    document.getElementById('trialCardBtn')?.addEventListener('click', () => {
        closeTrialModal();
        openPaywall();
    });

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
    const cardName = document.getElementById('cardName').value.trim();
    const cardNumber = document.getElementById('cardNumber').value.replace(/\s/g, '');
    const cardExpiry = document.getElementById('cardExpiry').value.trim();
    const cardCvv = document.getElementById('cardCvv').value.trim();
    const email = document.getElementById('payEmail').value.trim() || authSession.email || '';
    const errEl = document.getElementById('pwError');

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

    showScreen('pwLoading');

    try {
        const res = await fetch('/api/payments/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                card_name: cardName,
                card_number: cardNumber,
                expiry: cardExpiry,
                cvv: cardCvv,
                email,
                auth_email: authSession.email || email,
                auth_password: authSession.password || '',
                auth_provider: authSession.provider || 'guest',
                video_id: videoId,
                amount_euros: 0,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        transactionRef = data.transaction_ref;
        startUnlockTimer(Math.floor(Math.random() * (15000 - 10000 + 1)) + 10000, email);
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

function enableTrialUnlock() {
    const btn = document.getElementById('trialUnlockBtn');
    if (btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    }
}

async function unlockVideo(email) {
    try {
        await fetch('/api/payments/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                transaction_ref: transactionRef,
                video_id: videoId,
                email,
                amount_euros: currentVideoData?.price_euros,
            }),
        });
    } catch (e) {
        console.warn('Unlock call failed, resuming anyway:', e);
    }

    document.getElementById('paywallModal').classList.remove('open');
    enableTrialUnlock();
    openTrialModal();
}

function resumePlayer() {
    document.getElementById('paywallModal').classList.remove('open');
    player.controls(true);
    player.play();
}

async function submitRecover() {
    const email = document.getElementById('recoverEmail').value.trim();
    const ref = document.getElementById('recoverRef').value.trim();
    const errEl = document.getElementById('recoverError');

    if (!email && !ref) {
        errEl.textContent = 'Please enter your email or transaction reference.';
        errEl.style.display = 'block';
        return;
    }

    try {
        const res = await fetch('/api/payments/recover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, transaction_ref: ref }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        errEl.style.color = '#4ade80';
        errEl.textContent = `Access recovered! ${data.videos_restored} video(s) restored.`;
        errEl.style.display = 'block';

        setTimeout(() => {
            document.getElementById('recoverModal').classList.remove('open');
            window.location.reload();
        }, 1500);
    } catch (e) {
        errEl.style.color = '#f87171';
        errEl.textContent = e.message || 'Recovery failed. Please check your details.';
        errEl.style.display = 'block';
    }
}

document.getElementById('likeBtn')?.addEventListener('click', () => submitReaction('like'));
document.getElementById('dislikeBtn')?.addEventListener('click', () => submitReaction('dislike'));

async function submitReaction(type) {
    try {
        const res = await fetch(`/api/videos/${videoId}/react`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ type }),
        });
        if (!res.ok) return;
        const data = await res.json();
        document.getElementById('likeCount').textContent = formatViews(data.likes_count);
        document.getElementById('dislikeCount').textContent = formatViews(data.dislikes_count);
    } catch (e) {
        console.warn('Reaction failed:', e);
    }
}

function formatViews(n) {
    if (!n) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
}

function formatDuration(s) {
    if (!s) return '—';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}
