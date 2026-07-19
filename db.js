(function () {
  const DB_NAME = "securities-study-profile";
  const STORE_NAME = "profile";
  const SNAPSHOT_KEY = "sqlite-snapshot";
  const HANDLE_KEY = "sqlite-file-handle";

  let SQL = null;
  let db = null;
  let fileHandle = null;
  let saveTimer = null;
  let savePromise = Promise.resolve();
  let statusListener = () => {};
  let profileName = "浏览器自动保存档案";
  let lastSavedAt = null;
  let idbAvailable = true;

  function emitStatus(state, message) {
    statusListener({ state, message, profileName, lastSavedAt, bound: Boolean(fileHandle) });
  }

  function openBrowserDb() {
    if (!idbAvailable) return Promise.reject(new Error("IndexedDB unavailable"));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        idbAvailable = false;
        reject(new Error("IndexedDB unavailable"));
      }, 1500);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        clearTimeout(timeout);
        if (settled) request.result.close();
        else { settled = true; resolve(request.result); }
      };
      request.onerror = () => {
        clearTimeout(timeout);
        idbAvailable = false;
        if (!settled) { settled = true; reject(request.error); }
      };
    });
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    if (!value) return null;
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function getSnapshot() {
    const idbValue = await idbGet(SNAPSHOT_KEY).catch(() => null);
    if (idbValue) return new Uint8Array(idbValue);
    try { return base64ToBytes(localStorage.getItem(SNAPSHOT_KEY)); } catch (_) { return null; }
  }

  async function setSnapshot(bytes) {
    try {
      await idbSet(SNAPSHOT_KEY, bytes.buffer.slice(0));
      return;
    } catch (_) {}
    try { localStorage.setItem(SNAPSHOT_KEY, bytesToBase64(bytes)); } catch (_) {}
  }

  async function idbGet(key) {
    const storeDb = await openBrowserDb();
    return new Promise((resolve, reject) => {
      const tx = storeDb.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => storeDb.close();
    });
  }

  async function idbSet(key, value) {
    const storeDb = await openBrowserDb();
    return new Promise((resolve, reject) => {
      const tx = storeDb.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => { storeDb.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(key) {
    const storeDb = await openBrowserDb();
    return new Promise((resolve, reject) => {
      const tx = storeDb.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => { storeDb.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }

  function run(sql, params = []) {
    db.run(sql, params);
  }

  function all(sql, params = []) {
    const statement = db.prepare(sql);
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    statement.free();
    return rows;
  }

  function get(sql, params = []) {
    return all(sql, params)[0] || null;
  }

  function schema() {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS profile_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        question_version INTEGER NOT NULL DEFAULT 1,
        selected_json TEXT NOT NULL,
        is_correct INTEGER NOT NULL,
        mode TEXT NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_question ON attempts(question_id);
      CREATE INDEX IF NOT EXISTS idx_attempts_created ON attempts(created_at);
      CREATE TABLE IF NOT EXISTS bookmarks (
        question_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        modified_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS notes (
        question_id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        modified_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS exam_sessions (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        subject_id TEXT,
        question_ids_json TEXT NOT NULL,
        score INTEGER,
        total INTEGER NOT NULL,
        duration_seconds INTEGER,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS exam_answers (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        selected_json TEXT NOT NULL,
        is_correct INTEGER NOT NULL,
        answered_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        modified_at TEXT NOT NULL
      );
    `);
    const bookmarkColumns = all("PRAGMA table_info(bookmarks)").map((row) => row.name);
    if (!bookmarkColumns.includes("deleted_at")) run("ALTER TABLE bookmarks ADD COLUMN deleted_at TEXT");
    const now = new Date().toISOString();
    if (!get("SELECT value FROM profile_meta WHERE key='created_at'")) {
      run("INSERT INTO profile_meta(key,value) VALUES (?,?)", ["created_at", now]);
      run("INSERT INTO profile_meta(key,value) VALUES (?,?)", ["schema_version", "1"]);
      run("INSERT INTO profile_meta(key,value) VALUES (?,?)", ["device_id", crypto.randomUUID()]);
    }
  }

  function integrityCheck(candidate) {
    const rows = candidate.exec("PRAGMA integrity_check");
    const value = rows?.[0]?.values?.[0]?.[0];
    if (value !== "ok") throw new Error("SQLite 完整性检查未通过");
  }

  function tableColumns(candidate, table) {
    const result = candidate.exec(`PRAGMA table_info(${table})`)[0];
    if (!result) return [];
    const nameIndex = result.columns.indexOf("name");
    return result.values.map((row) => row[nameIndex]);
  }

  function validateStudyProfile(candidate) {
    const tablesResult = candidate.exec("SELECT name FROM sqlite_master WHERE type='table'")[0];
    const tables = new Set((tablesResult?.values || []).map((row) => row[0]));
    if (!tables.has("profile_meta") || !tables.has("attempts")) {
      throw new Error("不是本工具生成的 SQLite 学习档案");
    }
    const metaColumns = new Set(tableColumns(candidate, "profile_meta"));
    const attemptColumns = new Set(tableColumns(candidate, "attempts"));
    if (!["key", "value"].every((column) => metaColumns.has(column)) ||
        !["id", "question_id", "selected_json", "is_correct", "mode", "created_at"].every((column) => attemptColumns.has(column))) {
      throw new Error("学习档案缺少必要字段");
    }
    const versionResult = candidate.exec("SELECT value FROM profile_meta WHERE key='schema_version' LIMIT 1")[0];
    const version = Number(versionResult?.values?.[0]?.[0] || 1);
    if (!Number.isFinite(version) || version > 1) throw new Error(`不支持的学习档案版本：${version}`);
  }

  function replaceDb(bytes) {
    const candidate = bytes?.length ? new SQL.Database(bytes) : new SQL.Database();
    try {
      integrityCheck(candidate);
      if (bytes?.length) validateStudyProfile(candidate);
    } catch (error) {
      candidate.close();
      throw error;
    }
    const previous = db;
    db = candidate;
    try {
      schema();
      all("SELECT id,question_id,selected_json,is_correct,mode,created_at FROM attempts LIMIT 1");
    } catch (error) {
      db = previous;
      candidate.close();
      throw new Error(`学习档案结构不兼容：${error.message}`);
    }
    if (previous) previous.close();
  }

  async function init() {
    const wasmBinary = Uint8Array.from(atob(window.SQL_WASM_BASE64), (char) => char.charCodeAt(0));
    SQL = await window.initSqlJs({ wasmBinary });
    const savedHandle = await idbGet(HANDLE_KEY).catch(() => null);
    let snapshot = null;
    if (savedHandle) {
      try {
        const permission = await savedHandle.queryPermission({ mode: "readwrite" });
        if (permission === "granted") {
          fileHandle = savedHandle;
          profileName = fileHandle.name;
          const file = await fileHandle.getFile();
          snapshot = file.size ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
        }
      } catch (_) {}
    }
    if (!snapshot) snapshot = await getSnapshot();
    replaceDb(snapshot);
    emitStatus("saved", fileHandle ? "已绑定学习档案" : "已保存到浏览器");
  }

  async function persistNow() {
    emitStatus("saving", "保存中");
    const bytes = db.export();
    await setSnapshot(bytes);
    if (fileHandle) {
      let permission = await fileHandle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        permission = await fileHandle.requestPermission({ mode: "readwrite" });
      }
      if (permission === "granted") {
        const writable = await fileHandle.createWritable();
        await writable.write(bytes);
        await writable.close();
      } else {
        throw new Error("没有学习档案写入权限");
      }
    }
    lastSavedAt = new Date();
    emitStatus("saved", fileHandle ? "已写入档案" : "已保存到浏览器");
  }

  function scheduleSave(delay = 350) {
    clearTimeout(saveTimer);
    emitStatus("saving", "等待保存");
    saveTimer = setTimeout(() => {
      savePromise = savePromise.then(persistNow).catch((error) => {
        emitStatus("error", error.message || "保存失败");
      });
    }, delay);
  }

  async function flush() {
    clearTimeout(saveTimer);
    savePromise = savePromise.then(persistNow);
    return savePromise;
  }

  async function createBoundProfile() {
    if (!window.showSaveFilePicker) throw new Error("当前浏览器不支持直接创建文件，请使用导出功能");
    const handle = await window.showSaveFilePicker({
      suggestedName: "securities-study-profile.sqlite",
      types: [{ description: "SQLite 学习档案", accept: { "application/x-sqlite3": [".sqlite", ".db"] } }]
    });
    replaceDb(null);
    fileHandle = handle;
    profileName = handle.name;
    await idbSet(HANDLE_KEY, handle).catch(() => {});
    await persistNow();
  }

  async function openBoundProfile() {
    if (!window.showOpenFilePicker) throw new Error("当前浏览器不支持直接打开文件，请使用导入功能");
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: "SQLite 学习档案", accept: { "application/x-sqlite3": [".sqlite", ".db"] } }]
    });
    const file = await handle.getFile();
    replaceDb(new Uint8Array(await file.arrayBuffer()));
    fileHandle = handle;
    profileName = handle.name;
    await idbSet(HANDLE_KEY, handle).catch(() => {});
    await persistNow();
  }

  async function importBytes(bytes, name = "导入的学习档案.sqlite", bind = false) {
    replaceDb(new Uint8Array(bytes));
    profileName = name;
    if (!bind) {
      fileHandle = null;
      await idbDelete(HANDLE_KEY).catch(() => {});
    }
    await persistNow();
  }

  function download(name, bytes) {
    const blob = new Blob([bytes], { type: "application/x-sqlite3" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportProfile() {
    await flush();
    download("securities-study-profile.sqlite", db.export());
  }

  async function mergeBytes(bytes) {
    const incoming = new SQL.Database(new Uint8Array(bytes));
    try {
      integrityCheck(incoming);
      validateStudyProfile(incoming);
    } catch (error) {
      incoming.close();
      throw error;
    }
    const incomingRows = (table) => {
      const result = incoming.exec(`SELECT * FROM ${table}`)[0];
      if (!result) return [];
      return result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])));
    };
    run("BEGIN");
    try {
      for (const table of ["attempts", "exam_sessions", "exam_answers"]) {
        const exists = incoming.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
        if (!exists.length) continue;
        const result = incoming.exec(`SELECT * FROM ${table}`)[0];
        if (!result) continue;
        const columns = result.columns;
        const placeholders = columns.map(() => "?").join(",");
        for (const values of result.values) {
          run(`INSERT OR IGNORE INTO ${table}(${columns.join(",")}) VALUES (${placeholders})`, values);
        }
      }
      if (incoming.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").length) {
        for (const row of incomingRows("notes")) {
          const local = get("SELECT modified_at FROM notes WHERE question_id=?", [row.question_id]);
          if (!local || String(row.modified_at) > String(local.modified_at)) {
            run("INSERT OR REPLACE INTO notes(question_id,body,modified_at) VALUES (?,?,?)", [row.question_id, row.body, row.modified_at]);
          }
        }
      }
      if (incoming.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").length) {
        for (const row of incomingRows("settings")) {
          const local = get("SELECT modified_at FROM settings WHERE key=?", [row.key]);
          if (!local || String(row.modified_at) > String(local.modified_at)) {
            run("INSERT OR REPLACE INTO settings(key,value,modified_at) VALUES (?,?,?)", [row.key, row.value, row.modified_at]);
          }
        }
      }
      if (incoming.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='bookmarks'").length) {
        for (const row of incomingRows("bookmarks")) {
          const local = get("SELECT modified_at FROM bookmarks WHERE question_id=?", [row.question_id]);
          if (!local || String(row.modified_at) > String(local.modified_at)) {
            run("INSERT OR REPLACE INTO bookmarks(question_id,created_at,modified_at,deleted_at) VALUES (?,?,?,?)", [row.question_id, row.created_at, row.modified_at, row.deleted_at || null]);
          }
        }
      }
      run("COMMIT");
    } catch (error) {
      run("ROLLBACK");
      incoming.close();
      throw error;
    }
    incoming.close();
    await persistNow();
  }

  function recordAttempt({ questionId, questionVersion = 1, selected, isCorrect, mode, sessionId = null }) {
    run(
      "INSERT INTO attempts(id,question_id,question_version,selected_json,is_correct,mode,session_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
      [crypto.randomUUID(), questionId, questionVersion, JSON.stringify(selected), isCorrect ? 1 : 0, mode, sessionId, new Date().toISOString()]
    );
    scheduleSave();
  }

  function toggleBookmark(questionId) {
    const existing = get("SELECT question_id,created_at,deleted_at FROM bookmarks WHERE question_id=?", [questionId]);
    const now = new Date().toISOString();
    if (existing && !existing.deleted_at) run("UPDATE bookmarks SET modified_at=?,deleted_at=? WHERE question_id=?", [now, now, questionId]);
    else if (existing) run("UPDATE bookmarks SET modified_at=?,deleted_at=NULL WHERE question_id=?", [now, questionId]);
    else run("INSERT INTO bookmarks(question_id,created_at,modified_at,deleted_at) VALUES (?,?,?,NULL)", [questionId, now, now]);
    scheduleSave();
    return !(existing && !existing.deleted_at);
  }

  function isBookmarked(questionId) {
    return Boolean(get("SELECT question_id FROM bookmarks WHERE question_id=? AND deleted_at IS NULL", [questionId]));
  }

  function saveNote(questionId, body) {
    run(
      "INSERT INTO notes(question_id,body,modified_at) VALUES (?,?,?) ON CONFLICT(question_id) DO UPDATE SET body=excluded.body,modified_at=excluded.modified_at",
      [questionId, body, new Date().toISOString()]
    );
    scheduleSave();
  }

  function getNote(questionId) {
    return get("SELECT body FROM notes WHERE question_id=?", [questionId])?.body || "";
  }

  function createSession({ id, mode, subjectId, questionIds }) {
    run(
      "INSERT INTO exam_sessions(id,mode,subject_id,question_ids_json,total,started_at) VALUES (?,?,?,?,?,?)",
      [id, mode, subjectId || null, JSON.stringify(questionIds), questionIds.length, new Date().toISOString()]
    );
    scheduleSave();
  }

  function completeSession({ id, score, durationSeconds }) {
    run(
      "UPDATE exam_sessions SET score=?,duration_seconds=?,completed_at=? WHERE id=?",
      [score, durationSeconds, new Date().toISOString(), id]
    );
    scheduleSave();
  }

  function recordExamAnswer({ sessionId, questionId, selected, isCorrect }) {
    const id = `${sessionId}:${questionId}`;
    run(
      "INSERT OR REPLACE INTO exam_answers(id,session_id,question_id,selected_json,is_correct,answered_at) VALUES (?,?,?,?,?,?)",
      [id, sessionId, questionId, JSON.stringify(selected), isCorrect ? 1 : 0, new Date().toISOString()]
    );
    scheduleSave();
  }

  function getActiveExam() {
    const session = get("SELECT * FROM exam_sessions WHERE mode='exam' AND completed_at IS NULL ORDER BY started_at DESC LIMIT 1");
    if (!session) return null;
    const answers = all("SELECT question_id,selected_json FROM exam_answers WHERE session_id=?", [session.id]);
    return {
      ...session,
      questionIds: JSON.parse(session.question_ids_json),
      answers: Object.fromEntries(answers.map((row) => [row.question_id, JSON.parse(row.selected_json)]))
    };
  }

  function getDashboard() {
    const total = Number(get("SELECT COUNT(*) AS c FROM attempts")?.c || 0);
    const correct = Number(get("SELECT COUNT(*) AS c FROM attempts WHERE is_correct=1")?.c || 0);
    const unique = Number(get("SELECT COUNT(DISTINCT question_id) AS c FROM attempts")?.c || 0);
    const wrongUnique = getWrongQuestionIds().length;
    const exams = Number(get("SELECT COUNT(*) AS c FROM exam_sessions WHERE completed_at IS NOT NULL")?.c || 0);
    return { total, correct, unique, wrongUnique, exams, accuracy: total ? Math.round(correct * 100 / total) : 0 };
  }

  function getAttemptRows() {
    return all("SELECT * FROM attempts ORDER BY created_at DESC");
  }

  function getWrongQuestionIds() {
    return all(`
      SELECT a.question_id
      FROM attempts a
      WHERE a.rowid = (
        SELECT latest.rowid FROM attempts latest
        WHERE latest.question_id=a.question_id
        ORDER BY latest.created_at DESC, latest.rowid DESC
        LIMIT 1
      )
      AND a.is_correct=0
    `).map((row) => row.question_id);
  }

  function getBookmarkIds() {
    return all("SELECT question_id FROM bookmarks WHERE deleted_at IS NULL ORDER BY modified_at DESC").map((row) => row.question_id);
  }

  function getExamHistory() {
    return all("SELECT * FROM exam_sessions WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 20");
  }

  function getMeta() {
    const rows = all("SELECT key,value FROM profile_meta");
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  window.StudyDb = {
    init,
    run,
    all,
    get,
    flush,
    createBoundProfile,
    openBoundProfile,
    importBytes,
    exportProfile,
    mergeBytes,
    recordAttempt,
    toggleBookmark,
    isBookmarked,
    saveNote,
    getNote,
    createSession,
    completeSession,
    recordExamAnswer,
    getActiveExam,
    getDashboard,
    getAttemptRows,
    getWrongQuestionIds,
    getBookmarkIds,
    getExamHistory,
    getMeta,
    onStatus(listener) { statusListener = listener; emitStatus("saved", "就绪"); },
    hasDirectFileSupport() { return Boolean(window.showOpenFilePicker && window.showSaveFilePicker); }
  };
})();
