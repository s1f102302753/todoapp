const SUPABASE_URL = 'https://fpemvzgedgypjsaofvsn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwZW12emdlZGd5cGpzYW9mdnNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Nzc1MDksImV4cCI6MjEwMjM1MzUwOX0.cmoSJ2dZKuIUo_736g_KYIrM1f5EB8pkxHWQAlJcUsA';

// Supabaseライブラリの読み込み安全チェック
if (!window.supabase) {
  console.error('Supabase CDNが読み込まれていません。index.htmlの<script>タグを確認してください。');
}

const { createClient } = window.supabase || {};
const supabaseClient = createClient ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

let currentWeekId = null;
let currentUser = null;

// 通知の重複表示を防ぐフラグ
let shownMilestones = { '50': false, '80': false, '100': false };

// --- 認証処理 ---

async function loginWithGoogle() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });
  if (error) console.error('Login Error:', error.message);
}

async function logout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  window.location.reload();
}

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    const authSection = document.getElementById('authSection');
    const appSection = document.getElementById('appSection');
    const userInfo = document.getElementById('userInfo');

    if (session && session.user) {
      const isNewUser = !currentUser || currentUser.id !== session.user.id;
      currentUser = session.user;
      
      if (authSection) authSection.style.display = 'none';
      if (appSection) appSection.style.display = 'block';
      if (userInfo) userInfo.textContent = `${session.user.email} でログイン中`;
      
      if (isNewUser) {
        await requestNotificationPermission();
        init();
      }
    } else {
      currentUser = null;
      currentWeekId = null;
      if (authSection) authSection.style.display = 'block';
      if (appSection) appSection.style.display = 'none';
    }
  });
}

// --- アプリ本体処理 ---

async function init() {
  await loadWeekData();
}

async function loadWeekData() {
  if (!currentUser || !supabaseClient) return;

  let { data: weeks, error } = await supabaseClient
    .from('weeks')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Week Load Error:', error.message);
    return;
  }

  if (!weeks || weeks.length === 0) {
    const { data: newWeek, error: insertError } = await supabaseClient.from('weeks').insert([{
      goal: '今週の目標を設定しよう！',
      user_id: currentUser.id
    }]).select();

    if (insertError) {
      console.error('Week Insert Error:', insertError.message);
      return;
    }

    currentWeekId = newWeek[0].id;
    displayWeekInfo(newWeek[0]);
  } else {
    currentWeekId = weeks[0].id;
    displayWeekInfo(weeks[0]);
  }

  shownMilestones = { '50': false, '80': false, '100': false };
  await loadTasks();
}

function displayWeekInfo(week) {
  const goalElement = document.getElementById('goalDisplay');
  if (goalElement) {
    goalElement.textContent = week.goal || '目標未設定';
  }
}

async function loadTasks() {
  if (!currentWeekId || !currentUser || !supabaseClient) return;

  const { data: tasks, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .eq('week_id', currentWeekId)
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Task Load Error:', error.message);
    return;
  }

  const container = document.getElementById('taskList');
  if (!container) return;

  let totalTasks = tasks ? tasks.length : 0;
  let doneTasks = 0;
  let htmlContent = '';

  if (tasks) {
    tasks.forEach(task => {
      if (task.is_done) doneTasks++;
      htmlContent += `
        <div class="task-item ${task.is_done ? 'done' : ''}">
          <input type="checkbox" ${task.is_done ? 'checked' : ''} onchange="toggleTask('${task.id}', this.checked)">
          <span class="task-title">${escapeHtml(task.title)}</span>
          <button class="del-btn" onclick="deleteTask('${task.id}')">✕</button>
        </div>
      `;
    });
  }

  container.innerHTML = htmlContent;

  const percent = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  if (progressBar) progressBar.style.width = percent + '%';
  if (progressText) progressText.textContent = `${percent}% (${doneTasks}/${totalTasks})`;

  if (percent < 100) shownMilestones['100'] = false;
  if (percent < 80) shownMilestones['80'] = false;
  if (percent < 50) shownMilestones['50'] = false;

  return percent;
}

