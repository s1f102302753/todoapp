const SUPABASE_URL = 'https://fpemvzgedgypjsaofvsn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwZW12emdlZGd5cGpzYW9mdnNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Nzc1MDksImV4cCI6MjEwMjM1MzUwOX0.cmoSJ2dZKuIUo_736g_KYIrM1f5EB8pkxHWQAlJcUsA';

if (!window.supabase) {
  console.error('Supabase CDNが読み込まれていません。index.htmlの<script>の順番を確認してください。');
}

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

let currentWeekId = null;
let currentUser = null;

// --- 認証処理 ---

async function loginWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });
  if (error) console.error('Login Error:', error.message);
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.reload();
}

// 認証状態のリアルタイム監視
supabaseClient.auth.onAuthStateChange((event, session) => {
  const authSection = document.getElementById('authSection');
  const appSection = document.getElementById('appSection');
  const userInfo = document.getElementById('userInfo');

  if (session && session.user) {
    const isNewUser = !currentUser || currentUser.id !== session.user.id;
    currentUser = session.user;
    
    if (authSection) authSection.style.display = 'none';
    if (appSection) appSection.style.display = 'block';
    if (userInfo) userInfo.textContent = `${session.user.email} でログイン中`;
    
    // ユーザーが変わった場合のみ初期化処理を実行（重複ロード防止）
    if (isNewUser) {
      init();
    }
  } else {
    currentUser = null;
    currentWeekId = null;
    if (authSection) authSection.style.display = 'block';
    if (appSection) appSection.style.display = 'none';
  }
});

// --- アプリ本体処理（weeks / tasks） ---

async function init() {
  await loadWeekData();
}

async function loadWeekData() {
  if (!currentUser) return;

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

  await loadTasks();
}

function displayWeekInfo(week) {
  const goalElement = document.getElementById('goalDisplay');
  if (goalElement) {
    goalElement.textContent = week.goal || '目標未設定';
  }
}

async function loadTasks() {
  if (!currentWeekId || !currentUser) return;

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
}

async function addTask() {
  const input = document.getElementById('taskInput');
  if (!input || !input.value.trim() || !currentWeekId || !currentUser) return;

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
  loadTasks();
}

async function toggleTask(taskId, isDone) {
  if (!currentUser) return;
  // 自分のデータのみ更新できるように user_id を指定
  await supabaseClient
    .from('tasks')
    .update({ is_done: isDone })
    .eq('id', taskId)
    .eq('user_id', currentUser.id);

  if (isDone && typeof confetti === 'function') {
    confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
  }
  loadTasks();
}

async function deleteTask(taskId) {
  if (!currentUser) return;
  // 自分のデータのみ削除できるように user_id を指定
  await supabaseClient
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('user_id', currentUser.id);

  loadTasks();
}

async function updateGoal() {
  const input = document.getElementById('goalInput');
  if (!input || !input.value.trim() || !currentWeekId || !currentUser) return;

  // 自分のデータのみ更新できるように user_id を指定
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
