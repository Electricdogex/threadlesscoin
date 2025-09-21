(async () => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.ENV;
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (id) => document.getElementById(id);
  const authBox = $('auth'), profileBox = $('profile'), walletBox = $('wallet');
  const miningBox = $('mining'), friendsBox = $('friends'), packagesBox = $('packages');

  function uiSignedIn(on) {
    authBox.style.display = on ? 'none' : 'block';
    [profileBox, walletBox, miningBox, friendsBox, packagesBox].forEach(el => el.style.display = on ? 'block' : 'none');
  }

  async function refreshBalance() {
    const { data, error } = await sb.from('wallets').select('balance').maybeSingle();
    if (!error && data) $('balance').textContent = data.balance ?? 0;
  }

  async function refreshProfile() {
    const { data: me, error } = await sb.auth.getUser();
    if (error || !me.user) return;
    const { data: prof } = await sb.from('profiles').select('username').eq('id', me.user.id).maybeSingle();
    $('meUser').textContent = prof?.username ? `@${prof.username}` : '(no username yet)';
  }

  // AUTH
  $('loginBtn').onclick = async () => {
    const { error } = await sb.auth.signInWithPassword({ email: $('email').value, password: $('password').value });
    if (error) return alert(error.message);
    uiSignedIn(true); await refreshProfile(); await refreshBalance();
  };
  $('signupBtn').onclick = async () => {
    const { error } = await sb.auth.signUp({ email: $('email').value, password: $('password').value });
    if (error) return alert(error.message);
    alert('Signed up—now log in.'); 
  };

  // USERNAME
  $('saveUserBtn').onclick = async () => {
    const u = $('username').value.trim();
    if (!u) return;
    const { error } = await sb.rpc('ensure_profile_username', { p_username: u });
    if (error) return alert(error.message);
    await refreshProfile();
    await sb.from('wallets').insert({ user_id: (await sb.auth.getUser()).data.user.id }).then(()=>{}).catch(()=>{});
    await refreshBalance();
  };

  // SEND
  $('sendBtn').onclick = async () => {
    const to = $('toUser').value.trim().replace(/^@/,'');
    const amt = parseInt($('amt').value, 10);
    const { data, error } = await sb.rpc('send_coins', { p_to_username: to, p_amount: amt, p_memo: null });
    if (error) return alert(error.message);
    await refreshBalance();
    alert('Sent!');
  };

  // FRIENDS
  $('addFriendBtn').onclick = async () => {
    const u = $('friendUser').value.trim().replace(/^@/,'');
    const { error } = await sb.rpc('add_friend', { p_username: u });
    if (error) return alert(error.message);
    alert('Added!');
  };

  // PACKAGES
  $('mkPkgBtn').onclick = async () => {
    const amt = parseInt($('pkgAmt').value, 10);
    const { data, error } = await sb.rpc('create_package', { p_amount: amt });
    if (error) return alert(error.message);
    $('pkgOut').innerHTML = `PassID: <code>${data.passid}</code>`;
    await refreshBalance();
  };
  $('redeemBtn').onclick = async () => {
    const code = $('redeemCode').value.trim();
    const { data, error } = await sb.rpc('redeem_package', { p_passid: code });
    if (error) return alert(error.message);
    await refreshBalance();
    alert('Redeemed!');
  };

  // MINING
  let currentChallenge = null, miningAbort = false;

  $('issueBtn').onclick = async () => {
    const diff = parseInt($('difficulty').value, 10);
    const { data, error } = await sb.rpc('issue_challenge', { p_difficulty: diff });
    if (error) return alert(error.message);
    currentChallenge = data;
    $('challengeView').textContent = JSON.stringify({ id: data.id, difficulty: data.difficulty, challenge: data.challenge }, null, 2);
    $('mineBtn').disabled = false;
  };

  $('mineBtn').onclick = async () => {
    if (!currentChallenge) return;
    miningAbort = false;
    $('mineBtn').textContent = 'Mining… (click to stop)';
    $('mineBtn').onclick = () => { miningAbort = true; $('mineBtn').textContent = 'Start mining'; $('mineBtn').onclick = startMining; };
    await startMining();
    function startMining(){} // placeholder so we can rebind above
  };

  async function sha256Hex(str) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  async function startMining() {
    const target = '0'.repeat(currentChallenge.difficulty);
    let nonce = 0;
    let last = performance.now(), hashes = 0;

    while (!miningAbort) {
      const digest = await sha256Hex(currentChallenge.challenge + (await sb.auth.getUser()).data.user.id + nonce);
      hashes++;
      if (digest.startsWith(target)) {
        const { error } = await sb.rpc('submit_solution', { p_challenge: currentChallenge.id, p_nonce: String(nonce) });
        if (error) alert(error.message); else { await refreshBalance(); alert('Solved! +1 TLC'); }
        $('mineBtn').textContent = 'Start mining'; $('mineBtn').onclick = async () => { await startMining(); };
        return;
      }
      nonce++;
      const now = performance.now();
      if (now - last > 1000) { $('hashrate').textContent = `${hashes} H/s`; hashes = 0; last = now; await new Promise(r=>setTimeout(r,0)); }
    }
  }

  // session
  sb.auth.onAuthStateChange((_e, sess) => uiSignedIn(!!sess));
  const { data: { session } } = await sb.auth.getSession();
  uiSignedIn(!!session);
  if (session) { await refreshProfile(); await refreshBalance(); }
})();
