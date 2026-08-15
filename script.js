const SUPABASE_URL = 'https://fpemvzgedgypjsaofvsn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwZW12emdlZGd5cGpzYW9mdnNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Nzc1MDksImV4cCI6MjEwMjM1MzUwOX0.cmoSJ2dZKuIUo_736g_KYIrM1f5EB8pkxHWQAlJcUsA';


const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentWeekId = null;

async function init() {
  await loadWeekData();
}

async function loadWeekData() {
  let { data: weeks } = await supabaseClient.from('weeks').select('*').order('created_at', { ascending: false }).limit(1);

  if (!weeks || weeks.length === 0) {
    const { data: newWeek } = await supabaseClient.from('weeks').insert([{
      goal: '今週の目標を設定しよう！'
    }]).select();
    currentWeekId = newWeek[0].id;
    displayWeekInfo(newWeek[0]);
  } else {
    currentWeekId = weeks[0].id;
    displayWeekInfo(weeks[0]);
  }

  await loadTasks();
}

function displayWeekInfo(week) {
  document.getElementById('goalDisplay').textContent = week.goal || '目標未設定';
}

async function loadTasks() {
  const { data: tasks } = await supabaseClient.from('tasks').select('*').eq('week_id', currentWeekId).order('created_at', { ascending: true });

  const container = document.getElementById('taskList');
  container.innerHTML = '';

  let totalTasks = tasks ? tasks.length : 0;
  let doneTasks = 0;

  if (tasks) {
    tasks.forEach(task => {
      if (task.is_done) doneTasks++;
      container.innerHTML += `
        <div class="task-item ${task.is_done ? 'done' : ''}">
          <input type="checkbox" ${task.is_done ? 'checked' : ''} onchange="toggleTask('${task.id}', this.checked)">
          <span class="task-title">${escapeHtml(task.title)}</span>
          <button class="del-btn" onclick="deleteTask('${task.id}')">✕</button>
        </div>
      `;
    });
  }

  // 進捗バーの更新
  const percent = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);
  document.getElementById('progressBar').style.width = percent + '%';
  document.getElementById('progressText').textContent = `${percent}% (${doneTasks}/${totalTasks})`;
}

async function addTask() {
  const input = document.getElementById('taskInput');
  if (!input.value.trim()) return;

  await supabaseClient.from('tasks').insert([{
    week_id: currentWeekId,
    day_of_week: 'all', // 曜日固定をなくし一括管理
    title: input.value.trim(),
    is_done: false
  }]);

  input.value = '';
  loadTasks();
}

async function toggleTask(taskId, isDone) {
  await supabaseClient.from('tasks').update({ is_done: isDone }).eq('id', taskId);
  if (isDone) {
    confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
  }
  loadTasks();
}

async function deleteTask(taskId) {
  await supabaseClient.from('tasks').delete().eq('id', taskId);
  loadTasks();
}

async function updateGoal() {
  const input = document.getElementById('goalInput');
  if (!input.value.trim()) return;

  await supabaseClient.from('weeks').update({ goal: input.value.trim() }).eq('id', currentWeekId);
  document.getElementById('goalDisplay').textContent = input.value.trim();
  input.value = '';
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

init();