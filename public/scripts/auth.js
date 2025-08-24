//auth  stuff to be used accross the website. Seperated for peace of mind. Jeesis!!!
(function (global) {
    let _user = null;
    let _resolveReady;
    const _ready = new Promise(r => (_resolveReady = r));
    const _subs = [];
  
    function _currentUrl() {
      return window.location.pathname + window.location.search + window.location.hash;
    }
    function _getParam(name) {
      return new URLSearchParams(window.location.search).get(name);
    }
  
    function init() {
      try {
        firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch (_) {}
  
      firebase.auth().onAuthStateChanged(u => {
        _user = u || null;
        _subs.forEach(cb => { try { cb(_user); } catch {} });
        if (_resolveReady) { _resolveReady(); _resolveReady = null; }
      });
    }
  
    function ready() {
    return _ready; 
    }
    function currentUser() { 
    return _user; 
    }
    function onChange(cb) {
      _subs.push(cb);
      return () => { const i = _subs.indexOf(cb); if (i >= 0) _subs.splice(i, 1); };
    }
  
    async function signIn(email, password) {
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      return firebase.auth().signInWithEmailAndPassword(email, password);
    }
    function signOut() { return firebase.auth().signOut(); }
  
    async function requireAuthOrRedirect() {
      await ready();
      if (!_user) {
        const rt = encodeURIComponent(_currentUrl());
        window.location.assign(`index.html?returnTo=${rt}`);
        throw new Error("Redirecting to login");
      }
    }
  
    // Hook up the homepage modal’s button & Enter key. Also auto-open if "returnTo" exists.
    function wireIndexLoginModal() {
      const boot = (event) => { //do i even need this event thingy here>?>>
        const emailEl  = document.getElementById("authEmail");
        const passEl   = document.getElementById("authPassword");
        const submitEl = document.querySelector("#exampleModal .btn.btn-primary");
        if (!emailEl || !passEl || !submitEl) return;
  
        const doLogin = async (e) => {
          e && e.preventDefault();
          try {
            await signIn((emailEl.value || "").trim(), passEl.value || "");
            const dest = _getParam("returnTo") || "board.html";
            try { $("#exampleModal").modal("hide"); } catch (_) {}
            window.location.assign(dest);
          } catch (err) {
            console.error("Login failed:", err);
            alert(err.message || "Login failed");
          }
        };
        submitEl.addEventListener("click", doLogin);
        emailEl.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(e); });
        passEl.addEventListener("keydown",  e => { if (e.key === "Enter") doLogin(e); });
  
        if (_getParam("returnTo")) { try { $("#exampleModal").modal("show"); } catch (_) {} }
      };
  
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
      else boot();
    }
  
    init();
    global.imibAuth = { ready, currentUser, onChange, signIn, signOut, requireAuthOrRedirect, wireIndexLoginModal };
  })(window);

  
  