async function addTask() {
  const input = document.getElementById('taskInput');
  if (!input || !input.value.trim() || !currentWeekId || !currentUser || !supabaseClient) return;

  const { error } = await supabaseClient.from('tasks').insert([{
    week_id: currentWeekId,
    user_id: currentUser.id,
    day_of_week: 'all',
    title: input.value.trim(),
    is_done: false
  }]);

  if (error) {
    console.error('Task Insert Error:', error.message);
    return;
  }

  input.value = '';
  await loadTasks();
}

async function toggleTask(taskId, isDone) {
  if (!currentUser || !supabaseClient) return;

  await supabaseClient
    .from('tasks')
    .update({ is_done: isDone })
    .eq('id', taskId)
    .eq('user_id', currentUser.id);

  const percent = await loadTasks();
  checkAchievement(percent, isDone);
}

// 達成度チェック＆メッセージ通知処理
function checkAchievement(percent, isDone) {
  if (!isDone) return;

  if (percent === 100 && !shownMilestones['100']) {
    shownMilestones['100'] = true;
    const title = '全タスク達成！';
    const message = '素晴らしい！ゆうなちゃんはやればできる子だね。おつかれさま！';
    const emoji = '👑';
    showRewardModal(emoji, title, message);
    sendNativeNotification(title, message, emoji);
    triggerConfetti(120);
  } else if (percent >= 80 && percent < 100 && !shownMilestones['80']) {
    shownMilestones['80'] = true;
    const title = 'あと少し！';
    const message = '達成率80%突破！ゆうなちゃんは頑張り屋さんだね';
    const emoji = '🔥';
    showRewardModal(emoji, title, message);
    sendNativeNotification(title, message, emoji);
    triggerConfetti(50);
  } else if (percent >= 50 && percent < 80 && !shownMilestones['50']) {
    shownMilestones['50'] = true;
    const title = '折り返し地点！';
    const message = '達成率50%突破！ゆうなちゃん応援しているよ！！✨';
    const emoji = '🌟';
    showRewardModal(emoji, title, message);
    sendNativeNotification(title, message, emoji);
    triggerConfetti(30);
  }
}

// モーダル表示（安全化）
function showRewardModal(emoji, title, message) {
  const modal = document.getElementById('rewardModal');
  const emojiEl = document.getElementById('rewardEmoji');
  const titleEl = document.getElementById('rewardTitle');
  const msgEl = document.getElementById('rewardMessage');

  if (emojiEl) emojiEl.textContent = emoji;
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (modal) modal.style.display = 'flex';
}

function closeRewardModal() {
  const modal = document.getElementById('rewardModal');
  if (modal) modal.style.display = 'none';
}

// 紙吹雪エフェクト
function triggerConfetti(count) {
  if (typeof confetti === 'function') {
    confetti({ particleCount: count, spread: 80, origin: { y: 0.6 } });
  }
}

async function deleteTask(taskId) {
  if (!currentUser || !supabaseClient) return;

  await supabaseClient
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('user_id', currentUser.id);

  loadTasks();
}

async function updateGoal() {
  const input = document.getElementById('goalInput');
  if (!input || !input.value.trim() || !currentWeekId || !currentUser || !supabaseClient) return;

  await supabaseClient
    .from('weeks')
    .update({ goal: input.value.trim() })
    .eq('id', currentWeekId)
    .eq('user_id', currentUser.id);

  const goalElement = document.getElementById('goalDisplay');
  if (goalElement) goalElement.textContent = input.value.trim();
  input.value = '';
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

// --- OS・ブラウザ標準のWeb通知処理 ---

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;

  if (Notification.permission === 'granted') return true;

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  return false;
}

function sendNativeNotification(title, message, emoji = '🎉') {
  if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(`${emoji} ${title}`, {
      body: message,
      icon: 'https://cdn-icons-png.flaticon.com/512/190/190411.png',
      tag: 'weekly-planner-achievement'
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

// グローバル関数への明示的割り当て
window.closeRewardModal = closeRewardModal;
window.toggleTask = toggleTask;
window.deleteTask = deleteTask;
window.addTask = addTask;
window.updateGoal = updateGoal;
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;