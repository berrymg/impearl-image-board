//namespace
var imib = imib || {};

//keys
imib.FB_COLLECTION_BOARDS  = "boards";
imib.FB_COLLECTION_THREADS = "threads";
imib.FB_COLLECTION_POSTS   = "posts";

//helpers!!!
imib.util = {
  boardId() {
    const el = document.querySelector("[data-board-id]") || document.body;
    return (el.dataset && el.dataset.boardId) ? el.dataset.boardId : "board"; //these question mark failsafes are dope..
  },
  tsToString(ts) {
    try {
      const d = ts?.toDate ? ts.toDate() : new Date(ts || Date.now());
      return d.toLocaleString();
    } catch { return ""; }
  },
  esc(myString) {
    return (myString || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },
  snippet(myString, n = 180) {
    myString = myString || ""; return myString.length > n ? myString.slice(0, n) + "…" : myString;
  },
  getFileInput() {
    return document.getElementById("pbFile") || document.getElementById("pbfile");
  },

  applyAuthVisibility() {
    const uid = firebase.auth().currentUser?.uid || "";
  
    document.querySelectorAll('.thread .op, .thread .reply').forEach(container => {
      const authorId = container.getAttribute('data-author-id') || "";
      const showMine = uid && authorId && uid === authorId;
  
      container.querySelectorAll('.editSpan, .deleteSpan').forEach(el => {
        el.style.display = showMine ? 'inline' : 'none';
      });
    });
  }, 
};

imib.BoardModel = class {
  constructor(boardId) {
    this.boardId = boardId;
    this.db = firebase.firestore();
    this.storage = (firebase.storage ? firebase.storage() : null);
  }

  _boardRef() { return this.db.collection(imib.FB_COLLECTION_BOARDS).doc(this.boardId); }
  _threadsCol() { return this._boardRef().collection(imib.FB_COLLECTION_THREADS); }
  _postsCol(threadId) { return this._threadsCol().doc(threadId).collection(imib.FB_COLLECTION_POSTS); }

  async _upload(threadId, postId, file) {
    if (!file) return null;
    if (!this.storage) throw new Error("Storage not found!");
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const suffix = ext ? "." + ext : "";
    const path = `boards/${this.boardId}/threads/${threadId}/posts/${postId}${suffix}`;
    const snap = await this.storage.ref(path).put(file);
    const url  = await snap.ref.getDownloadURL();
    return { url, ext, size: file.size, name: file.name, storagePath: snap.ref.fullPath };
  }

  async createThread({ displayName, subject, comment, file }) {
    const threadRef = this._threadsCol().doc();
    const postRef   = this._postsCol(threadRef.id).doc();

    let image = null;
    if (file) image = await this._upload(threadRef.id, postRef.id, file);

    const now = firebase.firestore.FieldValue.serverTimestamp();
    const uid = firebase.auth()?.currentUser?.uid || null;
    const authorName = (displayName || "").trim() || "anonymous";

    const threadDoc = {
      boardId: this.boardId,
      subject: subject || null,
      opPostId: postRef.id,
      opAuthorId: uid || null,
      opAuthorName: authorName,                   
      opSnippet: imib.util.snippet(comment, 2000),
      opImageThumb: image ? image.url : null,
      createdAt: now,
      lastBumpAt: now,
      postCount: 1,
      replyCount: 0
    };

    const postDoc = {
      id: postRef.id,
      threadId: threadRef.id,
      boardId: this.boardId,
      isOP: true,
      authorId: uid || null,                    
      authorName,                   
      subject: subject || null,
      comment: comment || "",
      image,
      createdAt: now
    };

    const batch = this.db.batch();
    batch.set(threadRef, threadDoc);
    batch.set(postRef, postDoc);
    await batch.commit();
    return { threadId: threadRef.id, postId: postRef.id };
  }

  // Live watch: with bump order.. newest-bumped first
  watchThreads(onChange) {
    return this._threadsCol()
      .orderBy("lastBumpAt", "desc")
      .onSnapshot((snap) => {
        const arr = [];
        snap.forEach((doc) => arr.push({ id: doc.id, ...doc.data() }));
        onChange(arr);
      }, (err) => {
        console.error("watchThreads error:", err);
        alert("Threads failed to load: " + err.message);
      });
  }

  async createReply({ threadId, replyToPostId = null, displayName = "", subject = "", comment = "", file = null }) {
    if (!threadId) throw new Error("Missing threadId");
    const postsCol = this._postsCol(threadId);
    const postRef = postsCol.doc();

    let image = null;
    if (file) image = await this._upload(threadId, postRef.id, file);

    const now = firebase.firestore.FieldValue.serverTimestamp();
    const uid = firebase.auth()?.currentUser?.uid || null;
    const inc = firebase.firestore.FieldValue.increment(1);
    const authorName = (displayName || "").trim() || "anonymous";

    const postDoc = {
      id: postRef.id,
      threadId,
      boardId: this.boardId,
      isOP: false,
      authorId: uid || null,                     // TODO: auth styff haha
      authorName,                                // display name
      subject: subject || null,
      comment: comment || "",
      image,
      replyTo: replyToPostId || null,
      createdAt: now
    };

    const threadRef = this._threadsCol().doc(threadId);
    const batch = this.db.batch();
    batch.set(postRef, postDoc);
    batch.update(threadRef, {
      postCount: inc,
      replyCount: inc,
      lastBumpAt: now
    });

    await batch.commit();
    return { postId: postRef.id };
  }

  watchReplies(threadId, onChange) {
    return this._postsCol(threadId)
      .where("isOP", "==", false)
      .orderBy("createdAt", "asc")
      .onSnapshot(
        (snap) => {
          const arr = [];
          snap.forEach((doc) => arr.push({ id: doc.id, ...doc.data() }));
          onChange(arr);
        },
        (err) => console.error("watchReplies error:", err)
      );
  }

  async updatePost({ threadId, postId, subject, comment, isOP }) {
    if (!threadId || !postId) throw new Error("Missing edit target");
    const postRef = this._postsCol(threadId).doc(postId);
    const updates = {
      subject: subject ? subject : null,
      comment: comment != null ? comment : ""
    };
    await postRef.update(updates);

    if (isOP) {
      const threadRef = this._threadsCol().doc(threadId);
      await threadRef.update({
        subject: updates.subject,
        opSnippet: imib.util.snippet(updates.comment || "", 2000)
      });
    }
  }

  async deletePost({ threadId, postId, isOP }) {
    if (!threadId || !postId) throw new Error("Missing delete target");

    if (!isOP) {
      const postRef   = this._postsCol(threadId).doc(postId);
      const threadRef = this._threadsCol().doc(threadId);
      const dec = firebase.firestore.FieldValue.increment(-1);

      let storagePath = null;
      const snap = await postRef.get();
      const data = snap.data() || {};
      if (data?.image?.storagePath) storagePath = data.image.storagePath;

      const batch = this.db.batch();
      batch.delete(postRef);
      batch.update(threadRef, { postCount: dec, replyCount: dec });
      await batch.commit();

      try { if (storagePath && this.storage) await this.storage.ref(storagePath).delete(); } catch (_) {}
      return;
    }

    const postsSnap = await this._postsCol(threadId).get();
    const allDocs = [];
    postsSnap.forEach(d => allDocs.push(d));

    if (this.storage) {
      await Promise.all(allDocs.map(async (d) => {
        const sp = d.data()?.image?.storagePath;
        if (sp) { try { await this.storage.ref(sp).delete(); } catch (_) {} }
      }));
    }

    while (allDocs.length) {
      const chunk = allDocs.splice(0, 400);
      const batch = this.db.batch();
      chunk.forEach(d => batch.delete(d.ref));
      if (allDocs.length === 0) batch.delete(this._threadsCol().doc(threadId));
      await batch.commit();
    }
  }
}; //i hate it here... will make pretty and readable one day. 

// controller class
  imib.BoardController = class {
  constructor(model) {
    this.model = model;

    this._watchedReplies = new Map();
    this._replyTarget = { threadId: null, replyToPostId: null };

    // Reply modal
    $("#replyModal").on("show.bs.modal", (e) => {
      const anchor = e.relatedTarget;
      const $thread = $(anchor).closest(".thread");
      this._replyTarget.threadId = $thread.data("thread-id") || null;
      this._replyTarget.replyToPostId = $(anchor).data("reply-to") || $thread.find(".op").data("post-id") || null;

      // reset fields every open
      $("#replyDisplayName").val("");
      $("#replySubject").val("");
      $("#replyComment").val("");
      const f = document.getElementById("replyFile"); if (f) f.value = "";
    });

    // Reply modal, post button!!!!
    $("#replyModal .btn.btn-primary").on("click", async (evt) => {
      evt.preventDefault();
      const displayName = ($("#replyDisplayName").val() || "").trim();
      const subject = ($("#replySubject").val() || "").trim();
      const comment = ($("#replyComment").val() || "").trim();
      const fileEl = document.getElementById("replyFile");
      const file = fileEl?.files?.[0] || null;

      if (!subject && !comment && !file) {
        alert("Type a comment, add a subject, or attach a file.");
        return;
      }
      if (!this._replyTarget.threadId) {
        alert("Missing thread context for reply.");
        return;
      }

      try {
        await this.model.createReply({
          threadId: this._replyTarget.threadId,
          replyToPostId: this._replyTarget.replyToPostId,
          displayName, subject, comment, file
        });
        $("#replyModal").modal("hide");
      } catch (err) {
        console.error("createReply failed:", err);
        alert("Failed to post reply: " + err.message);
      }
    });

    // Attaches reply watchers
    const cont = document.getElementById("threadContainer");
    if (cont) {
      this._ensureReplyWatches();
      this._observer = new MutationObserver(() => this._ensureReplyWatches());
      this._observer.observe(cont, { childList: true });
    }

    // edit/delete modal targets
    this._editTarget   = { threadId: null, postId: null, isOP: false };
    this._deleteTarget = { threadId: null, postId: null, isOP: false };

    $("#editModal").on("show.bs.modal", (e) => {
      const anchor  = e.relatedTarget;
      const $thread  = $(anchor).closest(".thread");
      const threadId = $thread.data("thread-id");
      const postId   = anchor.getAttribute("data-edit");
      const isOP     = $(anchor).closest(".op").length > 0;

      this._editTarget = { threadId, postId, isOP };
      this._prefillEditModal(threadId, postId, isOP);
    });

    $("#editModal .btn.btn-primary").on("click", async (evt) => {
      evt.preventDefault();
      const subject = ($("#editSubject").val() || "").trim();
      const comment = ($("#editComment").val() || "").trim();
      const { threadId, postId, isOP } = this._editTarget;

      if (!threadId || !postId) { alert("Missing edit target."); return; }

      try {
        await this.model.updatePost({ threadId, postId, subject, comment, isOP });
        $("#editModal").modal("hide");
      } catch (err) {
        console.error("updatePost failed:", err);
        alert("Failed to save changes: " + err.message);
      }
    });

    $("#deleteModal").on("show.bs.modal", (e) => {
      const anchor  = e.relatedTarget;
      const $thread  = $(anchor).closest(".thread");
      const threadId = $thread.data("thread-id");
      const postId   = anchor.getAttribute("data-delete");
      const isOP     = $(anchor).closest(".op").length > 0;

      this._deleteTarget = { threadId, postId, isOP };
    });

    $("#deleteModal .btn.btn-primary").on("click", async (evt) => {
      evt.preventDefault();
      const { threadId, postId, isOP } = this._deleteTarget;
      if (!threadId || !postId) { alert("Missing delete target."); return; }

      try {
        await this.model.deletePost({ threadId, postId, isOP });
        $("#deleteModal").modal("hide");
      } catch (err) {
        console.error("deletePost failed:", err);
        alert("Failed to delete: " + err.message);
      }
    });
  }

  _prefillEditModal(threadId, postId, isOP) {
    let $post;
    const $thread = $(`.thread[data-thread-id="${CSS.escape(threadId)}"]`);
    if (isOP) { $post = $thread.find(".op"); }
    else { $post = $thread.find(`.reply[data-post-id="${CSS.escape(postId)}"]`); }
    const subj = ($post.find(".postSubject").text() || "").trim();
    const comm = ($post.find(".comment").text() || "").trim();
    $("#editSubject").val(subj);
    $("#editComment").val(comm);
  }

  async submitPost() {
    const authorEl  = document.getElementById("pbAuthor");
    const subjectEl = document.getElementById("pbSubject");
    const commentEl = document.getElementById("pbComment");
    const fileEl    = imib.util.getFileInput();

    const displayName = authorEl ? authorEl.value.trim() : "";
    const subject = subjectEl ? subjectEl.value.trim() : "";
    const comment = commentEl ? commentEl.value.trim() : "";
    const file    = (fileEl && fileEl.files && fileEl.files[0]) ? fileEl.files[0] : null;

    if (!subject && !comment && !file) {
      alert("you gotta be posting at least something bro");
      return;
    }

    await this.model.createThread({ displayName, subject, comment, file });

    // clear everythang
    if (authorEl)  authorEl.value  = "";
    if (subjectEl) subjectEl.value = "";
    if (commentEl) commentEl.value = "";
    if (fileEl)    fileEl.value    = "";
  }

  updateView(threads) {
    const cont = document.getElementById("threadContainer");
    if (!cont) return;

    cont.innerHTML = threads.map((t) => {
      const ts = imib.util.tsToString(t.createdAt); //timestamp. ts=timestamp
      const id = t.id;
      const imgHtml = t.opImageThumb ? `<img src="${t.opImageThumb}" alt="">` : "";
      const opReplyLink  = `<span>[<a href="#" class="reply-link" data-reply-to="${imib.util.esc(t.opPostId || "")}" data-toggle="modal" data-target="#replyModal">reply</a>]</span>`;
      const opEditLink   = `<span class="editSpan">[<a href="#" class="edit-link" data-edit="${imib.util.esc(t.opPostId || "")}" data-toggle="modal" data-target="#editModal">edit</a>]</span>`;
      const opDeleteLink = `<span class="deleteSpan">[<a href="#" class="delete-link" data-delete="${imib.util.esc(t.opPostId || "")}" data-toggle="modal" data-target="#deleteModal">delete</a>]</span>`;
      const author = t.opAuthorName || "anonymous";

      return `
        <div class="thread" id="thread-${id}" data-thread-id="${id}">
          <div class="op" data-post-id="${imib.util.esc(t.opPostId || "")}"
          data-author-id="${imib.util.esc(t.opAuthorId || "")}">
            ${imgHtml}
            <div class="post-bar">
              <span class="author-span">${imib.util.esc(author)}</span>
              ${t.subject ? `<span class="postSubject">${imib.util.esc(t.subject)}</span><span> | </span>` : ""}
              <span>${imib.util.esc(ts)}</span>
              ${opReplyLink}${opEditLink}${opDeleteLink}
            </div>
            <div class="comment">${imib.util.esc(t.opSnippet || "")}</div>
          </div>
          <div class="replies"></div>
          <br>
        </div>`;
    }).join("");

    this._resetReplyWatches();
    this._ensureReplyWatches();
    imib.util.applyAuthVisibility();
  }

  _ensureReplyWatches() {
    const cont = document.getElementById("threadContainer");
    if (!cont) return;
    cont.querySelectorAll(".thread").forEach((el) => {
      const tid = el.getAttribute("data-thread-id");
      if (!tid || this._watchedReplies.has(tid)) return;
      const unsub = this.model.watchReplies(tid, (replies) => this._renderReplies(tid, replies));
      this._watchedReplies.set(tid, unsub);
    });
  }

  _resetReplyWatches() {
    this._watchedReplies.forEach((unsub) => { try { unsub(); } catch {} });
    this._watchedReplies.clear();
  }

  _renderReplies(threadId, replies) {
    const threadEl = document.querySelector(`.thread[data-thread-id="${CSS.escape(threadId)}"]`);
    if (!threadEl) return;
    const cont = threadEl.querySelector(".replies");
    if (!cont) return;
    cont.innerHTML = replies.map((p) => this._replyHtml(p)).join("");
    imib.util.applyAuthVisibility()
  }

  _replyHtml(p) {
    const ts = imib.util.tsToString(p.createdAt);
    const imgHtml = p.image?.url ? `<img src="${p.image.url}" alt="">` : "";
    const subjHtml = p.subject ? `<span class="postSubject">${imib.util.esc(p.subject)}</span><span> | </span>` : "";
    const replyLink  = `<span>[<a href="#" class="reply-link" data-reply-to="${imib.util.esc(p.id)}" data-toggle="modal" data-target="#replyModal">reply</a>]</span>`;
    const editLink   = `<span class="editSpan">[<a href="#" class="edit-link" data-edit="${imib.util.esc(p.id)}" data-toggle="modal" data-target="#editModal">edit</a>]</span>`;
    const deleteLink = `<span class="deleteSpan">[<a href="#" class="delete-link" data-delete="${imib.util.esc(p.id)}" data-toggle="modal" data-target="#deleteModal">delete</a>]</span>`;
    const author = p.authorName || "anonymous";

    return `
      <div class="reply" data-post-id="${imib.util.esc(p.id)}"
      data-author-id="${imib.util.esc(p.authorId || "")}">
        ${imgHtml}
        <div class="post-bar">
          <span class="author-span">${imib.util.esc(author)}</span>
          ${subjHtml}
          <span>${imib.util.esc(ts)}</span>
          ${replyLink}${editLink}${deleteLink}
        </div>
        <div class="comment">${imib.util.esc(p.comment || "")}</div>
      </div>
      <br>
    `;
  }
};


// main
imib.main = function () {
  const model = new imib.BoardModel(imib.util.boardId());
  const controller = new imib.BoardController(model);

  $("#pbSubmit").click((event) => {
    event.preventDefault();
    controller.submitPost();
  });

  model.watchThreads((threads) => controller.updateView(threads));
};

imib.main();
