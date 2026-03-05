/**
 * Очередь задач на основе JSON-файла
 * Замена Redis/BullMQ для проектов без внешних зависимостей
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const JOBS_FILE = path.join(__dirname, "..", "data", "jobs.json");
const MAX_ATTEMPTS = 3;

function readJobs() {
  try { return JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")); }
  catch { return []; }
}

function writeJobs(jobs) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf-8");
}

/**
 * Создать задачу
 * @param {string} appointmentId - ID записи
 * @param {string} kind - "pre_confirm_30m" | "no_response_10m"
 * @param {Date|string} runAt - когда выполнить
 * @returns {object} созданная задача
 */
function createJob(appointmentId, kind, runAt) {
  const jobs = readJobs();
  const idempotencyKey = `${appointmentId}:${kind}`;

  // Идемпотентность: не создаём дубликат
  const existing = jobs.find(j => j.idempotencyKey === idempotencyKey && j.state !== "failed");
  if (existing) {
    console.log(`⏭️  Job уже существует: ${idempotencyKey} (state: ${existing.state})`);
    return existing;
  }

  const job = {
    id: crypto.randomBytes(8).toString("hex"),
    appointmentId,
    kind,
    runAt: new Date(runAt).toISOString(),
    state: "scheduled", // scheduled | running | done | failed
    attempts: 0,
    lastError: null,
    idempotencyKey,
    createdAt: new Date().toISOString(),
  };

  jobs.push(job);
  writeJobs(jobs);
  console.log(`📋 Job создан: ${kind} для записи ${appointmentId} на ${job.runAt}`);
  return job;
}

/**
 * Получить задачи, готовые к выполнению
 * @returns {Array} задачи, которые пора выполнять
 */
function getDueJobs() {
  const now = new Date();
  const jobs = readJobs();
  return jobs.filter(j =>
    j.state === "scheduled" &&
    new Date(j.runAt) <= now
  );
}

/**
 * Обновить состояние задачи
 */
function updateJob(jobId, updates) {
  const jobs = readJobs();
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return null;
  Object.assign(jobs[idx], updates);
  writeJobs(jobs);
  return jobs[idx];
}

/**
 * Пометить задачу как "в процессе"
 */
function markRunning(jobId) {
  return updateJob(jobId, {
    state: "running",
    attempts: (readJobs().find(j => j.id === jobId)?.attempts || 0) + 1,
  });
}

/**
 * Пометить задачу как завершённую
 */
function markDone(jobId) {
  return updateJob(jobId, { state: "done" });
}

/**
 * Пометить задачу как проваленную (с возможностью повтора)
 */
function markFailed(jobId, error) {
  const jobs = readJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job) return null;

  const attempts = job.attempts || 0;
  const newState = attempts >= MAX_ATTEMPTS ? "failed" : "scheduled";

  return updateJob(jobId, {
    state: newState,
    lastError: String(error).substring(0, 500),
    // Retry через 1/2/4 минуты (экспоненциальный бэкофф)
    runAt: newState === "scheduled"
      ? new Date(Date.now() + Math.pow(2, attempts) * 60000).toISOString()
      : job.runAt,
  });
}

/**
 * Отменить все задачи для записи
 */
function cancelJobsForAppointment(appointmentId) {
  const jobs = readJobs();
  let cancelled = 0;
  jobs.forEach(j => {
    if (j.appointmentId === appointmentId && j.state === "scheduled") {
      j.state = "done";
      j.lastError = "Отменено (запись изменена)";
      cancelled++;
    }
  });
  writeJobs(jobs);
  if (cancelled > 0) console.log(`🚫 Отменено ${cancelled} задач для записи ${appointmentId}`);
  return cancelled;
}

/**
 * Получить все задачи для записи
 */
function getJobsForAppointment(appointmentId) {
  return readJobs().filter(j => j.appointmentId === appointmentId);
}

/**
 * Создать пару задач для записи (30 мин + 10 мин до визита)
 */
function scheduleConfirmationJobs(booking) {
  const appointmentTime = new Date(`${booking.date}T${booking.time}:00`);

  // 30 минут до записи
  const pre30 = new Date(appointmentTime.getTime() - 30 * 60 * 1000);
  // 10 минут до записи
  const pre10 = new Date(appointmentTime.getTime() - 10 * 60 * 1000);

  const now = new Date();

  // Создаём только если время ещё не прошло
  if (pre30 > now) {
    createJob(booking.id, "pre_confirm_30m", pre30);
  } else {
    console.log(`⚠️  Время для pre_confirm_30m уже прошло для записи ${booking.id}`);
  }

  if (pre10 > now) {
    createJob(booking.id, "no_response_10m", pre10);
  } else {
    console.log(`⚠️  Время для no_response_10m уже прошло для записи ${booking.id}`);
  }
}

module.exports = {
  createJob,
  getDueJobs,
  updateJob,
  markRunning,
  markDone,
  markFailed,
  cancelJobsForAppointment,
  getJobsForAppointment,
  scheduleConfirmationJobs,
  readJobs,
};
