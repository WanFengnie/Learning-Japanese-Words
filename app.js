/* 新标日单词记忆 · 应用逻辑 */
(function () {
  'use strict';

  var DATA = (typeof LESSONS !== 'undefined') ? LESSONS : {};
  var META = (typeof LESSON_META !== 'undefined') ? LESSON_META : {};
  /* 各课生词表分组：[{n:条数, t:组名}]；无数据的课不分组 */
  var GROUP_DATA = (typeof GROUPS !== 'undefined' && GROUPS) ? GROUPS : {};
  var BOOK_LIST = (typeof BOOKS !== 'undefined') ? BOOKS : [
    { id: 'up', name: '初级上', from: 1, to: 24 },
    { id: 'down', name: '初级下', from: 25, to: 48 },
    { id: 'mid1', name: '中级上', from: 49, to: 64 },
    { id: 'mid2', name: '中级下', from: 65, to: 80 },
    { id: 'hi1', name: '高级上', from: 81, to: 92 },
    { id: 'hi2', name: '高级下', from: 93, to: 104 }
  ];
  /* 全局最后一课课次 */
  var MAX_LESSON = 0;
  Object.keys(DATA).forEach(function (k) { var n = +k; if (n > MAX_LESSON) MAX_LESSON = n; });
  if (!MAX_LESSON) MAX_LESSON = BOOK_LIST[BOOK_LIST.length - 1].to;

  var STORE_KEY = 'sbj2_vocab_v1';
  var $ = function (s) { return document.querySelector(s); };

  /* 掌握度分数满 PRO_NEED（默认 3）即标记「掌握」。卡片：掌握=满分，记住=+1（每词每天限 1 次），忘记=归零；测验：答对+1，答错归零 */
  var PRO_NEED = 3;
  /* 分数 0~2 为待巩固；满 3（LV_MAX）为掌握，移出学习与测验，仅在复习中出现 */
  var LV_MAX = 3;
  /* 每轮复习的掌握词数量上限 */
  var PRO_SAMPLE = 12;

  /* 测验题型：id 同时作为开关键；needKanji 表示需要本课有带表记的词 */
  var QUIZ_TYPES = [
    { id: 'j2c', label: '日→中', hint: '看读音选释义', needKanji: false },
    { id: 'c2j', label: '中→日', hint: '看释义选读音', needKanji: false },
    { id: 'listen', label: '听音辨义', hint: '只听发音选释义', needKanji: false },
    { id: 'k2y', label: '汉字→假名', hint: '看汉字选读音', needKanji: true },
    { id: 'kji', label: '假名→汉字', hint: '看读音选正确汉字', needKanji: true },
    { id: 'inkana', label: '输入假名', hint: '看释义写出读音', needKanji: false, input: true }
  ];
  var DEFAULT_QN = 20;               /* 每轮默认词数（每词遍历全部勾选题型） */
  var QN_CHOICES = [10, 20, 30, 0];  /* 0 = 本课/本池全部词 */

  /* ---------- 间隔重复 ---------- */
  /* 掌握后复习间隔（天）：step 为掌握后第几次成功（从 1 起），查表用 step-1 */
  var INTERVALS = [3, 7, 15, 30, 60, 120, 240];
  var HOUR = 3600000, DAY = 86400000;
  /* 每日目标默认次数，以及可选档位 */
  var DAILY_GOAL = 30;
  var GOAL_CHOICES = [20, 30, 50, 100];

  /* ---------- 存储 ---------- */
  var migrated = false;   /* 迁移后立即落盘 */
  var store = loadStore();
  if (migrated) saveStore();

  function loadStore() {
    var def = {
      marks: {}, today: { date: '', n: 0 }, last: null, pos: {}, book: null,
      history: {},
      settings: {
        shuffle: false, hideKanji: false, showPro: false, proNeed: PRO_NEED, proVer: 2,
        quizQn: DEFAULT_QN, quizVer: 2, dailyGoal: DAILY_GOAL,
        /* 读音题选项是否附带汉字表记；关闭则只给假名 */
        optKanji: false,
        /* 输入假名题是否改为从平/片假名中点选（默认手写） */
        kanaBank: false,
        /* 题型默认全开；出题时自动跳过不可用题型 */
        quizTypes: { j2c: true, c2j: true, listen: true, k2y: true, kji: true }
      }
    };
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return def;
      var obj = JSON.parse(raw);
      var st = Object.assign({}, def.settings, obj.settings || {});
      st.quizTypes = Object.assign({}, def.settings.quizTypes, (obj.settings || {}).quizTypes || {});
      /* 旧默认阈值 2 迁移为 3（仅一次） */
      if (!(obj.settings || {}).proVer) {
        if (st.proNeed === 2) st.proNeed = PRO_NEED;
        st.proVer = 2;
        migrated = true;
      }
      /* ok 迁移为掌握度分数：掌握词记满分，其余归零 */
      if ((st.proVer || 0) < 3) {
        var mk = obj.marks || {};
        Object.keys(mk).forEach(function (k) {
          var m = mk[k];
          if (!m) return;
          m.ok = (m.lv >= LV_MAX) ? (st.proNeed || PRO_NEED) : 0;
        });
        st.proVer = 3;
        migrated = true;
      }
      /* 补齐默认题型与题量（仅一次） */
      if (!(obj.settings || {}).quizVer) {
        st.quizTypes = { j2c: true, c2j: true, listen: true, k2y: true, kji: true };
        st.quizQn = DEFAULT_QN;
        st.quizVer = 2;
        migrated = true;
      }
      /* 等级合并为 1/2/3 三档：lv4 并入 lv3 */
      var marks = obj.marks || {};
      if (!(obj.settings || {}).lvVer) {
        Object.keys(marks).forEach(function (k) {
          var m = marks[k];
          if (m && m.lv > LV_MAX) {
            marks[k] = { lv: LV_MAX, t: m.t || Date.now(), ok: Math.max(m.ok || 0, st.proNeed || PRO_NEED) };
          }
        });
        st.lvVer = 3;
        migrated = true;
      }
      /* 补齐缺失的 due / err / step 为 0 */
      if (!(obj.settings || {}).srsVer) {
        Object.keys(marks).forEach(function (k) {
          var m = marks[k];
          if (!m) return;
          if (typeof m.due !== 'number') m.due = 0;
          if (typeof m.err !== 'number') m.err = 0;
          if (typeof m.step !== 'number') m.step = 0;
        });
        st.srsVer = 1;
        migrated = true;
      }
      return {
        marks: marks,
        today: obj.today || def.today,
        history: obj.history || {},
        last: obj.last || null,
        /* 每课的卡片浏览位置：{ '7': { key: '假名|表记', i: 20 } } */
        pos: obj.pos || {},
        book: obj.book || null,
        settings: st
      };
    } catch (e) { return def; }
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }
  /* ---------- 备份：导出 / 导入 ---------- */
  function exportStore() {
    try {
      var payload = { app: 'sbj2-vocab', ver: 1, at: new Date().toISOString(), store: store };
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var d = new Date();
      a.href = url;
      a.download = 'sbj2-backup-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('已导出 ' + Object.keys(store.marks || {}).length + ' 条学习记录', 'pro');
    } catch (e) {
      toast('导出失败：' + (e.message || '浏览器不允许下载'), 'back');
    }
  }
  function importStore(text) {
    var obj = JSON.parse(text);
    var next = (obj && obj.store) ? obj.store : obj;      /* 兼容裸存档与带 store 包装的备份 */
    if (!next || typeof next !== 'object' || !next.marks || typeof next.marks !== 'object') {
      throw new Error('文件里没有有效的字段');
    }
    var cnt = Object.keys(next.marks).length;
    if (!confirm('文件中的 ' + cnt + ' 条记录将覆盖当前学习进度，是否确定继续？')) return false;
    store = {
      marks: next.marks,
      today: next.today || { date: '', n: 0 },
      history: next.history || {},
      last: next.last || null,
      pos: next.pos || {},
      book: next.book || null,
      settings: Object.assign({}, store.settings, next.settings || {})
    };
    saveStore();
    state.deckSig = null; state.quiz = null; state.rquiz = null; state.reviewDeck = null;
    toast('已导入 ' + cnt + ' 条记录', 'pro');
    return true;
  }
  function dateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function todayStr() { return dateStr(); }
  function bumpToday() {
    var t = todayStr();
    if (!store.today || store.today.date !== t) store.today = { date: t, n: 0 };
    store.today.n++;
    /* 按日累计，用于打卡与目标进度 */
    if (!store.history) store.history = {};
    store.history[t] = (store.history[t] || 0) + 1;
    pruneHistory();
  }
  /* 仅保留最近 400 天 */
  function pruneHistory() {
    var keys = Object.keys(store.history || {});
    if (keys.length <= 400) return;
    keys.sort();
    keys.slice(0, keys.length - 400).forEach(function (k) { delete store.history[k]; });
  }
  function todayCount() {
    return (store.today && store.today.date === todayStr()) ? store.today.n : 0;
  }
  /* 连续打卡天数；今日未练则从昨日起算 */
  function streakDays() {
    var h = store.history || {}, n = 0, d = new Date();
    if (!h[dateStr(d)]) d = new Date(d.getTime() - DAY);
    while (n < 4000) {
      if (!h[dateStr(d)]) break;
      n++;
      d = new Date(d.getTime() - DAY);
    }
    return n;
  }
  function dailyGoal() { return store.settings.dailyGoal || DAILY_GOAL; }

  /* ---------- 词条工具 ---------- */
  /* 记录结构：{ lv, t, ok, step, err, due }
     lv 0 未学 / 1 遗忘 / 2 记住 / 3 掌握；ok 掌握度分数；step 复习间隔档位；err 错误次数；due 到期时间戳 */
  function keyOf(w) { return w[0] + '|' + w[1]; }
  function recOf(w) { return store.marks[keyOf(w)] || null; }
  function lvOf(w) { var m = recOf(w); return m ? Math.min(m.lv || 0, LV_MAX) : 0; }
  function okOf(w) { var m = recOf(w); return m ? (m.ok || 0) : 0; }
  function errOf(w) { var m = recOf(w); return m ? (m.err || 0) : 0; }
  function dueOf(w) { var m = recOf(w); return m ? (m.due || 0) : 0; }
  function isPro(w) { return lvOf(w) >= LV_MAX; }
  function proNeed() { return store.settings.proNeed || PRO_NEED; }
  /* 由掌握度分数推等级：满分为 3，1~2 分为 2，0 分为 1 */
  function lvAfterScore(score) {
    return score >= proNeed() ? LV_MAX : (score > 0 ? 2 : 1);
  }
  /* 第 step 档的间隔天数（从 1 起，超出取末档） */
  function ivDays(step) { return INTERVALS[Math.min(Math.max(step || 1, 1), INTERVALS.length) - 1]; }
  /* 到期时间：掌握态按 step 取间隔；记住 1 天；忘记立即到期 */
  function dueAfter(lv, step) {
    var now = Date.now();
    if (lv >= LV_MAX) return now + ivDays(step) * DAY;
    if (lv === 2) return now + DAY;
    return now;
  }
  /* 掌握词复习成功的档位：提前复习（距到期超过半个间隔）不升档 */
  function proStepAfterOk(prev) {
    var step = prev.step || 0;
    if (prev.lv >= LV_MAX && prev.due && prev.due - Date.now() > ivDays(step) * DAY / 2) return Math.max(step, 1);
    return step + 1;
  }
  /* 掌握词遗忘：档位回退 3 级（最低 0） */
  function lapseStep(prev) { return Math.max(0, (prev.step || 0) - 3); }
  /* 答对抵消一次错误计数 */
  function decErr(w) { var m = recOf(w); if (m && m.err > 0) m.err--; }
  /* 卡片判级：掌握＝满分；记住＝+1 分；忘记＝归零且错误 +1。已掌握词判记住则保持掌握、提前复习 */
  function markWord(w, lv) {
    var k = keyOf(w), prev = recOf(w) || {}, need = proNeed(), wasPro = prev.lv >= LV_MAX;
    var ok, err = prev.err || 0, od = prev.od || '', capped = false, shortened = false, today = todayStr();
    var step = prev.step || 0, due = null;
    if (lv >= LV_MAX) {
      ok = need; err = Math.max(0, err - 1);        /* 满分 */
    } else if (lv === 2) {
      if (wasPro) {
        ok = need; shortened = true; err = Math.max(0, err - 1);
      } else if (od === today) {
        ok = prev.ok || 0; capped = true;           /* 每词每天最多加 1 分 */
      } else {
        ok = Math.min((prev.ok || 0) + 1, need); od = today; err = Math.max(0, err - 1);   /* 记住：+1 分 */
      }
    } else {
      ok = 0; err++;                                /* 遗忘：归零 */
    }
    var nl = lvAfterScore(ok);
    if (shortened) {
      step = Math.max(step, 1);
      due = Date.now() + Math.max(1, Math.round(ivDays(step) / 2)) * DAY;
    } else if (nl >= LV_MAX) {
      step = wasPro ? proStepAfterOk(prev) : step + 1;
    } else if (wasPro) {
      step = lapseStep(prev);
    }                                               /* 待巩固保留 step */
    if (due === null) due = dueAfter(nl, step);
    store.marks[k] = { lv: nl, t: Date.now(), ok: ok, step: step, err: err, due: due, od: od };
    bumpToday();
    saveStore();
    return { lv: nl, ok: ok, need: need, promoted: nl >= LV_MAX && !wasPro, left: Math.max(0, need - ok), capped: capped, shortened: shortened };
  }
  /* 测验答错：打回待巩固，ok 清零，err +1 */
  function markQuizWrong(w) {
    var prev = recOf(w) || {};
    store.marks[keyOf(w)] = {
      lv: 1, t: Date.now(), ok: 0, step: prev.lv >= LV_MAX ? lapseStep(prev) : (prev.step || 0),
      err: (prev.err || 0) + 1, due: dueAfter(1, 0), od: prev.od || ''
    };
    bumpToday();
    saveStore();
  }
  /* 测验/复习按词结算：本轮全部题型答完且无错才判掌握；中途答错即打回待巩固 */
  function quizSettle(sess, cur, ok) {
    var k = keyOf(cur.item);
    var st = sess.stat || (sess.stat = {});
    var e = st[k] || (st[k] = { ok: 0, wrong: 0, done: 0 });
    e.done++;
    if (ok) e.ok++; else e.wrong++;
    var total = (sess.total && sess.total[k]) || e.done;
    if (ok && e.done >= total && e.wrong === 0) {
      markWord(cur.item, LV_MAX);
      sess.proCount++;
      cur.pro = { ok: e.ok, need: total, promoted: true, left: 0 };
      return;
    }
    if (!ok) {
      markQuizWrong(cur.item);
      if (sess.wrong) sess.wrong.push({ lesson: cur.lesson, w: cur.item, type: cur.type });
    } else {
      decErr(cur.item);
      bumpToday();          /* 计入练习量 */
      saveStore();
    }
    cur.pro = { ok: e.ok, need: total, promoted: false, left: Math.max(0, total - e.done) };
  }
  /* ---------- 每课学习位置（翻到第几张） ---------- */
  function posOf(n) { return (store.pos && store.pos[n]) || null; }
  /* 保存当前卡片位置：词条 key 为主，序号为兜底 */
  function savePos() {
    if (state.mode !== 'study' || !state.lesson) return;
    var list = DATA[state.lesson] || [];
    var di = state.deck[state.idx];
    if (!store.pos) store.pos = {};
    /* 位于第一张或无卡时清除该课位置 */
    if (state.idx === 0 || di === undefined || !list[di]) {
      if (store.pos[state.lesson]) { delete store.pos[state.lesson]; saveStore(); }
      return;
    }
    store.pos[state.lesson] = { key: keyOf(list[di]), i: state.idx };
    saveStore();
  }
  function resumeIdx(list) {
    var p = posOf(state.lesson);
    if (!p) return 0;
    if (p.key) {
      for (var i = 0; i < state.deck.length; i++) {
        if (keyOf(list[state.deck[i]]) === p.key) return i;
      }
    }
    if (typeof p.i === 'number' && p.i > 0) return Math.min(p.i, Math.max(0, state.deck.length - 1));
    return 0;
  }
  function allWords() {
    var out = [];
    Object.keys(DATA).forEach(function (k) {
      (DATA[k] || []).forEach(function (w) { out.push({ lesson: +k, w: w }); });
    });
    return out;
  }
  function lessonStats(n) {
    var list = DATA[n] || [], learned = 0, mastered = 0;
    list.forEach(function (w) {
      var lv = lvOf(w);
      if (lv > 0) learned++;
      if (lv >= LV_MAX) mastered++;
    });
    /* pro 与 mastered 同义，保留以兼容调用处 */
    return { total: list.length, learned: learned, mastered: mastered, pro: mastered };
  }
  function globalStats() {
    var total = 0, learned = 0, mastered = 0, review = 0, dueNow = 0, seen = {}, now = Date.now();
    Object.keys(DATA).forEach(function (k) {
      (DATA[k] || []).forEach(function (w) {
        total++;
        var lv = lvOf(w);
        if (lv <= 0) return;
        var key = keyOf(w);
        if (seen[key]) return;   /* 同一词条跨课重复只计一次 */
        seen[key] = 1;
        learned++;
        if (lv >= LV_MAX) mastered++;
        else { review++; if (dueOf(w) <= now) dueNow++; }
      });
    });
    return {
      total: total, learned: learned, mastered: mastered, review: review, dueNow: dueNow,
      pro: mastered, proSample: Math.min(mastered, PRO_SAMPLE)
    };
  }
  /* 排序：已到期优先（逾期越久越前），其次按到期时间；同到期时错误数多者在前 */
  function dueFirst(a, b) {
    var now = Date.now();
    var da = dueOf(a.w), db = dueOf(b.w);
    var oa = da <= now ? 0 : 1, ob = db <= now ? 0 : 1;
    if (oa !== ob) return oa - ob;
    if (da !== db) return da - db;
    return errOf(b.w) - errOf(a.w);
  }
  /* 复习范围：选定课次则只扫该课，否则扫全库 */
  function revLessonKeys() {
    var n = state.reviewLesson;
    return (n && DATA[n]) ? [String(n)] : Object.keys(DATA);
  }
  /* 待巩固池：分数 0~2 的词，到期优先，同词条只计一次 */
  function duePool() {
    var out = [], seen = {};
    revLessonKeys().forEach(function (k) {
      (DATA[k] || []).forEach(function (w, i) {
        var key = keyOf(w);
        if (seen[key]) return;
        var lv = lvOf(w);
        if (lv !== 1 && lv !== 2) return;
        seen[key] = 1;
        out.push({ lesson: +k, w: w, i: i, pro: false });
      });
    });
    out.sort(dueFirst);
    return out;
  }
  /* 掌握复习池：已掌握词按到期优先排序，取前 PRO_SAMPLE 个 */
  function proPoolAll() {
    var out = [], seen = {};
    revLessonKeys().forEach(function (k) {
      (DATA[k] || []).forEach(function (w, i) {
        var key = keyOf(w);
        if (seen[key]) return;
        if (lvOf(w) >= LV_MAX) { seen[key] = 1; out.push({ lesson: +k, w: w, i: i, pro: true }); }
      });
    });
    out.sort(dueFirst);
    return out;
  }
  function proPool() {
    return proPoolAll().slice(0, PRO_SAMPLE);
  }
  /* 复习列表用池：两池取全部，排序由 state.reviewSort 决定 */
  function reviewListPool(scope) {
    var rows = scope === 'pro' ? proPoolAll() : duePool();
    var sort = state.reviewSort || 'err';
    rows.sort(function (a, b) {
      if (sort === 'lesson') {
        if (a.lesson !== b.lesson) return a.lesson - b.lesson;
        return a.i - b.i;
      }
      if (sort === 'due') {
        var da = dueOf(a.w), db = dueOf(b.w);
        if (da !== db) return da - db;
        return errOf(b.w) - errOf(a.w);
      }
      var ea = errOf(a.w), eb = errOf(b.w);
      if (ea !== eb) return eb - ea;
      return dueOf(a.w) - dueOf(b.w);
    });
    return rows;
  }
  /* 到期文案：相对天数 */
  function dueLabel(ts) {
    if (!ts) return '未安排';
    var d = ts - Date.now();
    if (d <= 0) return '已到期';
    var days = Math.ceil(d / DAY);
    return days <= 1 ? '今天' : days + ' 天后';
  }
  /* 复习队列用池：两池取全量，到期词在前 */
  function poolOf(scope) {
    return scope === 'pro' ? proPool() : duePool();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  /* 轻提示：升级掌握或降级时显示 */
  var toastTimer = null;
  function toast(msg, kind) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 2800);
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------- 语音 ---------- */
  var voices = [];
  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    voices = window.speechSynthesis.getVoices() || [];
  }
  if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
  var speechSeq = 0;          /* 递增以打断上一朗读链 */
  function makeUtterance(text) {
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 0.86;
    var v = voices.filter(function (x) { return /^ja/i.test(x.lang); })[0];
    if (v) u.voice = v;
    return u;
  }
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      speechSeq++;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(makeUtterance(text));
    } catch (e) {}
  }
  /* 连续朗读：按 onend 串行推进；单点发音会打断整条链 */
  function speakList(words) {
    if (!('speechSynthesis' in window) || !words || !words.length) return;
    try {
      var token = ++speechSeq;
      window.speechSynthesis.cancel();
      var i = 0;
      (function next() {
        if (token !== speechSeq || i >= words.length) return;
        var u = makeUtterance(words[i][0]);
        u.onend = function () { i++; if (token === speechSeq) setTimeout(next, 200); };
        u.onerror = u.onend;
        window.speechSynthesis.speak(u);
      })();
    } catch (e) {}
  }

  /* ---------- 状态 ---------- */
  /* 课次属于哪一册 */
  function bookOfLesson(n) {
    for (var i = 0; i < BOOK_LIST.length; i++) {
      if (n >= BOOK_LIST[i].from && n <= BOOK_LIST[i].to) return BOOK_LIST[i].id;
    }
    return BOOK_LIST[0].id;
  }
  /* 侧栏默认册：优先上次选择，其次按上次学习课次推断 */
  function initBook() {
    var saved = store.book;
    if (saved && BOOK_LIST.some(function (b) { return b.id === saved; })) return saved;
    if (store.last) return bookOfLesson(store.last);
    return BOOK_LIST[0].id;
  }

  var state = {
    book: initBook(),
    lesson: null,
    mode: 'home',
    deck: [],
    idx: 0,
    flipped: false,
    quiz: null,
    query: '',
    reviewScope: 'due',   /* due = 待巩固（不会的）；pro = 掌握复习（会了的） */
    reviewPhase: 'quiz',  /* quiz = 做题检验（默认）；card = 翻卡重看；list = 词条列表 */
    reviewSort: 'err',    /* 列表排序：err 错得多优先 / due 到期最近 / lesson 按课次 */
    reviewFilter: 'all',  /* 列表筛选：all / due 已到期 / err 错 ≥ 2 */
    reviewLesson: 0,      /* 复习课程范围：0 为全部课程，否则为课次；两池共用 */
    rquiz: null,          /* 复习做题会话：{ scope, qs, i, score, proCount, avail } */
    collapsed: {},        /* 词表分组折叠状态：键为「课号|组序」 */
    quizSegs: {}          /* 测验选中的生词表：课号 -> 组序数组；无键 = 全部 */
  };

  /* ---------- 侧栏 ---------- */
  var lastSidebarLesson = null;   /* 侧栏上次展开的课次，用于判断是否换课 */
  function renderSidebar() {
    var s = globalStats();
    $('#overview').innerHTML =
      '<div class="ov-item pro"><b>' + s.pro + '</b><span>已掌握</span></div>' +
      '<div class="ov-item accent"><b>' + s.review + '</b><span>待复习</span></div>' +
      '<div class="ov-item green"><b>' + s.learned + '</b><span>已学过</span></div>' +
      '<div class="ov-item"><b>' + s.total + '</b><span>总词数</span></div>';

    $('#bookTabs').innerHTML = BOOK_LIST.map(function (b) {
      return '<button data-book="' + b.id + '" class="' + (state.book === b.id ? 'on' : '') + '">' + esc(b.name) + '</button>';
    }).join('');

    var book = BOOK_LIST.filter(function (b) { return b.id === state.book; })[0] || BOOK_LIST[0];
    var html = '';
    for (var n = book.from; n <= book.to; n++) {
      var st = lessonStats(n);
      var pct = st.total ? Math.round((st.learned / st.total) * 100) : 0;
      html += '<button class="lesson-item ' + (state.lesson === n ? 'on' : '') + '" data-lesson="' + n + '">' +
        '<span class="no">' + pad2(n) + '</span>' +
        '<span class="meta"><b>' + esc(META[n] || ('第 ' + n + ' 课')) + '</b>' +
        '<i><em style="width:' + pct + '%"></em></i></span>' +
        '<span class="cnt">' + (st.pro ? '<em>' + st.pro + '</em>' : '') + st.total + '</span>' +
        '</button>';
      /* 仅展开当前课的生词表子选项 */
      if (state.lesson === n) html += sidebarSegs(n);
    }
    $('#lessonScroll').innerHTML = html;
    /* 换课时才滚动到可见位置 */
    if (lastSidebarLesson !== state.lesson) {
      lastSidebarLesson = state.lesson;
      var segRow = document.querySelector('#lessonScroll .lesson-segs');
      var onItem = document.querySelector('#lessonScroll .lesson-item.on');
      var tgt = segRow || onItem;
      if (tgt && tgt.scrollIntoView) tgt.scrollIntoView({ block: 'nearest' });
    }
  }

  /* 侧栏生词表子选项：仅有分组数据的课次显示；点一组只看该组，再点回到全部 */
  function sidebarSegs(lesson) {
    var segs = segsOf(lesson);
    if (segs.length < 2) return '';
    var sel = segSel(lesson);
    var h = '<div class="lesson-segs"><b>生词表</b>' +
      '<button data-sseg="all" data-slsn="' + lesson + '" class="' + (sel ? '' : 'on') + '">全部</button>';
    segs.forEach(function (sg, gi) {
      var on = !!sel && sel.indexOf(gi) >= 0;
      h += '<button data-sseg="' + gi + '" data-slsn="' + lesson + '" class="' + (on ? 'on' : '') + '"' +
        ' title="只看 ' + esc(sg.t) + '（' + sg.n + ' 词），再点一次回到全部">' + esc(shortSeg(sg.t)) + '<em>' + sg.n + '</em></button>';
    });
    return h + '</div>';
  }

  /* ---------- 顶栏 ---------- */
  function renderTopbar() {
    var label = state.lesson ? ('第 ' + state.lesson + ' 课 ' + (META[state.lesson] || '')) : '选择一课开始';
    $('#crumb').innerHTML = state.lesson
      ? '<b>第 ' + state.lesson + ' 课</b><span class="jp">' + esc(META[state.lesson] || '') + '</span>'
      : '<b>' + label + '</b>';

    var modes = [['home', '首页'], ['study', '学习'], ['quiz', '测验'], ['list', '词表'], ['review', '复习']];
    $('#modes').innerHTML = modes.map(function (m) {
      return '<button data-mode="' + m[0] + '" class="' + (state.mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>';
    }).join('');
    /* 同步移动端底部导航高亮 */
    var tb = document.getElementById('tabbar');
    if (tb) {
      Array.prototype.forEach.call(tb.children, function (b) {
        if (b.dataset.mode === state.mode) b.classList.add('on');
        else b.classList.remove('on');
      });
    }
  }

  /* ---------- 主区 ---------- */
  function renderStage() {
    var stage = $('#stage');
    if (state.query) { stage.innerHTML = viewSearch(); return; }
    if (state.mode === 'study') { stage.innerHTML = viewStudy(); return; }
    if (state.mode === 'quiz') { stage.innerHTML = viewQuiz(); return; }
    if (state.mode === 'list') { stage.innerHTML = viewList(); return; }
    if (state.mode === 'review') {
      stage.innerHTML = state.reviewPhase === 'card' ? viewStudy()
        : (state.reviewPhase === 'list' ? viewReviewList() : viewReviewQuiz());
      return;
    }
    stage.innerHTML = viewHome();
  }

  /* ---------- 总览 ---------- */
  function viewHome() {
    var s = globalStats();
    var book = BOOK_LIST.filter(function (b) { return b.id === state.book; })[0] || BOOK_LIST[0];
    var heat = '';
    for (var n = book.from; n <= book.to; n++) {
      var st = lessonStats(n);
      var pct = st.total ? st.learned / st.total : 0;
      var cls = 'heat-btn';
      if (pct > 0.95) cls += ' g3 full';
      else if (pct > 0.6) cls += ' g3';
      else if (pct > 0.3) cls += ' g2';
      else if (pct > 0) cls += ' g1';
      heat += '<button class="' + cls + '" data-lesson="' + n + '" title="第' + n + '课 · 点击开始">' +
        '<i style="height:' + Math.round(pct * 100) + '%"></i><span>' + n + '</span></button>';
    }

    var last = store.last;
    var cont = last && DATA[last]
      ? '<button class="btn primary" data-lesson="' + last + '" data-mode="study">继续第 ' + last + ' 课</button>'
      : '<button class="btn primary" data-lesson="1" data-mode="study">从第 1 课开始</button>';
    var tc = todayCount(), goal = dailyGoal(), stk = streakDays();

    return '<div class="home">' +
      '<div class="home-hero">' +
      '<h2>新标日单词记忆</h2>' +
      '</div>' +
      '<div class="kpis">' +
      '<div class="kpi"><b>' + s.total + '</b><span>总词条</span></div>' +
      '<div class="kpi k2"><b>' + s.learned + '</b><span>已学过</span></div>' +
      '<div class="kpi k5"><b>' + s.pro + '</b><span>已掌握</span></div>' +
      '<div class="kpi k3"><b>' + s.dueNow + '</b><span>今日待复习' + (s.review > s.dueNow ? ' / 共 ' + s.review : '') + '</span></div>' +
      '<div class="kpi k4"><b>' + tc + '<small> / ' + goal + '</small></b><span>今日次数 · 连续 ' + stk + ' 天</span></div>' +
      '</div>' +
      '<div class="panel"><h3>课程进度<em>' + esc(book.name) + '</em></h3><div class="heat">' + heat + '</div></div>' +
      '<div class="panel"><h3>开始学习<em></em></h3><div class="continue-row">' + cont +
      '<button class="btn" data-lesson="' + (state.lesson || 1) + '" data-mode="quiz">本课测验</button>' +
      '<button class="btn" data-mode="review" data-scope="due">学习待巩固词 (' + s.dueNow + ')</button>' +
      '<button class="btn" data-mode="review" data-scope="pro">掌握复习 (' + s.proSample + ')</button>' +
      '</div></div>' +
      '<div class="panel"><h3>测验方式<em></em></h3>' +
      '<p class="panel-note"></p>' +
      '<div class="qtype-grid">' + qtypeCards() + '</div>' +
      '<div class="panel-sub"><em>每轮词数</em>' + qnSeg() + '</div></div>' +
      '<div class="panel"><h3>掌握机制</h3>' +
      '<p class="panel-note"><b>卡片</b>：判「掌握」直接满分，判「记住」加 1 分，判「遗忘」清零；累计满 ' + proNeed() + ' 分即为掌握。' +
      '<br><b>测验</b>：词的所有题型全部答对即为掌握，答错则留在待巩固。</p>' +
      '<div class="seg" id="proSeg">' +
      [2, 3, 4].map(function (n) {
        return '<button data-pro="' + n + '" class="' + (proNeed() === n ? 'on' : '') + '">满分 ' + n + ' 分</button>';
      }).join('') +
      '</div></div>' +
      '<div class="panel"><h3>每日目标<em>连续 ' + stk + ' 天</em></h3>' +
      '<p class="panel-note">卡片判级、测验答题、复习做题各计一次，达标后继续练习同样计数。连续天数按自然日计算，中断一天即清零。<br>学习记录仅保存在本机，可通过侧栏「导出记录」备份。</p>' +
      '<div class="seg" id="goalSeg">' +
      GOAL_CHOICES.map(function (n) {
        return '<button data-goal="' + n + '" class="' + (goal === n ? 'on' : '') + '">' + n + ' 次 / 天</button>';
      }).join('') +
      '</div></div>' +
      '</div>';
  }

  /* ---------- 学习 / 复习 ---------- */
  function ensureDeck() {
    var list = DATA[state.lesson] || [];
    if (state.mode === 'review') return;
    var sel = segSel(state.lesson), segs = segsOf(state.lesson);
    var allow = null;
    if (sel) {
      allow = {};
      sel.forEach(function (gi) {
        for (var j = segs[gi].from; j < segs[gi].to; j++) allow[j] = 1;
      });
    }
    var sig = state.lesson + '|' + (store.settings.showPro ? 1 : 0) + '|' + (sel ? sel.join(',') : 'all');
    if (state.deckSig !== sig) {
      state.deckSig = sig;
      state.deckLesson = state.lesson;
      /* 默认不含已掌握词；选定生词表时仅取所选范围 */
      state.deck = list.map(function (_, i) { return i; }).filter(function (i) {
        if (allow && !allow[i]) return false;
        return store.settings.showPro || lvOf(list[i]) < LV_MAX;
      });
      if (store.settings.shuffle) shuffle(state.deck);
      /* 选定生词表时从该范围第一张开始 */
      state.idx = sel ? 0 : resumeIdx(list);
      state.flipped = false;
      savePos();   /* 序号变化后同步保存位置 */
    }
  }

  /* 复习统计：选定课次时只统计该课，否则为全局统计 */
  function revStats() {
    if (!state.reviewLesson) return globalStats();
    var due = duePool(), pro = proPoolAll().length, now = Date.now();
    return {
      review: due.length, pro: pro, proSample: Math.min(pro, PRO_SAMPLE),
      dueNow: due.filter(function (c) { return dueOf(c.w) <= now; }).length
    };
  }
  /* 课程筛选下拉：按册分组，列出池中有词的课，当前选中课始终保留 */
  function revLessonSelect() {
    var isPro = state.reviewScope === 'pro', cur = state.reviewLesson || 0, seen = {}, total = 0;
    var groups = BOOK_LIST.map(function (b) {
      var opts = '';
      for (var n = b.from; n <= b.to; n++) {
        var cnt = 0;
        (DATA[n] || []).forEach(function (w) {
          var lv = lvOf(w);
          if (isPro ? lv >= LV_MAX : (lv === 1 || lv === 2)) {
            cnt++;
            if (!seen[keyOf(w)]) { seen[keyOf(w)] = 1; total++; }
          }
        });
        if (cnt || n === cur) opts += '<option value="' + n + '"' + (n === cur ? ' selected' : '') + '>第 ' + n + ' 课 · ' + cnt + ' 词</option>';
      }
      return opts ? '<optgroup label="' + esc(b.name) + '">' + opts + '</optgroup>' : '';
    }).join('');
    return '<select class="rev-lesson" id="revLesson" title="按课程筛选">' +
      '<option value="0"' + (cur ? '' : ' selected') + '>全部课程 · ' + total + ' 词</option>' + groups + '</select>';
  }
  function setReviewLesson(n) {
    state.reviewLesson = n;
    state.reviewDeck = null;
    state.rquiz = null;
    state.reviewFilter = 'all';
    state.idx = 0; state.flipped = false;
    render();
  }

  /* 复习区顶部入口：待巩固 / 掌握复习 */
  function revTabs(active) {
    var s = revStats();
    var tip;
    if (active === 'pro') tip = '已掌握 ' + s.pro + ' 个 · 每轮最多抽 ' + PRO_SAMPLE + ' 个 · 到期时间排序';
    else if (s.review) tip = (s.dueNow ? '今日到期 ' + s.dueNow + ' 个 · ' : '暂无到期 · ') + '共 ' + s.review + ' 个，到期时间排序';
    else tip = '遗忘 / 记住 / 测验答错的词';
    return '<div class="rev-tabs">' +
      '<button data-scope="due" class="' + (active === 'due' ? 'on' : '') + '">待巩固 <b>' + s.review + '</b></button>' +
      '<button data-scope="pro" class="' + (active === 'pro' ? 'on' : '') + '">掌握复习 <b>' + s.proSample + '</b></button>' +
      '<span class="rev-tip">' + tip + '</span>' +
      '</div>';
  }

  /* 复习练法：做题检验 / 翻卡重看 / 词条列表 */
  function revModeBar(active) {
    return '<div class="rev-mode">' +
      '<button data-rphase="quiz" class="' + (active === 'quiz' ? 'on' : '') + '">做题检验</button>' +
      '<button data-rphase="card" class="' + (active === 'card' ? 'on' : '') + '">翻卡重看</button>' +
      '<button data-rphase="list" class="' + (active === 'list' ? 'on' : '') + '">词条列表</button>' +
      '<span class="rev-mode-tip">' + (active === 'quiz'
        ? ''
        : active === 'card'
          ? ''
          : '') + '</span>' +
      revLessonSelect() +
      '</div>';
  }

  /* 空态下仍可切换练法 */
  function emptyModeBar() {
    return revModeBar(state.reviewPhase === 'card' ? 'card' : (state.reviewPhase === 'list' ? 'list' : 'quiz'));
  }

  function viewReviewEmpty(scope) {
    var s = globalStats();
    if (state.reviewLesson) {
      return '<div class="review-wrap">' + revTabs(scope) + emptyModeBar() +
        '<div class="empty"><b>第 ' + state.reviewLesson + ' 课没有' + (scope === 'pro' ? '已掌握' : '待巩固') + '的词</b>' +
        '<div class="continue-row" style="justify-content:center;margin-top:20px">' +
        '<button class="btn primary" data-rlesson="0">查看全部课程</button>' +
        '</div></div></div>';
    }
    if (scope === 'pro') {
      return '<div class="review-wrap">' + revTabs('pro') + emptyModeBar() +
        '<div class="empty"><b>暂无已掌握的词</b><p>词累计满 ' + proNeed() + ' 分即为掌握（卡片判「掌握」直接满分，判「记住」加 1 分），此后不再出现在学习和测验中。<br>当前已掌握 <b>' + s.pro + '</b> / ' + s.total + ' 个词条。</p>' +
        '<div class="continue-row" style="justify-content:center;margin-top:20px">' +
        '<button class="btn primary" data-mode="quiz" data-lesson="' + (state.lesson || 1) + '">去测验</button>' +
        (s.dueNow ? '<button class="btn" data-mode="review" data-scope="due">复习待巩固 (' + s.dueNow + ')</button>' : '') +
        '</div></div></div>';
    }
    /* 待巩固池为空即无 0~2 分的词 */
    return '<div class="review-wrap">' + revTabs('due') + emptyModeBar() +
      '<div class="empty"><b>待巩固池为空</b><p>卡片中标记「遗忘」「记住」的词，以及测验、复习中答错的词，会进入此处重练。<br>已掌握的 <b>' + s.pro + '</b> 个词位于「掌握复习」。</p>' +
      '<div class="continue-row" style="justify-content:center;margin-top:20px">' +
      (s.pro ? '<button class="btn primary" data-mode="review" data-scope="pro">掌握复习 (' + s.proSample + ')</button>' : '') +
      '<button class="btn" data-mode="study" data-lesson="' + (state.lesson || 1) + '">去学习</button>' +
      '</div></div></div>';
  }

  /* 卡片正反面：viewStudy 首屏与翻卡局部更新共用 */
  function cardFacesHTML(cur) {
    var w = cur.w;
    var isReview = state.mode === 'review';
    var srcTag = isReview ? '<span class="src-tag">' + esc(originLabel(cur.lesson, w)) + '</span>' : '';
    var hideKanji = store.settings.hideKanji;
    var hasKanji = w[1] && w[1] !== w[0];
    var curOk = okOf(w);
    var need = proNeed();
    /* 长词降字号：假名 ≥16 / ≥11 字，表记 ≥10 字 */
    var kanaLen = (w[0] || '').length;
    var kanaCls = kanaLen >= 16 ? ' len-16' : (kanaLen >= 11 ? ' len-11' : '');
    var kanjiCls = (w[1] || '').length >= 10 ? ' len-10' : '';
    return '<div class="face front">' +
      '<span class="pos-tag">' + esc(w[2] || '') + '</span>' +
      srcTag +
      (cur.pro ? '<span class="pro-flag">掌握复习</span>' : '') +
      '<button class="speak-fab" id="speakFab" title="发音">♪</button>' +
      '<div class="kana' + kanaCls + '">' + esc(w[0]) + '</div>' +
      (hasKanji ? '<div class="kanji ' + (hideKanji ? 'hidden' : '') + kanjiCls + '">' + esc(w[1]) + '</div>' : '') +
      '<div class="hintline">点击卡片查看释义</div>' +
      '</div>' +
      '<div class="face back">' +
      '<span class="pos-tag">' + esc(w[2] || '') + '</span>' +
      srcTag +
      (cur.pro ? '<span class="pro-flag">掌握复习</span>' : '') +
      '<div class="mean">' + esc(w[3]) + '</div>' +
      '<div class="mean-sub">' + esc(w[0]) + (hasKanji ? ' · ' + esc(w[1]) : '') + '</div>' +
      (curOk ? '<div class="pro-track">掌握度 ' + curOk + ' / ' + need + (curOk >= need ? ' · 已掌握' : ' · 再 ' + (need - curOk) + ' 分掌握') + '</div>' : '') +
      '<div class="hintline"> ' + need + ' </div>' +
      '</div>';
  }

  /* 翻卡 / 判级只替换卡片内容与进度，不重建舞台 */
  function patchStudy() {
    var stage = $('#stage');
    var card = $('#theCard');
    if (!stage || !card) return false;
    var isReview = state.mode === 'review';
    var cards = isReview ? (state.reviewDeck || []) : (state.deck || []);
    var cur;
    if (isReview) {
      cur = cards[state.idx] || null;
    } else {
      var list = DATA[state.lesson] || [];
      var di = cards[state.idx];
      cur = di === undefined ? null : { lesson: state.lesson, w: list[di], i: di, pro: false };
    }
    if (!cur || !cur.w) return false;         /* 已走完，交给全量渲染 */

    card.classList.remove('flipped', 'card-out-next', 'card-out-prev');
    card.innerHTML = cardFacesHTML(cur);
    card.classList.add('card-in');
    setTimeout(function () { card.classList.remove('card-in'); }, 260);

    var n = cards.length;
    var cnt = stage.querySelector('[data-k="count"]');
    var stL = isReview ? null : lessonStats(state.lesson);
    if (cnt) {
      cnt.textContent = (state.idx + 1) + ' / ' + n + ((stL && stL.pro) ? '（' + stL.pro + ' 词已掌握移出）' : '');
    }
    var bar = stage.querySelector('[data-k="bar"]');
    if (bar) bar.style.width = Math.round((state.idx / n) * 100) + '%';
    var prev = $('#prevBtn');
    if (prev) prev.disabled = state.idx === 0;
    var rb = $('#restartBtn');
    if (rb) {
      if (state.idx > 0) rb.removeAttribute('hidden');
      else rb.setAttribute('hidden', '');
    }
    var j1 = stage.querySelector('[data-k="j1"]');
    if (j1 && j1.firstChild) j1.firstChild.nodeValue = '遗忘';
    var j3 = stage.querySelector('[data-k="j3"]');
    if (j3 && j3.firstChild) j3.firstChild.nodeValue = '掌握';
    return true;
  }

  /* 翻卡轻量渲染；失败则整页渲染 */
  function renderCard(withSidebar) {
    if (patchStudy()) {
      if (withSidebar) renderSidebar();
      autoSpeak();
    } else {
      render();
    }
  }

  function viewStudy() {
    var isReview = state.mode === 'review';
    if (!state.lesson && !isReview) {
      return '<div class="empty"><b>未选择课次</b><p>课次可在左侧课程列表或首页「课程进度」中选择。</p></div>';
    }
    var isPro = isReview && state.reviewScope === 'pro';
    var cards;

    if (isReview) {
      var scope = isPro ? 'pro' : 'due';
      /* 复习类型变化时重建队列 */
      if (state.reviewDeck && state.reviewDeckScope !== scope) state.reviewDeck = null;

      if (state.reviewDeck && state.reviewDeck.length && state.idx >= state.reviewDeck.length) {
        /* 本轮已走完，显示完成页 */
        cards = state.reviewDeck;
      } else {
        var pool = poolOf(scope);
        if (!pool.length) return viewReviewEmpty(scope);
        if (!state.reviewDeck) {
          /* 不打乱，保持到期优先顺序 */
          state.reviewDeck = pool.slice();
          state.reviewDeckScope = scope;
          state.idx = 0;
          state.flipped = false;
        }
        cards = state.reviewDeck;
      }
    } else {
      ensureDeck();
      var list = DATA[state.lesson] || [];
      if (!list.length) {
        return '<div class="empty"><b>本课暂无词表</b><p>第 ' + state.lesson + ' 课的数据尚未抓取，可在 data.js 中补充后刷新页面。</p></div>';
      }
      cards = state.deck.map(function (i) { return { lesson: state.lesson, w: list[i], i: i, pro: false }; });
      if (!cards.length) {
        var selNow = segSel(state.lesson);
        var baseN = segWords(state.lesson, selNow).length;
        return '<div class="empty"><b>' + (selNow ? '所选生词表已全部掌握' : '本课已全部掌握') + '</b><p>' +
          (selNow ? '所选生词表共 ' : '第 ' + state.lesson + ' 课的 ') + baseN + ' 个词均已掌握，不再出现在卡片学习中。<br>这些词可在「复习」中重温。</p>' +
          '<div class="continue-row" style="justify-content:center;margin-top:20px">' +
          '<button class="btn primary" data-mode="review" data-scope="pro">去掌握复习</button>' +
          '<button class="btn" id="showProBtn">仍要看一遍' + (selNow ? '所选范围' : '本课') + '</button>' +
          '</div></div>';
      }
    }

    if (state.idx >= cards.length) return viewDone(cards.length, isReview);

    var cur = cards[state.idx];
    var pct = Math.round((state.idx / cards.length) * 100);
    var hideKanji = store.settings.hideKanji;
    var stL = isReview ? null : lessonStats(state.lesson);

    var head = isReview
      ? '<div class="study-head"><div class="prog"><div class="prog-top"><b>' + (isPro ? '掌握复习' : '待巩固') + '</b><span data-k="count">' + (state.idx + 1) + ' / ' + cards.length + '</span></div>'
      : '<div class="study-head"><div class="prog"><div class="prog-top"><b>第 ' + state.lesson + ' 课 · ' + esc(META[state.lesson] || '') + '</b><span data-k="count">' + (state.idx + 1) + ' / ' + cards.length +
        (stL.pro ? '（' + stL.pro + ' 词掌握被移出）' : '') + '</span></div>';

    head += '<div class="track"><em data-k="bar" style="width:' + pct + '%"></em></div></div>' +
      '<div class="toggles">' +
      (isReview ? '' : '<button class="chip ' + (store.settings.shuffle ? 'on' : '') + '" id="shuffleBtn">打乱</button>') +
      '<button class="chip ' + (hideKanji ? 'on' : '') + '" id="hideBtn">遮盖汉字</button>' +
      (store.settings.showPro ? '<button class="chip on" id="proToggle">含掌握词</button>' : '') +
      (!isReview ? '<button class="chip" id="restartBtn" title="回到第 1 张"' + (state.idx > 0 ? '' : ' hidden') + '>从头</button>' : '') +
      '</div></div>';

    var segBar = (!isReview && segsOf(state.lesson).length) ? segChips(state.lesson) : '';
    return '<div class="study">' + (isReview ? revTabs(isPro ? 'pro' : 'due') + revModeBar('card') : '') + segBar + head +
      '<div class="card-scene">' +
      '<button class="arrow card-nav prev" id="prevBtn"' + (state.idx === 0 ? ' disabled' : '') + '>‹</button>' +
      '<div class="card ' + (state.flipped ? 'flipped' : '') + '" id="theCard">' +
      cardFacesHTML(cur) +
      '</div>' +
      '<button class="arrow card-nav next" id="nextBtn">›</button>' +
      '</div>' +
      '<div class="judge">' +
      '<button class="j1" data-lv="1" data-k="j1">' + ('遗忘') + '<small>1</small></button>' +
      '<button class="j2" data-lv="2">记住<small>2</small></button>' +
      '<button class="j3" data-lv="3" data-k="j3">' + ('掌握') + '<small>3</small></button>' +
      '</div>' +
      '<div class="kbd-hint"><kbd>空格</kbd> 翻转 · <kbd>←</kbd><kbd>→</kbd> 切换 · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 标记 · <kbd>s</kbd> 发音</div>' +
      '</div>';
  }

  function viewDone(n, isReview) {
    var st = state.lesson ? lessonStats(state.lesson) : { mastered: 0, total: 0, pro: 0 };
    var isPro = isReview && state.reviewScope === 'pro';
    var s = globalStats();
    var otherBtn = isPro
      ? (s.dueNow ? '<button class="btn" data-mode="review" data-scope="due">复习待巩固 (' + s.dueNow + ')</button>' : '')
      : (s.pro ? '<button class="btn" data-mode="review" data-scope="pro">掌握复习 (' + s.proSample + ')</button>' : '');
    return '<div class="result">' +
      '<div class="score">' + n + '<small> / 张</small></div>' +
      '<p>' + (isPro ? '本轮掌握复习已完成，答对的词已更新复习时间' : isReview ? '本轮待巩固复习已完成' : '第 ' + state.lesson + ' 课已学完一轮') +
      (isReview ? '' : '，本课已掌握 ' + st.mastered + ' / ' + st.total) + '</p>' +
      '<div class="continue-row" style="justify-content:center;margin-top:22px">' +
      '<button class="btn primary" id="againBtn">再来一轮</button>' +
      (isReview ? '' : '<button class="btn" data-mode="quiz" data-lesson="' + state.lesson + '">本课测验</button>' +
        '<button class="btn" data-lesson="' + Math.min(state.lesson + 1, MAX_LESSON) + '" data-mode="study">下一课</button>') +
      otherBtn +
      '</div></div>';
  }

  /* ---------- 复习做题 ---------- */
  /* 全库词池：复习跨课出题，干扰项从这里取 */
  var allWordCache = null;
  function allWordsFlat() {
    if (!allWordCache) allWordCache = allWords().map(function (x) { return x.w; });
    return allWordCache;
  }
  /* 词性归类：动词 / 形容词 / 名词（含代词、サ变名词）/ 其余保持原词性 */
  function posClass(p) {
    p = p || '';
    if (p.charAt(0) === '动') return 'v';
    if (p.indexOf('形') >= 0) return 'a';
    if (p.charAt(0) === '名' || p === '代') return 'n';
    return p;
  }
  /* 干扰项按优先级排序：同熟悉度且同词性优先，其次同熟悉度，最后全库；各档内打乱 */
  function distractorWords(item) {
    var seen = lvOf(item) > 0, pc = posClass(item[2]), t1 = [], t2 = [], t3 = [];
    allWordsFlat().forEach(function (w) {
      if (w === item) return;
      if (w[3] === item[3]) return;   /* 释义相同则两项皆对 */
      if (w[0] === item[0]) return;   /* 读音相同 */
      if (hasKanji(item) && w[1] === item[1]) return;   /* 表记相同 */
      if ((lvOf(w) > 0) !== seen) t3.push(w);
      else if (posClass(w[2]) === pc) t1.push(w);
      else t2.push(w);
    });
    return shuffle(t1).concat(shuffle(t2), shuffle(t3));
  }

  function buildReviewQuiz(scope) {
    var pool = poolOf(scope);                    /* 已按到期优先排序 */
    if (!pool.length) return { scope: scope, qs: [], i: 0, score: 0, proCount: 0, avail: [], wrong: [], fixed: false, stat: {}, total: {} };
    /* 先截取候选词，再打乱 */
    var cards = shuffle(pool.slice(0, quizQn(pool.length)));
    var words = cards.map(function (c) { return c.w; });
    var avTypes = availTypesByWords(words);   /* 词池可用题型（供开关显示） */
    var types = activeTypesByWords(words);    /* 本次出题题型（受开关限制） */
    var lessonMap = {};
    cards.forEach(function (c) { lessonMap[keyOf(c.w)] = c.lesson; });

    var qs = composeQuiz(words, types, distractorWords, function (w) {
      return lessonMap[keyOf(w)] || state.lesson || 1;
    });

    spokenKey = '';
    return {
      scope: scope, qs: qs, i: 0, score: 0, proCount: 0,
      avail: avTypes.map(function (t) { return t.id; }), wrong: [], fixed: false,
      stat: {}, total: wordTotals(qs)
    };
  }

  /* 掌握复习答对：保持掌握，按 step 推进间隔 */
  function keepPro(w) {
    var prev = recOf(w) || {};
    var step = proStepAfterOk(prev);
    store.marks[keyOf(w)] = {
      lv: LV_MAX, t: Date.now(), ok: proNeed(), step: step,
      err: Math.max(0, (prev.err || 0) - 1), due: dueAfter(LV_MAX, step), od: prev.od || ''
    };
    bumpToday();
    saveStore();
  }
  /* 掌握复习答错：打回待巩固，err +1 */
  function demoteFromPro(w) {
    var prev = recOf(w) || {};
    store.marks[keyOf(w)] = {
      lv: 1, t: Date.now(), ok: 0, step: lapseStep(prev),
      err: (prev.err || 0) + 1, due: dueAfter(1, 0), od: prev.od || ''
    };
    bumpToday();
    saveStore();
    toast('「' + w[0] + '」已打回待巩固', 'back');
  }
  /* 掌握复习按词结算：首次答错即打回待巩固；全部题型答对且仍为掌握态时推进一次间隔 */
  function proSettle(sess, cur, ok) {
    var k = keyOf(cur.item);
    var st = sess.stat || (sess.stat = {});
    var e = st[k] || (st[k] = { ok: 0, wrong: 0, done: 0 });
    e.done++;
    if (ok) e.ok++; else e.wrong++;
    var total = (sess.total && sess.total[k]) || e.done;
    var left = Math.max(0, total - e.done), kept = false;
    if (!ok && e.wrong === 1) {
      if (isPro(cur.item)) demoteFromPro(cur.item); else markQuizWrong(cur.item);
    } else if (ok && !left && !e.wrong && isPro(cur.item)) {
      keepPro(cur.item); kept = true; cur.note = '掌握';
    } else {
      if (ok) decErr(cur.item);
      bumpToday();          /* 其余题仅计练习量 */
      saveStore();
    }
    if (!ok && sess.wrong) sess.wrong.push({ lesson: cur.lesson, w: cur.item, type: cur.type });
    cur.proRev = { kept: kept, left: left, failed: e.wrong > 0 };
  }

  function reviewPick(pi) {
    var q = state.rquiz;
    if (!q) return;
    var cur = q.qs[q.i];
    if (!cur || (cur.picked !== null && cur.picked !== undefined)) return;
    cur.picked = pi;
    cur.correct = (pi === cur.answer);
    if (cur.correct) {
      q.score++;
      if (q.scope === 'pro') proSettle(q, cur, true);
      else quizSettle(q, cur, true);
    } else if (q.scope === 'pro') {
      proSettle(q, cur, false);
    } else {
      quizSettle(q, cur, false);
    }
    render();
  }

  function viewReviewQuiz() {
    var scope = state.reviewScope === 'pro' ? 'pro' : 'due';
    /* 池空且无进行中会话时显示空态 */
    if (!state.rquiz || (!state.rquiz.fixed && state.rquiz.scope !== scope)) {
      if (!poolOf(scope).length) return viewReviewEmpty(scope);
      state.rquiz = buildReviewQuiz(scope);
    }
    var q = state.rquiz;
    if (!q.qs.length) return viewReviewEmpty(scope);

    var head = revTabs(scope) + revModeBar('quiz');
    var onMap = quizOn();
    var effId = q.avail.filter(function (id) { return onMap[id]; }).length ? null : q.avail[0];
    var chips = '<div class="qt-bar"><em>题型</em><div class="qtypes" id="qtypes">' +
      qtypeChipsByAvail(q.avail, effId) + '</div>' +
      '<span class="qt-qn"><em>词数</em>' + qnSeg() + '</span></div>' + optStyleBar(q.avail);

    if (q.i >= q.qs.length) {
      var rate = Math.round((q.score / q.qs.length) * 100);
      var brk = {}, order = [];
      q.qs.forEach(function (x) {
        if (!brk[x.type]) { brk[x.type] = { ok: 0, n: 0 }; order.push(x.type); }
        brk[x.type].n++;
        if (x.picked !== null && x.picked !== undefined && x.correct) brk[x.type].ok++;
      });
      var brkHtml = order.map(function (id) {
        var b = brk[id];
        return '<span class="qb-item ' + (b.ok === b.n ? 'ok' : (b.ok === 0 ? 'no' : '')) + '">' +
          typeMeta(id).label + ' <b>' + b.ok + '</b>/' + b.n + '</span>';
      }).join('');
      return '<div class="quiz">' + head +
        '<div class="q-card result">' +
        '<div class="score">' + q.score + '<small> / ' + q.qs.length + '</small></div>' +
        '<p>' + (q.scope === 'pro'
          ? '掌握复习结束。全部题型答对的词保持掌握，答错过的词退回待巩固。'
          : '待巩固复习结束。全部题型答对的词升为掌握，答错过的词留在待巩固。') +
        (q.proCount ? '<br>本轮新掌握 <b>' + q.proCount + '</b> 个词，这些词不再出现在学习和课内测验中。' : '') +
        (rate >= 90 ? '<br>正确率较高，可间隔几天再复习。' : rate >= 70 ? '<br>整体较好，部分错题仍需巩固。' : '<br>错题较多，可先用「翻卡重看」过一遍。') +
        '</p>' +
        '<div class="q-break">' + brkHtml + '</div>' +
        wrongListHtml(q.wrong) +
        '<div class="continue-row" style="justify-content:center;margin-top:22px">' +
        (q.wrong && q.wrong.length ? '<button class="btn primary" id="retryWrong">重练这 ' + q.wrong.length + ' 个错题</button>' : '') +
        '<button class="btn' + (q.wrong && q.wrong.length ? '' : ' primary') + '" id="againBtn">再来一轮</button>' +
        '<button class="btn" data-rphase="card">翻卡重看</button>' +
        (q.scope === 'pro' && globalStats().dueNow
          ? '<button class="btn" data-mode="review" data-scope="due">待巩固 (' + globalStats().dueNow + ')</button>'
          : '') +
        (!q.scope || q.scope === 'due'
          ? '<button class="btn" data-mode="quiz" data-lesson="' + (state.lesson || 1) + '">本课测验</button>'
          : '') +
        '</div></div></div>';
    }

    var cur = q.qs[q.i];
    var tm = typeMeta(cur.type);
    var revealed = (cur.picked !== null && cur.picked !== undefined);
    var pt = promptOf(cur);
    var jpOpt = (cur.type === 'c2j' || cur.type === 'k2y' || cur.type === 'kji');
    var opts = cur.opts.map(function (o, i) {
      var cls = 'opt';
      if (revealed) {
        if (i === cur.answer) cls += ' right';
        else if (i === cur.picked) cls += ' wrong';
        cls += ' done';
      }
      return '<button class="' + cls + '" data-opt="' + i + '"><span class="idx">' + 'ABCD'[i] + '</span>' +
        '<span class="' + (jpOpt ? 'jp' : '') + '">' + esc(optLabel(cur, o)) + '</span></button>';
    }).join('');

    var fb = '';
    if (revealed) {
      if (cur.correct) {
        fb = '正确';
        if (cur.proRev) fb += cur.proRev.kept ? ' · 全部答对，保持掌握，复习时间已刷新'
          : (cur.proRev.failed ? ' · 本轮已答错过，留在待巩固'
            : (cur.proRev.left ? ' · 本词还剩 ' + cur.proRev.left + ' 题' : ' · 留在待巩固'));
        else if (cur.pro) fb += ' · 本词题型 ' + cur.pro.ok + '/' + cur.pro.need +
          (cur.pro.promoted ? '，全部答对，已掌握' : (cur.pro.left ? '（还剩 ' + cur.pro.left + ' 题）' : '，本轮未全对，留在待巩固'));
      } else {
        fb = '正确答案：' + esc(answerText(cur)) + (q.scope === 'pro' ? '（已打回待巩固）' : '（继续留在待巩固池）');
      }
    }

    return '<div class="quiz">' + head +
      '<div class="quiz-head"><span>' + (scope === 'pro' ? '掌握复习' : '待巩固') +
      ' · 第 ' + (q.i + 1) + ' / ' + q.qs.length + ' 题' +
      '<span class="q-origin">' + esc(originLabel(cur.lesson, cur.item)) + '</span></span>' +
      '<span class="q-badge">' + tm.label + '</span></div>' + chips +
      '<div class="q-card">' +
      pt.prompt +
      (pt.tip ? '<div class="q-tip">' + pt.tip + '</div>' : '') +
      (cur.type === 'inkana' ? inputHtml(cur, revealed) : '<div class="opts">' + opts + '</div>') +
      '<div class="quiz-foot"><div class="feedback ' + (revealed ? (cur.correct ? 'ok' : 'no') : '') + '">' + fb + '</div>' +
      (revealed ? '<button class="btn dark" id="quizNext">' + (q.i + 1 >= q.qs.length ? '看结果' : '下一题') + '</button>'
        : (cur.type === 'inkana' ? '<button class="btn dark" id="kanaSubmit">提交</button>' : '')) +
      '</div></div></div>';
  }

  /* ---------- 复习：词条列表（整池总览） ---------- */
  /* 整池词条列表：行尾显示错误次数、掌握度与到期时间；点击行从该词开始翻卡 */
  function viewReviewList() {
    var scope = state.reviewScope === 'pro' ? 'pro' : 'due';
    var all = reviewListPool(scope);
    var head = revTabs(scope) + revModeBar('list');

    if (!all.length) {
      if (state.reviewLesson) return viewReviewEmpty(scope);
      return '<div class="review-wrap">' + head +
        '<div class="empty"><b>' + (scope === 'pro' ? '还没有掌握词' : '待巩固池已清空') + '</b>' +
        '<p>' + (scope === 'pro'
          ? '词累计满 ' + proNeed() + ' 分后进入掌握池，此处按到期时间排列'
          : '标记为「遗忘 / 记住」或答错的词会进入此处，按错误次数和到期时间排列') + '</p></div></div>';
    }

    var now = Date.now();
    var dueNow = 0, errSum = 0, err2 = 0;
    all.forEach(function (c) {
      if (dueOf(c.w) <= now) dueNow++;
      var e = errOf(c.w);
      errSum += e;
      if (e >= 2) err2++;
    });

    var filter = state.reviewFilter || 'all';
    var shown = all.filter(function (c) {
      if (filter === 'due') return dueOf(c.w) <= now;
      if (filter === 'err') return errOf(c.w) >= 2;
      return true;
    });

    function chip(attr, val, on, label) {
      return '<button ' + attr + '="' + val + '" class="' + (on ? 'on' : '') + '">' + label + '</button>';
    }
    var bar = '<div class="rl-bar">' +
      '<span class="rl-grp"><em>排序</em>' +
      chip('data-rsort', 'err', (state.reviewSort || 'err') === 'err', '错误最多') +
      chip('data-rsort', 'due', state.reviewSort === 'due', '到期最近') +
      chip('data-rsort', 'lesson', state.reviewSort === 'lesson', '按课次') +
      '</span>' +
      '<span class="rl-grp"><em>筛选</em>' +
      chip('data-rfilter', 'all', filter === 'all', '全部 ' + all.length) +
      chip('data-rfilter', 'due', filter === 'due', '已到期 ' + dueNow) +
      chip('data-rfilter', 'err', filter === 'err', '错 ≥ 2 · ' + err2) +
      '</span>' +
      '<span class="rl-hint">首列为课次 · 点词条直达卡片</span>' +
      '</div>';

    var sum = '<div class="rl-sum"><b>' + (scope === 'pro' ? '掌握池' : '待巩固池') + ' ' + all.length + ' 词</b>' +
      '<span>' + (scope === 'pro'
        ? '按间隔 ' + INTERVALS.join('/') + ' 天复习 · ' + (dueNow ? dueNow + ' 个已到期' : '暂无到期') +
          (err2 ? ' · ' + err2 + ' 个曾错过 2 次以上' : '')
        : (dueNow ? dueNow + ' 个已到期' + (all.length - dueNow ? ' · ' + (all.length - dueNow) + ' 个未到期' : '') : '全部未到期') +
          ' · 累计答错 ' + errSum + ' 次' + (err2 ? ' · ' + err2 + ' 个词错了 2 次以上' : '')) +
      '</span></div>';

    var rows = shown.map(function (c) {
      var w = c.w, lv = lvOf(w), err = errOf(w), ok = okOf(w), due = dueOf(w);
      var hasKanji = w[1] && w[1] !== w[0];
      var meta = '';
      if (scope === 'pro' || lv >= LV_MAX) meta += '<span class="rl-ok" title="掌握度分数 / 升掌握满分值">掌握度 ' + ok + '/' + proNeed() + '</span>';
      else if (ok) meta += '<span class="rl-ok" title="已得 ' + ok + ' 分，满 ' + proNeed() + ' 分升掌握">掌握度 ' + ok + '/' + proNeed() + '</span>';
      if (err) meta += '<span class="rl-err" title="累计答错 ' + err + ' 次">错 ' + err + '</span>';
      return '<div class="wl-row rl-row" data-rkey="' + esc(keyOf(w)) + '">' +
        '<span class="wl-idx">' + c.lesson + '</span>' +
        '<span class="wl-main"><span class="wl-kana">' + esc(w[0]) + (hasKanji ? '<em>' + esc(w[1]) + '</em>' : '') + '</span>' +
        '<div class="wl-mean">' + esc(w[3]) + '</div></span>' +
        meta +
        '<span class="rl-due' + (due <= now ? ' now' : '') + '">' + dueLabel(due) + '</span>' +
        '<span class="dot lv' + lv + '" title="' + ['未学', '遗忘', '记住', '掌握'][lv] + '"></span>' +
        '</div>';
    }).join('');

    var body = shown.length
      ? '<div class="word-list">' + rows + '</div>'
      : '<div class="empty" style="padding:44px 20px"><b>该筛选下没有词条</b></div>';

    return '<div class="review-wrap">' + head + sum + bar + body + '</div>';
  }

  /* ---------- 生词表分组：词表页与测验共用 ---------- */
  /* 返回 [{t:组名, n:词数, from, to}]；无分组数据则为空数组 */
  function segsOf(lesson) {
    var segs = GROUP_DATA[lesson], list = DATA[lesson] || [];
    if (!segs || segs.length < 2 || !list.length) return [];
    var p = 0;
    return segs.map(function (s) {
      var end = Math.min(p + s.n, list.length);
      var seg = { t: s.t, n: end - p, from: p, to: end };
      p = end;
      return seg;
    });
  }
  /* 当前选中的生词表下标数组；null = 全部选中 */
  function segSel(lesson) {
    var segs = segsOf(lesson);
    if (!segs.length) return null;
    var s = state.quizSegs[lesson];
    if (!s || !s.length) return null;
    s = s.filter(function (i) { return i >= 0 && i < segs.length; });
    if (!s.length || s.length >= segs.length) return null;
    return s;
  }
  /* 选中生词表覆盖的词条，按教材顺序 */
  function segWords(lesson, sel) {
    var list = DATA[lesson] || [], segs = segsOf(lesson);
    if (!segs.length || !sel) return list.slice();
    var out = [];
    segs.forEach(function (sg, gi) {
      if (sel.indexOf(gi) >= 0) out = out.concat(list.slice(sg.from, sg.to));
    });
    return out;
  }
  /* 「表 3」短名，用于测验页窄条 */
  function shortSeg(t) {
    var m = /生词表\s*(\d+)/.exec(t || '');
    return m ? ('表 ' + m[1]) : (t || '');
  }
  function segLabel(lesson, sel) {
    if (!sel) return '';
    var segs = segsOf(lesson);
    return ' · ' + sel.map(function (gi) {
      return shortSeg(segs[gi] && segs[gi].t);
    }).join('+');
  }
  /* 词条出处：第 N 课 · 生词表 X；无分组数据时只显示课号 */
  function originLabel(lesson, w) {
    var segs = segsOf(lesson);
    if (segs.length) {
      var idx = (DATA[lesson] || []).indexOf(w);
      if (idx >= 0) {
        for (var k = 0; k < segs.length; k++) {
          if (idx >= segs[k].from && idx < segs[k].to) return '第 ' + lesson + ' 课 · ' + segs[k].t;
        }
      }
    }
    return '第 ' + lesson + ' 课';
  }

  /* ---------- 测验 ---------- */
  /* 已掌握词不进入测验，仅在复习中出现 */
  function hasKanji(w) { return !!(w[1] && w[1] !== w[0]); }
  /* 汉字题可用性：表记含省略号「～」且假名不含时不出题；接尾词（词性含「接」）除外 */
  function kanjiQuizOk(w) {
    if (!hasKanji(w)) return false;
    return !/[〜～~]/.test(w[1]) || /[〜～~]/.test(w[0]) || (w[2] || '').indexOf('接') >= 0;
  }
  function quizPool(n, sel) {
    var s = (sel === undefined) ? segSel(n) : sel;
    return segWords(n, s).filter(function (w) { return lvOf(w) < LV_MAX; });
  }
  function quizKanjiPool(n, sel) {
    return quizPool(n, sel).filter(kanjiQuizOk);
  }
  function quizOn() {
    var t = store.settings.quizTypes;
    if (!t) { t = {}; store.settings.quizTypes = t; }
    /* 新增题型默认开启 */
    if (t.inkana === undefined) t.inkana = true;
    return t;
  }
  /* 每轮词数：0 为全部，不超过池大小 */
  function quizQnCap() {
    var n = store.settings.quizQn;
    return (n === 0 || n === undefined || n === null) ? 0 : n;
  }
  function quizQn(poolLen) {
    var cap = quizQnCap();
    return cap ? Math.min(cap, poolLen) : poolLen;
  }
  /* 每轮词数选择器：测验页与首页共用 */
  function qnSeg() {
    var cap = quizQnCap();
    return '<div class="seg qn-seg">' + QN_CHOICES.map(function (n) {
      var on = n === 0 ? !cap : cap === n;
      return '<button data-qn="' + n + '" class="' + (on ? 'on' : '') + '">' + (n === 0 ? '全部词' : n + ' 词') + '</button>';
    }).join('') + '</div>';
  }
  /* 本课（或所选生词表）可用题型：词池至少 1 词即可 */
  function availTypes(n, sel) {
    var pool = quizPool(n, sel), kj = quizKanjiPool(n, sel);
    var voice = ('speechSynthesis' in window);
    return QUIZ_TYPES.filter(function (t) {
      if (t.id === 'listen') return voice && pool.length >= 1;
      if (t.id === 'k2y') return kj.length >= 1 && pool.length >= 1;
      if (t.id === 'kji') return kj.length >= 1;
      return pool.length >= 1;
    });
  }
  /* 当前开启且可用的题型；全未开启时取第一个可用题型 */
  function activeTypes(n, sel) {
    var on = quizOn(), av = availTypes(n, sel);
    var picked = av.filter(function (t) { return on[t.id]; });
    return picked.length ? picked : av.slice(0, 1);
  }
  function typeMeta(id) {
    return QUIZ_TYPES.filter(function (t) { return t.id === id; })[0] || QUIZ_TYPES[0];
  }
  /* 读音题选项是否带汉字表记 */
  function optKanji() { return !!store.settings.optKanji; }
  function optKjChip() {
    return '<button class="chip' + (optKanji() ? ' on' : '') + '" id="optKjBtn"' +
      ' title="「中→日」题的读音选项后面是否附上汉字表记">选项带汉字</button>';
  }
  /* 选项样式开关：单独成行，相关题型可用时才显示 */
  function optStyleBar(availIds) {
    var has = function (id) { return (availIds || []).indexOf(id) >= 0; };
    var chips = '';
    if (has('c2j')) chips += optKjChip();
    if (has('inkana')) chips += kanaBankChip();
    return chips ? '<div class="qt-bar qt-opt"><em>选项</em>' + chips + '</div>' : '';
  }
  /* 首页用的题型开关卡片 */
  function qtypeCards() {
    var on = quizOn();
    return QUIZ_TYPES.map(function (t) {
      return '<button class="qt-card' + (on[t.id] ? ' on' : '') + '" data-qtype="' + t.id + '">' +
        '<b>' + t.label + '</b><span>' + t.hint + '</span>' +
        '<i>✓</i></button>';
    }).join('');
  }

  /* 按词条数组判断题型可用性（复习跨课出题用，至少 1 词） */
  function availTypesByWords(words) {
    var kj = words.filter(kanjiQuizOk);
    var voice = ('speechSynthesis' in window);
    return QUIZ_TYPES.filter(function (t) {
      if (t.id === 'listen') return voice && words.length >= 1;
      if (t.id === 'k2y') return kj.length >= 1;
      if (t.id === 'kji') return kj.length >= 1;
      return words.length >= 1;
    });
  }
  function activeTypesByWords(words) {
    var on = quizOn(), av = availTypesByWords(words);
    var picked = av.filter(function (t) { return on[t.id]; });
    return picked.length ? picked : av.slice(0, 1);
  }

  /* 测验页题型开关：lesson 决定可用题型 */
  function qtypeChips(lesson, effId) {
    var av = lesson ? availTypes(lesson).map(function (t) { return t.id; }) : null;
    return qtypeChipsByAvail(av, effId);
  }
  /* av = 可用题型 id 数组，null 表示不限制（首页/全局） */
  function qtypeChipsByAvail(av, effId) {
    var on = quizOn();
    return QUIZ_TYPES.map(function (t) {
      var usable = !av || av.indexOf(t.id) >= 0;
      var isOn = !!on[t.id] && usable;
      var cls = 'qtype' + (isOn ? ' on' : (effId === t.id ? ' eff' : '')) + (usable ? '' : ' na');
      return '<button class="' + cls + '" data-qtype="' + t.id + '" title="' +
        t.hint + (usable ? '' : '（当前词池不满足该题型条件）') + '"' +
        (usable ? '' : ' disabled') + '>' + t.label + '</button>';
    }).join('');
  }

  /* 测验页生词表多选条，默认全选 */
  function segChips(lesson) {
    var segs = segsOf(lesson);
    if (!segs.length) return '';
    var sel = segSel(lesson);
    var chips = segs.map(function (sg, gi) {
      var on = !sel || sel.indexOf(gi) >= 0;
      return '<button class="qseg' + (on ? ' on' : '') + '" data-qseg="' + gi + '"' +
        ' title="' + esc(sg.t) + ' · ' + sg.n + ' 词（可同时勾选多个生词表）">' +
        '<b>' + esc(shortSeg(sg.t)) + '</b><i>' + sg.n + '</i></button>';
    }).join('');
    var cnt = segWords(lesson, sel).length;
    return '<div class="qt-bar qseg-bar"><em>生词表</em>' +
      '<div class="qsegs">' +
      '<button class="qseg all' + (sel ? '' : ' on') + '" data-qseg="all">全部</button>' +
      chips + '</div>' +
      '<span class="qseg-sum">' + (sel ? '已选 ' + sel.length + '/' + segs.length + ' 表' : '全选 ' + segs.length + ' 表') +
      ' · ' + cnt + ' 词</span></div>';
  }

  /* 题干 + 提示：测验与复习做题共用 */
  function promptOf(cur) {
    var item = cur.item;
    var revealed = (cur.picked !== null && cur.picked !== undefined);
    var prompt, tip;
    if (cur.type === 'c2j') {
      prompt = '<div class="q-word cn">' + esc(item[3]) + '</div>';
      tip = '选择正确假名';
    } else if (cur.type === 'inkana') {
      prompt = '<div class="q-word cn">' + esc(item[3]) + '</div>';
      tip = revealed ? esc(item[0]) : '写出假名';
    } else if (cur.type === 'listen') {
      prompt = revealed
        ? '<div class="q-word">' + esc(item[0]) + '</div>'
        : '<button class="q-play" id="replayBtn" title="再听一次">' +
          '<span>♪</span><b>播放发音</b></button>';
      tip = revealed ? (hasKanji(item) ? esc(item[1]) : '') : '听发音，选择正确释义';
    } else if (cur.type === 'k2y') {
      prompt = '<div class="q-word kj">' + esc(item[1]) + '</div>';
      tip = '选择正确假名';
    } else if (cur.type === 'kji') {
      prompt = '<div class="q-word">' + esc(item[0]) + '</div>';
      tip = esc(item[3]) + ' · 选择正确汉字';
    } else {
      prompt = '<div class="q-word">' + esc(item[0]) + '</div>';
      tip = hasKanji(item) ? esc(item[1]) : '选择正确释义';
    }
    return { prompt: prompt, tip: tip };
  }

  function viewQuiz() {
    if (!state.lesson) return '<div class="empty"><b>未选择课次</b><p>在左侧课程列表中选择课次后即可开始测验。</p></div>';
    var sel = segSel(state.lesson);
    var base = segWords(state.lesson, sel);       /* 当前选中生词表覆盖的词条 */
    if (!base.length) {
      return '<div class="empty"><b>' + (sel ? '所选生词表暂无词条' : '本课暂无词条') + '</b>' +
        '<p>当前范围内没有词条' + (sel ? '（已选 ' + sel.length + ' 个生词表）。' : '。') + '</p></div>';
    }

    var segBar = segChips(state.lesson);
    var pool = quizPool(state.lesson, sel);
    if (!pool.length) {
      return '<div class="quiz">' + segBar + '<div class="empty" style="border:0;background:none;padding:30px 0">' +
        '<b>所选范围已全部掌握</b>' +
        '<p>' + (sel ? '所选生词表' : '第 ' + state.lesson + ' 课') + '共 ' + base.length + ' 词，均已掌握，没有可测的词条。' +
        '<br>已掌握的词仅在「复习 → 掌握复习」中出现，在此答「遗忘」或「记住」会退回待巩固。</p>' +
        '<div class="continue-row" style="justify-content:center;margin-top:20px">' +
        '<button class="btn primary" data-mode="review" data-scope="pro">去掌握复习</button>' +
        '<button class="btn" data-lesson="' + state.lesson + '" data-mode="study">回到卡片</button>' +
        '</div></div></div>';
    }

    var sig = sel ? sel.join(',') : 'all';
    if (!state.quiz || (!state.quiz.fixed && (state.quiz.lesson !== state.lesson || state.quiz.sig !== sig))) {
      state.quiz = buildQuiz(state.lesson);
    }
    var q = state.quiz;

    var onMap = quizOn(), usableNow = availTypes(state.lesson, sel);
    var effId = usableNow.filter(function (t) { return onMap[t.id]; }).length ? null : (usableNow[0] || {}).id;
    var chips = segBar + '<div class="qt-bar"><em>题型</em><div class="qtypes" id="qtypes">' +
      qtypeChips(state.lesson, effId) + '</div>' +
      '<span class="qt-qn"><em>词数</em>' + qnSeg() + '</span></div>' +
      optStyleBar(usableNow.map(function (t) { return t.id; }));

    if (q.i >= q.qs.length) {
      var rate = Math.round((q.score / q.qs.length) * 100);
      var brk = {}, order = [];
      q.qs.forEach(function (x) {
        if (!brk[x.type]) { brk[x.type] = { ok: 0, n: 0 }; order.push(x.type); }
        brk[x.type].n++;
        if (x.picked !== null && x.picked !== undefined && x.correct) brk[x.type].ok++;
      });
      var brkHtml = order.map(function (id) {
        var b = brk[id];
        return '<span class="qb-item ' + (b.ok === b.n ? 'ok' : (b.ok === 0 ? 'no' : '')) + '">' +
          typeMeta(id).label + ' <b>' + b.ok + '</b>/' + b.n + '</span>';
      }).join('');
      return '<div class="quiz">' + chips + '<div class="q-card result">' +
        '<div class="score">' + q.score + '<small> / ' + q.qs.length + '</small></div>' +
        '<p>' + (rate >= 90 ? '正确率较高，可以进入下一课。' : rate >= 70 ? '基本掌握，部分错题仍需复习。' : '正确率偏低，可先用卡片模式过一遍。') +
        (q.proCount ? '<br>本轮新掌握 <b>' + q.proCount + '</b> 个词，此后仅在复习中出现。' : '') + '</p>' +
        '<div class="q-break">' + brkHtml + '</div>' +
        wrongListHtml(q.wrong) +
        '<div class="continue-row" style="justify-content:center;margin-top:22px">' +
        (q.wrong && q.wrong.length ? '<button class="btn primary" id="retryWrong">重练这 ' + q.wrong.length + ' 个错题</button>' : '') +
        '<button class="btn' + (q.wrong && q.wrong.length ? '' : ' primary') + '" id="quizAgain">再测一次</button>' +
        '<button class="btn" data-lesson="' + state.lesson + '" data-mode="study">回到卡片</button>' +
        '<button class="btn" data-mode="review" data-scope="due">复习错词</button>' +
        '</div></div></div>';
    }

    var cur = q.qs[q.i];
    var item = cur.item;
    var tm = typeMeta(cur.type);
    var revealed = (cur.picked !== null && cur.picked !== undefined);
    var pt = promptOf(cur);
    var prompt = pt.prompt, tip = pt.tip;

    var jpOpt = (cur.type === 'c2j' || cur.type === 'k2y' || cur.type === 'kji');
    var opts = cur.opts.map(function (o, i) {
      var cls = 'opt';
      if (revealed) {
        if (i === cur.answer) cls += ' right';
        else if (i === cur.picked) cls += ' wrong';
        cls += ' done';
      }
      return '<button class="' + cls + '" data-opt="' + i + '"><span class="idx">' + 'ABCD'[i] + '</span>' +
        '<span class="' + (jpOpt ? 'jp' : '') + '">' + esc(optLabel(cur, o)) + '</span></button>';
    }).join('');

    return '<div class="quiz">' +
      '<div class="quiz-head">' +
      '<span>第 ' + state.lesson + ' 课' + segLabel(state.lesson, sel) + ' · 第 ' + (q.i + 1) + ' / ' + q.qs.length + ' 题</span>' +
      '<span class="q-badge">' + tm.label + '</span>' +
      '</div>' + chips +
      '<div class="q-card">' +
      prompt +
      (tip ? '<div class="q-tip">' + tip + '</div>' : '') +
      (cur.type === 'inkana' ? inputHtml(cur, revealed) : '<div class="opts">' + opts + '</div>') +
      '<div class="quiz-foot"><div class="feedback ' + (revealed ? (cur.correct ? 'ok' : 'no') : '') + '">' +
      (revealed ? (cur.correct
        ? '正确' + (cur.pro ? ' · 本词题型 ' + cur.pro.ok + '/' + cur.pro.need +
          (cur.pro.promoted ? '，全部答对，已掌握' : (cur.pro.left ? '（还剩 ' + cur.pro.left + ' 题）' : '，本轮未全对，留在待巩固')) : '')
        : '正确答案：' + esc(answerText(cur))) : '') +
      '</div>' +
      (revealed ? '<button class="btn dark" id="quizNext">下一题</button>'
        : (cur.type === 'inkana' ? '<button class="btn dark" id="kanaSubmit">提交</button>' : '')) +
      '</div></div></div>';
  }

  function optLabel(cur, o) {
    if (typeof o === 'string') return o;
    if (cur.type === 'c2j') return o[0] + (hasKanji(o) && optKanji() ? '　' + o[1] : '');
    return o[3];
  }
  function answerText(cur) {
    if (!cur.opts || !cur.opts.length) return cur.item[0];
    var o = cur.opts[cur.answer];
    if (typeof o === 'string') return o;
    if (cur.type === 'c2j') return o[0] + (hasKanji(o) && optKanji() ? '　' + o[1] : '');
    return o[3];
  }

  /* ---------- 输入题：假名比对 ---------- */
  function normKana(s) {
    return String(s == null ? '' : s)
      .replace(/[\s　]/g, '')
      .replace(/[～~]/g, '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .toLowerCase();
  }
  /* 忽略空白、波浪线、全角半角与长音符；片假名仍须写对 */
  function kanaEq(input, answer) {
    var a = normKana(answer), b = normKana(input);
    if (!b) return false;
    if (a === b) return true;
    return a.replace(/ー/g, '') === b.replace(/ー/g, '');
  }
  /* 长度格子：格数为标准答案假名数（小假名、长音符各算一格），多输入的字符追加虚线格 */
  function kanaCellsHtml(len, value, caret) {
    var chars = Array.from(value || '');
    var total = Math.max(len, chars.length, 1);
    var h = '';
    for (var i = 0; i < total; i++) {
      h += '<i class="' + (i >= len ? 'over' : '') + (i === caret ? ' on' : '') + '">' +
        (chars[i] ? esc(chars[i]) : '') + '</i>';
    }
    return h;
  }
  /* 格子宽度由 CSS 的 --n 决定，此处只给字号档位 */
  function kanaSizeCls(len) {
    return len <= 6 ? '' : len <= 10 ? ' s' : ' xs';
  }
  function syncKanaFill() {
    var inp = document.getElementById('kanaInput');
    var row = document.getElementById('kanaCells');
    if (!inp || !row) return;
    var len = +row.dataset.len || 1;
    /* 点选模式无光标，高亮固定在下一待填格 */
    var caret = (inp.readOnly || inp.selectionStart === null) ? Array.from(inp.value || '').length : inp.selectionStart;
    row.innerHTML = kanaCellsHtml(len, inp.value, caret);
  }
  /* 输入题作答区：未作答显示格子与透明输入框，已作答只回显 */
  function inputHtml(cur, revealed) {
    if (revealed) {
      return '<div class="answer-input done ' + (cur.correct ? 'ok' : 'no') + '">' +
        '<span class="ai-what">' + esc(String(cur.picked || '（空）')) + '</span>' +
        (cur.correct ? '<em>正确</em>' : '<em>应写：' + esc(cur.item[0]) + '</em>') +
        '</div>';
    }
    var len = Array.from(cur.item[0]).length;
    var bank = kanaBankOn();
    return '<div class="answer-input">' +
      '<div class="kana-fill">' +
      '<div class="kc-row' + kanaSizeCls(len) + '" id="kanaCells" data-len="' + len + '" style="--n:' + len + '">' + kanaCellsHtml(len, '', 0) + '</div>' +
      '<input id="kanaInput" class="kana-raw" type="text" lang="ja" autocomplete="off" spellcheck="false"' +
      (bank ? ' readonly inputmode="none"' : '') +
      ' maxlength="' + len + '" aria-label="假名读音，共 ' + len + ' 格">' +
      '</div></div>' +
      (bank ? kanaBankHtml(cur) : '') +
      '<p class="ai-hint"></p>';
  }

  /* ---------- 假名点选：从一堆平/片假名里挑着填 ---------- */
  var KANA_HIRA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゃゅょっぁぃぅぇぉ';
  var KANA_KATA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポャュョッァィゥェォー';
  function kanaBankOn() { return !!store.settings.kanaBank; }
  function kanaBankChip() {
    return '<button class="chip' + (kanaBankOn() ? ' on' : '') + '" id="kanaBankBtn"' +
      ' title="输入假名题不再手写，而是从一堆平/片假名里点选拼出读音">点选假名</button>';
  }
  /* 每个答案假名各一块，另加若干干扰块；答案为片假名时干扰偏片假名 */
  function buildKanaBank(ans) {
    var chars = Array.from(ans);
    var have = {};
    chars.forEach(function (c) { have[c] = 1; });
    var kata = /[\u30A1-\u30FA\u30FC]/.test(ans);
    var poolStr = kata ? (KANA_KATA + KANA_HIRA) : (KANA_HIRA + KANA_KATA);
    var pool = shuffle(poolStr.split('').filter(function (c) { return !have[c]; }));
    var extra = Math.max(3, Math.min(5, Math.round(chars.length * 0.6) + 1));
    var tiles = chars.slice();
    for (var i = 0; i < extra && i < pool.length; i++) tiles.push(pool[i]);
    return shuffle(tiles);
  }
  function kanaBankHtml(cur) {
    if (!cur.kanaBank) cur.kanaBank = buildKanaBank(cur.item[0]);
    var t = cur.kanaBank.map(function (c, i) {
      return '<button class="ktile" data-ktile="' + i + '" data-k="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
    /* 退格键与磁贴同排 */
    return '<div class="kana-bank"><div class="kb-grid">' + t +
      '<button class="kb-del" id="kbDel" title="删掉最后一格" disabled>⌫</button></div></div>';
  }
  function curKanaQ() {
    var sess = state.mode === 'review' ? state.rquiz : state.quiz;
    return (sess && sess.qs) ? sess.qs[sess.i] : null;
  }
  /* 点选 / 退格后刷新磁贴状态：按 cur.kbTap 记录的已点磁贴置灰；键盘输入部分按字符从左匹配 */
  function markBankUsed() {
    var inp = document.getElementById('kanaInput');
    var tiles = document.querySelectorAll('#stage .ktile');
    if (!inp) return;
    var val = Array.from(inp.value || ''), cur = curKanaQ();
    var tap = (cur && cur.kbTap) || [], used = {}, n = 0;
    /* 仅保留与输入框逐位一致的点击记录；手动改动的部分作废 */
    while (n < tap.length && n < val.length && tiles[tap[n]] && tiles[tap[n]].dataset.k === val[n]) { used[tap[n]] = 1; n++; }
    if (cur) cur.kbTap = tap.slice(0, n);
    var left = {};
    val.slice(n).forEach(function (c) { left[c] = (left[c] || 0) + 1; });
    for (var i = 0; i < tiles.length; i++) {
      var c = tiles[i].dataset.k;
      if (!used[i] && left[c] > 0) { left[c]--; used[i] = 1; }
      if (used[i]) { tiles[i].classList.add('used'); tiles[i].disabled = true; }
      else { tiles[i].classList.remove('used'); tiles[i].disabled = false; }
    }
    var del = document.getElementById('kbDel');
    if (del) del.disabled = !(inp.value || '').length;
  }
  /* 点磁贴 / 退格：直接修改输入框的值 */
  function kanaBankTap(ch, ti) {
    var inp = document.getElementById('kanaInput');
    if (!inp) return;
    var cur = Array.from(inp.value || '');
    var max = +inp.maxLength || 99;
    var q = curKanaQ();
    if (q && !q.kbTap) q.kbTap = [];
    if (ch === null) {
      if (!cur.length) return;
      cur.pop();
      if (q && q.kbTap.length > cur.length) q.kbTap.length = cur.length;
    } else {
      if (cur.length >= max) return;
      /* 输入框已有手打内容时不记录点击 */
      if (q && ti !== undefined && q.kbTap.length === cur.length) q.kbTap.push(ti);
      cur.push(ch);
    }
    inp.value = cur.join('');
    syncKanaFill();
    markBankUsed();
  }
  /* 提交输入答案：与选项作答同一计分路径 */
  function submitKana() {
    var inp = $('#kanaInput');
    if (!inp) return;
    var sess = state.mode === 'review' ? state.rquiz : state.quiz;
    if (!sess || !sess.qs) return;
    var cur = sess.qs[sess.i];
    if (!cur || (cur.picked !== null && cur.picked !== undefined)) return;
    if (!(inp.value || '').trim()) return;   /* 空答案不判错 */
    var ok = kanaEq(inp.value, cur.item[0]);
    cur.picked = inp.value || '（空）';
    cur.correct = ok;
    if (ok) {
      sess.score++;
      if (state.mode === 'review' && sess.scope === 'pro') {
        proSettle(sess, cur, true);
      } else {
        quizSettle(sess, cur, true);
      }
    } else if (state.mode === 'review' && sess.scope === 'pro') {
      proSettle(sess, cur, false);
    } else {
      quizSettle(sess, cur, false);
    }
    render();
  }

  /* 取 n 个干扰项：按 keyFn 去重，排除与正确项同值者；pool 按 distractorWords 顺序取 */
  function distractors(pool, item, keyFn, n) {
    var seen = {}, out = [], exclude = keyFn(item);
    pool.forEach(function (x) {
      if (out.length >= n || x === item) return;
      var k = keyFn(x);
      if (k === exclude || seen[k]) return;
      seen[k] = 1;
      out.push(x);
    });
    return out;
  }

  /* 单题：按题型生成题干与选项，answer 为正确项下标 */
  function makeQuestion(type, item, pool) {
    var opts, dis, answer = -1;

    /* 输入题无选项，答案比对见 kanaEq */
    if (type === 'inkana') {
      return { type: type, item: item, opts: [], answer: -1, picked: null, correct: false, pro: null };
    }
    if (type === 'kji') {
      dis = distractors(pool.filter(kanjiQuizOk), item, function (x) { return x[1]; }, 3)
        .map(function (x) { return x[1]; });
      opts = shuffle([item[1]].concat(dis));
      answer = opts.indexOf(item[1]);
    } else if (type === 'k2y') {
      /* 读音题干扰项不得与正确项同音 */
      dis = distractors(pool, item, function (x) { return x[0]; }, 3)
        .map(function (x) { return x[0]; });
      opts = shuffle([item[0]].concat(dis));
      answer = opts.indexOf(item[0]);
    } else {
      /* c2j 按读音去重；j2c / listen 按释义去重 */
      var keyFn = function (x) { return type === 'c2j' ? x[0] : x[3]; };
      dis = distractors(pool, item, keyFn, 3);
      opts = shuffle([item].concat(dis));
      opts.forEach(function (o, i) { if (o === item) answer = i; });
    }

    return { type: type, item: item, opts: opts, answer: answer, picked: null, correct: false, pro: null };
  }

  /* 组装一轮题目：每词遍历全部勾选题型（无表记的词跳过汉字题型），题序打乱 */
  function composeQuiz(items, types, poolFor, lessonOf) {
    var qs = [], seen = {};
    shuffle(items.slice()).forEach(function (w) {
      if (seen[keyOf(w)]) return;      /* 同一个词只遍历一遍 */
      seen[keyOf(w)] = 1;
      shuffle(types.filter(function (t) { return !t.needKanji || kanjiQuizOk(w); })).forEach(function (t) {
        var q = makeQuestion(t.id, w, poolFor(w));
        q.lesson = lessonOf(w);
        qs.push(q);
      });
    });
    shuffle(qs);          /* 题序整体打乱 */
    return qs;
  }
  /* 每个词在本轮的题数 */
  function wordTotals(qs) {
    var t = {};
    qs.forEach(function (q) { var k = keyOf(q.item); t[k] = (t[k] || 0) + 1; });
    return t;
  }

  function buildQuiz(lesson) {
    var sel = segSel(lesson);
    var pool = quizPool(lesson, sel);
    var types = activeTypes(lesson, sel);
    var words = shuffle(pool.slice()).slice(0, quizQn(pool.length));   /* 先随机取词 */
    /* 干扰项从全库取 */
    var qs = composeQuiz(words, types, distractorWords, function () { return lesson; });

    spokenKey = '';   /* 新一轮重置自动朗读标记 */
    return {
      lesson: lesson, sig: sel ? sel.join(',') : 'all', sel: sel, qs: qs, i: 0, score: 0,
      proCount: 0, wrong: [], fixed: false, stat: {}, total: wordTotals(qs)
    };
  }
  /* 错题重练：以答错的词组卷，题型沿用当前开关 */
  function buildWrongQuiz(cards) {
    var words = cards.map(function (c) { return c.w; });
    var types = activeTypesByWords(words);
    var lessonMap = {};
    cards.forEach(function (c) { lessonMap[keyOf(c.w)] = c.lesson; });
    var qs = composeQuiz(words, types, distractorWords, function (w) {
      return lessonMap[keyOf(w)] || state.lesson || 1;
    });
    return {
      lesson: state.lesson, scope: state.mode === 'review' ? state.reviewScope : null,
      sig: 'wrong', qs: qs, i: 0, score: 0, proCount: 0, wrong: [],
      avail: availTypesByWords(words).map(function (t) { return t.id; }),
      fixed: true, stat: {}, total: wordTotals(qs)
    };
  }
  /* 结果页的错题清单 */
  function wrongListHtml(list) {
    if (!list || !list.length) return '';
    return '<div class="wrong-list"><h4>本轮错题 <em>' + list.length + ' 个</em></h4>' +
      list.map(function (x) {
        return '<div class="wrong-row">' +
          '<span class="wr-kana">' + esc(x.w[0]) + '</span>' +
          (x.w[1] && x.w[1] !== x.w[0] ? '<span class="wr-kanji">' + esc(x.w[1]) + '</span>' : '') +
          '<span class="wr-mean">' + esc(x.w[3]) + '</span>' +
          '<span class="wr-type">' + typeMeta(x.type).label + '</span>' +
          '</div>';
      }).join('') + '</div>';
  }

  /* ---------- 词表 ---------- */
  function viewList() {
    if (!state.lesson) return '<div class="empty"><b>请先选择一课</b></div>';
    var list = DATA[state.lesson] || [];
    if (!list.length) return '<div class="empty"><b>本课词表暂缺</b></div>';
    var stl = lessonStats(state.lesson);

    function rowHtml(w, i) {
      var lv = lvOf(w);
      var hasKanji = w[1] && w[1] !== w[0];
      return '<div class="wl-row" data-word="' + i + '">' +
        '<span class="wl-idx">' + (i + 1) + '</span>' +
        '<span class="wl-main"><span class="wl-kana">' + esc(w[0]) + (hasKanji ? '<em>' + esc(w[1]) + '</em>' : '') + '</span>' +
        '<div class="wl-mean">' + esc(w[3]) + '</div></span>' +
        '<span class="wl-pos">' + esc(w[2] || '') + '</span>' +
        (lv >= LV_MAX ? '<span class="wl-pro" title="掌握度满 ' + proNeed() + ' 分，仅在复习中复习">掌握</span>' : '') +
        '<span class="dot lv' + lv + '" title="' + ['未学', '遗忘', '记住', '掌握'][lv] + '"></span>' +
        '</div>';
    }

    var segs = segsOf(state.lesson);
    var sel = segSel(state.lesson);
    var rows;
    if (segs.length > 1) {
      rows = segs.map(function (seg, gi) {
        if (sel && sel.indexOf(gi) < 0) return '';
        var body = '';
        for (var j = seg.from; j < seg.to; j++) body += rowHtml(list[j], j);
        var collapsed = !!state.collapsed[state.lesson + '|' + gi];
        return '<div class="wl-group' + (collapsed ? ' is-off' : '') + '">' +
          '<div class="wl-ghead" data-gtoggle="' + gi + '">' +
          '<span class="wl-gname">' + esc(seg.t) + '</span>' +
          '<span class="wl-gnum">' + seg.n + ' 词</span>' +
          '<span class="wl-gright">' +
          '<button class="wl-gtest" data-qtest="' + gi + '" title="只测验这一组">测这组</button>' +
          '<i class="wl-garrow"></i></span></div>' +
          '<div class="wl-gbody">' + body + '</div></div>';
      }).join('');
    } else {
      rows = list.map(rowHtml).join('');
    }

    var shown = sel ? segWords(state.lesson, sel).length : list.length;
    return '<div class="study">' + segChips(state.lesson) +
      '<div class="study-head list-head"><div class="prog"><div class="prog-top"><b>第 ' + state.lesson + ' 课 · ' + esc(META[state.lesson] || '') + '</b></div></div>' +
      '<div class="toggles"><span class="head-cnt">' + shown + ' 词' +
      (stl.pro ? ' · 掌握 ' + stl.pro : '') + (sel ? ' · 全课 ' + list.length : '') + '</span>' +
      '<button class="btn" id="speakAll" style="height:28px;padding:0 10px;font-size:11.5px">朗读全部</button></div></div>' +
      '<div class="word-list">' + rows + '</div></div>';
  }

  /* ---------- 搜索 ---------- */
  function viewSearch() {
    var q = state.query.trim().toLowerCase();
    var hits = allWords().filter(function (x) {
      var w = x.w;
      return (w[0] + w[1] + w[3]).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 80);

    if (!hits.length) return '<div class="search-res"><div class="empty"><b>未找到「' + esc(state.query) + '」相关词条</b><p>支持按假名、汉字或中文释义搜索。</p></div></div>';

    var rows = hits.map(function (x) {
      var w = x.w;
      var hasKanji = w[1] && w[1] !== w[0];
      return '<div class="wl-row" data-jump="' + x.lesson + '" data-idx="' + (DATA[x.lesson] || []).indexOf(w) + '">' +
        '<span class="wl-idx">' + x.lesson + '</span>' +
        '<span class="wl-main"><span class="wl-kana">' + esc(w[0]) + (hasKanji ? '<em>' + esc(w[1]) + '</em>' : '') + '</span>' +
        '<div class="wl-mean">' + esc(w[3]) + '</div></span>' +
        '<span class="wl-pos">' + esc(w[2] || '') + '</span>' +
        '</div>';
    }).join('');
    return '<div class="search-res"><p class="section-title">「' + esc(state.query) + '」命中 ' + hits.length + ' 条（点击进入对应课次）</p><div class="word-list">' + rows + '</div></div>';
  }

  /* ---------- 交互 ---------- */
  function selectLesson(n, mode) {
    savePos();                       /* 保存当前课位置 */
    state.lesson = n;
    store.last = n; saveStore();
    state.deckSig = null;
    state.quiz = null;
    state.flipped = false;           /* 位置由 ensureDeck 按存档恢复 */
    state.mode = mode || (state.mode === 'home' ? 'study' : state.mode);
    if (state.mode === 'home') state.mode = 'study';
    closeMenu();
    render();
  }

  /* 回首页：保留当前课次，仅切换视图 */
  function goHome() {
    if (state.mode === 'study') savePos();
    state.mode = 'home';
    state.query = '';
    var si = $('#searchInput');
    if (si) si.value = '';
    closeMenu();
    render();
  }

  function currentCard() {
    if (state.mode === 'review') {
      var p = state.reviewDeck || [];
      return p[state.idx] ? p[state.idx].w : null;
    }
    var list = DATA[state.lesson] || [];
    var di = state.deck[state.idx];
    return di === undefined ? null : list[di];
  }

  /* 离场过渡：卡片淡出后执行回调；动画期间忽略重复操作 */
  var animating = false;
  function leaveCard(dir, done) {
    var card = $('#theCard');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!card || animating || reduce) { done(); return; }
    animating = true;
    card.classList.add(dir > 0 ? 'card-out-next' : 'card-out-prev');
    setTimeout(function () {
      animating = false;
      card.classList.remove('card-out-next', 'card-out-prev');
      done();
    }, 190);
  }
  function judge(lv) {
    if (animating) return;
    leaveCard(lv === 1 ? -1 : 1, function () { judgeNow(lv); });
  }

  function judgeNow(lv) {
    var res = null, word = null, wasPro = false;
    if (state.mode === 'review') {
      var card = (state.reviewDeck || [])[state.idx];
      if (!card) return;
      word = card.w;
      wasPro = lvOf(word) >= LV_MAX;
      /* 掌握词判级：忘记打回待巩固，记住与掌握均保持掌握 */
      res = markWord(word, lv);
    } else {
      var w = currentCard();
      if (!w) return;
      word = w;
      wasPro = lvOf(w) >= LV_MAX;
      /* 已掌握词点「掌握」不降级 */
      res = markWord(w, lv);
    }
    if (res && res.promoted) {
      toast('「' + word[0] + '」已满 ' + res.need + ' 分，标记为掌握', 'pro');
    } else if (res && wasPro && res.lv < LV_MAX) {
      toast('「' + word[0] + '」已退回待巩固，当前 ' + res.ok + ' 分', 'back');
    } else if (res && res.shortened) {
      toast('「' + word[0] + '」仍为掌握，下次复习提前');
    } else if (res && res.capped) {
      toast('「' + word[0] + '」今天已加过分，明天再判「记住」才加分');
    }
    state.flipped = false;
    state.idx++;
    if (state.mode === 'study') savePos();
    renderCard(true);          /* 判级后刷新侧栏 */
  }

  function move(d) {
    if (animating) return;
    leaveCard(d, function () { moveNow(d); });
  }
  function moveNow(d) {
    var n = state.idx + d;
    if (n < 0) return;
    state.idx = n;
    state.flipped = false;
    if (state.mode === 'study') savePos();
    renderCard(false);         /* 翻卡不刷新侧栏 */
  }

  function closeMenu() {
    $('#sidebar').classList.remove('open');
    $('#scrim').classList.remove('show');
  }
  function openMenu() {
    $('#sidebar').classList.add('open');
    $('#scrim').classList.add('show');
  }

  /* 同步课次与模式到地址栏 hash */
  function syncHash() {
    if (!state.lesson) return;
    var c = '';
    if (state.mode === 'quiz') c = 'q';
    else if (state.mode === 'list') c = 'v';
    else if (state.mode === 'review') c = state.reviewScope === 'pro' ? 'p' : 'r';
    var next = '#L' + state.lesson + c;
    if (location.hash === next) return;
    try { history.replaceState(null, '', next); }
    catch (e) { location.hash = next; }   /* file:// 下 replaceState 可能被拒，改用 hash */
  }

  function render() {
    renderSidebar();
    renderTopbar();
    renderStage();
    syncHash();
    autoSpeak();
    focusKanaInput();
  }
  /* 输入题自动聚焦；触屏设备不主动弹键盘 */
  function focusKanaInput() {
    var ki = document.getElementById('kanaInput');
    if (!ki) return;
    if (window.matchMedia && !window.matchMedia('(hover:hover)').matches) return;
    var ae = document.activeElement;
    if (ae && ae.id === 'searchInput') return;
    try { ki.focus(); } catch (e) {}
    syncKanaFill();
  }

  /* 听音辨义：进入题目即自动朗读一次 */
  var spokenKey = '';
  /* 自动朗读：读音已在题干中露出或为听音题时出题即读；读音即答案的题型在作答后再读 */
  var SPEAK_BEFORE = { listen: 1, j2c: 1, kji: 1 };
  function autoSpeak() {
    /* 卡片正面显示假名，换卡即朗读一次 */
    if (!state.query && (state.mode === 'study' || (state.mode === 'review' && state.reviewPhase === 'card'))) {
      var cw = currentCard();
      if (!cw) return;
      var ck = 'card|' + state.mode + '|' + (state.lesson || state.reviewScope) + '|' + state.idx + '|' + keyOf(cw);
      if (spokenKey === ck) return;
      spokenKey = ck;
      setTimeout(function () { speak(cw[0]); }, 140);
      return;
    }
    var q = state.mode === 'review' ? state.rquiz : (state.mode === 'quiz' ? state.quiz : null);
    if (!q || !q.qs) return;
    var cur = q.qs[q.i];
    if (!cur) return;
    var answered = cur.picked !== null && cur.picked !== undefined;
    if (answered === !!SPEAK_BEFORE[cur.type]) return;
    var key = (q.scope || q.lesson) + '|' + (q.sig || '') + '|' + q.i + '|' + keyOf(cur.item) + '|' + (answered ? 1 : 0);
    if (spokenKey === key) return;
    spokenKey = key;
    setTimeout(function () { speak(cur.item[0]); }, 140);
  }

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'revLesson') setReviewLesson(+e.target.value);
  });

  /* 事件委托 */
  document.addEventListener('click', function (e) {
    /* 吞掉滑动结束后补发的 click */
    if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
    var t = e.target;

    if (t.closest('#brandHome')) { goHome(); return; }

    /* 侧栏生词表子选项：学习 / 测验 / 词表共用同一范围选择 */
    var sSegBtn = t.closest('[data-sseg]');
    if (sSegBtn) {
      var sl = +(sSegBtn.dataset.slsn || state.lesson || 0);
      if (!sl) return;
      var ssegs = segsOf(sl);
      if (!ssegs.length) return;
      state.lesson = sl;
      var sv = sSegBtn.dataset.sseg;
      if (sv === 'all') {
        delete state.quizSegs[sl];
      } else {
        /* 侧栏单选：点一组只看该组，再点回到全部 */
        var sOnly = state.quizSegs[sl];
        if (sOnly && sOnly.length === 1 && sOnly[0] === +sv) delete state.quizSegs[sl];
        else state.quizSegs[sl] = [+sv];
      }
      state.deckSig = null;                                  /* 按新范围重建卡片队列 */
      state.quiz = quizPool(sl, segSel(sl)).length ? buildQuiz(sl) : null;
      savePos();
      render();
      return;
    }

    var lessonBtn = t.closest('[data-lesson]');
    if (lessonBtn && !lessonBtn.classList.contains('modes')) {
      var ln = +lessonBtn.dataset.lesson;
      var md = lessonBtn.dataset.mode;
      selectLesson(ln, md);
      return;
    }

    /* 词表组头「测这组」：仅测验该组 */
    var testBtn = t.closest('[data-qtest]');
    if (testBtn && state.lesson) {
      var ti = +testBtn.dataset.qtest;
      if (segsOf(state.lesson).length > 1) {
        state.quizSegs[state.lesson] = [ti];
        state.quiz = buildQuiz(state.lesson);
        state.mode = 'quiz';
        render();
      }
      return;
    }

    /* 词表分组折叠/展开 */
    var gHead = t.closest('[data-gtoggle]');
    if (gHead) {
      var gk = state.lesson + '|' + gHead.dataset.gtoggle;
      state.collapsed[gk] = !state.collapsed[gk];
      gHead.parentNode.classList.toggle('is-off', state.collapsed[gk]);
      return;
    }

    var bookBtn = t.closest('[data-book]');
    if (bookBtn) {
      state.book = bookBtn.dataset.book;
      store.book = state.book;
      saveStore();
      renderSidebar();
      if (state.mode === 'home') renderStage();
      return;
    }

    /* 复习区切换：待巩固 / 掌握复习 */
    var scopeBtn = t.closest('.rev-tabs [data-scope]');
    if (scopeBtn) {
      state.reviewScope = scopeBtn.dataset.scope === 'pro' ? 'pro' : 'due';
      state.reviewDeck = null;
      state.rquiz = null;
      state.reviewFilter = 'all';   /* 换池后重置筛选 */
      state.idx = 0; state.flipped = false;
      render();
      return;
    }

    var rlBtn = t.closest('[data-rlesson]');
    if (rlBtn) { setReviewLesson(+rlBtn.dataset.rlesson); return; }

    /* 复习练法切换 */
    var rpBtn = t.closest('[data-rphase]');
    if (rpBtn) {
      var raw = rpBtn.dataset.rphase;
      var phase = raw === 'card' ? 'card' : (raw === 'list' ? 'list' : 'quiz');
      if (state.reviewPhase !== phase) {
        state.reviewPhase = phase;
        state.reviewDeck = null;
        state.rquiz = null;
        state.idx = 0;
        state.flipped = false;
        render();
      }
      return;
    }

    /* 复习列表：排序 / 筛选 / 点词直达卡片 */
    var rsort = t.closest('[data-rsort]');
    if (rsort) {
      state.reviewSort = rsort.dataset.rsort;
      render();
      return;
    }
    var rfilter = t.closest('[data-rfilter]');
    if (rfilter) {
      state.reviewFilter = rfilter.dataset.rfilter;
      render();
      return;
    }
    var rkey = t.closest('#stage [data-rkey]');
    if (rkey) {
      var sc = state.reviewScope === 'pro' ? 'pro' : 'due';
      var deck = reviewListPool(sc), at = -1;
      deck.forEach(function (c, i) { if (keyOf(c.w) === rkey.dataset.rkey) at = i; });
      if (at >= 0) {
        state.reviewPhase = 'card';
        state.reviewDeck = deck;        /* 顺序与列表一致 */
        state.reviewDeckScope = sc;
        state.idx = at;
        state.flipped = false;
        render();
      }
      return;
    }

    /* 顶栏模式切换及页内模式按钮 */
    var modeBtn = t.closest('[data-mode]');
    if (modeBtn) {
      var m = modeBtn.dataset.mode;
      if (state.mode === 'study') savePos();   /* 离开学习页前保存位置 */
      if (m === 'review') {
        /* data-scope 决定复习队列；顶栏「复习」无 scope 时沿用上次 */
        var sc = modeBtn.dataset.scope;
        if (sc === 'due' || sc === 'pro') {
          state.reviewScope = sc;
          state.reviewPhase = 'quiz';   /* 从首页或结果页进入时直接进入做题检验 */
          state.reviewLesson = 0;       /* 范围复位为全部课程 */
        }
        state.reviewDeck = null; state.rquiz = null;
        state.idx = 0; state.flipped = false;
      }
      if (m === 'quiz' && state.lesson) state.quiz = buildQuiz(state.lesson);
      if (m === 'study' && state.lesson) {
        /* 从复习切回学习时恢复本课上次位置 */
        state.flipped = false;
        if (state.mode === 'review') state.idx = resumeIdx(DATA[state.lesson] || []);
      }
      state.query = '';
      $('#searchInput').value = '';
      state.mode = m;
      render();
      return;
    }

    if (t.closest('#theCard') && !t.closest('#speakFab')) {
      state.flipped = !state.flipped;
      var card = $('#theCard');
      if (card) card.classList.toggle('flipped', state.flipped);
      return;
    }
    if (t.closest('#speakFab')) {
      var w = currentCard();
      if (w) speak(w[0]);
      return;
    }
    if (t.closest('#prevBtn')) { move(-1); return; }
    if (t.closest('#nextBtn')) { move(1); return; }

    var jbtn = t.closest('.judge [data-lv]');
    if (jbtn) { judge(+jbtn.dataset.lv); return; }

    if (t.closest('#shuffleBtn')) {
      store.settings.shuffle = !store.settings.shuffle;
      saveStore();
      state.deckSig = null;
      render();
      return;
    }
    if (t.closest('#restartBtn')) {
      state.idx = 0;
      state.flipped = false;
      if (store.pos) delete store.pos[state.lesson];
      saveStore();
      render();
      return;
    }
    if (t.closest('#optKjBtn')) {
      store.settings.optKanji = !store.settings.optKanji;
      saveStore();
      render();
      return;
    }
    if (t.closest('#kanaBankBtn')) {
      store.settings.kanaBank = !store.settings.kanaBank;
      saveStore();
      render();
      return;
    }
    /* 假名点选：点磁贴补齐下一格，⌫ 退一格 */
    var kTile = t.closest('.ktile');
    if (kTile) { kanaBankTap(kTile.dataset.k, +kTile.dataset.ktile); return; }
    if (t.closest('#kbDel')) { kanaBankTap(null); return; }
    if (t.closest('#hideBtn')) {
      store.settings.hideKanji = !store.settings.hideKanji;
      saveStore();
      render();
      return;
    }
    if (t.closest('#proToggle')) {
      store.settings.showPro = false;
      saveStore();
      state.deckSig = null;
      render();
      return;
    }
    if (t.closest('#showProBtn')) {
      /* 临时将掌握词加回卡片队列 */
      store.settings.showPro = true;
      saveStore();
      state.deckSig = null;
      render();
      return;
    }
    var proBtn = t.closest('#proSeg [data-pro]');
    if (proBtn) {
      store.settings.proNeed = +proBtn.dataset.pro;
      saveStore();
      render();
      return;
    }
    if (t.closest('#againBtn')) {
      if (state.mode === 'review') {
        if (state.reviewPhase === 'quiz') {
          state.rquiz = buildReviewQuiz(state.reviewScope);
        } else {
          var again = poolOf(state.reviewScope);
          state.reviewDeck = again.length ? shuffle(again) : null;
          if (again.length) state.reviewDeckScope = state.reviewScope === 'pro' ? 'pro' : 'due';
        }
      }
      state.idx = 0; state.flipped = false;
      /* 重新一轮从头开始，清除旧位置 */
      if (state.mode !== 'review' && store.pos && store.pos[state.lesson]) {
        delete store.pos[state.lesson];
        saveStore();
      }
      render();
      return;
    }

    /* 测验 / 复习做题 */
    if (t.closest('#kanaSubmit')) { submitKana(); return; }
    var opt = t.closest('[data-opt]');
    if (opt) {
      if (state.mode === 'review') { reviewPick(+opt.dataset.opt); return; }
      if (!state.quiz) return;
      var q = state.quiz;
      var cur = q.qs[q.i];
      if (cur.picked !== null && cur.picked !== undefined) return;
      var pi = +opt.dataset.opt;
      cur.picked = pi;
      cur.correct = (pi === cur.answer);
      if (cur.correct) {
        q.score++;
        quizSettle(q, cur, true);
      } else {
        quizSettle(q, cur, false);
      }
      render();
      return;
    }
    if (t.closest('#replayBtn')) {
      var sess = state.mode === 'review' ? state.rquiz : state.quiz;
      if (sess && sess.qs && sess.qs[sess.i]) speak(sess.qs[sess.i].item[0]);
      return;
    }
    if (t.closest('#quizNext')) {
      if (state.mode === 'review') { if (state.rquiz) state.rquiz.i++; }
      else if (state.quiz) state.quiz.i++;
      render();
      return;
    }
    if (t.closest('#quizAgain')) {
      state.quiz = buildQuiz(state.lesson);
      render();
      return;
    }
    /* 结果页：只重练本轮错题 */
    if (t.closest('#retryWrong')) {
      var wsess = state.mode === 'review' ? state.rquiz : state.quiz;
      if (wsess && wsess.wrong && wsess.wrong.length) {
        var nq = buildWrongQuiz(wsess.wrong);
        nq.scope = state.mode === 'review' ? (wsess.scope || state.reviewScope) : null;
        if (state.mode === 'review') state.rquiz = nq;
        else state.quiz = nq;
      }
      render();
      return;
    }
    /* 每轮词数变化后重新组卷 */
    var qnBtn = t.closest('[data-qn]');
    if (qnBtn) {
      store.settings.quizQn = +qnBtn.dataset.qn;
      saveStore();
      if (state.mode === 'review') state.rquiz = buildReviewQuiz(state.reviewScope);
      else if (state.mode === 'quiz' && state.lesson) state.quiz = buildQuiz(state.lesson);
      render();
      return;
    }

    /* 学习 / 测验 / 词表页：生词表多选切换 */
    var qsegBtn = t.closest('[data-qseg]');
    if (qsegBtn && (state.mode === 'quiz' || state.mode === 'study' || state.mode === 'list') && state.lesson) {
      var segs = segsOf(state.lesson);
      var sv = qsegBtn.dataset.qseg;
      if (sv === 'all') {
        delete state.quizSegs[state.lesson];
      } else {
        var cur = state.quizSegs[state.lesson] ? state.quizSegs[state.lesson].slice()
          : segs.map(function (_, i) { return i; });
        var k = cur.indexOf(+sv);
        if (k >= 0) {
          if (cur.length <= 1) return;       /* 至少保留一个生词表 */
          cur.splice(k, 1);
        } else {
          cur.push(+sv);
          cur.sort(function (a, b) { return a - b; });
        }
        if (cur.length >= segs.length) delete state.quizSegs[state.lesson];
        else state.quizSegs[state.lesson] = cur;
      }
      state.deckSig = null;                  /* 按新范围重建卡片队列 */
      state.quiz = quizPool(state.lesson, segSel(state.lesson)).length ? buildQuiz(state.lesson) : null;
      render();
      return;
    }

    var qtBtn = t.closest('[data-qtype]');
    if (qtBtn) {
      var qid = qtBtn.dataset.qtype;
      var onMap = quizOn();
      var availIds;
      if (state.mode === 'review') {
        availIds = (state.rquiz && state.rquiz.avail) ||
          availTypesByWords(poolOf(state.reviewScope).map(function (c) { return c.w; }))
            .map(function (x) { return x.id; });
      } else {
        availIds = state.lesson ? availTypes(state.lesson).map(function (x) { return x.id; }) : null;
      }
      if (availIds && availIds.indexOf(qid) < 0) return;   /* 当前词池不支持的题型 */
      if (onMap[qid]) {
        /* 至少保留一种题型 */
        var left = QUIZ_TYPES.filter(function (x) { return onMap[x.id] && (!availIds || availIds.indexOf(x.id) >= 0); });
        if (left.length <= 1) return;
        onMap[qid] = false;
      } else {
        onMap[qid] = true;
      }
      saveStore();
      if (state.mode === 'review') state.rquiz = buildReviewQuiz(state.reviewScope);
      else if (state.mode === 'quiz' && state.lesson) state.quiz = buildQuiz(state.lesson);
      render();
      return;
    }

    /* 词表行 */
    var row = t.closest('#stage .wl-row[data-word]');
    if (row) {
      var wl = DATA[state.lesson] || [];
      var ww = wl[+row.dataset.word];
      if (ww) speak(ww[0]);
      return;
    }
    if (t.closest('#speakAll')) {
      /* 朗读当前页面显示的范围 */
      speakList(segWords(state.lesson, segSel(state.lesson)));
      return;
    }

    /* 搜索结果跳转 */
    var jump = t.closest('[data-jump]');
    if (jump) {
      state.query = '';
      $('#searchInput').value = '';
      selectLesson(+jump.dataset.jump, 'study');
      state.idx = +jump.dataset.idx;
      state.flipped = false;
      render();
      return;
    }

    if (t.closest('#menuBtn')) { openMenu(); return; }
    if (t.closest('#scrim')) { closeMenu(); return; }

    if (t.closest('#resetBtn')) {
      if (confirm('将清除全部学习记录，清除后无法恢复，可先通过「导出记录」备份 是否确定继续？')) {
        store = {
          marks: {}, today: { date: '', n: 0 }, history: {}, last: null,
          pos: {}, book: null, settings: store.settings
        };
        saveStore();
        render();
      }
      return;
    }
    if (t.closest('#exportBtn')) { exportStore(); return; }
    if (t.closest('#importBtn')) { var fi = $('#importFile'); if (fi) fi.click(); return; }
    var goalBtn = t.closest('[data-goal]');
    if (goalBtn) {
      store.settings.dailyGoal = +goalBtn.dataset.goal;
      saveStore();
      render();
      return;
    }
  });

  /* ---------- 触屏手势：左右滑切换、上滑掌握、下滑忘记 ---------- */
  var touch0 = null, suppressClick = false;
  document.addEventListener('touchstart', function (e) {
    var card = (e.target && e.target.closest) ? e.target.closest('#theCard') : null;
    if (!card) { touch0 = null; return; }
    var t = e.touches[0];
    touch0 = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!touch0) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touch0.x, dy = t.clientY - touch0.y;
    touch0 = null;
    /* 位移不足视为点击，由 click 处理翻面 */
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 56) return;
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 400);
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) move(1); else move(-1);
      return;
    }
    if (state.mode === 'study' || (state.mode === 'review' && state.reviewPhase === 'card')) {
      judge(dy < 0 ? LV_MAX : 1);
    }
  }, { passive: true });

  /* 导入：读取所选文件文本后校验并覆盖 */
  var importInput = $('#importFile');
  if (importInput) {
    importInput.addEventListener('change', function () {
      var f = importInput.files && importInput.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          if (importStore(String(fr.result))) render();
        } catch (e) {
          toast('导入失败：' + (e.message || '文件格式不对'), 'back');
        } finally {
          importInput.value = '';
        }
      };
      fr.onerror = function () {
        toast('导入失败：文件读取错误', 'back');
        importInput.value = '';
      };
      fr.readAsText(f);
    });
  }

  /* 搜索输入 */
  var si = $('#searchInput');
  si.addEventListener('input', function () {
    state.query = si.value;
    renderStage();
  });
  si.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { si.value = ''; state.query = ''; renderStage(); }
  });

  /* 输入题：键入与移动光标时同步长度格子 */
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'kanaInput') {
      syncKanaFill();
      if (kanaBankOn()) markBankUsed();
    }
  });
  document.addEventListener('selectionchange', function () {
    var a = document.activeElement;
    if (a && a.id === 'kanaInput') syncKanaFill();
  });
  /* 点击格子时将光标定位到对应格 */
  document.addEventListener('pointerdown', function (e) {
    var inp = e.target;
    if (!inp || inp.id !== 'kanaInput') return;
    if (inp.readOnly) return;                 /* 点选模式无需定位光标 */
    var cells = document.querySelectorAll('#kanaCells i');
    if (!cells.length) return;
    var idx = cells.length;
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { idx = i; break; }
    }
    e.preventDefault();
    try { inp.focus(); inp.setSelectionRange(idx, idx); } catch (err) {}
    syncKanaFill();
  });

  /* 键盘 */
  document.addEventListener('keydown', function (e) {
    /* 输入题：Enter 提交 */
    if (e.target && e.target.id === 'kanaInput' && e.key === 'Enter') {
      e.preventDefault();
      submitKana();
      return;
    }
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    if (state.mode === 'quiz' || (state.mode === 'review' && state.reviewPhase === 'quiz')) {
      if (e.key === 'Enter') {
        /* 点选模式下 Enter 同样提交 */
        if (document.getElementById('kanaInput') && !document.getElementById('quizNext')) {
          e.preventDefault();
          submitKana();
          return;
        }
        var nb = $('#quizNext'); if (nb) nb.click();
      }
      if (/^[1-4]$/.test(e.key)) { var ob = document.querySelectorAll('[data-opt]')[+e.key - 1]; if (ob) ob.click(); }
      return;
    }
    if (state.mode === 'study' || (state.mode === 'review' && state.reviewPhase === 'card')) {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        var c = $('#theCard');
        if (c) { state.flipped = !state.flipped; c.classList.toggle('flipped', state.flipped); }
      } else if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
      else if (e.key === '1') judge(1);
      else if (e.key === '2') judge(2);
      else if (e.key === '3') judge(3);
      else if (e.key.toLowerCase() === 's') { var w = currentCard(); if (w) speak(w[0]); }
    }
  });

  /* 关页或切到后台前保存位置 */
  window.addEventListener('beforeunload', function () { savePos(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') savePos();
  });

  /* 初始化 */
  var hashMatch = (location.hash || '').match(/L(\d+)([a-z]?)/);
  var hashModes = { q: 'quiz', v: 'list', r: 'review', p: 'review', s: 'study' };
  if (hashMatch && DATA[hashMatch[1]]) {
    state.lesson = +hashMatch[1];
    state.book = bookOfLesson(state.lesson);   /* 侧栏切换到该课所属册 */
    store.book = state.book;
    store.last = state.lesson;
    saveStore();
    state.mode = hashModes[hashMatch[2]] || 'study';
    if (hashMatch[2] === 'p') state.reviewScope = 'pro';
    else if (hashMatch[2] === 'r') state.reviewScope = 'due';
  } else if (store.last && DATA[store.last]) {
    state.lesson = store.last;
    state.mode = 'study';
  }
  render();
})();
